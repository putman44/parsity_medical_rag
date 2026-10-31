import {
  buildPineconeFilter,
  type VectorSearchFilters,
} from "@/lib/vector-filters";
import { createEmbedding } from "@/lib/openai";
import { pinecone } from "@/lib/pinecone";
import { searchClinicalNotes } from "@/lib/vector-search";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openai", () => ({
  createEmbedding: vi.fn(),
}));

vi.mock("@/lib/pinecone", () => ({
  pinecone: {
    index: vi.fn(),
    inference: {
      rerank: vi.fn(),
    },
  },
}));

describe("buildPineconeFilter", () => {
  it("maps exact age to ageAtNote", () => {
    const filters: VectorSearchFilters = {
      age: 76,
      minAge: null,
      maxAge: null,
      city: null,
      state: null,
      gender: null,
      race: null,
      patientId: null,
      source: null,
      noteDate: null,
      noteStartDate: null,
      noteEndDateExclusive: null,
      noteYear: null,
      noteType: null,
    };

    expect(buildPineconeFilter(filters)).toEqual({
      ageAtNote: { $eq: 76 },
    });
  });
});

describe("searchClinicalNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves cosine ranks when reranking changes the order", async () => {
    vi.mocked(createEmbedding).mockResolvedValue([0.1, 0.2]);

    const query = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "note-a",
          score: 0.42,
          metadata: {
            content: "First note",
            patientId: "patient-1",
            source: "postgres",
            noteDate: "1988-06-01",
          },
        },
        {
          id: "note-b",
          score: 0.4,
          metadata: {
            content: "Second note",
            patientId: "patient-1",
            source: "postgres",
            noteDate: "1988-06-07",
          },
        },
      ],
    });

    vi.mocked(pinecone.index).mockReturnValue({ query } as never);
    vi.mocked(pinecone.inference.rerank).mockResolvedValue({
      data: [
        { index: 1, score: 0.91 },
        { index: 0, score: 0.67 },
      ],
    } as never);

    await expect(searchClinicalNotes("tingling", { topK: 2, topN: 2 })).resolves
      .toEqual({
        cosineMatches: [
          {
            id: "note-a",
            content: "First note",
            metadata: {
              patientId: "patient-1",
              source: "postgres",
              noteDate: "1988-06-01",
            },
            cosineScore: 0.42,
            cosineRank: 1,
          },
          {
            id: "note-b",
            content: "Second note",
            metadata: {
              patientId: "patient-1",
              source: "postgres",
              noteDate: "1988-06-07",
            },
            cosineScore: 0.4,
            cosineRank: 2,
          },
        ],
        rerankedMatches: [
          {
            id: "note-b",
            content: "Second note",
            metadata: {
              patientId: "patient-1",
              source: "postgres",
              noteDate: "1988-06-07",
            },
            cosineScore: 0.4,
            cosineRank: 2,
            rerankScore: 0.91,
            rerankRank: 1,
          },
          {
            id: "note-a",
            content: "First note",
            metadata: {
              patientId: "patient-1",
              source: "postgres",
              noteDate: "1988-06-01",
            },
            cosineScore: 0.42,
            cosineRank: 1,
            rerankScore: 0.67,
            rerankRank: 2,
          },
        ],
      });
  });
});
