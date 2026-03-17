import postgres from "postgres";
import type { Sql } from "./types";

let sharedSql: Sql | null = null;

export interface PostgresConnectionOptions {
  connectionString?: string;
  max?: number;
}

export function getPostgresSql(options: PostgresConnectionOptions = {}): Sql {
  if (sharedSql) {
    return sharedSql;
  }

  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required for PostgreSQL connection.",
    );
  }

  sharedSql = postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return sharedSql;
}

export async function closePostgresSql(): Promise<void> {
  if (sharedSql) {
    await sharedSql.end();
    sharedSql = null;
  }
}
