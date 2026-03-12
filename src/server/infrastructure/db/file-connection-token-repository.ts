import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
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

interface ResolvedEncryptionKeyRing {
  primaryKey: Buffer;
  decryptionKeys: readonly Buffer[];
}

export interface FileConnectionTokenRepositoryOptions {
  dataDirectory?: string;
  encryptionKey?: string;
  encryptionKeys?: readonly string[];
  encryptionKeyFilePath?: string;
}

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const ENCRYPTION_KEYS_ENV = "LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS";
const ENCRYPTION_KEY_ENV = "LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY";
const BASE64_KEY_VALUE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_KEY_VALUE_PATTERN = /^[0-9a-fA-F]{64}$/;

export class FileConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly dataDirectory: string;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly configuredKeyRing: readonly Buffer[] | null;
  private readonly encryptionKeyFilePath: string;
  private encryptionKeyRingPromise: Promise<ResolvedEncryptionKeyRing> | null = null;

  constructor(options: FileConnectionTokenRepositoryOptions = {}) {
    this.dataDirectory =
      options.dataDirectory ?? path.join(process.cwd(), ".locus-data", "connection-tokens");
    this.configuredKeyRing = resolveConfiguredEncryptionKeyRing({
      optionEncryptionKeys: options.encryptionKeys,
      optionEncryptionKey: options.encryptionKey,
      environmentEncryptionKeys: process.env[ENCRYPTION_KEYS_ENV] ?? null,
      environmentEncryptionKey: process.env[ENCRYPTION_KEY_ENV] ?? null,
    });
    this.encryptionKeyFilePath =
      options.encryptionKeyFilePath ?? path.join(this.dataDirectory, ".encryption-key");
  }

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const normalized = assertPersistedToken(input);

    await this.enqueueWrite(normalized.reviewerId, async () => {
      const keyRing = await this.getEncryptionKeyRing();
      const current = await this.readForReviewerId(normalized.reviewerId, keyRing.decryptionKeys);
      const withoutProvider = current.filter(
        (token) => token.provider !== normalized.provider,
      );
      const next = [...withoutProvider, normalized];
      await this.writeForReviewerId(normalized.reviewerId, next, keyRing.primaryKey);
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

    const keyRing = await this.getEncryptionKeyRing();
    const tokens = await this.readForReviewerId(normalizedReviewerId, keyRing.decryptionKeys);
    return tokens.find((token) => token.provider === provider) ?? null;
  }

  private async getEncryptionKeyRing(): Promise<ResolvedEncryptionKeyRing> {
    if (!this.encryptionKeyRingPromise) {
      this.encryptionKeyRingPromise = resolveEncryptionKeyRing({
        configuredKeyRing: this.configuredKeyRing,
        keyFilePath: this.encryptionKeyFilePath,
      });
    }

    return this.encryptionKeyRingPromise;
  }

  private getFilePath(reviewerId: string): string {
    return path.join(this.dataDirectory, `${encodeURIComponent(reviewerId)}.json`);
  }

  private async readForReviewerId(
    reviewerId: string,
    decryptionKeys: readonly Buffer[],
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

        const decrypted = decryptPersistedToken(normalized, decryptionKeys);

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
  decryptionKeys: readonly Buffer[],
): PersistedConnectionToken | null {
  for (const key of decryptionKeys) {
    try {
      const accessToken = decryptSecret(token.accessToken, key);

      if (!accessToken) {
        continue;
      }

      return {
        ...token,
        accessToken,
        refreshToken: token.refreshToken ? decryptSecret(token.refreshToken, key) : null,
      };
    } catch {
      continue;
    }
  }

  return null;
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

function resolveConfiguredEncryptionKeyRing(input: {
  optionEncryptionKeys: readonly string[] | undefined;
  optionEncryptionKey: string | undefined;
  environmentEncryptionKeys: string | null;
  environmentEncryptionKey: string | null;
}): readonly Buffer[] | null {
  const optionKeyRing = parseConfiguredEncryptionKeyRingFromList(
    input.optionEncryptionKeys,
    "FileConnectionTokenRepositoryOptions.encryptionKeys",
  );

  if (optionKeyRing) {
    return optionKeyRing;
  }

  const optionSingleKey = parseConfiguredSingleEncryptionKey(
    input.optionEncryptionKey,
    "FileConnectionTokenRepositoryOptions.encryptionKey",
  );

  if (optionSingleKey) {
    return [optionSingleKey];
  }

  const envKeyRing = parseConfiguredEncryptionKeyRingFromCommaSeparatedValue(
    input.environmentEncryptionKeys,
    ENCRYPTION_KEYS_ENV,
  );

  if (envKeyRing) {
    return envKeyRing;
  }

  const envSingleKey = parseConfiguredSingleEncryptionKey(
    input.environmentEncryptionKey,
    ENCRYPTION_KEY_ENV,
  );

  if (envSingleKey) {
    return [envSingleKey];
  }

  return null;
}

async function resolveEncryptionKeyRing(input: {
  configuredKeyRing: readonly Buffer[] | null;
  keyFilePath: string;
}): Promise<ResolvedEncryptionKeyRing> {
  if (input.configuredKeyRing && input.configuredKeyRing.length > 0) {
    return {
      primaryKey: input.configuredKeyRing[0],
      decryptionKeys: input.configuredKeyRing,
    };
  }

  await mkdir(path.dirname(input.keyFilePath), { recursive: true });

  try {
    const existing = await readFile(input.keyFilePath, "utf8");
    const key = parseConfiguredEncryptionKey(
      existing,
      `file:${input.keyFilePath}`,
    );

    return {
      primaryKey: key,
      decryptionKeys: [key],
    };
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

  return {
    primaryKey: generated,
    decryptionKeys: [generated],
  };
}

function parseConfiguredEncryptionKeyRingFromList(
  value: readonly string[] | undefined,
  source: string,
): Buffer[] | null {
  if (value === undefined) {
    return null;
  }

  if (value.length === 0) {
    throw new Error(`Invalid ${source}: at least one key is required.`);
  }

  return deduplicateEncryptionKeys(
    value.map((key, index) => parseConfiguredEncryptionKey(key, `${source}[${index}]`)),
  );
}

function parseConfiguredEncryptionKeyRingFromCommaSeparatedValue(
  value: string | null,
  source: string,
): Buffer[] | null {
  if (value === null) {
    return null;
  }

  if (value.trim().length === 0) {
    throw new Error(`Invalid ${source}: at least one key is required.`);
  }

  const items = value.split(",").map((item) => item.trim());
  const emptyItemIndex = items.findIndex((item) => item.length === 0);

  if (emptyItemIndex >= 0) {
    throw new Error(`Invalid ${source}: key at index ${emptyItemIndex} is empty.`);
  }

  return deduplicateEncryptionKeys(
    items.map((item, index) => parseConfiguredEncryptionKey(item, `${source}[${index}]`)),
  );
}

function parseConfiguredSingleEncryptionKey(
  value: string | undefined | null,
  source: string,
): Buffer | null {
  if (value === undefined || value === null) {
    return null;
  }

  return parseConfiguredEncryptionKey(value, source);
}

function parseConfiguredEncryptionKey(value: string, source: string): Buffer {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Invalid ${source}: key must not be empty.`);
  }

  if (trimmed.startsWith("base64:")) {
    const encoded = trimmed.slice("base64:".length).trim();

    if (encoded.length === 0) {
      throw new Error(`Invalid ${source}: base64 key must not be empty.`);
    }

    if (!BASE64_KEY_VALUE_PATTERN.test(encoded)) {
      throw new Error(
        `Invalid ${source}: expected \"base64:<32-byte key>\" or 64 hex characters.`,
      );
    }

    const buffer = Buffer.from(encoded, "base64");
    const canonical = buffer.toString("base64").replace(/=+$/, "");

    if (canonical !== encoded.replace(/=+$/, "")) {
      throw new Error(`Invalid ${source}: base64 payload is malformed.`);
    }

    if (buffer.length !== 32) {
      throw new Error(`Invalid ${source}: base64 key must decode to exactly 32 bytes.`);
    }

    return buffer;
  }

  if (HEX_KEY_VALUE_PATTERN.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  throw new Error(`Invalid ${source}: expected \"base64:<32-byte key>\" or 64 hex characters.`);
}

function deduplicateEncryptionKeys(keys: readonly Buffer[]): Buffer[] {
  const unique: Buffer[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const digest = key.toString("hex");

    if (seen.has(digest)) {
      continue;
    }

    seen.add(digest);
    unique.push(key);
  }

  return unique;
}
