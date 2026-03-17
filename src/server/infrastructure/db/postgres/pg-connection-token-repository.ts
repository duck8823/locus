import type { Sql } from "./types";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";

interface ConnectionTokenRow {
  reviewer_id: string;
  provider: string;
  access_token: string;
  token_type: string | null;
  scope: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  updated_at: string;
}

export class PgConnectionTokenRepository implements ConnectionTokenRepository {
  constructor(private readonly sql: Sql) {}

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const normalized = assertPersistedToken(input);

    await this.sql`
      INSERT INTO connection_tokens (
        reviewer_id, provider, access_token, token_type, scope,
        refresh_token, expires_at, updated_at
      ) VALUES (
        ${normalized.reviewerId}, ${normalized.provider}, ${normalized.accessToken},
        ${normalized.tokenType}, ${normalized.scope}, ${normalized.refreshToken},
        ${normalized.expiresAt}, ${normalized.updatedAt}
      )
      ON CONFLICT (reviewer_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        token_type = EXCLUDED.token_type,
        scope = EXCLUDED.scope,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    `;

    return normalized;
  }

  async findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null> {
    const normalizedReviewerId = normalizeString(reviewerId, 200);

    if (!normalizedReviewerId) {
      return null;
    }

    const rows = await this.sql<ConnectionTokenRow[]>`
      SELECT reviewer_id, provider, access_token, token_type, scope,
             refresh_token, expires_at, updated_at
      FROM connection_tokens
      WHERE reviewer_id = ${normalizedReviewerId} AND provider = ${provider}
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      reviewerId: row.reviewer_id,
      provider: row.provider as "github",
      accessToken: row.access_token,
      tokenType: row.token_type,
      scope: row.scope,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    };
  }
}

function assertPersistedToken(value: unknown): PersistedConnectionToken {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid connection token input.");
  }

  const record = value as Record<string, unknown>;
  const reviewerId = normalizeString(record.reviewerId, 200);
  const accessToken = normalizeString(record.accessToken, 16_384);
  const updatedAt = normalizeIsoTimestamp(record.updatedAt);

  if (!reviewerId || !accessToken || !updatedAt) {
    throw new Error("Invalid connection token input.");
  }

  return {
    reviewerId,
    provider: "github",
    accessToken,
    tokenType: normalizeNullableString(record.tokenType, 120),
    scope: normalizeNullableString(record.scope, 2_000),
    refreshToken: normalizeNullableString(record.refreshToken, 16_384),
    expiresAt: normalizeIsoTimestamp(record.expiresAt),
    updatedAt,
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

function normalizeNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}
