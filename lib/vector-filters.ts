import { z } from "zod";

export const VectorFiltersSchema = z.object({
  age: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Exact age in years stated in the question; null if none."),
  minAge: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Inclusive minimum age, if stated; otherwise null."),
  maxAge: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Inclusive maximum age, if stated; otherwise null."),
  city: z
    .string()
    .min(1)
    .nullable()
    .describe("City named in the question; null if none."),
  state: z
    .string()
    .length(2)
    .nullable()
    .describe(
      "Two-letter US state code, such as MA for Massachusetts; null if none.",
    ),
  gender: z
    .enum(["male", "female"])
    .nullable()
    .describe("Patient gender stated in the question; null if none."),
  race: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Race as stored in the note metadata, such as Black or African American; null if none.",
    ),
  patientName: z
    .string()
    .min(1)
    .nullable()
    .describe("Full name of a specific patient, if stated; null otherwise."),
  patientId: z
    .string()
    .uuid()
    .nullable()
    .describe(
      "Patient UUID only if explicitly present in the question; never guess it.",
    ),
  source: z
    .literal("postgres")
    .nullable()
    .describe(
      "Use postgres only when the source is explicitly requested; otherwise null.",
    ),
  noteDate: z
    .string()
    .nullable()
    .describe("Exact note date in YYYY-MM-DD format; null if none."),
  noteStartDate: z
    .string()
    .nullable()
    .describe(
      "Inclusive beginning of the requested note-date range; null if none.",
    ),
  noteEndDateExclusive: z
    .string()
    .nullable()
    .describe("Exclusive end of the requested note-date range; null if none."),

  noteYear: z
    .number()
    .int()
    .nullable()
    .describe("Exact note year stated in the question; null if none."),
  noteType: z
    .string()
    .min(1)
    .nullable()
    .describe("Clinical note type explicitly requested; null if none."),
});

export type VectorFilters = z.infer<typeof VectorFiltersSchema>;

export type VectorSearchFilters = Omit<VectorFilters, "patientName">;

export function buildPineconeFilter(
  values: VectorSearchFilters | null | undefined,
): Record<string, unknown> | undefined {
  if (!values) return undefined;

  const filter: Record<string, unknown> = {};

  if (values.age != null) {
    filter.ageAtNote = { $eq: values.age };
  } else if (values.minAge != null || values.maxAge != null) {
    filter.ageAtNote = {
      ...(values.minAge != null && { $gte: values.minAge }),
      ...(values.maxAge != null && { $lte: values.maxAge }),
    };
  }

  for (const key of [
    "city",
    "state",
    "gender",
    "race",
    "patientId",
    "source",
    "noteDate",
    "noteYear",
    "noteType",
  ] as const) {
    const value = values[key];

    if (value != null) {
      filter[key] = {
        $eq:
          key === "state" && typeof value === "string"
            ? value.toUpperCase()
            : value,
      };
    }
  }

  if (values.noteStartDate != null || values.noteEndDateExclusive != null) {
    filter.noteTimestamp = {
      ...(values.noteStartDate != null && {
        $gte: new Date(`${values.noteStartDate}T00:00:00.000Z`).getTime(),
      }),
      ...(values.noteEndDateExclusive != null && {
        $lt: new Date(`${values.noteEndDateExclusive}T00:00:00.000Z`).getTime(),
      }),
    };
  }

  return Object.keys(filter).length ? filter : undefined;
}
