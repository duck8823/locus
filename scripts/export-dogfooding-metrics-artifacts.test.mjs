import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateThresholdViolations,
  exportDogfoodingMetricsArtifacts,
  parseCliArgs,
  renderDogfoodingMetricsMarkdown,
} from "./export-dogfooding-metrics-artifacts.mjs";

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
        "--jobs-file",
        "jobs.json",
        "--json-out",
        "out.json",
        "--markdown-out",
        "out.md",
        "--max-failure-rate-percent",
        "40",
        "--max-average-duration-ms",
        "2500",
        "--min-recovery-success-rate-percent",
        "60",
      ]),
    ).toEqual({
      jobsFilePath: "jobs.json",
      jsonOutputPath: "out.json",
      markdownOutputPath: "out.md",
      maxFailureRatePercent: 40,
      maxAverageDurationMs: 2500,
      minRecoverySuccessRatePercent: 60,
    });
  });

  it("throws on unknown option", () => {
    expect(() => parseCliArgs(["--unknown", "value"])).toThrow("Unknown option");
  });
});

describe("renderDogfoodingMetricsMarkdown", () => {
  it("renders summary table with review rows", () => {
    const markdown = renderDogfoodingMetricsMarkdown({
      generatedAt: "2026-03-14T00:00:00.000Z",
      jobsFilePath: "/tmp/jobs.json",
      global: {
        totalJobs: 4,
        terminalJobs: 4,
        averageDurationMs: 1117,
        failureRatePercent: 25,
        recoverySuccessRatePercent: 50,
      },
      byReview: [
        {
          reviewId: "demo-review",
          totalJobs: 3,
          terminalJobs: 3,
          averageDurationMs: 1117,
          failureRatePercent: 33.3,
          recoverySuccessRatePercent: 50,
        },
      ],
    });

    expect(markdown).toContain("# Dogfooding Metrics Summary");
    expect(markdown).toContain("| reviewId | totalJobs | terminalJobs | averageDurationMs |");
    expect(markdown).toContain("| demo-review | 3 | 3 | 1117 | 33.3 | 50 |");
  });
});

describe("evaluateThresholdViolations", () => {
  it("reports threshold violations", () => {
    const violations = evaluateThresholdViolations(
      {
        generatedAt: "2026-03-14T00:00:00.000Z",
        jobsFilePath: "jobs.json",
        global: {
          totalJobs: 5,
          terminalJobs: 5,
          averageDurationMs: 4000,
          failureRatePercent: 60,
          recoverySuccessRatePercent: 30,
        },
        byReview: [],
      },
      {
        maxFailureRatePercent: 30,
        maxAverageDurationMs: 2000,
        minRecoverySuccessRatePercent: 70,
      },
    );

    expect(violations).toEqual([
      "failureRatePercent 60 exceeded max 30",
      "averageDurationMs 4000 exceeded max 2000",
      "recoverySuccessRatePercent 30 fell below min 70",
    ]);
  });
});

describe("exportDogfoodingMetricsArtifacts", () => {
  it("writes JSON/markdown artifacts from fixture input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "locus-dogfood-artifact-"));
    temporaryDirectories.push(root);
    const jsonOutputPath = path.join(root, "dogfooding-metrics.json");
    const markdownOutputPath = path.join(root, "dogfooding-metrics-summary.md");

    const result = await exportDogfoodingMetricsArtifacts({
      jobsFilePath: path.join(process.cwd(), "scripts", "fixtures", "dogfooding-metrics", "ci-jobs.json"),
      jsonOutputPath,
      markdownOutputPath,
      maxFailureRatePercent: 40,
      maxAverageDurationMs: 2000,
      minRecoverySuccessRatePercent: 40,
    });

    const jsonContent = JSON.parse(await readFile(jsonOutputPath, "utf8"));
    const markdownContent = await readFile(markdownOutputPath, "utf8");

    expect(result.violations).toEqual([]);
    expect(jsonContent.global.totalJobs).toBe(4);
    expect(markdownContent).toContain("## Global");
    expect(markdownContent).toContain("| demo-review |");
  });
});
