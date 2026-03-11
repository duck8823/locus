import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type {
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
  ListConnectionStateTransitionOptions,
  UpdateConnectionStateAndTransitionResult,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";

interface ConnectionStateRow {
  provider: unknown;
  status: unknown;
  status_updated_at: unknown;
  connected_account_label: unknown;
}

interface ConnectionStateFileRecord {
  reviewerId?: string;
  connections?: unknown;
}

export interface SqliteConnectionStateRepositoryOptions {
  databasePath?: string;
  legacyDataDirectory?: string;
}

const DEFAULT_TRANSITION_LIMIT = 20;
const MAX_TRANSITION_LIMIT = 100;
const MAX_CONNECTED_ACCOUNT_LABEL_LENGTH = 200;
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export class SqliteConnectionStateRepository
  implements
    ConnectionStateRepository,
    ConnectionStateTransitionRepository,
    ConnectionStateTransitionTransactionalRepository
{
  private readonly databasePath: string;
  private readonly legacyDataDirectory: string;
  private database: DatabaseSync | null = null;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly migrationQueues = new Map<string, Promise<void>>();
  private readonly migratedReviewerIds = new Set<string>();

  constructor(options: SqliteConnectionStateRepositoryOptions = {}) {
    this.databasePath =
      options.databasePath ??
      path.join(process.cwd(), ".locus-data", "connection-state.sqlite");
    this.legacyDataDirectory =
      options.legacyDataDirectory ??
      path.join(process.cwd(), ".locus-data", "connection-states");

    // Intentionally lazy-initialize SQLite handles so that build-time module
    // evaluation does not race on schema setup across worker processes.
  }

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    await this.ensureLegacyReviewerMigrated(reviewerId);
    return this.selectStatesForReviewerId(reviewerId);
  }

  async saveForReviewerId(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): Promise<void> {
    await this.updateForReviewerId(reviewerId, () => states);
  }

  async updateForReviewerId(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => PersistedConnectionState[],
  ): Promise<PersistedConnectionState[]> {
    const result = await this.updateStateAndAppendTransition(reviewerId, (states) => ({
      states: updater(states),
      transition: null,
    }));

    return result.states;
  }

  async updateStateAndAppendTransition(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft | null;
    },
  ): Promise<UpdateConnectionStateAndTransitionResult> {
    let result: UpdateConnectionStateAndTransitionResult = {
      states: [],
      transition: null,
    };

    await this.enqueueWrite(reviewerId, async () => {
      await this.ensureLegacyReviewerMigrated(reviewerId);
      const currentStates = this.selectStatesForReviewerId(reviewerId);
      const next = updater(currentStates);
      const nextStates = normalizeStates(next.states);
      const normalizedTransition = next.transition
        ? normalizeTransitionDraft(next.transition)
        : null;

      const database = this.databaseHandle;
      database.exec("BEGIN IMMEDIATE TRANSACTION");

      try {
        this.replaceStatesForReviewerIdInTransaction(reviewerId, nextStates);

        if (normalizedTransition) {
          this.insertTransitionInTransaction(normalizedTransition);
        }

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      result = {
        states: nextStates,
        transition: normalizedTransition,
      };
    });

    return result;
  }

  async appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition> {
    const normalizedTransition = normalizeTransitionDraft(transition);

    await this.enqueueWrite(normalizedTransition.reviewerId, async () => {
      await this.ensureLegacyReviewerMigrated(normalizedTransition.reviewerId);
      this.insertTransitionInTransaction(normalizedTransition);
    });

    return normalizedTransition;
  }

  async listRecentByReviewerId(
    reviewerId: string,
    options: ListConnectionStateTransitionOptions = {},
  ): Promise<PersistedConnectionStateTransition[]> {
    await this.ensureLegacyReviewerMigrated(reviewerId);

    const limit = normalizeTransitionLimit(options.limit);
    const provider = normalizeProvider(options.provider);

    const database = this.databaseHandle;
    const rows = provider
      ? database
          .prepare(
            `SELECT
              transition_id,
              reviewer_id,
              provider,
              previous_status,
              next_status,
              changed_at,
              connected_account_label
             FROM connection_state_transitions
             WHERE reviewer_id = ?
               AND provider = ?
             ORDER BY changed_at DESC, transition_id DESC
             LIMIT ?`
          )
          .all(reviewerId, provider, limit)
      : database
          .prepare(
            `SELECT
              transition_id,
              reviewer_id,
              provider,
              previous_status,
              next_status,
              changed_at,
              connected_account_label
             FROM connection_state_transitions
             WHERE reviewer_id = ?
             ORDER BY changed_at DESC, transition_id DESC
             LIMIT ?`
          )
          .all(reviewerId, limit);

    return rows.flatMap((row) => {
      const normalized = normalizeTransitionRow(row);
      return normalized ? [normalized] : [];
    });
  }

  private selectStatesForReviewerId(reviewerId: string): PersistedConnectionState[] {
    const database = this.databaseHandle;
    const rows = database
      .prepare(
        `SELECT
          provider,
          status,
          status_updated_at,
          connected_account_label
         FROM connection_states
         WHERE reviewer_id = ?`
      )
      .all(reviewerId) as ConnectionStateRow[];

    return rows.flatMap((row) => {
      const normalized = normalizeStateRow(row);
      return normalized ? [normalized] : [];
    });
  }

  private replaceStatesForReviewerId(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): void {
    const database = this.databaseHandle;
    database.exec("BEGIN IMMEDIATE TRANSACTION");

    try {
      this.replaceStatesForReviewerIdInTransaction(reviewerId, states);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  private replaceStatesForReviewerIdInTransaction(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): void {
    const database = this.databaseHandle;
    database
      .prepare("DELETE FROM connection_states WHERE reviewer_id = ?")
      .run(reviewerId);

    const insertStatement = database.prepare(
      `INSERT INTO connection_states (
        reviewer_id,
        provider,
        status,
        status_updated_at,
        connected_account_label
      ) VALUES (?, ?, ?, ?, ?)`
    );

    for (const state of states) {
      insertStatement.run(
        reviewerId,
        state.provider,
        state.status,
        state.statusUpdatedAt,
        state.connectedAccountLabel,
      );
    }
  }

  private insertTransitionInTransaction(
    transition: PersistedConnectionStateTransition,
  ): void {
    const database = this.databaseHandle;
    database
      .prepare(
        `INSERT INTO connection_state_transitions (
          transition_id,
          reviewer_id,
          provider,
          previous_status,
          next_status,
          changed_at,
          connected_account_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        transition.transitionId,
        transition.reviewerId,
        transition.provider,
        transition.previousStatus,
        transition.nextStatus,
        transition.changedAt,
        transition.connectedAccountLabel,
      );
  }

  private countStatesForReviewerId(reviewerId: string): number {
    const database = this.databaseHandle;
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM connection_states WHERE reviewer_id = ?")
      .get(reviewerId) as { count?: unknown } | undefined;

    if (!row) {
      return 0;
    }

    const count = typeof row.count === "number" ? row.count : Number(row.count ?? 0);

    if (!Number.isFinite(count) || count <= 0) {
      return 0;
    }

    return count;
  }

  private async ensureLegacyReviewerMigrated(reviewerId: string): Promise<void> {
    if (this.migratedReviewerIds.has(reviewerId)) {
      return;
    }

    const previous = this.migrationQueues.get(reviewerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (this.migratedReviewerIds.has(reviewerId)) {
        return;
      }

      if (this.countStatesForReviewerId(reviewerId) > 0) {
        this.migratedReviewerIds.add(reviewerId);
        return;
      }

      const legacyStates = await this.readLegacyStatesForReviewerId(reviewerId);

      if (legacyStates.length === 0) {
        this.migratedReviewerIds.add(reviewerId);
        return;
      }

      this.replaceStatesForReviewerId(reviewerId, legacyStates);
      this.migratedReviewerIds.add(reviewerId);
    });

    this.migrationQueues.set(reviewerId, next);

    try {
      await next;
    } finally {
      if (this.migrationQueues.get(reviewerId) === next) {
        this.migrationQueues.delete(reviewerId);
      }
    }
  }

  private async readLegacyStatesForReviewerId(
    reviewerId: string,
  ): Promise<PersistedConnectionState[]> {
    const filePath = path.join(
      this.legacyDataDirectory,
      `${encodeURIComponent(reviewerId)}.json`,
    );

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = parseLegacyConnectionStateFile(raw);

      if (!parsed || !Array.isArray(parsed.connections)) {
        return [];
      }

      return normalizeStates(parsed.connections);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async enqueueWrite(
    reviewerId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const previousWrite = this.writeQueues.get(reviewerId) ?? Promise.resolve();
    const nextWrite = previousWrite.catch(() => undefined).then(action);

    this.writeQueues.set(reviewerId, nextWrite);

    try {
      await nextWrite;
    } finally {
      if (this.writeQueues.get(reviewerId) === nextWrite) {
        this.writeQueues.delete(reviewerId);
      }
    }
  }

  private get databaseHandle(): DatabaseSync {
    if (this.database) {
      return this.database;
    }

    mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath, {
      timeout: SQLITE_BUSY_TIMEOUT_MS,
    });
    initializeDatabaseSchema(this.database);

    return this.database;
  }
}

function initializeDatabaseSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS connection_states (
      reviewer_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      status_updated_at TEXT,
      connected_account_label TEXT,
      PRIMARY KEY (reviewer_id, provider)
    );

    CREATE TABLE IF NOT EXISTS connection_state_transitions (
      transition_id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      connected_account_label TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_connection_state_transitions_reviewer_changed
      ON connection_state_transitions (reviewer_id, changed_at DESC, transition_id DESC);

    CREATE INDEX IF NOT EXISTS idx_connection_state_transitions_reviewer_provider_changed
      ON connection_state_transitions (reviewer_id, provider, changed_at DESC, transition_id DESC);
  `);
}

function normalizeStateRow(row: ConnectionStateRow): PersistedConnectionState | null {
  const provider = normalizeProvider(row.provider);

  if (!provider) {
    return null;
  }

  return {
    provider,
    status: normalizeStatus(row.status),
    statusUpdatedAt: normalizeStatusUpdatedAt(row.status_updated_at),
    connectedAccountLabel: normalizeConnectedAccountLabel(row.connected_account_label),
  };
}

function parseLegacyConnectionStateFile(raw: string): ConnectionStateFileRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isPlainObject(parsed)) {
      return null;
    }

    return parsed as ConnectionStateFileRecord;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function normalizeStateRecord(record: unknown): PersistedConnectionState | null {
  if (!isPlainObject(record)) {
    return null;
  }

  const provider = normalizeProvider(record.provider);

  if (!provider) {
    return null;
  }

  return {
    provider,
    status: normalizeStatus(record.status),
    statusUpdatedAt: normalizeStatusUpdatedAt(record.statusUpdatedAt),
    connectedAccountLabel: normalizeConnectedAccountLabel(record.connectedAccountLabel),
  };
}

function normalizeStates(records: unknown[]): PersistedConnectionState[] {
  return records.flatMap((record) => {
    const normalized = normalizeStateRecord(record);
    return normalized ? [normalized] : [];
  });
}

function normalizeTransitionDraft(
  draft: PersistedConnectionStateTransitionDraft,
): PersistedConnectionStateTransition {
  const provider = normalizeProvider(draft.provider);

  if (!provider) {
    throw new Error(`Invalid provider for connection transition: ${String(draft.provider)}`);
  }

  const reviewerId = normalizeReviewerId(draft.reviewerId);

  if (!reviewerId) {
    throw new Error(`Invalid reviewerId for connection transition: ${String(draft.reviewerId)}`);
  }

  const changedAt = normalizeStatusUpdatedAt(draft.changedAt);

  if (!changedAt) {
    throw new Error(`Invalid changedAt for connection transition: ${String(draft.changedAt)}`);
  }

  return {
    transitionId: randomUUID(),
    reviewerId,
    provider,
    previousStatus: normalizeStatus(draft.previousStatus),
    nextStatus: normalizeStatus(draft.nextStatus),
    changedAt,
    connectedAccountLabel: normalizeConnectedAccountLabel(draft.connectedAccountLabel),
  };
}

function normalizeTransitionRow(row: unknown): PersistedConnectionStateTransition | null {
  if (!isPlainObject(row)) {
    return null;
  }

  const transitionId = normalizeTransitionId(row.transition_id);
  const reviewerId = normalizeReviewerId(row.reviewer_id);
  const provider = normalizeProvider(row.provider);
  const changedAt = normalizeStatusUpdatedAt(row.changed_at);

  if (!transitionId || !reviewerId || !provider || !changedAt) {
    return null;
  }

  return {
    transitionId,
    reviewerId,
    provider,
    previousStatus: normalizeStatus(row.previous_status),
    nextStatus: normalizeStatus(row.next_status),
    changedAt,
    connectedAccountLabel: normalizeConnectedAccountLabel(row.connected_account_label),
  };
}

function normalizeTransitionId(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value.trim();
}

function normalizeReviewerId(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length > 200) {
    return null;
  }

  return normalized;
}

function normalizeTransitionLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_TRANSITION_LIMIT;
  }

  return Math.min(value, MAX_TRANSITION_LIMIT);
}

function normalizeProvider(provider: unknown): string | null {
  if (!isNonEmptyString(provider)) {
    return null;
  }

  const normalized = provider.trim();

  if (normalized.length > 120) {
    return null;
  }

  return normalized;
}

function normalizeStatus(status: unknown): string {
  if (!isNonEmptyString(status)) {
    return "not_connected";
  }

  return status.trim();
}

function normalizeStatusUpdatedAt(statusUpdatedAt: unknown): string | null {
  if (!isNonEmptyString(statusUpdatedAt)) {
    return null;
  }

  const epochMs = Date.parse(statusUpdatedAt);

  if (Number.isNaN(epochMs)) {
    return null;
  }

  return new Date(epochMs).toISOString();
}

function normalizeConnectedAccountLabel(connectedAccountLabel: unknown): string | null {
  if (typeof connectedAccountLabel !== "string") {
    return null;
  }

  const trimmed = connectedAccountLabel.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAX_CONNECTED_ACCOUNT_LABEL_LENGTH) {
    return trimmed.slice(0, MAX_CONNECTED_ACCOUNT_LABEL_LENGTH);
  }

  return trimmed;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
