import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateThresholdViolations,
  exportAiSuggestionEvaluationArtifacts,
  parseCliArgs,
  renderAiSuggestionEvaluationMarkdown,
} from "./export-ai-suggestion-evaluation-artifacts.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("parseCliArgs", () => {
  it("parses known options", () => {
    expect(
      parseCliArgs([
        "--fixtures-file",
        "fixtures.json",
        "--json-out",
        "result.json",
        "--markdown-out",
        "result.md",
        "--min-useful-rate-percent",
        "85",
        "--max-false-positive-rate-percent",
        "10",
      ]),
    ).toEqual({
      fixturesFilePath: "fixtures.json",
      jsonOutputPath: "result.json",
      markdownOutputPath: "result.md",
      minUsefulRatePercent: 85,
      maxFalsePositiveRatePercent: 10,
    });
  });

  it("throws on invalid option", () => {
    expect(() => parseCliArgs(["--invalid", "1"])).toThrow("Unknown option");
  });
});

describe("renderAiSuggestionEvaluationMarkdown", () => {
  it("renders summary and fixture rows", () => {
    const markdown = renderAiSuggestionEvaluationMarkdown({
      generatedAt: "2026-03-15T00:00:00.000Z",
      fixtureFilePath: "scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json",
      summary: {
        fixtureCount: 2,
        usefulRatePercent: 100,
        falsePositiveRatePercent: 0,
      },
      fixtures: [
        {
          fixtureId: "fixture-1",
          usefulRatePercent: 100,
          falsePositiveRatePercent: 0,
          detectedUsefulCount: 1,
          expectedUsefulCount: 1,
          detectedFalsePositiveCount: 0,
          expectedFalsePositiveCount: 1,
        },
      ],
    });

    expect(markdown).toContain("# AI Suggestion Evaluation Summary");
    expect(markdown).toContain("| fixtureId | usefulRatePercent | falsePositiveRatePercent | usefulHits | falsePositiveHits |");
    expect(markdown).toContain("| fixture-1 | 100 | 0 | 1/1 | 0/1 |");
  });
});

describe("evaluateThresholdViolations", () => {
  it("reports summary + fixture threshold violations", () => {
    const violations = evaluateThresholdViolations(
      {
        summary: {
          usefulRatePercent: 70,
          falsePositiveRatePercent: 25,
        },
        fixtures: [
          {
            fixtureId: "fixture-1",
            usefulRatePercent: 60,
            falsePositiveRatePercent: 40,
          },
        ],
      },
      {
        minUsefulRatePercent: 80,
        maxFalsePositiveRatePercent: 20,
      },
    );

    expect(violations).toEqual([
      "summary usefulRatePercent 70 fell below min 80",
      "summary falsePositiveRatePercent 25 exceeded max 20",
      "fixture fixture-1 usefulRatePercent 60 fell below min 80",
      "fixture fixture-1 falsePositiveRatePercent 40 exceeded max 20",
    ]);
  });
});

describe("exportAiSuggestionEvaluationArtifacts", () => {
  it("writes JSON + markdown artifacts and passes threshold gate", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "locus-ai-eval-artifact-"));
    temporaryDirectories.push(root);

    const jsonOutputPath = path.join(root, "ai-suggestion-evaluation.json");
    const markdownOutputPath = path.join(root, "ai-suggestion-evaluation-summary.md");

    const result = await exportAiSuggestionEvaluationArtifacts({
      fixturesFilePath: path.join(
        process.cwd(),
        "scripts",
        "fixtures",
        "ai-suggestion-evaluation",
        "sample-fixtures.json",
      ),
      jsonOutputPath,
      markdownOutputPath,
      minUsefulRatePercent: 80,
      maxFalsePositiveRatePercent: 20,
    });

    const jsonContent = JSON.parse(await readFile(jsonOutputPath, "utf8"));
    const markdownContent = await readFile(markdownOutputPath, "utf8");

    expect(result.violations).toEqual([]);
    expect(jsonContent.summary.fixtureCount).toBeGreaterThan(0);
    expect(markdownContent).toContain("## Global");
    expect(markdownContent).toContain("## By fixture");
  });
});
