import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Sql, TransactionSql } from "./types";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
}

export async function runMigrations(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql<{ version: number }[]>`
    SELECT version FROM schema_migrations ORDER BY version
  `;
  const appliedVersions = new Set(applied.map((row) => row.version));

  const migrationFiles = await discoverMigrations();
  const pending = migrationFiles.filter((m) => !appliedVersions.has(m.version));

  if (pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    const sqlContent = await readFile(migration.filePath, "utf8");

    await sql.begin(async (tx_) => {
      const tx = tx_ as unknown as TransactionSql;
      await tx.unsafe(sqlContent);
      await tx`
        INSERT INTO schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})
        ON CONFLICT (version) DO NOTHING
      `;
    });
  }
}

export async function dryRunMigrations(sql: Sql): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = await sql<{ version: number }[]>`
    SELECT version FROM schema_migrations ORDER BY version
  `;
  const appliedVersions = new Set(applied.map((row) => row.version));

  const migrationFiles = await discoverMigrations();
  const pending = migrationFiles.filter((m) => !appliedVersions.has(m.version));

  return pending.map((m) => `${m.version}: ${m.name}`);
}

async function discoverMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".sql")) {
      continue;
    }

    const match = entry.match(/^(\d+)_(.+)\.sql$/);

    if (!match) {
      continue;
    }

    migrations.push({
      version: parseInt(match[1], 10),
      name: match[2],
      filePath: path.join(MIGRATIONS_DIR, entry),
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}
