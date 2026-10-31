import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  queryRawUnsafe: vi.fn(),
  conditionFindMany: vi.fn(),
  patientFindMany: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  openai: { responses: { parse: mocks.parse } },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    condition: { findMany: mocks.conditionFindMany },
    patient: { findMany: mocks.patientFindMany },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import { runSql } from "@/lib/agents/sql";

describe("runSql", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conditionFindMany.mockResolvedValue([
      { display: "Type 2 Diabetes Mellitus" },
    ]);
    mocks.patientFindMany.mockResolvedValue([{ state: "MA" }]);
    mocks.parse.mockResolvedValue({
      output_parsed: {
        sql: 'SELECT COUNT(DISTINCT "patientId") AS count FROM conditions WHERE display = \'Type 2 Diabetes Mellitus\'',
      },
    });
    mocks.queryRawUnsafe.mockResolvedValue([{ count: BigInt(63) }]);
  });

  it("grounds text-to-SQL with stored values and renders the query rows", async () => {
    const result = await runSql("How many patients have diabetes?");

    const request = mocks.parse.mock.calls[0][0];
    expect(request.input[0].content).toContain("Type 2 Diabetes Mellitus");
    expect(request.input[0].content).toContain("Patient state values:\nMA");
    expect(mocks.queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT COUNT(DISTINCT "patientId") AS count FROM conditions WHERE display = \'Type 2 Diabetes Mellitus\'',
    );
    expect(result).toContain('"count": 63');
  });
});
