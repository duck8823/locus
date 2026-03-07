import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewSession } from "@/server/domain/entities/review-session";
import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-review-session-"));
  temporaryDirectories.push(root);

  return {
    root,
    repository: new FileReviewSessionRepository({
      dataDirectory: path.join(root, "review-sessions"),
    }),
  };
}

describe("FileReviewSessionRepository", () => {
  it("saves and reloads a review session from disk", async () => {
    const { root, repository } = await createRepository();
    const reviewSession = ReviewSession.create({
      reviewId: "demo-review",
      title: "Demo",
      repositoryName: "duck8823/locus",
      branchLabel: "feat/web-shell-skeleton",
      viewerName: "Demo reviewer",
      lastOpenedAt: "2026-03-07T00:00:00.000Z",
      groups: [
        {
          groupId: "group-a",
          title: "Group A",
          summary: "Summary",
          filePath: "src/a.ts",
          status: "reviewed",
          upstream: ["upstream-a"],
          downstream: ["downstream-a"],
        },
      ],
    });

    await repository.save(reviewSession);

    const reloaded = await repository.findByReviewId("demo-review");
    const persisted = JSON.parse(
      await readFile(path.join(root, "review-sessions", "demo-review.json"), "utf8"),
    ) as { viewerName: string };

    expect(reloaded?.toRecord().groups[0]?.status).toBe("reviewed");
    expect(persisted.viewerName).toBe("Demo reviewer");
  });

  it("serializes concurrent writes and leaves no temporary files behind", async () => {
    const { root, repository } = await createRepository();
    const baseSession = ReviewSession.create({
      reviewId: "demo-review",
      title: "Demo",
      repositoryName: "duck8823/locus",
      branchLabel: "feat/web-shell-skeleton",
      viewerName: "Demo reviewer",
      lastOpenedAt: "2026-03-07T00:00:00.000Z",
      groups: [
        {
          groupId: "group-a",
          title: "Group A",
          summary: "Summary",
          filePath: "src/a.ts",
          status: "unread",
          upstream: [],
          downstream: [],
        },
      ],
    });
    const updatedSession = ReviewSession.fromRecord(baseSession.toRecord());
    updatedSession.setGroupStatus("group-a", "reviewed");

    await Promise.all([repository.save(baseSession), repository.save(updatedSession)]);

    const files = await readdir(path.join(root, "review-sessions"));
    const reloaded = await repository.findByReviewId("demo-review");

    expect(files).toEqual(["demo-review.json"]);
    expect(reloaded?.toRecord().groups[0]?.status).toBe("reviewed");
  });
});
