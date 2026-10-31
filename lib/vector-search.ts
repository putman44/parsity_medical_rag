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

import {
  buildPineconeFilter,
  type VectorSearchFilters,
} from "./vector-filters";
import { createEmbedding } from "./openai";
import { pinecone, type MedicalNoteMetadata } from "./pinecone";

export {
  VectorFiltersSchema,
  type VectorFilters,
} from "./vector-filters";

export { buildPineconeFilter, type VectorSearchFilters };

export type VectorSearchOptions = {
  topK?: number; // candidates the cosine search fetches
  topN?: number; // candidates kept after reranking
  filters?: VectorSearchFilters | null; // structured values extracted from the question
  filter?: Record<string, unknown>; // direct Pinecone filter for existing callers
};

export type ClinicalNoteMatch = {
  id: string;
  content: string;
  metadata: MedicalNoteMetadata;
  cosineScore: number;
  cosineRank: number;
};

export type RerankedClinicalNoteMatch = ClinicalNoteMatch & {
  rerankScore: number;
  rerankRank: number;
};

export type ClinicalNoteSearchResult = {
  cosineMatches: ClinicalNoteMatch[];
  rerankedMatches: RerankedClinicalNoteMatch[];
};

export async function searchClinicalNotes(
  query: string,
  options: VectorSearchOptions = {},
): Promise<ClinicalNoteSearchResult> {
  const { topK = 10, topN = 5, filters, filter } = options;
  const pineconeFilter = filter ?? buildPineconeFilter(filters);

  // query -> string[]
  const embedding = await createEmbedding(query);
  // search pinecone
  const results = await pinecone.index(process.env.PINECONE_INDEX!).query({
    vector: embedding, //query represented as 1536 vector
    topK,
    includeMetadata: true, // content we got race / gender / age / etc.
    filter: pineconeFilter,
  });

  const cosineMatches = results.matches.map((match, index) => {
    const { content, ...metadata } = match.metadata ?? {};

    return {
      id: match.id,
      content: typeof content === "string" ? content : "",
      metadata: metadata as MedicalNoteMetadata,
      cosineScore: match.score ?? 0,
      cosineRank: index + 1,
    };
  });

  // filter out scores below 0.3
  const filteredMatches = cosineMatches.filter(
    (match) => match.cosineScore > 0.3,
  );

  if (filteredMatches.length === 0) {
    return { cosineMatches, rerankedMatches: [] };
  }

  const docs: string[] = filteredMatches.map(
    (match) => `note: ${match.content}`,
  );

  const reranked = await pinecone.inference.rerank({
    model: "bge-reranker-v2-m3",
    query: query,
    documents: docs,
    topN,
  });

  // scores against the query and the doc

  const rerankedMatches = reranked.data.flatMap((result, index) => {
    const match = filteredMatches[result.index];
    if (!match) return [];

    return [
      {
        ...match,
        rerankScore: result.score,
        rerankRank: index + 1,
      },
    ];
  });

  return { cosineMatches, rerankedMatches };
}
