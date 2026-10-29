/**
 * Vectorize the notes — Week 1.
 *
 * Postgres is the system of record. Pinecone is a DERIVED index built from it:
 * read every clinical note, shape it into a `MedicalChunk`, and hand the chunks
 * to `upsertChunks()` (lib/pinecone.ts), which embeds AND upserts them, 40 at
 * a time, with retries.
 *
 *   npm run vectorize -- --limit 5     # prove it works, then check the Pinecone console
 *   npm run vectorize                  # all ~21,000 notes (15–25 min, a few cents)
 *
 * Re-running is safe: each vector's id is the note's id, so a second run
 * overwrites instead of duplicating.
 *
 * Needs: DATABASE_URL, OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX.
 */

import "dotenv/config";
import { toMedicalChunk } from "../lib/note-chunk";
import { ensureIndexExists, upsertChunks } from "../lib/pinecone";
import { createPrisma } from "../lib/prisma";

// The long read over ~21k notes times out on Neon's POOLED host, so prefer the
// direct (non-pooler) connection. Same credentials either way.
const directUrl =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = createPrisma(directUrl);

// `--limit 5` → 5. No flag → undefined (all notes).
const limitIdx = process.argv.indexOf("--limit");
const limit =
  limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : undefined;

// Read + upsert in pages: one giant findMany over ~21k notes drops the TLS
// connection to Neon (BAD_RECORD_MAC). Small pages keep each response short, and
// a crash only loses the current page — re-runs overwrite by id.
const PAGE = 1000;

async function readPage(cursor: string | undefined, take: number) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.note.findMany({
        take,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        include: { patient: true },
        orderBy: { id: "asc" },
      });
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`Postgres read failed (attempt ${attempt}/4), retrying…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main() {
  await ensureIndexExists();

  let cursor: string | undefined;
  let total = 0;
  while (limit === undefined || total < limit) {
    const take = limit === undefined ? PAGE : Math.min(PAGE, limit - total);
    const notes = await readPage(cursor, take);
    if (notes.length === 0) break;

    const chunks = notes.map(toMedicalChunk);

    total += await upsertChunks(chunks);
    cursor = notes[notes.length - 1].id;
    console.log(`== ${total} notes done`);
  }
  console.log(`Done. Upserted ${total} note vectors.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
