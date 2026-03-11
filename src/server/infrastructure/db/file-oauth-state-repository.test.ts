import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileOAuthStateRepository } from "@/server/infrastructure/db/file-oauth-state-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-oauth-state-"));
  temporaryDirectories.push(root);
  const dataFilePath = path.join(root, "oauth", "pending-states.json");

  return {
    root,
    dataFilePath,
    repository: new FileOAuthStateRepository({
      dataFilePath,
    }),
  };
}

describe("FileOAuthStateRepository", () => {
  it("saves and consumes pending oauth states", async () => {
    const { repository } = await createRepository();
    await repository.savePendingState({
      state: "state-1",
      provider: "github",
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      codeVerifier: "verifier-1",
      createdAt: "2026-03-12T00:00:00.000Z",
      expiresAt: "2099-03-12T00:10:00.000Z",
    });

    await expect(repository.consumePendingState("state-1")).resolves.toEqual({
      state: "state-1",
      provider: "github",
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      codeVerifier: "verifier-1",
      createdAt: "2026-03-12T00:00:00.000Z",
      expiresAt: "2099-03-12T00:10:00.000Z",
    });
    await expect(repository.consumePendingState("state-1")).resolves.toBeNull();
  });

  it("drops expired states while consuming", async () => {
    const { dataFilePath, repository } = await createRepository();
    await mkdir(path.dirname(dataFilePath), { recursive: true });
    await writeFile(
      dataFilePath,
      JSON.stringify(
        {
          states: [
            {
              state: "expired-state",
              provider: "github",
              reviewerId: "demo-reviewer",
              redirectPath: "/settings/connections",
              codeVerifier: "verifier-expired",
              createdAt: "2026-03-12T00:00:00.000Z",
              expiresAt: "2000-01-01T00:00:01.000Z",
            },
            {
              state: "valid-state",
              provider: "github",
              reviewerId: "demo-reviewer",
              redirectPath: "/settings/connections",
              codeVerifier: "verifier-valid",
              createdAt: "2026-03-12T00:00:00.000Z",
              expiresAt: "2099-03-12T00:10:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(repository.consumePendingState("valid-state")).resolves.toMatchObject({
      state: "valid-state",
      codeVerifier: "verifier-valid",
    });
    const persisted = JSON.parse(await readFile(dataFilePath, "utf8")) as {
      states?: Array<{ state: string }>;
    };
    expect(persisted.states ?? []).toEqual([]);
  });

  it("returns null for missing state files or malformed input", async () => {
    const { dataFilePath, repository } = await createRepository();
    await expect(repository.consumePendingState("missing-state")).resolves.toBeNull();

    await mkdir(path.dirname(dataFilePath), { recursive: true });
    await writeFile(dataFilePath, "{ invalid");

    await expect(repository.consumePendingState("missing-state")).resolves.toBeNull();
  });
});
