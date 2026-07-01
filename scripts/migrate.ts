// One-time (idempotent) schema migration for Neon Postgres.
//
// Usage (DATABASE_URL must be in the environment):
//   npx dotenv -e .env.local -- npx tsx scripts/migrate.ts
// or, if env vars are already exported:
//   npx tsx scripts/migrate.ts
import { neon } from "@neondatabase/serverless";
import { SCHEMA_STATEMENTS } from "../lib/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Run `vercel env pull .env.local` first, then:\n" +
        "  npx dotenv -e .env.local -- npx tsx scripts/migrate.ts",
    );
    process.exit(1);
  }

  const sql = neon(url);
  console.log(`Applying ${SCHEMA_STATEMENTS.length} schema statements...`);
  for (const stmt of SCHEMA_STATEMENTS) {
    await sql.query(stmt);
    const label = stmt.trim().split("\n")[0].slice(0, 70);
    console.log(`  ✓ ${label}`);
  }
  console.log("Schema migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
