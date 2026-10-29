import type { MedicalChunk } from "./pinecone";

export type NoteForChunk = {
  id: string;
  patientId: string;
  content: string;
  date: Date | null;
  type: string | null;
  patient: {
    birthDate: Date | null;
    gender: string | null;
    race: string | null;
    city: string | null;
    state: string | null;
  };
};

function ageOnDate(birthDate: Date, noteDate: Date): number {
  const yearDifference = noteDate.getUTCFullYear() - birthDate.getUTCFullYear();

  const noteIsBeforeBirthday =
    noteDate.getUTCMonth() < birthDate.getUTCMonth() ||
    (noteDate.getUTCMonth() === birthDate.getUTCMonth() &&
      noteDate.getUTCDate() < birthDate.getUTCDate());

  return yearDifference - (noteIsBeforeBirthday ? 1 : 0);
}

export function toMedicalChunk(note: NoteForChunk): MedicalChunk {
  return {
    id: note.id,
    content: note.content,
    metadata: {
      patientId: note.patientId,
      source: "postgres",

      ...(note.patient.birthDate && {
        birthDate: note.patient.birthDate.toISOString().slice(0, 10),
        birthTimestamp: note.patient.birthDate.getTime(),
      }),

      ...(note.date && {
        noteDate: note.date.toISOString().slice(0, 10),
        noteTimestamp: note.date.getTime(),
        noteYear: note.date.getUTCFullYear(),
      }),

      ...(note.patient.birthDate &&
        note.date && {
          ageAtNote: ageOnDate(note.patient.birthDate, note.date),
        }),

      ...(note.type && { noteType: note.type }),
      ...(note.patient.gender && { gender: note.patient.gender }),
      ...(note.patient.race && { race: note.patient.race }),
      ...(note.patient.city && { city: note.patient.city }),
      ...(note.patient.state && { state: note.patient.state }),
    },
  };
}
