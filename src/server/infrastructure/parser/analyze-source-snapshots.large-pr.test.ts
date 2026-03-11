import { describe, expect, it } from "vitest";
import { analyzeSourceSnapshots } from "@/server/application/services/analyze-source-snapshots";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

const LARGE_PR_FILE_COUNT = 200;
const MAX_ALLOWED_DURATION_MS = 10_000;

function createSnapshotPairs(reviewId: string, fileCount: number): SourceSnapshotPair[] {
  return Array.from({ length: fileCount }, (_, index) => {
    const id = `file-${index + 1}`;
    const filePath = `src/generated/module-${index + 1}.ts`;

    return {
      fileId: id,
      filePath,
      before: {
        snapshotId: `${id}-before`,
        fileId: id,
        filePath,
        language: "typescript",
        revision: "before",
        content: `
export function computeValue${index + 1}(value: number): number {
  return value + 1;
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
      after: {
        snapshotId: `${id}-after`,
        fileId: id,
        filePath,
        language: "typescript",
        revision: "after",
        content: `
export function computeValue${index + 1}(value: number): number {
  const normalized = value + 1;
  return normalized + 1;
}
`.trim(),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
    } satisfies SourceSnapshotPair;
  });
}

describe("analyzeSourceSnapshots (large PR baseline)", () => {
  it("processes a 200-file synthetic pull request without timing out", async () => {
    const reviewId = "benchmark-review";
    const snapshotPairs = createSnapshotPairs(reviewId, LARGE_PR_FILE_COUNT);
    const startedAt = Date.now();
    const result = await analyzeSourceSnapshots({
      reviewId,
      snapshotPairs,
      parserAdapters: [new TypeScriptParserAdapter()],
    });
    const durationMs = Date.now() - startedAt;

    // Optional debug output:
    // ANALYZE_SNAPSHOTS_BENCHMARK=1 npm test -- analyze-source-snapshots.large-pr.test.ts
    if (process.env.ANALYZE_SNAPSHOTS_BENCHMARK === "1") {
      console.info(
        `[benchmark] processed ${LARGE_PR_FILE_COUNT} files in ${durationMs} ms`,
      );
    }

    expect(result.groups.length).toBe(LARGE_PR_FILE_COUNT);
    expect(result.semanticChanges.length).toBe(LARGE_PR_FILE_COUNT);
    expect(durationMs).toBeLessThanOrEqual(MAX_ALLOWED_DURATION_MS);
  });
});
