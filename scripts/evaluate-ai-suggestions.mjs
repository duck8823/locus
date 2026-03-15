#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_SUGGESTION_REDACTION_POLICY_VERSION,
  redactAiSuggestionPayload,
} from "../src/server/application/ai/ai-suggestion-redaction-policy.ts";
import { buildAiSuggestionPayload } from "../src/server/application/ai/build-ai-suggestion-payload.ts";
import { generateAiSuggestionsFromPayload } from "../src/server/application/ai/generate-ai-suggestions.ts";

const HEURISTIC_PROMPT_TEMPLATE_ID = "heuristic.rule_set.v1";
const HEURISTIC_PROMPT_VERSION = "heuristic.v1";

function toFixedOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateRatePercent(hitCount, baseCount) {
  if (baseCount <= 0) {
    return null;
  }

  return toFixedOneDecimal((hitCount / baseCount) * 100);
}

export function evaluateFixtures(fixtures) {
  return fixtures.map((fixture) => {
    const payload = buildAiSuggestionPayload(fixture.input);
    const generatedSuggestions = generateAiSuggestionsFromPayload(payload);
    const generatedSuggestionIds = generatedSuggestions.map((suggestion) => suggestion.suggestionId);
    const generatedSuggestionIdSet = new Set(generatedSuggestionIds);
    const expectedUsefulIds = [...new Set(fixture.expectedUsefulSuggestionIds)];
    const expectedFalsePositiveIds = [...new Set(fixture.expectedFalsePositiveSuggestionIds ?? [])];
    const detectedUsefulCount = expectedUsefulIds.filter((suggestionId) => generatedSuggestionIdSet.has(suggestionId)).length;
    const detectedFalsePositiveCount = expectedFalsePositiveIds.filter((suggestionId) =>
      generatedSuggestionIdSet.has(suggestionId),
    ).length;

    return {
      fixtureId: fixture.fixtureId,
      generatedSuggestionIds,
      expectedUsefulCount: expectedUsefulIds.length,
      detectedUsefulCount,
      usefulRatePercent: calculateRatePercent(detectedUsefulCount, expectedUsefulIds.length),
      expectedFalsePositiveCount: expectedFalsePositiveIds.length,
      detectedFalsePositiveCount,
      falsePositiveRatePercent: calculateRatePercent(detectedFalsePositiveCount, expectedFalsePositiveIds.length),
      payload: redactAiSuggestionPayload(payload),
    };
  });
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runAiSuggestionEvaluation(input = {}) {
  const fixtureFilePath =
    input.fixtureFilePath ??
    path.join(process.cwd(), "scripts", "fixtures", "ai-suggestion-evaluation", "sample-fixtures.json");
  const outputFilePath =
    input.outputFilePath ??
    path.join(
      process.cwd(),
      "docs",
      "performance",
      "ai-suggestion-evaluations",
      `eval-${createTimestamp()}.json`,
    );
  const fixtureFileContent = await readFile(fixtureFilePath, "utf8");
  const parsed = JSON.parse(fixtureFileContent);
  const fixtures = Array.isArray(parsed.fixtures)
    ? parsed.fixtures.filter((fixture) => {
        if (!fixture || typeof fixture !== "object") {
          return false;
        }

        return (
          typeof fixture.fixtureId === "string" &&
          fixture.fixtureId.trim().length > 0 &&
          fixture.input !== undefined &&
          Array.isArray(fixture.expectedUsefulSuggestionIds)
        );
      })
    : [];
  const fixtureResults = evaluateFixtures(fixtures);
  const usefulRateValues = fixtureResults
    .map((result) => result.usefulRatePercent)
    .filter((value) => value !== null);
  const falsePositiveRateValues = fixtureResults
    .map((result) => result.falsePositiveRatePercent)
    .filter((value) => value !== null);
  const usefulRateAverage = average(usefulRateValues);
  const falsePositiveRateAverage = average(falsePositiveRateValues);
  const result = {
    generatedAt: new Date().toISOString(),
    fixtureFilePath,
    outputFilePath,
    summary: {
      fixtureCount: fixtureResults.length,
      usefulRatePercent: usefulRateAverage === null ? null : toFixedOneDecimal(usefulRateAverage),
      falsePositiveRatePercent:
        falsePositiveRateAverage === null ? null : toFixedOneDecimal(falsePositiveRateAverage),
    },
    audit: {
      provider: "heuristic",
      promptTemplateId: HEURISTIC_PROMPT_TEMPLATE_ID,
      promptVersion: HEURISTIC_PROMPT_VERSION,
      redactionPolicyVersion: AI_SUGGESTION_REDACTION_POLICY_VERSION,
    },
    fixtures: fixtureResults,
  };

  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await writeFile(outputFilePath, JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function main() {
  const fixtureFilePath = process.argv[2];
  const outputFilePath = process.argv[3];
  const result = await runAiSuggestionEvaluation({
    fixtureFilePath,
    outputFilePath,
  });

  process.stdout.write(`${result.outputFilePath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`ai suggestion evaluation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
