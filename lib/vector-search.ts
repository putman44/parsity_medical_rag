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
import { pinecone } from "./pinecone";

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

export async function searchClinicalNotes(
  query: string,
  options: VectorSearchOptions = {},
): Promise<string> {
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

  const matchesWithScores = results.matches.map((match) => ({
    id: match.id,
    score: match.score,
    content: match.metadata?.content as string,
    metadata: match.metadata,
  }));

  // console.log(JSON.stringify(matchesWithScores, null, 2));

  // filter out scores below 0.3
  const filteredMatches = matchesWithScores.filter(
    (match) => match?.score && match.score > 0.3,
  );

  if (filteredMatches.length === 0) {
    return "No clinical notes matched the search and metadata filters.";
  }

  const docs: string[] = filteredMatches.map(
    (match) => `note: ${match.metadata?.content}`,
  );

  const reranked = await pinecone.inference.rerank({
    model: "bge-reranker-v2-m3",
    query: query,
    documents: docs,
    topN,
  });

  // scores against the query and the doc

  // console.log(JSON.stringify(reranked.data, null, 2));

  return reranked.data.map((result) => result.document?.text).join("\n");
}
