import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

async function createRepository(
  options: { maxTransitionsPerReviewer?: number } = {},
) {
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
      maxTransitionsPerReviewer: options.maxTransitionsPerReviewer,
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

  it("updates state and transition atomically", async () => {
    const { repository } = await createRepository();

    const updated = await repository.updateStateAndAppendTransition(
      "demo-reviewer",
      () => ({
        states: [
          {
            provider: "github",
            status: "connected",
            statusUpdatedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
        transition: {
          reviewerId: "demo-reviewer",
          provider: "github",
          previousStatus: "not_connected",
          nextStatus: "connected",
          changedAt: "2026-03-11T00:00:00.000Z",
          reason: "manual",
          actorType: "reviewer",
          actorId: "demo-reviewer",
          connectedAccountLabel: "duck8823",
        },
      }),
    );

    expect(updated.states).toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
    ]);
    expect(updated.transition).toMatchObject({
      reviewerId: "demo-reviewer",
      provider: "github",
      previousStatus: "not_connected",
      nextStatus: "connected",
      reason: "manual",
      actorType: "reviewer",
      actorId: "demo-reviewer",
    });

    const transitions = await repository.listRecentByReviewerId("demo-reviewer", {
      limit: 10,
    });

    expect(transitions).toHaveLength(1);
    expect(transitions[0].nextStatus).toBe("connected");
  });

  it("rolls back state changes when atomic transition insert fails", async () => {
    const { repository } = await createRepository();

    await expect(
      repository.updateStateAndAppendTransition("demo-reviewer", () => ({
        states: [
          {
            provider: "github",
            status: "connected",
            statusUpdatedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
        transition: {
          reviewerId: "demo-reviewer",
          provider: "github",
          previousStatus: "not_connected",
          nextStatus: "connected",
          changedAt: "invalid-date",
          reason: "manual",
          actorType: "reviewer",
          actorId: "demo-reviewer",
          connectedAccountLabel: "duck8823",
        },
      })),
    ).rejects.toThrow("Invalid changedAt for connection transition: invalid-date");

    await expect(repository.findByReviewerId("demo-reviewer")).resolves.toEqual([]);
    await expect(repository.listRecentByReviewerId("demo-reviewer")).resolves.toEqual([]);
  });

  it("stores and lists recent transitions", async () => {
    const { repository } = await createRepository();

    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "github",
      previousStatus: "not_connected",
      nextStatus: "connected",
      changedAt: "2026-03-11T00:00:00.000Z",
      reason: "manual",
      actorType: "reviewer",
      actorId: "demo-reviewer",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "github",
      previousStatus: "connected",
      nextStatus: "reauth_required",
      changedAt: "2026-03-11T00:01:00.000Z",
      reason: "token-expired",
      actorType: "system",
      actorId: "oauth-monitor",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "demo-reviewer",
      provider: "confluence",
      previousStatus: "planned",
      nextStatus: "planned",
      changedAt: "2026-03-11T00:02:00.000Z",
      reason: "webhook",
      actorType: "system",
      actorId: "confluence-webhook",
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
    expect(allTransitions[0]).toMatchObject({
      reason: "webhook",
      actorType: "system",
      actorId: "confluence-webhook",
    });

    const githubTransitions = await repository.listRecentByReviewerId("demo-reviewer", {
      provider: "github",
      limit: 10,
    });

    expect(githubTransitions).toHaveLength(2);
    expect(githubTransitions.map((transition) => transition.nextStatus)).toEqual([
      "reauth_required",
      "connected",
    ]);
    expect(githubTransitions[0]).toMatchObject({
      reason: "token-expired",
      actorType: "system",
      actorId: "oauth-monitor",
    });
  });

  it("prunes older transitions when retention limit is exceeded", async () => {
    const { repository } = await createRepository({
      maxTransitionsPerReviewer: 3,
    });

    await repository.appendTransition({
      reviewerId: "retention-reviewer",
      provider: "github",
      previousStatus: "not_connected",
      nextStatus: "connected",
      changedAt: "2026-03-11T00:00:00.000Z",
      reason: "manual",
      actorType: "reviewer",
      actorId: "retention-reviewer",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "retention-reviewer",
      provider: "github",
      previousStatus: "connected",
      nextStatus: "reauth_required",
      changedAt: "2026-03-11T00:01:00.000Z",
      reason: "token-expired",
      actorType: "system",
      actorId: "oauth-monitor",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "retention-reviewer",
      provider: "github",
      previousStatus: "reauth_required",
      nextStatus: "connected",
      changedAt: "2026-03-11T00:02:00.000Z",
      reason: "manual",
      actorType: "reviewer",
      actorId: "retention-reviewer",
      connectedAccountLabel: "duck8823",
    });
    await repository.appendTransition({
      reviewerId: "retention-reviewer",
      provider: "github",
      previousStatus: "connected",
      nextStatus: "reauth_required",
      changedAt: "2026-03-11T00:03:00.000Z",
      reason: "webhook",
      actorType: "system",
      actorId: "github-webhook",
      connectedAccountLabel: "duck8823",
    });

    const transitions = await repository.listRecentByReviewerId("retention-reviewer", {
      limit: 10,
    });

    expect(transitions).toHaveLength(3);
    expect(transitions.map((transition) => transition.changedAt)).toEqual([
      "2026-03-11T00:03:00.000Z",
      "2026-03-11T00:02:00.000Z",
      "2026-03-11T00:01:00.000Z",
    ]);
  });

  it("adds transition audit columns for pre-existing databases and reads defaults", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "locus-sqlite-connection-state-"));
    temporaryDirectories.push(root);

    const databasePath = path.join(root, "data", "connection-state.sqlite");
    await mkdir(path.dirname(databasePath), { recursive: true });

    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE connection_state_transitions (
        transition_id TEXT PRIMARY KEY,
        reviewer_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        next_status TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        connected_account_label TEXT
      );
      INSERT INTO connection_state_transitions (
        transition_id,
        reviewer_id,
        provider,
        previous_status,
        next_status,
        changed_at,
        connected_account_label
      ) VALUES (
        'legacy-transition-1',
        'legacy-reviewer',
        'github',
        'not_connected',
        'connected',
        '2026-03-11T00:00:00.000Z',
        'duck8823'
      );
    `);
    database.close();

    const repository = new SqliteConnectionStateRepository({
      databasePath,
      legacyDataDirectory: path.join(root, "legacy"),
    });

    const transitions = await repository.listRecentByReviewerId("legacy-reviewer", {
      limit: 10,
    });

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      transitionId: "legacy-transition-1",
      reason: "manual",
      actorType: "reviewer",
      actorId: "legacy-reviewer",
    });
  });
});
