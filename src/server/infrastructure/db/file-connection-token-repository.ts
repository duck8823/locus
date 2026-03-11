import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";

interface ConnectionTokenFileRecord {
  reviewerId?: string;
  tokens?: unknown;
}

export interface FileConnectionTokenRepositoryOptions {
  dataDirectory?: string;
}

export class FileConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly dataDirectory: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(options: FileConnectionTokenRepositoryOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "connection-tokens");
  }

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const normalized = assertPersistedToken(input);
    let saved = normalized;

    await this.enqueueWrite(normalized.reviewerId, async () => {
      const current = await this.readForReviewerId(normalized.reviewerId);
      const withoutProvider = current.filter((token) => token.provider !== normalized.provider);
      const next = [...withoutProvider, normalized];
      await this.writeForReviewerId(normalized.reviewerId, next);
      saved = normalized;
    });

    return saved;
  }

  async findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null> {
    const normalizedReviewerId = normalizeString(reviewerId, 200);

    if (!normalizedReviewerId) {
      return null;
    }

    const tokens = await this.readForReviewerId(normalizedReviewerId);
    return tokens.find((token) => token.provider === provider) ?? null;
  }

  private getFilePath(reviewerId: string): string {
    return path.join(this.dataDirectory, `${encodeURIComponent(reviewerId)}.json`);
  }

  private async readForReviewerId(reviewerId: string): Promise<PersistedConnectionToken[]> {
    try {
      const raw = await readFile(this.getFilePath(reviewerId), "utf8");
      const parsed = JSON.parse(raw) as ConnectionTokenFileRecord;

      if (!parsed || !Array.isArray(parsed.tokens)) {
        return [];
      }

      return parsed.tokens.flatMap((token) => {
        const normalized = normalizeToken(token);
        return normalized ? [normalized] : [];
      });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      if (error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async writeForReviewerId(
    reviewerId: string,
    tokens: PersistedConnectionToken[],
  ): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const filePath = this.getFilePath(reviewerId);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      tempPath,
      JSON.stringify(
        {
          reviewerId,
          tokens,
        },
        null,
        2,
      ),
    );
    await rename(tempPath, filePath);
  }

  private async enqueueWrite(reviewerId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(reviewerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.writeQueues.set(reviewerId, next);

    try {
      await next;
    } finally {
      if (this.writeQueues.get(reviewerId) === next) {
        this.writeQueues.delete(reviewerId);
      }
    }
  }
}

function normalizeToken(value: unknown): PersistedConnectionToken | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const reviewerId = normalizeString(record.reviewerId, 200);
  const accessToken = normalizeString(record.accessToken, 4096);
  const updatedAt = normalizeIsoTimestamp(record.updatedAt);

  if (!reviewerId || !accessToken || !updatedAt) {
    return null;
  }

  return {
    reviewerId,
    provider: "github",
    accessToken,
    tokenType: normalizeNullableString(record.tokenType, 120),
    scope: normalizeNullableString(record.scope, 2000),
    refreshToken: normalizeNullableString(record.refreshToken, 4096),
    expiresAt: normalizeIsoTimestamp(record.expiresAt),
    updatedAt,
  };
}

function assertPersistedToken(value: unknown): PersistedConnectionToken {
  const normalized = normalizeToken(value);

  if (!normalized) {
    throw new Error("Invalid connection token input.");
  }

  return normalized;
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

  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
