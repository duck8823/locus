declare module "node:sqlite" {
  export interface DatabaseSyncOptions {
    allowExtension?: boolean;
    open?: boolean;
    readOnly?: boolean;
    timeout?: number;
  }

  export interface StatementSyncResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...parameters: unknown[]): StatementSyncResult;
    get<T extends object = Record<string, unknown>>(...parameters: unknown[]): T | undefined;
    all<T extends object = Record<string, unknown>>(...parameters: unknown[]): T[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
