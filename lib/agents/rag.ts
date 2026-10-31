/**
 * RAG agent — Week 3. Returns TEXT (never streams).
 *
 * Exact scope becomes Pinecone metadata filters; the remaining note meaning is
 * handled by embeddings and reranking. Similarity is fuzzy, identity is exact.
 */

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "../openai";
import { findPatientByName } from "../patients";
import {
  searchClinicalNotes,
  type VectorSearchFilters,
} from "../vector-search";

const RagScopeSchema = z.object({
  patientName: z
    .string()
    .nullable()
    .describe(
      "Full patient name explicitly stated in the search; otherwise null.",
    ),
  noteDate: z
    .string()
    .nullable()
    .describe("Exact clinical-note date in YYYY-MM-DD format; otherwise null."),
});

function normalizeNoteDate(value: string | null): string | null {
  if (!value) return null;

  // Already in the format Pinecone stores.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

const FILTER_PROMPT = `
Extract only the patient and exact note date explicitly stated in this
clinical-note search.

Rules:
- Do not answer the question.
- Never invent a patient or date.
- Use noteDate for one exact note date.
- Leave either field null when it is not explicitly stated.
- Return noteDate in YYYY-MM-DD format when possible.
`;

export async function runRag(semanticQuery: string): Promise<string> {
  const response = await openai.responses.parse({
    model: "gpt-6-luna",
    input: [
      { role: "system", content: FILTER_PROMPT },
      { role: "user", content: semanticQuery },
    ],
    text: {
      format: zodTextFormat(RagScopeSchema, "rag_scope"),
    },
    reasoning: { effort: "none" },
  });

  const { patientName, noteDate: extractedNoteDate } = RagScopeSchema.parse(
    response.output_parsed,
  );

  const noteDate = normalizeNoteDate(extractedNoteDate);

  if (extractedNoteDate && !noteDate) {
    return `I couldn't understand the note date "${extractedNoteDate}".`;
  }

  let patientId: string | null = null;

  if (patientName) {
    const patients = await findPatientByName(patientName);

    if (patients.length === 0) {
      return `No patient named ${patientName} was found.`;
    }

    if (patients.length > 1) {
      return `Multiple patients named ${patientName} were found. Ask for a more specific name.`;
    }

    patientId = patients[0].id;

  }

  const filters: VectorSearchFilters = {
    age: null,
    minAge: null,
    maxAge: null,
    city: null,
    state: null,
    gender: null,
    race: null,
    patientId,
    source: null,
    noteDate,
    noteStartDate: null,
    noteEndDateExclusive: null,
    noteYear: null,
    noteType: null,
  };

  const { rerankedMatches } = await searchClinicalNotes(semanticQuery, {
    topK: 100,
    topN: 5,
    filters,
  });

  if (rerankedMatches.length === 0) {
    return "No clinical notes matched the semantic query and metadata filters.";
  }

  return rerankedMatches
    .map((match) =>
      [
        `<clinical-note rank="${match.rerankRank}" id="${match.id}">`,
        `patientId: ${match.metadata.patientId}`,
        `date: ${match.metadata.noteDate ?? "unknown"}`,
        `type: ${match.metadata.noteType ?? "unknown"}`,
        `content:\n${match.content}`,
        "</clinical-note>",
      ].join("\n"),
    )
    .join("\n\n");
}
