import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSourceSnapshots } from "@/server/application/services/analyze-source-snapshots";
import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";

function readFixture(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function createRealPrFixturePairs(reviewId: string): SourceSnapshotPair[] {
  return [
    {
      fileId: "set-workspace-locale-action",
      filePath: "src/server/presentation/actions/set-workspace-locale-action.ts",
      before: {
        snapshotId: "set-workspace-locale-action-before",
        fileId: "set-workspace-locale-action",
        filePath: "src/server/presentation/actions/set-workspace-locale-action.ts",
        language: "typescript",
        revision: "before",
        content: readFixture(
          "src/server/infrastructure/parser/fixtures/real-pr/set-workspace-locale-action.before.ts.txt",
        ),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
      after: {
        snapshotId: "set-workspace-locale-action-after",
        fileId: "set-workspace-locale-action",
        filePath: "src/server/presentation/actions/set-workspace-locale-action.ts",
        language: "typescript",
        revision: "after",
        content: readFixture(
          "src/server/infrastructure/parser/fixtures/real-pr/set-workspace-locale-action.after.ts.txt",
        ),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
    },
    {
      fileId: "start-github-demo-session-action",
      filePath: "src/server/presentation/actions/start-github-demo-session-action.ts",
      before: {
        snapshotId: "start-github-demo-session-action-before",
        fileId: "start-github-demo-session-action",
        filePath: "src/server/presentation/actions/start-github-demo-session-action.ts",
        language: "typescript",
        revision: "before",
        content: readFixture(
          "src/server/infrastructure/parser/fixtures/real-pr/start-github-demo-session-action.before.ts.txt",
        ),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
      after: {
        snapshotId: "start-github-demo-session-action-after",
        fileId: "start-github-demo-session-action",
        filePath: "src/server/presentation/actions/start-github-demo-session-action.ts",
        language: "typescript",
        revision: "after",
        content: readFixture(
          "src/server/infrastructure/parser/fixtures/real-pr/start-github-demo-session-action.after.ts.txt",
        ),
        metadata: {
          codeHost: "github",
          repositoryRef: "duck8823/locus",
          changeRequestRef: reviewId,
        },
      },
    },
  ];
}

describe("TypeScriptParserAdapter real PR fixtures", () => {
  it("detects security-meaningful redirect validation update from real PR commit", async () => {
    const adapter = new TypeScriptParserAdapter();
    const [pair] = createRealPrFixturePairs("real-pr-fixture-review");
    const before = await adapter.parse(pair.before!);
    const after = await adapter.parse(pair.after!);
    const diff = await adapter.diff({ before, after });

    expect(diff.items).toHaveLength(1);
    expect(diff.items[0]).toMatchObject({
      symbolKey: "function::<root>::assertRelativeRedirectPath",
      changeType: "modified",
      bodySummary: "Body changed",
    });
  });

  it("keeps meaningful callable-level changes for start-github-demo-session update", async () => {
    const adapter = new TypeScriptParserAdapter();
    const [, pair] = createRealPrFixturePairs("real-pr-fixture-review");
    const before = await adapter.parse(pair.before!);
    const after = await adapter.parse(pair.after!);
    const diff = await adapter.diff({ before, after });

    expect(diff.items.length).toBeGreaterThanOrEqual(4);
    expect(
      diff.items.map((item) => ({
        symbolKey: item.symbolKey,
        changeType: item.changeType,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          symbolKey: "function::<root>::createDemoErrorMessage",
          changeType: "removed",
        },
        {
          symbolKey: "function::<root>::readRequiredValue",
          changeType: "modified",
        },
        {
          symbolKey: "function::<root>::parsePullRequestNumber",
          changeType: "modified",
        },
        {
          symbolKey: "function::<root>::startGitHubDemoSessionAction",
          changeType: "modified",
        },
      ]),
    );
  });

  it("runs end-to-end analysis pipeline on real PR fixtures without unsupported files", async () => {
    const reviewId = "real-pr-fixture-review";
    const startedAt = Date.now();
    const result = await analyzeSourceSnapshots({
      reviewId,
      snapshotPairs: createRealPrFixturePairs(reviewId),
      parserAdapters: [new TypeScriptParserAdapter()],
    });
    const durationMs = Date.now() - startedAt;

    if (process.env.ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK === "1") {
      console.info(`[benchmark] analyzed real-pr fixtures in ${durationMs} ms`);
    }

    expect(result.unsupportedFiles).toEqual([]);
    expect(result.semanticChanges.length).toBeGreaterThanOrEqual(5);
    expect(result.groups.length).toBe(2);
    expect(durationMs).toBeLessThanOrEqual(5_000);
    expect(
      result.semanticChanges.map((change) => change.symbol.displayName),
    ).toEqual(
      expect.arrayContaining([
        "assertRelativeRedirectPath",
        "readRequiredValue",
        "parsePullRequestNumber",
        "startGitHubDemoSessionAction",
      ]),
    );
  });
});
