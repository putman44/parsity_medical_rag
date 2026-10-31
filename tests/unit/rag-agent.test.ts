import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  findPatientByName: vi.fn(),
  searchClinicalNotes: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  openai: { responses: { parse: mocks.parse } },
}));

vi.mock("@/lib/patients", () => ({
  findPatientByName: mocks.findPatientByName,
}));

vi.mock("@/lib/vector-search", async () => {
  const { VectorFiltersSchema } = await import("@/lib/vector-filters");
  return {
    VectorFiltersSchema,
    searchClinicalNotes: mocks.searchClinicalNotes,
  };
});

import { runRag } from "@/lib/agents/rag";

describe("runRag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parse.mockResolvedValue({
      output_parsed: {
        patientName: "Avery Mueller",
        noteDate: "1988-06-07",
      },
    });
    mocks.findPatientByName.mockResolvedValue([
      { id: "87741719-d8a6-f2ac-104b-7885598a0a71" },
    ]);
    mocks.searchClinicalNotes.mockResolvedValue({
      cosineMatches: [],
      rerankedMatches: [
        {
          id: "00027a95-0b3b-dcb1-9e81-d718e979a5b7",
          content: "Tingling in Hands and Feet",
          metadata: {
            patientId: "87741719-d8a6-f2ac-104b-7885598a0a71",
            source: "postgres",
            noteDate: "1988-06-07",
          },
          cosineScore: 0.48,
          cosineRank: 3,
          rerankScore: 0.9,
          rerankRank: 1,
        },
      ],
    });
  });

  it("turns patient and date scope into exact Pinecone filters", async () => {
    const query =
      "Find Avery Mueller's clinical note from June 7, 1988 and summarize it.";

    const result = await runRag(query);

    expect(mocks.findPatientByName).toHaveBeenCalledWith("Avery Mueller");
    expect(mocks.searchClinicalNotes).toHaveBeenCalledWith(query, {
      topK: 100,
      topN: 5,
      filters: expect.objectContaining({
        patientId: "87741719-d8a6-f2ac-104b-7885598a0a71",
        noteDate: "1988-06-07",
      }),
    });
    expect(result).toContain('id="00027a95-0b3b-dcb1-9e81-d718e979a5b7"');
    expect(result).toContain("date: 1988-06-07");
    expect(result).toContain("Tingling in Hands and Feet");
  });
});
