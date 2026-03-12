import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileConnectionTokenRepository } from "@/server/infrastructure/db/file-connection-token-repository";

const ENCRYPTION_KEYS_ENV = "LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS";
const ENCRYPTION_KEY_ENV = "LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY";
const DEFAULT_TEST_ENCRYPTION_KEY = "11".repeat(32);

const originalEncryptionKeysEnv = process.env[ENCRYPTION_KEYS_ENV];
const originalEncryptionKeyEnv = process.env[ENCRYPTION_KEY_ENV];
const temporaryDirectories: string[] = [];

beforeEach(() => {
  delete process.env[ENCRYPTION_KEYS_ENV];
  delete process.env[ENCRYPTION_KEY_ENV];
});

afterEach(async () => {
  process.env[ENCRYPTION_KEYS_ENV] = originalEncryptionKeysEnv;
  process.env[ENCRYPTION_KEY_ENV] = originalEncryptionKeyEnv;

  if (originalEncryptionKeysEnv === undefined) {
    delete process.env[ENCRYPTION_KEYS_ENV];
  }

  if (originalEncryptionKeyEnv === undefined) {
    delete process.env[ENCRYPTION_KEY_ENV];
  }

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-connection-token-"));
  temporaryDirectories.push(root);
  return root;
}

async function createRepository(options: {
  root?: string;
  encryptionKey?: string;
  encryptionKeys?: readonly string[];
} = {}) {
  const root = options.root ?? (await createTemporaryRoot());
  const dataDirectory = path.join(root, "connection-tokens");
  const hasExplicitEncryptionKey = Object.prototype.hasOwnProperty.call(options, "encryptionKey");
  const encryptionKey = options.encryptionKeys
    ? options.encryptionKey
    : hasExplicitEncryptionKey
      ? options.encryptionKey
      : DEFAULT_TEST_ENCRYPTION_KEY;

  return {
    root,
    dataDirectory,
    repository: new FileConnectionTokenRepository({
      dataDirectory,
      encryptionKey,
      encryptionKeys: options.encryptionKeys,
    }),
  };
}

describe("FileConnectionTokenRepository", () => {
  it("upserts token by reviewer and provider", async () => {
    const { repository, dataDirectory } = await createRepository();
    await repository.upsertToken({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "token-1",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-12T00:00:00.000Z",
    });

    await repository.upsertToken({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "token-2",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-12T00:01:00.000Z",
    });

    await expect(
      repository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toEqual({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "token-2",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-12T00:01:00.000Z",
    });

    const tokenRecordPath = path.join(dataDirectory, "demo-reviewer.json");
    const storedRecord = await readFile(tokenRecordPath, "utf8");
    expect(storedRecord).not.toContain("token-2");
    expect(storedRecord).toContain("enc:v1:");
  });

  it("returns null for malformed token files", async () => {
    const { dataDirectory, repository } = await createRepository();
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(path.join(dataDirectory, "demo-reviewer.json"), "{ invalid");

    await expect(
      repository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toBeNull();
  });

  it("returns null for blank reviewer id", async () => {
    const { repository } = await createRepository();

    await expect(repository.findTokenByReviewerId(" ", "github")).resolves.toBeNull();
  });

  it("decrypts with secondary key and re-encrypts with primary key", async () => {
    const root = await createTemporaryRoot();
    const legacyKey = `base64:${Buffer.alloc(32, 7).toString("base64")}`;
    const rotatedPrimaryKey = "ab".repeat(32);

    const { repository: legacyRepository, dataDirectory } = await createRepository({
      root,
      encryptionKey: legacyKey,
    });

    await legacyRepository.upsertToken({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "legacy-token",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: "legacy-refresh-token",
      expiresAt: null,
      updatedAt: "2026-03-12T00:00:00.000Z",
    });

    const { repository: rotatedRepository } = await createRepository({
      root,
      encryptionKeys: [rotatedPrimaryKey, legacyKey],
      encryptionKey: undefined,
    });

    await expect(
      rotatedRepository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toMatchObject({
      accessToken: "legacy-token",
      refreshToken: "legacy-refresh-token",
    });

    await rotatedRepository.upsertToken({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "rotated-token",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: "rotated-refresh-token",
      expiresAt: null,
      updatedAt: "2026-03-12T00:02:00.000Z",
    });

    const tokenRecordPath = path.join(dataDirectory, "demo-reviewer.json");
    const storedRecord = await readFile(tokenRecordPath, "utf8");
    expect(storedRecord).not.toContain("rotated-token");
    expect(storedRecord).not.toContain("rotated-refresh-token");
    expect(storedRecord).toContain("enc:v1:");

    const { repository: oldKeyOnlyRepository } = await createRepository({
      root,
      encryptionKey: legacyKey,
    });

    await expect(
      oldKeyOnlyRepository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toBeNull();

    const { repository: primaryKeyOnlyRepository } = await createRepository({
      root,
      encryptionKey: rotatedPrimaryKey,
    });

    await expect(
      primaryKeyOnlyRepository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toMatchObject({
      accessToken: "rotated-token",
      refreshToken: "rotated-refresh-token",
    });
  });

  it("reads existing enc:v1 payload when secondary key is configured", async () => {
    const root = await createTemporaryRoot();
    delete process.env[ENCRYPTION_KEY_ENV];

    const dataDirectory = path.join(root, "connection-tokens");
    const initialRepository = new FileConnectionTokenRepository({ dataDirectory });
    await initialRepository.upsertToken({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "existing-token",
      tokenType: "bearer",
      scope: "repo",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-12T00:00:00.000Z",
    });

    const generatedKey = (await readFile(path.join(dataDirectory, ".encryption-key"), "utf8")).trim();
    const rotatedPrimaryKey = "cd".repeat(32);
    const rotatedRepository = new FileConnectionTokenRepository({
      dataDirectory,
      encryptionKeys: [rotatedPrimaryKey, generatedKey],
    });

    await expect(
      rotatedRepository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toMatchObject({
      accessToken: "existing-token",
    });
  });

  it("throws clear error for ambiguous legacy key configuration", async () => {
    await expect(
      createRepository({
        encryptionKey: "plain-text-secret",
      }),
    ).rejects.toThrow(
      /Invalid FileConnectionTokenRepositoryOptions\.encryptionKey: expected "base64:<32-byte key>" or 64 hex characters\./,
    );
  });

  it("throws clear error for malformed LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS", async () => {
    process.env[ENCRYPTION_KEYS_ENV] = `${"ef".repeat(32)},`;

    await expect(
      createRepository({
        encryptionKey: undefined,
      }),
    ).rejects.toThrow(/Invalid LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS: key at index 1 is empty\./);
  });
});
