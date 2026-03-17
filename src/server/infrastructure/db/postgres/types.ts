import type postgres from "postgres";

/**
 * The main SQL connection type returned by postgres().
 */
export type Sql = ReturnType<typeof postgres>;

/**
 * Transaction SQL type. Due to a TypeScript limitation where Omit strips
 * call signatures, TransactionSql from postgres.js loses its tagged template
 * callable. We use Sql as the transaction type since it's a superset.
 */
export type TransactionSql = Sql;
