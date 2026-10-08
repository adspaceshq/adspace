import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

// Shares the existing pg pool so legacy and new repositories use one connection budget.
export function createDb(pool: Pool): Db {
  return drizzle({ client: pool, schema });
}

export { schema };
