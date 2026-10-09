import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

// Fresh in-memory Postgres with the real migrations applied, so CHECKs and indexes are exercised.
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const statements = fs
      .readFileSync(path.join(migrationsDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close() };
}
