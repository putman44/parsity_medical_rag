/**
 * Scheduling Intent Detection
 *
 * Week 3 · YOUR TASK · assignment: docs/CHALLENGE-TOOL-CALLING.md
 *
 * Detects when a user wants to schedule an appointment and extracts relevant info.
 * This is the LLM component of the human-in-the-loop pattern.
 */

import { zodTextFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";
import type { Message } from "./agent";
import { openai } from "./openai";

/**
 * TODO: Define a Zod schema for the scheduling intent and infer this type
 * from it (`z.infer<typeof SchedulingIntentSchema>`). Fields:
 * - patientName: string | null - Name of the patient to schedule
 * - suggestedDate: string | null - Date in YYYY-MM-DD format
 * - suggestedTime: string | null - Time in HH:MM 24h format
 * - reason: string | null - Appointment reason if mentioned
 */

const SchedulingIntentSchema = z.object({
  patientName: z.string().min(1).nullable(),
  suggestedDate: z.iso.date().nullable(),
  suggestedTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  reason: z.string().nullable(),
});

export type SchedulingIntent = z.infer<typeof SchedulingIntentSchema>;
/**
 * Analyze a query for scheduling intent
 *
 * TODO: Implement this function
 * 1. Use openai.responses.parse() with zodTextFormat (see CLAUDE.md)
 * 2. System prompt should:
 *    - Explain the task (detect appointment scheduling requests)
 *    - Include today's date for relative date parsing
 *    - Explain how to parse "next Tuesday", "tomorrow", etc.
 *    - Use the history to resolve "her" / "that patient" to a name
 * 3. Return the parsed scheduling intent
 */
export async function detectSchedulingIntent(
  query: string,
  history: Message[] = [],
): Promise<SchedulingIntent> {
  // 1. Get today's date
  const today = new Date().toISOString().split("T")[0];

  // 2. Build a system prompt
  const SCHEDULING_PROMPT = `
You are extracting scheduling information from a patient appointment request.

Today's date is: ${today}

Use the conversation history when necessary to determine the patient's name,
especially when the user says "her", "him", "them", or "that patient".

Rules:
- Do not answer the user's question.
- Never invent a patient, date, time, or reason.
- Do not schedule appointments for dates before today's date.
- Convert relative dates such as "tomorrow" or "next Tuesday" into YYYY-MM-DD.
- Convert times such as "2pm" into 24-hour HH:MM format.
- If no patient name is provided or resolvable from history, return null.
- If no date is provided, return null.
- If no time is provided, return null.
- If no appointment reason is given, return null.
- Interpret "next [weekday]" as the first occurrence of that weekday after today's date.
- For example, if today is Sunday and the user says "next Tuesday",
  use the Tuesday two days from now, not the Tuesday of the following week.
`;

  // 3. Ask the model for structured output
  const response = await openai.responses.parse({
    model: "gpt-6-luna",
    input: [
      {
        role: "system",
        content: SCHEDULING_PROMPT,
      },

      // 4. Include conversation history
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),

      // 5. Include current user query
      {
        role: "user",
        content: query,
      },
    ],

    // 6. Tell OpenAI to follow your Zod schema
    text: {
      format: zodTextFormat(SchedulingIntentSchema, "scheduling_scope"),
    },

    reasoning: { effort: "none" },
  });

  // 7. Validate / extract the structured result
  const intent = SchedulingIntentSchema.parse(response.output_parsed);

  // 8. Return it
  return intent;
}

/**
 * Build the scheduling action object the UI card needs, or null if this isn't
 * a bookable request. The route sends this in the X-Scheduling-Action header.
 */
export function buildSchedulingAction(intent: SchedulingIntent) {
  if (!intent.patientName) {
    return null;
  }
  return {
    type: "scheduling_action" as const,
    patientName: intent.patientName,
    suggestedDate: intent.suggestedDate || getDefaultDate(),
    suggestedTime: intent.suggestedTime || "09:00",
    reason: intent.reason,
  };
}

/**
 * Get default date (next business day)
 */
export function getDefaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);

  // Skip weekends
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }

  return date.toISOString().split("T")[0];
}
