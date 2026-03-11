import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileConnectionTokenRepository } from "@/server/infrastructure/db/file-connection-token-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-connection-token-"));
  temporaryDirectories.push(root);

  return {
    root,
    dataDirectory: path.join(root, "connection-tokens"),
    repository: new FileConnectionTokenRepository({
      dataDirectory: path.join(root, "connection-tokens"),
    }),
  };
}

describe("FileConnectionTokenRepository", () => {
  it("upserts token by reviewer and provider", async () => {
    const { repository } = await createRepository();
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
});
