#!/usr/bin/env node

/**
 * Migration apply-and-verify script for CI.
 * Applies all pending migrations against a fresh CI database, then verifies
 * the schema_migrations table is consistent.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/migration-apply-verify.mjs
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log("migration_apply_verify: skipped (no DATABASE_URL)");
  process.exit(0);
}

async function main() {
  const { default: postgres } = await import("postgres");
  const { runMigrations, dryRunMigrations } = await import(
    "../src/server/infrastructure/db/postgres/migrate.ts"
  );

  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    // Apply all migrations
    await runMigrations(sql);
    console.log("migration_apply_verify: migrations applied successfully");

    // Verify no pending migrations remain
    const pending = await dryRunMigrations(sql);

    if (pending.length > 0) {
      console.error(
        `migration_apply_verify: FAIL — ${pending.length} migration(s) still pending after apply:`,
      );

      for (const m of pending) {
        console.error(`  - ${m}`);
      }

      process.exit(1);
    }

    // Verify schema_migrations table has entries
    const applied =
      await sql`SELECT version, name FROM schema_migrations ORDER BY version`;

    console.log(
      `migration_apply_verify: ${applied.length} migration(s) applied:`,
    );

    for (const row of applied) {
      console.log(`  - ${row.version}: ${row.name}`);
    }

    console.log("migration_apply_verify: PASS");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("migration_apply_verify: failed", error);
  process.exit(1);
});
