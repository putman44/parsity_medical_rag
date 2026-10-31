/**
 * SQL agent — Week 3. Text-to-SQL: the LLM writes the query. Returns TEXT.
 *
 * The schema explains what can be queried. Distinct values explain how this
 * particular dataset names conditions and states.
 */

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Message } from "../agent";
import { openai } from "../openai";
import { prisma } from "../prisma";

const SqlQuerySchema = z.object({
  sql: z.string().min(1).describe("One PostgreSQL SELECT statement."),
});

const DATABASE_SCHEMA = `
Physical PostgreSQL tables and columns:

patients
- id text primary key
- "firstName" text, "lastName" text, gender text
- "birthDate" date, "deathDate" timestamp
- phone text, "maritalStatus" text, race text, ethnicity text
- city text, state text

conditions
- id text primary key, "patientId" text references patients(id)
- code text, display text, "clinicalStatus" text
- "onsetDate" timestamp, "abatementDate" timestamp

observations
- id text primary key, "patientId" text references patients(id)
- code text, display text, category text
- "valueNumber" double precision, "valueString" text, unit text
- "effectiveDate" timestamp

medications
- id text primary key, "patientId" text references patients(id)
- code text, display text, status text, "authoredOn" timestamp, dosage text

notes
- id text primary key, "patientId" text references patients(id)
- type text, date timestamp, content text

encounters
- id text primary key, "patientId" text references patients(id)
- "classCode" text, type text, status text
- "startDate" timestamp, "endDate" timestamp, "serviceProvider" text
`;

function stringifyRows(rows: unknown): string {
  return JSON.stringify(
    rows,
    (_key, value) => (typeof value === "bigint" ? Number(value) : value),
    2,
  );
}

export async function runSql(
  query: string,
  history: Message[] = [],
): Promise<string> {
  const [conditionRows, stateRows] = await Promise.all([
    prisma.condition.findMany({
      distinct: ["display"],
      select: { display: true },
      orderBy: { display: "asc" },
    }),
    prisma.patient.findMany({
      distinct: ["state"],
      select: { state: true },
      orderBy: { state: "asc" },
    }),
  ]);

  const grounding = [
    `Condition display values:\n${conditionRows.map((row) => row.display).join("\n")}`,
    `Patient state values:\n${stateRows
      .map((row) => row.state)
      .filter((state): state is string => state != null)
      .join("\n")}`,
  ].join("\n\n");

  const response = await openai.responses.parse({
    model: "gpt-6-luna",
    input: [
      {
        role: "system",
        content: `
Write one PostgreSQL SELECT statement that answers the user's structured-data
question.

Rules:
- Return only one SELECT statement through the required structured output.
- Never write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, or TRUNCATE.
- Do not add a semicolon or multiple statements.
- Use the physical table names and exact column names shown below.
- Double-quote camelCase column names such as "patientId" and "firstName".
- Add LIMIT 50 to row-listing queries. Do not add LIMIT to aggregate counts.
- Use the supplied distinct values to map the user's wording to values that
  actually exist in this dataset.

${DATABASE_SCHEMA}

Values that actually exist in the database:
${grounding}
`,
      },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: "user", content: query },
    ],
    text: {
      format: zodTextFormat(SqlQuerySchema, "sql_query"),
    },
    reasoning: { effort: "none" },
  });

  const { sql } = SqlQuerySchema.parse(response.output_parsed);

  // The student_ro database role is the actual write-prevention boundary.
  // TODO: add a single-SELECT validator later for clearer early failures.
  const rows = await prisma.$queryRawUnsafe(sql.trim());

  return [`SQL executed: ${sql.trim()}`, `Rows:\n${stringifyRows(rows)}`].join(
    "\n",
  );
}
