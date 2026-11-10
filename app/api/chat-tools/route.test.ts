import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	runSql: vi.fn(),
	runRag: vi.fn(),
}));

vi.mock('ai', () => ({
	generateText: mocks.generateText,
	stepCountIs: vi.fn(() => 'stop'),
	tool: vi.fn((definition) => definition),
}));
vi.mock('@/lib/openai', () => ({ openaiProvider: vi.fn(() => 'mock-model') }));
vi.mock('@/lib/agents/sql', () => ({ runSql: mocks.runSql }));
vi.mock('@/lib/agents/rag', () => ({ runRag: mocks.runRag }));

import { POST } from './route';

const QUESTION = "Does Augustine O'Conner have Diabetes, and does his July 18, 1966 note list fatigue?";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.runSql.mockResolvedValue('Augustine O\'Conner: Diabetes');
	mocks.runRag.mockResolvedValue('1966-07-18 Chief Complaint: Fatigue');
});

describe('chat-tools route trace (offline)', () => {
	it.each([
		{ name: 'SQL', selected: ['query_patient_database'] },
		{ name: 'RAG', selected: ['search_clinical_notes'] },
		{ name: 'combined', selected: ['query_patient_database', 'search_clinical_notes'] },
	])('reports $name tool calls and their outputs', async ({ selected }) => {
		mocks.generateText.mockImplementation(async ({ tools }) => {
			const toolCalls = [];
			const toolResults = [];
			for (const [index, name] of selected.entries()) {
				const input = { query: QUESTION };
				const toolCallId = `call-${index}`;
				const output = await tools[name].execute(input);
				toolCalls.push({ toolName: name, toolCallId, input });
				toolResults.push({ toolCallId, output });
			}
			return { text: 'Grounded answer', steps: [{ toolCalls, toolResults }] };
		});

		const response = await POST(new Request('http://localhost/api/chat-tools', {
			method: 'POST',
			body: JSON.stringify({ query: QUESTION }),
		}));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.trace.map((entry: { tool: string }) => entry.tool)).toEqual(selected);
		expect(body.trace.map((entry: { output: string }) => entry.output)).toEqual(
			selected.map((name) => name === 'query_patient_database'
				? "Augustine O'Conner: Diabetes"
				: '1966-07-18 Chief Complaint: Fatigue'),
		);
		expect(body.schedulingAction).toBeNull();
		expect(mocks.runSql).toHaveBeenCalledTimes(selected.includes('query_patient_database') ? 1 : 0);
		expect(mocks.runRag).toHaveBeenCalledTimes(selected.includes('search_clinical_notes') ? 1 : 0);
	});
});
