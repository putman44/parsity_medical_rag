import {
  buildPineconeFilter,
  type VectorSearchFilters,
} from "@/lib/vector-filters";
import { describe, expect, it } from "vitest";

describe("buildPineconeFilter", () => {
  it("maps exact age to ageAtNote", () => {
    const filters: VectorSearchFilters = {
      age: 76,
      minAge: null,
      maxAge: null,
      city: null,
      state: null,
      gender: null,
      race: null,
      patientId: null,
      source: null,
      noteDate: null,
      noteStartDate: null,
      noteEndDateExclusive: null,
      noteYear: null,
      noteType: null,
    };

    expect(buildPineconeFilter(filters)).toEqual({
      ageAtNote: { $eq: 76 },
    });
  });
});
