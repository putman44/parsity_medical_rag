import { aggregate } from "@/lib/agents/aggregator";
import { runRag } from "@/lib/agents/rag";
import { select } from "@/lib/agents/selector";
import { runSql } from "@/lib/agents/sql";
import {
  buildSchedulingAction,
  detectSchedulingIntent,
} from "@/lib/scheduling";
import { z } from "zod";

const ChatRequestSchema = z.object({
  query: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
});

/**
 * The chat pipeline — Week 3. This route is the orchestrator:
 *
 *   request -> select -> SQL and/or RAG -> aggregate -> text stream
 *
 * The route decides when each worker runs. The workers own how their work is
 * done, and the aggregator is the only part that streams an answer.
 */
export async function POST(request: Request) {
  try {
    const { query, messages } = ChatRequestSchema.parse(await request.json());
    const plan = await select(query, messages);

    // Scheduling is intentionally a later workflow. Keeping this branch here
    // prevents a scheduling request from accidentally becoming a data search.
    if (plan.useScheduler) {
      const schedule = await detectSchedulingIntent(query, messages);

      const action = buildSchedulingAction(schedule);

      if (!action) {
        return new Response(
          "Who would you like to schedule the appointment for?",
          { status: 200 },
        );
      }

      return new Response(
        "I found the appointment details. Please confirm below.",
        {
          status: 200,
          headers: {
            "X-Scheduling-Action": encodeURIComponent(JSON.stringify(action)),
          },
        },
      );
    }

    if (plan.needsSearch && !plan.useSql && !plan.useRag) {
      throw new Error(
        "The selector requested a search without choosing a worker.",
      );
    }

    const [sqlResults, ragResults] = await Promise.all([
      plan.useSql ? runSql(query, messages) : Promise.resolve(""),
      plan.useRag ? runRag(plan.semanticQuery) : Promise.resolve(""),
    ]);

    const results = [
      sqlResults && `<sql-results>\n${sqlResults}\n</sql-results>`,
      ragResults && `<rag-results>\n${ragResults}\n</rag-results>`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return aggregate(query, messages, results).toTextStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response("Invalid chat request.", { status: 400 });
    }

    console.error("Chat error:", error);
    return new Response(
      error instanceof Error ? error.message : "Internal server error",
      { status: 500 },
    );
  }
}
