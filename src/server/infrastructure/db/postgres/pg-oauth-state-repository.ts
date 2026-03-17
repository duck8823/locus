import type { Sql, TransactionSql } from "./types";
import type {
  OAuthStateRepository,
  PendingOAuthState,
  SavePendingOAuthStateInput,
} from "@/server/application/ports/oauth-state-repository";

interface OAuthStateRow {
  state: string;
  provider: string;
  reviewer_id: string;
  redirect_path: string;
  code_verifier: string;
  created_at: string;
  expires_at: string;
}

export class PgOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly sql: Sql) {}

  async savePendingState(input: SavePendingOAuthStateInput): Promise<PendingOAuthState> {
    const normalized = assertPendingOAuthState(input);

    await this.sql`
      INSERT INTO oauth_pending_states (
        state, provider, reviewer_id, redirect_path, code_verifier, created_at, expires_at
      ) VALUES (
        ${normalized.state}, ${normalized.provider}, ${normalized.reviewerId},
        ${normalized.redirectPath}, ${normalized.codeVerifier},
        ${normalized.createdAt}, ${normalized.expiresAt}
      )
      ON CONFLICT (state) DO UPDATE SET
        provider = EXCLUDED.provider,
        reviewer_id = EXCLUDED.reviewer_id,
        redirect_path = EXCLUDED.redirect_path,
        code_verifier = EXCLUDED.code_verifier,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at
    `;

    return normalized;
  }

  async consumePendingState(state: string): Promise<PendingOAuthState | null> {
    const normalizedState = state.trim();

    if (normalizedState.length === 0) {
      return null;
    }

    const now = new Date().toISOString();

    // Delete expired states and consume the matching one atomically
    const rows = await this.sql.begin(async (tx_) => {
      const tx = tx_ as unknown as TransactionSql;
      // Clean up expired states
      await tx`
        DELETE FROM oauth_pending_states WHERE expires_at <= ${now}
      `;

      // Consume the matching state
      const consumed = await tx<OAuthStateRow[]>`
        DELETE FROM oauth_pending_states
        WHERE state = ${normalizedState} AND expires_at > ${now}
        RETURNING state, provider, reviewer_id, redirect_path, code_verifier, created_at, expires_at
      `;

      return consumed;
    });

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      state: row.state,
      provider: row.provider as "github",
      reviewerId: row.reviewer_id,
      redirectPath: row.redirect_path,
      codeVerifier: row.code_verifier,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
}

function assertPendingOAuthState(input: SavePendingOAuthStateInput): PendingOAuthState {
  const record = input as unknown as Record<string, unknown>;
  const state = normalizeString(record.state, 512);
  const reviewerId = normalizeString(record.reviewerId, 200);
  const redirectPath = normalizeString(record.redirectPath, 2000);
  const codeVerifier = normalizeString(record.codeVerifier, 512);
  const createdAt = normalizeIsoTimestamp(record.createdAt);
  const expiresAt = normalizeIsoTimestamp(record.expiresAt);

  if (!state || !reviewerId || !redirectPath || !codeVerifier || !createdAt || !expiresAt) {
    throw new Error("Invalid pending OAuth state input.");
  }

  return {
    state,
    provider: "github",
    reviewerId,
    redirectPath,
    codeVerifier,
    createdAt,
    expiresAt,
  };
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }

  return trimmed;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const epochMs = Date.parse(value);

  if (!Number.isFinite(epochMs)) {
    return null;
  }

  return new Date(epochMs).toISOString();
}
