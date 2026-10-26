/**
 * Vector search over the clinical notes — Week 2, built together in class.
 *
 * The shape we're building, two-stage retrieval in one call:
 *   1. embed the query, ask Pinecone for the nearest topK notes (wide, cheap)
 *   2. rerank those candidates against the query, keep topN (narrow, careful)
 *
 * Returns both lists so you can log them side by side and SEE what reranking
 * changed on a given query.
 */

import type { SearchResult } from './pinecone';
import { createEmbedding } from './openai';
import { pinecone } from './pinecone';
import { z } from 'zod';

export const VectorFiltersSchema = z.object({
  age: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Exact age in years stated in the question; null if none."),
  minAge: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Inclusive minimum age, if stated; otherwise null."),
  maxAge: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Inclusive maximum age, if stated; otherwise null."),
  city: z
    .string()
    .min(1)
    .nullable()
    .describe("City named in the question; null if none."),
  state: z
    .string()
    .length(2)
    .nullable()
    .describe(
      "Two-letter US state code, such as MA for Massachusetts; null if none.",
    ),
  gender: z
    .enum(["male", "female"])
    .nullable()
    .describe("Patient gender stated in the question; null if none."),
  race: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Race as stored in the note metadata, such as Black or African American; null if none.",
    ),
  firstName: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "First-name-only constraint, if explicitly requested; null otherwise.",
    ),
  lastName: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Last-name-only constraint, if explicitly requested; null otherwise.",
    ),
  patientName: z
    .string()
    .min(1)
    .nullable()
    .describe("Full name of a specific patient, if stated; null otherwise."),
  patientId: z
    .string()
    .uuid()
    .nullable()
    .describe(
      "Patient UUID only if explicitly present in the question; never guess it.",
    ),
  currentMedication: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Exact medication name from the currentMedications metadata, if stated; null otherwise.",
    ),
  source: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Note source, such as postgres, only if explicitly requested; null otherwise.",
    ),
});

export type VectorFilters = z.infer<typeof VectorFiltersSchema>;
export type VectorSearchFilters = Omit<VectorFilters, "patientName">;

export function buildPineconeFilter(
  values: VectorSearchFilters | null | undefined,
): Record<string, unknown> | undefined {
  if (!values) return undefined;

  const filter: Record<string, unknown> = {};
  if (values.age != null) {
    filter.age = { $eq: values.age };
  } else if (values.minAge != null || values.maxAge != null) {
    filter.age = {
      ...(values.minAge != null && { $gte: values.minAge }),
      ...(values.maxAge != null && { $lte: values.maxAge }),
    };
  }

  for (const key of [
    "city",
    "state",
    "gender",
    "race",
    "firstName",
    "lastName",
    "source",
  ] as const) {
    const value = values[key];
    if (value) {
      filter[key] = { $eq: key === "state" ? value.toUpperCase() : value };
    }
  }
  if (values.currentMedication) {
    filter.currentMedications = { $in: [values.currentMedication] };
  }
  if (values.patientId) filter.patientId = { $eq: values.patientId };

  return Object.keys(filter).length ? filter : undefined;
}


export type VectorSearchOptions = {
	topK?: number; // candidates the cosine search fetches
	topN?: number; // candidates kept after reranking
	filters?: VectorSearchFilters | null; // structured metadata values
	filter?: Record<string, unknown>; // direct Pinecone metadata filter
};

export async function searchClinicalNotes(
	query: string,
	options: VectorSearchOptions = {},
): Promise<string> {
	const pineconeFilter = options.filter ?? buildPineconeFilter(options.filters);
	// query -> string[]
	const embedding = await createEmbedding(query);
	// search pinecone
	const results = await pinecone.index(process.env.PINECONE_INDEX!).query({
		vector: embedding, //query represented as 1536 vector
		topK: 10,
		includeMetadata: true, // contnet we got race / gender / age / etc.
		filter: pineconeFilter,
	});

	const matchesWithScores = results.matches.map((match) => ({
		id: match.id,
		score: match.score,
		content: match.metadata?.content as string,
		metadata: match.metadata,
	}));

	// filter -> terrible matches

	// cosine similarity agains the query and the doc

	console.log(JSON.stringify(matchesWithScores, null, 2));

	// filter out scores below 0.3
	const filteredMatches = matchesWithScores.filter(
		(match) => match?.score && match.score > 0.3,
	);

	const docs: string[] = filteredMatches.map(
		(match) =>
			`note: ${match.metadata?.content} \n\n metadata: ${JSON.stringify(match.metadata)}`,
	);

	if (filteredMatches.length === 0) {
		return 'No clinical notes matched the search and metadata filters.';
	}

	const reranked = await pinecone.inference.rerank({
		model: 'bge-reranker-v2-m3',
		query: query, //text
		documents: docs, //text
		topN: 5,
	});

	// scores against the query and the doc

	console.log(JSON.stringify(reranked.data, null, 2));

	return reranked.data.map((result) => result.document?.text).join('\n');
}
