import { toMedicalChunk } from "@/lib/note-chunk";
import { describe, expect, it } from "vitest";

describe("toMedicalChunk", () => {
  it("maps stable note and patient metadata", () => {
    const chunk = toMedicalChunk({
      id: "note-1",
      patientId: "patient-1",
      content: "Example clinical note",
      date: new Date("1988-06-07T00:00:00.000Z"),
      type: null,
      patient: {
        birthDate: new Date("1911-09-19T00:00:00.000Z"),
        gender: "male",
        race: "Black or African American",
        city: "Boston",
        state: "MA",
      },
    });

    expect(chunk).toEqual({
      id: "note-1",
      content: "Example clinical note",
      metadata: {
        patientId: "patient-1",
        source: "postgres",
        birthDate: "1911-09-19",
        birthTimestamp: new Date("1911-09-19T00:00:00.000Z").getTime(),
        noteDate: "1988-06-07",
        noteTimestamp: new Date("1988-06-07T00:00:00.000Z").getTime(),
        noteYear: 1988,
        ageAtNote: 76,
        gender: "male",
        race: "Black or African American",
        city: "Boston",
        state: "MA",
      },
    });
  });
});
