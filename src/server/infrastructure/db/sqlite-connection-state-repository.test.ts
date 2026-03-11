import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteConnectionStateRepository } from "@/server/infrastructure/db/sqlite-connection-state-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-sqlite-connection-state-"));
  temporaryDirectories.push(root);

  const databasePath = path.join(root, "data", "connection-state.sqlite");
  const legacyDataDirectory = path.join(root, "legacy-connection-states");

  return {
    root,
    databasePath,
    legacyDataDirectory,
    repository: new SqliteConnectionStateRepository({
      databasePath,
      legacyDataDirectory,
    }),
  };
}

describe("SqliteConnectionStateRepository", () => {
  it("saves and reloads states", async () => {
    const { repository } = await createRepository();

    await repository.saveForReviewerId("saved-reviewer", [
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
      {
        provider: "jira",
        status: " ",
        statusUpdatedAt: "invalid-date",
        connectedAccountLabel: " ",
      },
      {
        provider: "",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "skip-me",
      },
    ]);

    await expect(repository.findByReviewerId("saved-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
      {
        provider: "jira",
        status: "not_connected",
        statusUpdatedAt: null,
        connectedAccountLabel: null,
      },
    ]);
  });

  it("migrates legacy JSON state for reviewer when database row does not exist", async () => {
    const { databasePath, legacyDataDirectory, repository } = await createRepository();
    await mkdir(legacyDataDirectory, { recursive: true });
    await writeFile(
      path.join(legacyDataDirectory, `${encodeURIComponent("legacy-reviewer")}.json`),
      JSON.stringify(
        {
          reviewerId: "legacy-reviewer",
          connections: [
            {
              provider: "github",
              status: "connected",
              statusUpdatedAt: "2026-03-11T00:00:00.000Z",
              connectedAccountLabel: "duck8823",
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(repository.findByReviewerId("legacy-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
    ]);

    const reloadedRepository = new SqliteConnectionStateRepository({
      databasePath,
      legacyDataDirectory: path.join(legacyDataDirectory, "missing"),
    });

    await expect(reloadedRepository.findByReviewerId("legacy-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
    ]);
  });

  it("serializes concurrent updates and preserves provider changes", async () => {
    const { repository } = await createRepository();

    await Promise.all([
      repository.updateForReviewerId("demo-reviewer", (states) => [
        ...states.filter((state) => state.provider !== "github"),
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-11T00:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
      ]),
      repository.updateForReviewerId("demo-reviewer", (states) => [
        ...states.filter((state) => state.provider !== "jira"),
        {
          provider: "jira",
          status: "not_connected",
          statusUpdatedAt: "2026-03-11T00:00:01.000Z",
          connectedAccountLabel: null,
        },
      ]),
    ]);

    const result = await repository.findByReviewerId("demo-reviewer");

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-11T00:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
        {
          provider: "jira",
          status: "not_connected",
          statusUpdatedAt: "2026-03-11T00:00:01.000Z",
          connectedAccountLabel: null,
        },
      ]),
    );
  });

  it("stores and lists recent transitions", async () => {
    const { repository } = await createRepository();

    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "github",
      previousStatus: "not_connected",
      nextStatus: "connected",
      changedAt: "2026-03-11T00:00:00.000Z",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "github",
      previousStatus: "connected",
      nextStatus: "reauth_required",
      changedAt: "2026-03-11T00:01:00.000Z",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "confluence",
      previousStatus: "planned",
      nextStatus: "planned",
      changedAt: "2026-03-11T00:02:00.000Z",
      connectedAccountLabel: null,
    });

    const allTransitions = await repository.listRecentByReviewerId("demo-reviewer", {
      limit: 10,
    });

    expect(allTransitions).toHaveLength(3);
    expect(allTransitions.map((transition) => transition.provider)).toEqual([
      "confluence",
      "github",
      "github",
    ]);
    expect(allTransitions[0].nextStatus).toBe("planned");

    const githubTransitions = await repository.listRecentByReviewerId("demo-reviewer", {
      provider: "github",
      limit: 10,
    });

    expect(githubTransitions).toHaveLength(2);
    expect(githubTransitions.map((transition) => transition.nextStatus)).toEqual([
      "reauth_required",
      "connected",
    ]);
  });
});
