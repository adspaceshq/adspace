import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import * as schema from "./schema.js";

// Driver-agnostic so services run against node-postgres in production and PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Shares the existing pg pool so legacy and new repositories use one connection budget.
export function createDb(pool: Pool): Db {
  return drizzle({ client: pool, schema });
}

export { schema };
