import path from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";

interface ConnectionTokenFileRecord {
  reviewerId?: string;
  tokens?: unknown;
}

interface EncryptableConnectionToken {
  reviewerId: string;
  provider: "github";
  accessToken: string;
  tokenType: string | null;
  scope: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface FileConnectionTokenRepositoryOptions {
  dataDirectory?: string;
  encryptionKey?: string;
  encryptionKeyFilePath?: string;
}

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";

export class FileConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly dataDirectory: string;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly configuredEncryptionKey: string | null;
  private readonly encryptionKeyFilePath: string;
  private encryptionKeyPromise: Promise<Buffer> | null = null;

  constructor(options: FileConnectionTokenRepositoryOptions = {}) {
    this.dataDirectory =
      options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "connection-tokens");
    this.configuredEncryptionKey =
      options.encryptionKey ?? process.env.LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY ?? null;
    this.encryptionKeyFilePath =
      options.encryptionKeyFilePath ?? path.join(this.dataDirectory, ".encryption-key");
  }

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const normalized = assertPersistedToken(input);

    await this.enqueueWrite(normalized.reviewerId, async () => {
      const key = await this.getEncryptionKey();
      const current = await this.readForReviewerId(normalized.reviewerId, key);
      const withoutProvider = current.filter(
        (token) => token.provider !== normalized.provider,
      );
      const next = [...withoutProvider, normalized];
      await this.writeForReviewerId(normalized.reviewerId, next, key);
    });

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

    const key = await this.getEncryptionKey();
    const tokens = await this.readForReviewerId(normalizedReviewerId, key);
    return tokens.find((token) => token.provider === provider) ?? null;
  }

  private async getEncryptionKey(): Promise<Buffer> {
    if (!this.encryptionKeyPromise) {
      this.encryptionKeyPromise = resolveEncryptionKey({
        configuredKey: this.configuredEncryptionKey,
        keyFilePath: this.encryptionKeyFilePath,
      });
    }

    return this.encryptionKeyPromise;
  }

  private getFilePath(reviewerId: string): string {
    return path.join(this.dataDirectory, `${encodeURIComponent(reviewerId)}.json`);
  }

  private async readForReviewerId(
    reviewerId: string,
    key: Buffer,
  ): Promise<PersistedConnectionToken[]> {
    try {
      const raw = await readFile(this.getFilePath(reviewerId), "utf8");
      const parsed = JSON.parse(raw) as ConnectionTokenFileRecord;

      if (!parsed || !Array.isArray(parsed.tokens)) {
        return [];
      }

      const tokens: PersistedConnectionToken[] = [];

      for (const tokenCandidate of parsed.tokens) {
        const normalized = normalizeToken(tokenCandidate);

        if (!normalized) {
          continue;
        }

        const decrypted = decryptPersistedToken(normalized, key);

        if (!decrypted) {
          continue;
        }

        tokens.push(decrypted);
      }

      return tokens;
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
    key: Buffer,
  ): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const filePath = this.getFilePath(reviewerId);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const encryptedTokens = tokens.map((token) => encryptPersistedToken(token, key));

    await writeFile(
      tempPath,
      JSON.stringify(
        {
          reviewerId,
          tokens: encryptedTokens,
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

function normalizeToken(value: unknown): EncryptableConnectionToken | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const reviewerId = normalizeString(record.reviewerId, 200);
  const accessToken = normalizeString(record.accessToken, 16_384);
  const updatedAt = normalizeIsoTimestamp(record.updatedAt);

  if (!reviewerId || !accessToken || !updatedAt) {
    return null;
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

function encryptPersistedToken(
  token: PersistedConnectionToken,
  key: Buffer,
): EncryptableConnectionToken {
  return {
    ...token,
    accessToken: encryptSecret(token.accessToken, key),
    refreshToken: token.refreshToken ? encryptSecret(token.refreshToken, key) : null,
  };
}

function decryptPersistedToken(
  token: EncryptableConnectionToken,
  key: Buffer,
): PersistedConnectionToken | null {
  try {
    const accessToken = decryptSecret(token.accessToken, key);

    if (!accessToken) {
      return null;
    }

    return {
      ...token,
      accessToken,
      refreshToken: token.refreshToken ? decryptSecret(token.refreshToken, key) : null,
    };
  } catch {
    return null;
  }
}

function encryptSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_VALUE_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string, key: Buffer): string {
  if (!value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    return value;
  }

  const payload = value.slice(ENCRYPTED_VALUE_PREFIX.length);
  const [ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");

  if (!ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error("Invalid encrypted token payload.");
  }

  const iv = Buffer.from(ivEncoded, "base64url");
  const tag = Buffer.from(tagEncoded, "base64url");
  const encrypted = Buffer.from(encryptedEncoded, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

async function resolveEncryptionKey(input: {
  configuredKey: string | null;
  keyFilePath: string;
}): Promise<Buffer> {
  const configured = parseConfiguredEncryptionKey(input.configuredKey);

  if (configured) {
    return configured;
  }

  await mkdir(path.dirname(input.keyFilePath), { recursive: true });

  try {
    const existing = await readFile(input.keyFilePath, "utf8");
    const normalized = parseConfiguredEncryptionKey(existing);

    if (normalized) {
      return normalized;
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const generated = randomBytes(32);
  const serialized = `base64:${generated.toString("base64")}`;
  const tempPath = `${input.keyFilePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialized, { mode: 0o600 });
  await rename(tempPath, input.keyFilePath);
  return generated;
}

function parseConfiguredEncryptionKey(value: string | null): Buffer | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("base64:")) {
    return normalizeKeyBuffer(Buffer.from(trimmed.slice("base64:".length), "base64"));
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return createHash("sha256").update(trimmed).digest();
}

function normalizeKeyBuffer(buffer: Buffer): Buffer | null {
  if (buffer.length === 32) {
    return buffer;
  }

  return null;
}
