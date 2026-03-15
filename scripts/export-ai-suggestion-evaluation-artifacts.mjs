#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAiSuggestionEvaluation } from "./evaluate-ai-suggestions.mjs";

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
    fixturesFilePath: undefined,
    jsonOutputPath: undefined,
    markdownOutputPath: undefined,
    minUsefulRatePercent: undefined,
    maxFalsePositiveRatePercent: undefined,
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

    if (option === "--fixtures-file") {
      result.fixturesFilePath = value;
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

    if (option === "--min-useful-rate-percent") {
      result.minUsefulRatePercent = parsePercentage(value, option);
      continue;
    }

    if (option === "--max-false-positive-rate-percent") {
      result.maxFalsePositiveRatePercent = parsePercentage(value, option);
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return result;
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return `${value}`;
}

export function renderAiSuggestionEvaluationMarkdown(result) {
  const lines = [
    "# AI Suggestion Evaluation Summary",
    "",
    `- Generated at: ${result.generatedAt}`,
    `- Fixture file: \`${result.fixtureFilePath}\``,
    "",
    "## Global",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| fixtureCount | ${result.summary.fixtureCount} |`,
    `| usefulRatePercent | ${formatPercent(result.summary.usefulRatePercent)} |`,
    `| falsePositiveRatePercent | ${formatPercent(result.summary.falsePositiveRatePercent)} |`,
    "",
    "## By fixture",
    "",
  ];

  if (result.fixtures.length === 0) {
    lines.push("No valid fixtures were evaluated.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "| fixtureId | usefulRatePercent | falsePositiveRatePercent | usefulHits | falsePositiveHits |",
    "| --- | ---: | ---: | ---: | ---: |",
  );

  for (const fixture of result.fixtures) {
    lines.push(
      `| ${fixture.fixtureId} | ${formatPercent(fixture.usefulRatePercent)} | ${formatPercent(fixture.falsePositiveRatePercent)} | ${fixture.detectedUsefulCount}/${fixture.expectedUsefulCount} | ${fixture.detectedFalsePositiveCount}/${fixture.expectedFalsePositiveCount} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function evaluateThresholdViolations(result, thresholdOptions) {
  const violations = [];
  const summary = result.summary;

  if (
    thresholdOptions.minUsefulRatePercent !== undefined &&
    summary.usefulRatePercent !== null &&
    summary.usefulRatePercent < thresholdOptions.minUsefulRatePercent
  ) {
    violations.push(
      `summary usefulRatePercent ${summary.usefulRatePercent} fell below min ${thresholdOptions.minUsefulRatePercent}`,
    );
  }

  if (
    thresholdOptions.maxFalsePositiveRatePercent !== undefined &&
    summary.falsePositiveRatePercent !== null &&
    summary.falsePositiveRatePercent > thresholdOptions.maxFalsePositiveRatePercent
  ) {
    violations.push(
      `summary falsePositiveRatePercent ${summary.falsePositiveRatePercent} exceeded max ${thresholdOptions.maxFalsePositiveRatePercent}`,
    );
  }

  for (const fixture of result.fixtures) {
    if (
      thresholdOptions.minUsefulRatePercent !== undefined &&
      fixture.usefulRatePercent !== null &&
      fixture.usefulRatePercent < thresholdOptions.minUsefulRatePercent
    ) {
      violations.push(
        `fixture ${fixture.fixtureId} usefulRatePercent ${fixture.usefulRatePercent} fell below min ${thresholdOptions.minUsefulRatePercent}`,
      );
    }

    if (
      thresholdOptions.maxFalsePositiveRatePercent !== undefined &&
      fixture.falsePositiveRatePercent !== null &&
      fixture.falsePositiveRatePercent > thresholdOptions.maxFalsePositiveRatePercent
    ) {
      violations.push(
        `fixture ${fixture.fixtureId} falsePositiveRatePercent ${fixture.falsePositiveRatePercent} exceeded max ${thresholdOptions.maxFalsePositiveRatePercent}`,
      );
    }
  }

  return violations;
}

async function writeArtifactFile(targetPath, contents) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, "utf8");
}

export async function exportAiSuggestionEvaluationArtifacts(params = {}) {
  const fixturesFilePath =
    params.fixturesFilePath ??
    path.join(process.cwd(), "scripts", "fixtures", "ai-suggestion-evaluation", "sample-fixtures.json");
  const jsonOutputPath =
    params.jsonOutputPath ??
    path.join(process.cwd(), "artifacts", "ai-suggestion-evaluation.json");
  const markdownOutputPath =
    params.markdownOutputPath ??
    path.join(process.cwd(), "artifacts", "ai-suggestion-evaluation-summary.md");

  const evaluation = await runAiSuggestionEvaluation({
    fixtureFilePath: fixturesFilePath,
    outputFilePath: jsonOutputPath,
  });
  const markdown = renderAiSuggestionEvaluationMarkdown(evaluation);
  const thresholdOptions = {
    minUsefulRatePercent: params.minUsefulRatePercent,
    maxFalsePositiveRatePercent: params.maxFalsePositiveRatePercent,
  };
  const violations = evaluateThresholdViolations(evaluation, thresholdOptions);

  await writeArtifactFile(markdownOutputPath, markdown);

  return {
    evaluation,
    jsonOutputPath,
    markdownOutputPath,
    violations,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await exportAiSuggestionEvaluationArtifacts(options);

  process.stdout.write(`ai suggestion evaluation json: ${result.jsonOutputPath}\n`);
  process.stdout.write(`ai suggestion evaluation markdown: ${result.markdownOutputPath}\n`);

  if (result.violations.length > 0) {
    process.stderr.write(`ai suggestion quality gate violations:\n`);
    for (const violation of result.violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`ai suggestion evaluation artifact export failed: ${message}\n`);
    process.exitCode = 1;
  });
}
