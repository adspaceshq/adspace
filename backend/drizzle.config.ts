import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations use the direct/session connection; the app may use the transaction pooler.
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
