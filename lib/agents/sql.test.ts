import { beforeEach, expect, it, vi } from 'vitest';
const { parse, findConditions, findStates, queryRaw } = vi.hoisted(() => ({ parse: vi.fn(), findConditions: vi.fn(), findStates: vi.fn(), queryRaw: vi.fn() }));
vi.mock('../openai', () => ({ openai: { responses: { parse } } }));
vi.mock('../prisma', () => ({ prisma: { condition: { findMany: findConditions }, patient: { findMany: findStates }, $queryRawUnsafe: queryRaw } }));
import { runSql } from './sql';
beforeEach(() => { vi.clearAllMocks(); findConditions.mockResolvedValue([{ display: 'Myocardial Infarction' }]); findStates.mockResolvedValue([{ state: 'MA' }]); parse.mockResolvedValue({ output_parsed: { sql: 'SELECT COUNT(*) FROM patients' } }); queryRaw.mockResolvedValue([{ count: BigInt(3) }]); });
it('grounds generated SQL in real values and renders bigint results', async () => {
  const result = await runSql('How many patients had a heart attack?');
  expect(parse.mock.calls[0][0].input[0].content).toContain('Myocardial Infarction');
  expect(queryRaw).toHaveBeenCalledWith('SELECT COUNT(*) FROM patients');
  expect(result).toContain('"count": 3');
});
