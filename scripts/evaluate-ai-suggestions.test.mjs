import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateFixtures,
  runAiSuggestionEvaluation,
} from "./evaluate-ai-suggestions.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("evaluate-ai-suggestions", () => {
  it("computes useful/false-positive metrics from fixtures", () => {
    const results = evaluateFixtures([
      {
        fixtureId: "fixture-1",
        input: {
          review: {
            reviewId: "review-1",
            title: "Demo review",
            repositoryName: "duck8823/locus",
            branchLabel: "feature/demo",
          },
          selectedGroup: {
            groupId: "group-1",
            title: "Group 1",
            filePath: "src/demo.ts",
            semanticChanges: [
              {
                semanticChangeId: "sc-1",
                symbolDisplayName: "legacyHandler",
                symbolKind: "function",
                changeType: "removed",
                signatureSummary: null,
                bodySummary: null,
                before: {
                  filePath: "src/demo.ts",
                  startLine: 10,
                  endLine: 20,
                },
                after: null,
              },
            ],
            architectureGraph: {
              nodes: [
                {
                  nodeId: "group:group-1",
                  kind: "file",
                  label: "src/demo.ts",
                  role: "center",
                },
              ],
              edges: [],
            },
          },
          businessContextItems: [],
        },
        expectedUsefulSuggestionIds: ["verify-removed-symbol-references"],
        expectedFalsePositiveSuggestionIds: ["trace-requirement-context"],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      fixtureId: "fixture-1",
      expectedUsefulCount: 1,
      detectedUsefulCount: 1,
      usefulRatePercent: 100,
      expectedFalsePositiveCount: 1,
      detectedFalsePositiveCount: 0,
      falsePositiveRatePercent: 0,
    });
    expect(results[0]?.generatedSuggestionIds).toContain("verify-removed-symbol-references");
  });

  it("writes evaluation artifact with summary rates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "locus-ai-eval-"));
    temporaryDirectories.push(root);
    const fixtureFilePath = path.join(root, "fixtures.json");
    const outputFilePath = path.join(root, "eval-output.json");
    await writeFile(
      fixtureFilePath,
      JSON.stringify(
        {
          fixtures: [
            {
              fixtureId: "fixture-1",
              input: {
                review: {
                  reviewId: "review-1",
                  title: "No context",
                  repositoryName: "duck8823/locus",
                  branchLabel: "feature/no-context",
                },
                selectedGroup: null,
                businessContextItems: [],
              },
              expectedUsefulSuggestionIds: ["baseline-manual-review"],
              expectedFalsePositiveSuggestionIds: ["trace-requirement-context"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runAiSuggestionEvaluation({
      fixtureFilePath,
      outputFilePath,
    });
    const persisted = JSON.parse(await readFile(outputFilePath, "utf8"));

    expect(result.summary.fixtureCount).toBe(1);
    expect(result.summary.usefulRatePercent).toBe(100);
    expect(result.summary.falsePositiveRatePercent).toBe(0);
    expect(persisted.summary).toEqual(result.summary);
  });
});
