#!/usr/bin/env node

/**
 * Migration dry-run script for CI.
 * Reports pending migrations without applying them.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/migration-dry-run.mjs
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log("migration_dry_run: skipped (no DATABASE_URL)");
  process.exit(0);
}

async function main() {
  const { default: postgres } = await import("postgres");
  const { dryRunMigrations } = await import(
    "../src/server/infrastructure/db/postgres/migrate.ts"
  );

  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    const pending = await dryRunMigrations(sql);

    if (pending.length === 0) {
      console.log("migration_dry_run: no pending migrations");
    } else {
      console.log(`migration_dry_run: ${pending.length} pending migration(s):`);

      for (const migration of pending) {
        console.log(`  - ${migration}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("migration_dry_run: failed", error);
  process.exit(1);
});
