// Live evaluations: RUN_EVALS=1 npx vitest run lib/evals/clinical-tools.test.ts
// These call the chat model and Jev. Run individual cases with -t.
import request from 'supertest';
import { noul, TypeSafeClient } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';

const api = request(process.env.EVAL_BASE_URL ?? 'http://localhost:3000');
const jev = new TypeSafeClient();

// Verified against the read-only course database on 2026-11-09:
// notes.id 97c57906-4ad5-4158-0091-0b7633f9174e, 1966-07-18,
// lists Chest Pain and Fatigue under Chief Complaint for Augustine O'Conner.
// The same patient's conditions include display = 'Diabetes'.
const CASES = [
	{
		name: 'clinical note retrieval',
		question: "What does Augustine O'Conner's July 18, 1966 clinical note list under Chief Complaint about chest pain?",
		criteria: "States that Augustine O'Conner's July 18, 1966 clinical note lists chest pain as a chief complaint; does not substitute general medical advice.",
		tools: ['search_clinical_notes'],
	},
	{
		name: 'combined diabetes and fatigue',
		question: "Does Augustine O'Conner have a recorded diabetes diagnosis in the structured patient data, and does his July 18, 1966 clinical note list fatigue under Chief Complaint?",
		criteria: "States both that Augustine O'Conner has a recorded Diabetes condition and that his July 18, 1966 clinical note lists Fatigue under Chief Complaint.",
		tools: ['query_patient_database', 'search_clinical_notes'],
	},
] as const;

describe('grounded clinical tool evaluations (live)', () => {
	it.each(CASES)('$name', async ({ question, criteria, tools }) => {
		const response = await api.post('/api/chat-tools').send({ query: question });
		expect(response.status).toBe(200);
		const { message, trace } = response.body;
		expect(typeof message).toBe('string');
		expect(Array.isArray(trace)).toBe(true);
		const called = trace.map((entry: { tool: string }) => entry.tool);
		for (const tool of tools) expect(called).toContain(tool);
		expect(called).not.toContain('schedule_appointment');

		const { answers } = await jev.systemOne({
			state: { question, answer: message },
			questions: { met: noul(`Does the answer meet this criteria: ${criteria}`) },
		});
		expect(answers.met.noul).toBeGreaterThanOrEqual(0.8);
	}, 60_000);
});

describe('tool selection (live model)', () => {
	it('SQL question calls query_patient_database', async () => {
		const response = await api.post('/api/chat-tools').send({ query: 'How many patients have diabetes?' });
		expect(response.status).toBe(200);
		const called = response.body.trace.map((entry: { tool: string }) => entry.tool);
		expect(called).toContain('query_patient_database');
		expect(called).not.toContain('search_clinical_notes');
		expect(called).not.toContain('schedule_appointment');
	}, 60_000);

	it('clinical note question calls search_clinical_notes', async () => {
		const response = await api.post('/api/chat-tools').send({ query: CASES[0].question });
		expect(response.status).toBe(200);
		const called = response.body.trace.map((entry: { tool: string }) => entry.tool);
		expect(called).toContain('search_clinical_notes');
		expect(called).not.toContain('query_patient_database');
		expect(called).not.toContain('schedule_appointment');
	}, 60_000);

	it('combined question calls both retrieval tools', async () => {
		const response = await api.post('/api/chat-tools').send({ query: CASES[1].question });
		expect(response.status).toBe(200);
		const called = response.body.trace.map((entry: { tool: string }) => entry.tool);
		expect(called).toContain('query_patient_database');
		expect(called).toContain('search_clinical_notes');
		expect(called).not.toContain('schedule_appointment');
	}, 60_000);
});
