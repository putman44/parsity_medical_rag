import { openai, openaiProvider } from '@/lib/openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { findPatientByName } from '@/lib/patients';
import { searchClinicalNotes, VectorFiltersSchema, type VectorSearchFilters } from '@/lib/vector-search';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ChatRequestSchema = z.object({
	query: z.string().min(1),
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string(),
			}),
		)
		.default([]),
});

const selectorAgentSchema = z.object({
	action: z
		.enum(['sql_search', 'vector_search', 'reject'])
		.describe(
			'The action to take. Vector search is preferred, but if the query is too complex, reject it.',
		),
	reason: z.string().min(5).describe('The reason you chose this action.'),
	rejectionReason: z
		.string()
		.min(1)
		.describe('The reason you rejected the query.'),
	personalInfo: z
		.object({
			name: z.string().min(1).describe('The FULL name of the patient.'),
			dob: z
				.string()
				.min(1)
				.describe(
					'The date of birth of the patient. In this format: YYYY-MM-DD',
				),
		})
		.optional()
		.nullable(),
	vectorFilters: VectorFiltersSchema.nullable().describe(
		'For vector search, extract metadata explicitly stated in the question; otherwise null.',
	),
});

const fewShotExamples = [
	{
		query: 'What can you tell me about patient John Doe?',
		action: 'vector_search',
		reason: 'The query is a simple patient lookup, so we can use vector search.',
	},
	{
		query: 'What is the capital of Germanu',
		action: 'rejected',
		reason: 'Not a medical question.',
	},
	{
		query: 'Give me medical advice',
		action: 'rejected',
		reason: 'We NEVER give medical advice.',
	},
];

/**
 * The chat pipeline — Week 3. This route IS the orchestrator:
 *
 * Week 3 · assignment: docs/CHALLENGE-TOOL-CALLING.md
 *
 *   1. accept the message + history   (done — parsed below)
 *   2. the selector decides which stores to hit      (lib/agents/selector.ts)
 *   3. call 0, 1, or 2 specialists, in parallel      (lib/agents/sql.ts, rag.ts)
 *   4. the aggregator streams the answer back        (lib/agents/aggregator.ts)
 *
 * Scheduling actions ride back to the UI in the X-Scheduling-Action header.
 */
export async function POST(request: Request) {
	try {
		const { query, messages } = ChatRequestSchema.parse(
			await request.json(),
		);
		// selector
		// sql searh vector search OR reject
		const response = await openai.responses.parse({
			model: 'gpt-6-luna',
			input: [
				{
					role: 'system',
					content:
						'We are a medical facility. We need help looking up patient info. the query path to take',
				},
				{
					role: 'user',
					content: `
					query: ${query}
					previous messages: ${JSON.stringify(messages.slice(-5))}
					Example responses: ${JSON.stringify(fewShotExamples)}
					`, // more context
				},
			],
			text: {
				format: zodTextFormat(selectorAgentSchema, 'selector_agent'),
			},
		});

		// if rejected then retrn the rejection reason
		if (response.output_parsed?.action === 'reject') {
			return NextResponse.json({
				message: response.output_parsed.rejectionReason,
			});
		}

		if (response.output_parsed?.action === 'vector_search') {
			const values = response.output_parsed.vectorFilters;
			if (values?.minAge != null && values.maxAge != null && values.minAge > values.maxAge) {
				return NextResponse.json({ message: 'The requested age range is inconsistent.' });
			}
			if (values?.age != null && ((values.minAge != null && values.age < values.minAge) || (values.maxAge != null && values.age > values.maxAge))) {
				return NextResponse.json({ message: 'The requested ages are inconsistent.' });
			}

			let filters: VectorSearchFilters | null = null;
			if (values) {
				const { patientName, ...searchValues } = values;
				let patientId = searchValues.patientId;
				if (patientName) {
					const patients = await findPatientByName(patientName);
					if (patients.length !== 1) {
						return NextResponse.json({ message: patients.length === 0
							? "I couldn't find a patient with that name."
							: 'I found multiple patients with that name. Please provide a more specific name.' });
					}
					if (patientId && patientId !== patients[0].id) {
						return NextResponse.json({ message: 'The patient name and ID do not match.' });
					}
					patientId = patients[0].id;
				}
				filters = { ...searchValues, patientId };
			}
			const searchResults = await searchClinicalNotes(query, { filters });

			const summary = await openai.responses.create({
				model: 'gpt-6-sol',
				input: [
					{
						role: 'system',
						content:
							'Summarize the following notes. Format names to not have the numbers and make it concise and readable to a non-medical person.',
					},
					{ role: 'user', content: searchResults },
				],
			});

			return NextResponse.json(summary.output_text);
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		console.error('Chat error:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Internal server error',
			},
			{ status: 500 },
		);
	}
}
