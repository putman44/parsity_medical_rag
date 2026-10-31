import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  runSql: vi.fn(),
  runRag: vi.fn(),
  aggregate: vi.fn(),
  toTextStreamResponse: vi.fn(),
}));

vi.mock("@/lib/agents/selector", () => ({ select: mocks.select }));
vi.mock("@/lib/agents/sql", () => ({ runSql: mocks.runSql }));
vi.mock("@/lib/agents/rag", () => ({ runRag: mocks.runRag }));
vi.mock("@/lib/agents/aggregator", () => ({
  aggregate: mocks.aggregate,
}));

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockResolvedValue({
      useSql: true,
      useRag: true,
      useScheduler: false,
      needsSearch: true,
      semanticQuery: "notes describing difficulty exercising",
    });
    mocks.runSql.mockResolvedValue("SQL patients");
    mocks.runRag.mockResolvedValue("RAG notes");
    mocks.toTextStreamResponse.mockReturnValue(new Response("final answer"));
    mocks.aggregate.mockReturnValue({
      toTextStreamResponse: mocks.toTextStreamResponse,
    });
  });

  it("runs both workers and sends both result blocks to the aggregator", async () => {
    const messages = [{ role: "assistant" as const, content: "Previous answer" }];
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "How many patients with diabetes have notes describing difficulty exercising?",
        messages,
      }),
    });

    const response = await POST(request);

    expect(mocks.select).toHaveBeenCalledWith(
      "How many patients with diabetes have notes describing difficulty exercising?",
      messages,
    );
    expect(mocks.runSql).toHaveBeenCalledWith(
      "How many patients with diabetes have notes describing difficulty exercising?",
      messages,
    );
    expect(mocks.runRag).toHaveBeenCalledWith(
      "notes describing difficulty exercising",
    );
    expect(mocks.aggregate).toHaveBeenCalledWith(
      "How many patients with diabetes have notes describing difficulty exercising?",
      messages,
      [
        "<sql-results>",
        "SQL patients",
        "</sql-results>",
        "",
        "<rag-results>",
        "RAG notes",
        "</rag-results>",
      ].join("\n"),
    );
    expect(await response.text()).toBe("final answer");
  });
});
