import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "./types";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type {
  CountConnectionStateTransitionOptions,
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
  ListConnectionStateTransitionOptions,
  UpdateConnectionStateAndTransitionResult,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  ConnectionStateTransitionActorType,
  ConnectionStateTransitionReason,
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";
import {
  CONNECTION_STATE_TRANSITION_ACTOR_TYPES,
  CONNECTION_STATE_TRANSITION_REASONS,
} from "@/server/domain/value-objects/connection-state-transition";

interface ConnectionStateRow {
  provider: string;
  status: string;
  status_updated_at: string | null;
  connected_account_label: string | null;
}

interface TransitionRow {
  transition_id: string;
  reviewer_id: string;
  provider: string;
  previous_status: string;
  next_status: string;
  changed_at: string;
  reason: string;
  actor_type: string;
  actor_id: string | null;
  connected_account_label: string | null;
}

const DEFAULT_TRANSITION_LIMIT = 20;
const MAX_TRANSITION_LIMIT = 200;
const MAX_CONNECTED_ACCOUNT_LABEL_LENGTH = 200;
const DEFAULT_MAX_TRANSITIONS_PER_REVIEWER = 200;
const MAX_MAX_TRANSITIONS_PER_REVIEWER = 5_000;

export interface PgConnectionStateRepositoryOptions {
  maxTransitionsPerReviewer?: number;
}

export class PgConnectionStateRepository
  implements
    ConnectionStateRepository,
    ConnectionStateTransitionRepository,
    ConnectionStateTransitionTransactionalRepository
{
  private readonly maxTransitionsPerReviewer: number;

  constructor(
    private readonly sql: Sql,
    options: PgConnectionStateRepositoryOptions = {},
  ) {
    this.maxTransitionsPerReviewer = normalizeMaxTransitionsPerReviewer(
      options.maxTransitionsPerReviewer,
    );
  }

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    const rows = await this.sql<ConnectionStateRow[]>`
      SELECT provider, status, status_updated_at, connected_account_label
      FROM connection_states
      WHERE reviewer_id = ${reviewerId}
    `;

    return rows.flatMap((row) => {
      const normalized = normalizeStateRow(row);
      return normalized ? [normalized] : [];
    });
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
    return this.sql.begin(async (tx_) => {
      const tx = tx_ as unknown as TransactionSql;
      // Lock on the reviewer_id to prevent concurrent updates
      await tx`SELECT 1 FROM connection_states WHERE reviewer_id = ${reviewerId} FOR UPDATE`;

      const currentRows = await tx<ConnectionStateRow[]>`
        SELECT provider, status, status_updated_at, connected_account_label
        FROM connection_states
        WHERE reviewer_id = ${reviewerId}
      `;

      const currentStates = currentRows.flatMap((row: ConnectionStateRow) => {
        const normalized = normalizeStateRow(row);
        return normalized ? [normalized] : [];
      });

      const next = updater(currentStates);
      const nextStates = normalizeStates(next.states);
      const normalizedTransition = next.transition
        ? normalizeTransitionDraft(next.transition)
        : null;

      // Replace states
      await tx`DELETE FROM connection_states WHERE reviewer_id = ${reviewerId}`;

      for (const state of nextStates) {
        await tx`
          INSERT INTO connection_states (reviewer_id, provider, status, status_updated_at, connected_account_label)
          VALUES (${reviewerId}, ${state.provider}, ${state.status}, ${state.statusUpdatedAt}, ${state.connectedAccountLabel})
        `;
      }

      // Insert transition if present
      if (normalizedTransition) {
        await tx`
          INSERT INTO connection_state_transitions (
            transition_id, reviewer_id, provider, previous_status, next_status,
            changed_at, reason, actor_type, actor_id, connected_account_label
          ) VALUES (
            ${normalizedTransition.transitionId}, ${normalizedTransition.reviewerId},
            ${normalizedTransition.provider}, ${normalizedTransition.previousStatus},
            ${normalizedTransition.nextStatus}, ${normalizedTransition.changedAt},
            ${normalizedTransition.reason}, ${normalizedTransition.actorType},
            ${normalizedTransition.actorId}, ${normalizedTransition.connectedAccountLabel}
          )
        `;

        // Prune old transitions
        await tx`
          DELETE FROM connection_state_transitions
          WHERE reviewer_id = ${reviewerId}
            AND transition_id NOT IN (
              SELECT transition_id
              FROM connection_state_transitions
              WHERE reviewer_id = ${reviewerId}
              ORDER BY changed_at DESC, transition_id DESC
              LIMIT ${this.maxTransitionsPerReviewer}
            )
        `;
      }

      return {
        states: nextStates,
        transition: normalizedTransition,
      };
    });
  }

  async appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition> {
    const normalizedTransition = normalizeTransitionDraft(transition);

    await this.sql.begin(async (tx_) => {
      const tx = tx_ as unknown as TransactionSql;
      await tx`
        INSERT INTO connection_state_transitions (
          transition_id, reviewer_id, provider, previous_status, next_status,
          changed_at, reason, actor_type, actor_id, connected_account_label
        ) VALUES (
          ${normalizedTransition.transitionId}, ${normalizedTransition.reviewerId},
          ${normalizedTransition.provider}, ${normalizedTransition.previousStatus},
          ${normalizedTransition.nextStatus}, ${normalizedTransition.changedAt},
          ${normalizedTransition.reason}, ${normalizedTransition.actorType},
          ${normalizedTransition.actorId}, ${normalizedTransition.connectedAccountLabel}
        )
      `;

      await tx`
        DELETE FROM connection_state_transitions
        WHERE reviewer_id = ${normalizedTransition.reviewerId}
          AND transition_id NOT IN (
            SELECT transition_id
            FROM connection_state_transitions
            WHERE reviewer_id = ${normalizedTransition.reviewerId}
            ORDER BY changed_at DESC, transition_id DESC
            LIMIT ${this.maxTransitionsPerReviewer}
          )
      `;
    });

    return normalizedTransition;
  }

  async listRecentByReviewerId(
    reviewerId: string,
    options: ListConnectionStateTransitionOptions = {},
  ): Promise<PersistedConnectionStateTransition[]> {
    const limit = normalizeTransitionLimit(options.limit);
    const offset = normalizeTransitionOffset(options.offset);
    const provider = normalizeProvider(options.provider);
    const reason = normalizeTransitionReasonFilter(options.reason);

    let rows: TransitionRow[];

    if (provider && reason) {
      rows = await this.sql<TransitionRow[]>`
        SELECT transition_id, reviewer_id, provider, previous_status, next_status,
               changed_at, reason, actor_type, actor_id, connected_account_label
        FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND provider = ${provider} AND reason = ${reason}
        ORDER BY changed_at DESC, transition_id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (provider) {
      rows = await this.sql<TransitionRow[]>`
        SELECT transition_id, reviewer_id, provider, previous_status, next_status,
               changed_at, reason, actor_type, actor_id, connected_account_label
        FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND provider = ${provider}
        ORDER BY changed_at DESC, transition_id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (reason) {
      rows = await this.sql<TransitionRow[]>`
        SELECT transition_id, reviewer_id, provider, previous_status, next_status,
               changed_at, reason, actor_type, actor_id, connected_account_label
        FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND reason = ${reason}
        ORDER BY changed_at DESC, transition_id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await this.sql<TransitionRow[]>`
        SELECT transition_id, reviewer_id, provider, previous_status, next_status,
               changed_at, reason, actor_type, actor_id, connected_account_label
        FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId}
        ORDER BY changed_at DESC, transition_id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return rows.flatMap((row) => {
      const normalized = normalizeTransitionRow(row);
      return normalized ? [normalized] : [];
    });
  }

  async countByReviewerId(
    reviewerId: string,
    options: CountConnectionStateTransitionOptions = {},
  ): Promise<number> {
    const provider = normalizeProvider(options.provider);
    const reason = normalizeTransitionReasonFilter(options.reason);

    let result: { count: string }[];

    if (provider && reason) {
      result = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND provider = ${provider} AND reason = ${reason}
      `;
    } else if (provider) {
      result = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND provider = ${provider}
      `;
    } else if (reason) {
      result = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId} AND reason = ${reason}
      `;
    } else {
      result = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM connection_state_transitions
        WHERE reviewer_id = ${reviewerId}
      `;
    }

    const count = parseInt(result[0]?.count ?? "0", 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
}

function normalizeStateRow(row: ConnectionStateRow): PersistedConnectionState | null {
  const provider = normalizeProvider(row.provider);

  if (!provider) {
    return null;
  }

  return {
    provider,
    status: normalizeStatus(row.status),
    statusUpdatedAt: row.status_updated_at ?? null,
    connectedAccountLabel: normalizeConnectedAccountLabel(row.connected_account_label),
  };
}

function normalizeStates(records: unknown[]): PersistedConnectionState[] {
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") {
      return [];
    }

    const r = record as Record<string, unknown>;
    const provider = normalizeProvider(r.provider);

    if (!provider) {
      return [];
    }

    return [
      {
        provider,
        status: normalizeStatus(r.status),
        statusUpdatedAt: typeof r.statusUpdatedAt === "string" ? r.statusUpdatedAt : null,
        connectedAccountLabel: normalizeConnectedAccountLabel(r.connectedAccountLabel),
      },
    ];
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

  const changedAt = draft.changedAt;

  if (!changedAt) {
    throw new Error(`Invalid changedAt for connection transition: ${String(draft.changedAt)}`);
  }

  const actorType = normalizeTransitionActorType(draft.actorType);
  const actorId = normalizeTransitionActorId({
    reviewerId,
    actorType,
    actorId: draft.actorId,
  });

  return {
    transitionId: randomUUID(),
    reviewerId,
    provider,
    previousStatus: normalizeStatus(draft.previousStatus),
    nextStatus: normalizeStatus(draft.nextStatus),
    changedAt,
    reason: normalizeTransitionReason(draft.reason),
    actorType,
    actorId,
    connectedAccountLabel: normalizeConnectedAccountLabel(draft.connectedAccountLabel),
  };
}

function normalizeTransitionRow(row: TransitionRow): PersistedConnectionStateTransition | null {
  const provider = normalizeProvider(row.provider);

  if (!row.transition_id || !row.reviewer_id || !provider || !row.changed_at) {
    return null;
  }

  const actorType = normalizeTransitionActorType(row.actor_type);

  return {
    transitionId: row.transition_id,
    reviewerId: row.reviewer_id,
    provider,
    previousStatus: normalizeStatus(row.previous_status),
    nextStatus: normalizeStatus(row.next_status),
    changedAt: row.changed_at,
    reason: normalizeTransitionReason(row.reason),
    actorType,
    actorId: normalizeTransitionActorId({
      reviewerId: row.reviewer_id,
      actorType,
      actorId: row.actor_id,
    }),
    connectedAccountLabel: normalizeConnectedAccountLabel(row.connected_account_label),
  };
}

function normalizeMaxTransitionsPerReviewer(value: number | undefined): number {
  if (!value || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_MAX_TRANSITIONS_PER_REVIEWER;
  }

  return Math.min(value, MAX_MAX_TRANSITIONS_PER_REVIEWER);
}

function normalizeProvider(provider: unknown): string | null {
  if (typeof provider !== "string" || provider.trim().length === 0) {
    return null;
  }

  const normalized = provider.trim();
  return normalized.length > 120 ? null : normalized;
}

function normalizeStatus(status: unknown): string {
  if (typeof status !== "string" || status.trim().length === 0) {
    return "not_connected";
  }

  return status.trim();
}

function normalizeReviewerId(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 200 ? null : normalized;
}

function normalizeTransitionLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_TRANSITION_LIMIT;
  }

  return Math.min(value, MAX_TRANSITION_LIMIT);
}

function normalizeTransitionOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return 0;
  }

  return value;
}

function normalizeTransitionReasonFilter(
  value: ConnectionStateTransitionReason | undefined,
): ConnectionStateTransitionReason | null {
  if (value === "manual" || value === "token-expired" || value === "webhook") {
    return value;
  }

  return null;
}

function normalizeTransitionReason(value: unknown): ConnectionStateTransitionReason {
  if (
    typeof value === "string" &&
    (CONNECTION_STATE_TRANSITION_REASONS as readonly string[]).includes(value)
  ) {
    return value as ConnectionStateTransitionReason;
  }

  return "manual";
}

function normalizeTransitionActorType(value: unknown): ConnectionStateTransitionActorType {
  if (
    typeof value === "string" &&
    (CONNECTION_STATE_TRANSITION_ACTOR_TYPES as readonly string[]).includes(value)
  ) {
    return value as ConnectionStateTransitionActorType;
  }

  return "reviewer";
}

function normalizeTransitionActorId(input: {
  reviewerId: string;
  actorType: ConnectionStateTransitionActorType;
  actorId: unknown;
}): string | null {
  const normalizedActorId =
    typeof input.actorId === "string" && input.actorId.trim().length > 0
      ? input.actorId.trim().slice(0, 200)
      : null;

  if (input.actorType === "reviewer") {
    return normalizedActorId ?? input.reviewerId;
  }

  return normalizedActorId;
}

function normalizeConnectedAccountLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length > MAX_CONNECTED_ACCOUNT_LABEL_LENGTH
    ? trimmed.slice(0, MAX_CONNECTED_ACCOUNT_LABEL_LENGTH)
    : trimmed;
}
