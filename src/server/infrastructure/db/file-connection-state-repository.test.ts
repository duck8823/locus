import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileConnectionStateRepository } from "@/server/infrastructure/db/file-connection-state-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "locus-connection-state-"));
  temporaryDirectories.push(root);

  const dataDirectory = path.join(root, "connection-states");

  return {
    root,
    dataDirectory,
    repository: new FileConnectionStateRepository({ dataDirectory }),
  };
}

describe("FileConnectionStateRepository", () => {
  it("returns persisted connection states for a reviewer", async () => {
    const { dataDirectory, repository } = await createRepository();
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(
      path.join(dataDirectory, "demo-reviewer.json"),
      JSON.stringify(
        {
          reviewerId: "demo-reviewer",
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

    const result = await repository.findByReviewerId("demo-reviewer");

    expect(result).toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
      },
    ]);
  });

  it("returns empty array when file does not exist", async () => {
    const { repository } = await createRepository();
    const result = await repository.findByReviewerId("missing-reviewer");
    expect(result).toEqual([]);
  });
});
