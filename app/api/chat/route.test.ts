import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const { select, detectSchedulingIntent, aggregate, runSql, runRag } =
  vi.hoisted(() => ({
    select: vi.fn(),
    detectSchedulingIntent: vi.fn(),
    aggregate: vi.fn(),
    runSql: vi.fn(),
    runRag: vi.fn(),
  }));
vi.mock("@/lib/agents/selector", () => ({ select }));
vi.mock("@/lib/scheduling", () => ({
  detectSchedulingIntent,
  buildSchedulingAction: (s: {
    patientName: string | null;
    suggestedDate: string | null;
    suggestedTime: string | null;
    reason: string | null;
  }) => (s.patientName && s.suggestedDate && s.suggestedTime ? s : null),
}));
vi.mock("@/lib/agents/aggregator", () => ({ aggregate }));
vi.mock("@/lib/agents/sql", () => ({ runSql }));
vi.mock("@/lib/agents/rag", () => ({ runRag }));
const request = () =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ query: "Schedule Bret on Monday" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  select.mockResolvedValue({ useScheduler: true });
});
it("asks for missing scheduling details without booking", async () => {
  detectSchedulingIntent.mockResolvedValue({
    patientName: "Bret",
    suggestedDate: null,
    suggestedTime: "09:00",
    reason: null,
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Scheduling-Action")).toBeNull();
  expect(runSql).not.toHaveBeenCalled();
  expect(runRag).not.toHaveBeenCalled();
});
it("returns a confirmation action for complete details without booking", async () => {
  detectSchedulingIntent.mockResolvedValue({
    patientName: "Bret",
    suggestedDate: "2026-11-10",
    suggestedTime: "09:00",
    reason: null,
  });
  const response = await POST(request());
  expect(
    JSON.parse(
      decodeURIComponent(response.headers.get("X-Scheduling-Action")!),
    ),
  ).toMatchObject({
    patientName: "Bret",
    suggestedDate: "2026-11-10",
    suggestedTime: "09:00",
  });
  expect(runSql).not.toHaveBeenCalled();
});
it("runs both retrieval workers and streams the grounded answer", async () => {
  select.mockResolvedValue({
    useScheduler: false,
    needsSearch: true,
    useSql: true,
    useRag: true,
    semanticQuery: "patient notes",
  });
  runSql.mockResolvedValue("SQL text");
  runRag.mockResolvedValue("RAG text");
  aggregate.mockReturnValue({
    toTextStreamResponse: () => new Response("answer"),
  });
  const response = await POST(request());
  expect(await response.text()).toBe("answer");
  expect(aggregate.mock.calls[0][2]).toContain("SQL text");
  expect(aggregate.mock.calls[0][2]).toContain("RAG text");
});
