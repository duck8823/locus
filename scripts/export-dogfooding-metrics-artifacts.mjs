#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runDogfoodingMetrics } from "./dogfooding-metrics.mjs";

function parseNonNegativeNumber(rawValue, optionName) {
  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${optionName} must be a non-negative number`);
  }

  return value;
}

function parsePercentage(rawValue, optionName) {
  const value = parseNonNegativeNumber(rawValue, optionName);

  if (value > 100) {
    throw new Error(`${optionName} must be between 0 and 100`);
  }

  return value;
}

export function parseCliArgs(argv) {
  const result = {
    jobsFilePath: undefined,
    jsonOutputPath: undefined,
    markdownOutputPath: undefined,
    maxFailureRatePercent: undefined,
    maxAverageDurationMs: undefined,
    minRecoverySuccessRatePercent: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];

    if (!option?.startsWith("--")) {
      throw new Error(`Unknown argument: ${option}`);
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for option: ${option}`);
    }

    index += 1;

    if (option === "--jobs-file") {
      result.jobsFilePath = value;
      continue;
    }

    if (option === "--json-out") {
      result.jsonOutputPath = value;
      continue;
    }

    if (option === "--markdown-out") {
      result.markdownOutputPath = value;
      continue;
    }

    if (option === "--max-failure-rate-percent") {
      result.maxFailureRatePercent = parsePercentage(value, option);
      continue;
    }

    if (option === "--max-average-duration-ms") {
      result.maxAverageDurationMs = parseNonNegativeNumber(value, option);
      continue;
    }

    if (option === "--min-recovery-success-rate-percent") {
      result.minRecoverySuccessRatePercent = parsePercentage(value, option);
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return result;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }

  return "n/a";
}

export function renderDogfoodingMetricsMarkdown(result) {
  const lines = [
    "# Dogfooding Metrics Summary",
    "",
    `- Generated at: ${result.generatedAt}`,
    `- Jobs file: \`${result.jobsFilePath}\``,
    "",
    "## Global",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| totalJobs | ${formatNumber(result.global.totalJobs)} |`,
    `| terminalJobs | ${formatNumber(result.global.terminalJobs)} |`,
    `| averageDurationMs | ${formatNumber(result.global.averageDurationMs)} |`,
    `| failureRatePercent | ${formatNumber(result.global.failureRatePercent)} |`,
    `| recoverySuccessRatePercent | ${formatNumber(result.global.recoverySuccessRatePercent)} |`,
    "",
    "## By review",
    "",
  ];

  if (result.byReview.length === 0) {
    lines.push("No review-scoped jobs were found.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "| reviewId | totalJobs | terminalJobs | averageDurationMs | failureRatePercent | recoverySuccessRatePercent |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const row of result.byReview) {
    lines.push(
      `| ${row.reviewId} | ${formatNumber(row.totalJobs)} | ${formatNumber(row.terminalJobs)} | ${formatNumber(row.averageDurationMs)} | ${formatNumber(row.failureRatePercent)} | ${formatNumber(row.recoverySuccessRatePercent)} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function evaluateThresholdViolations(result, thresholdOptions) {
  const violations = [];
  const globalMetrics = result.global;

  if (
    thresholdOptions.maxFailureRatePercent !== undefined &&
    globalMetrics.failureRatePercent !== null &&
    globalMetrics.failureRatePercent > thresholdOptions.maxFailureRatePercent
  ) {
    violations.push(
      `failureRatePercent ${globalMetrics.failureRatePercent} exceeded max ${thresholdOptions.maxFailureRatePercent}`,
    );
  }

  if (
    thresholdOptions.maxAverageDurationMs !== undefined &&
    globalMetrics.averageDurationMs !== null &&
    globalMetrics.averageDurationMs > thresholdOptions.maxAverageDurationMs
  ) {
    violations.push(
      `averageDurationMs ${globalMetrics.averageDurationMs} exceeded max ${thresholdOptions.maxAverageDurationMs}`,
    );
  }

  if (
    thresholdOptions.minRecoverySuccessRatePercent !== undefined &&
    globalMetrics.recoverySuccessRatePercent !== null &&
    globalMetrics.recoverySuccessRatePercent < thresholdOptions.minRecoverySuccessRatePercent
  ) {
    violations.push(
      `recoverySuccessRatePercent ${globalMetrics.recoverySuccessRatePercent} fell below min ${thresholdOptions.minRecoverySuccessRatePercent}`,
    );
  }

  return violations;
}

async function writeArtifactFile(targetPath, contents) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, "utf8");
}

export async function exportDogfoodingMetricsArtifacts(params = {}) {
  const metrics = await runDogfoodingMetrics({
    jobsFilePath: params.jobsFilePath,
  });
  const jsonOutputPath =
    params.jsonOutputPath ?? path.join(process.cwd(), "artifacts", "dogfooding-metrics.json");
  const markdownOutputPath =
    params.markdownOutputPath ??
    path.join(process.cwd(), "artifacts", "dogfooding-metrics-summary.md");
  const thresholdOptions = {
    maxFailureRatePercent: params.maxFailureRatePercent,
    maxAverageDurationMs: params.maxAverageDurationMs,
    minRecoverySuccessRatePercent: params.minRecoverySuccessRatePercent,
  };
  const violations = evaluateThresholdViolations(metrics, thresholdOptions);
  const markdown = renderDogfoodingMetricsMarkdown(metrics);

  await writeArtifactFile(jsonOutputPath, `${JSON.stringify(metrics, null, 2)}\n`);
  await writeArtifactFile(markdownOutputPath, markdown);

  return {
    metrics,
    jsonOutputPath,
    markdownOutputPath,
    violations,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await exportDogfoodingMetricsArtifacts(options);

  process.stdout.write(`dogfooding metrics json: ${result.jsonOutputPath}\n`);
  process.stdout.write(`dogfooding metrics markdown: ${result.markdownOutputPath}\n`);

  if (result.violations.length > 0) {
    process.stderr.write(`dogfooding metrics threshold violations:\n`);
    for (const violation of result.violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`dogfooding metrics artifact export failed: ${message}\n`);
    process.exitCode = 1;
  });
}
