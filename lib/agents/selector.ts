/**
 * SELECTOR agent — Week 3. Structured output only (never streams).
 *
 * Week 3 · assignment: docs/CHALLENGE-TOOL-CALLING.md
 *
 * The selector just ROUTES: does this question need the SQL database (structured
 * facts, counts, filters), the clinical notes (meaning-based search), both, or
 * neither (a general question)? It does NOT extract conditions/filters/entities —
 * the SQL agent's LLM does that when it writes the query. Keep it tiny.
 *
 * Use the Responses API + zodTextFormat (see CLAUDE.md).
 */

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Message } from "../agent";
import { openai } from "../openai";

export const PlanSchema = z.object({
  useSql: z
    .boolean()
    .describe(
      "Whether the question needs structured database facts, counts, or exact lookups.",
    ),

  useRag: z
    .boolean()
    .describe(
      "Whether the question needs meaning-based search of clinical notes.",
    ),

  useScheduler: z
    .boolean()
    .describe("Whether the user requests a scheduling action."),

  needsSearch: z
    .boolean()
    .describe(
      "Whether the question requires clinic records; false for general questions.",
    ),

  semanticQuery: z
    .string()
    .describe(
      "Standalone request for the RAG worker, including any patient or date scope it needs; empty when useRag is false.",
    ),
});

const ROUTING_PROMPT = `
You are a routing agent for a medical-record assistant.

Do not answer the user's question. Produce only a plan describing which workers
are needed.

Routing rules:
- Use SQL for exact facts, dates, identities, counts, and structured filters.
- Use RAG when the answer requires understanding the meaning of clinical notes.
- Enable both SQL and RAG when both structured facts and note meaning are needed.
- Use the scheduler only when the user explicitly requests a scheduling action.
- Set needsSearch to false only for general questions that do not require clinic records.
- When useRag is true, semanticQuery must be a standalone clinical-note search request.
- When useRag is false, semanticQuery must be an empty string.
`;

export type Plan = z.infer<typeof PlanSchema>;

export async function select(
  query: string,
  history: Message[] = [],
): Promise<Plan> {
  const response = await openai.responses.parse({
    model: "gpt-6-luna",
    input: [
      {
        role: "system",
        content: ROUTING_PROMPT,
      },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: query,
      },
    ],
    text: {
      format: zodTextFormat(PlanSchema, "selector_plan"),
    },
    reasoning: { effort: "none" },
  });

  return PlanSchema.parse(response.output_parsed);
}
