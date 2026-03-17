#!/usr/bin/env node
/**
 * Multi-provider AI suggestion evaluation framework.
 * Runs the same fixture set against multiple providers and compares results.
 *
 * Usage:
 *   node scripts/evaluate-ai-suggestions-multi-provider.mjs [fixture-file] [output-file]
 *
 * Environment variables control which providers to evaluate:
 *   EVAL_PROVIDERS=heuristic,openai_compat,anthropic (comma-separated)
 *   Plus the standard LOCUS_AI_SUGGESTION_* env vars for each provider.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_SUGGESTION_REDACTION_POLICY_VERSION,
  redactAiSuggestionPayload,
} from "../src/server/application/ai/ai-suggestion-redaction-policy.ts";
import { buildAiSuggestionPayload } from "../src/server/application/ai/build-ai-suggestion-payload.ts";
import { generateAiSuggestionsFromPayload } from "../src/server/application/ai/generate-ai-suggestions.ts";
import { createAiSuggestionProviderBundle } from "../src/server/infrastructure/ai/create-ai-suggestion-provider.ts";

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

function evaluateFixtureForHeuristic(fixture) {
  const payload = buildAiSuggestionPayload(fixture.input);
  const generatedSuggestions = generateAiSuggestionsFromPayload(payload);
  return {
    payload,
    suggestions: generatedSuggestions,
  };
}

async function evaluateFixtureForLlmProvider(fixture, providerMode) {
  const payload = buildAiSuggestionPayload(fixture.input);
  const env = { ...process.env, LOCUS_AI_SUGGESTION_PROVIDER: providerMode };
  const bundle = createAiSuggestionProviderBundle({ env });

  try {
    const suggestions = await bundle.provider.generateSuggestions({
      payload,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return { payload, suggestions, error: null };
  } catch (error) {
    return { payload, suggestions: [], error: error.message ?? "Unknown error" };
  }
}

function scoreFixture(fixture, suggestions) {
  const generatedIds = new Set(suggestions.map((s) => s.suggestionId));
  const expectedUsefulIds = [...new Set(fixture.expectedUsefulSuggestionIds)];
  const expectedFalsePositiveIds = [...new Set(fixture.expectedFalsePositiveSuggestionIds ?? [])];

  const detectedUsefulCount = expectedUsefulIds.filter((id) => generatedIds.has(id)).length;
  const detectedFalsePositiveCount = expectedFalsePositiveIds.filter((id) => generatedIds.has(id)).length;

  // Category breakdown
  const categoryBreakdown = {};
  for (const suggestion of suggestions) {
    const category = suggestion.category ?? "general";
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { count: 0, confidences: {} };
    }
    categoryBreakdown[category].count += 1;
    const confidence = suggestion.confidence ?? "low";
    categoryBreakdown[category].confidences[confidence] =
      (categoryBreakdown[category].confidences[confidence] ?? 0) + 1;
  }

  return {
    fixtureId: fixture.fixtureId,
    generatedCount: suggestions.length,
    expectedUsefulCount: expectedUsefulIds.length,
    detectedUsefulCount,
    usefulRatePercent: calculateRatePercent(detectedUsefulCount, expectedUsefulIds.length),
    expectedFalsePositiveCount: expectedFalsePositiveIds.length,
    detectedFalsePositiveCount,
    falsePositiveRatePercent: calculateRatePercent(
      detectedFalsePositiveCount,
      expectedFalsePositiveIds.length,
    ),
    categoryBreakdown,
  };
}

function summarizeResults(scores) {
  const usefulRates = scores.map((s) => s.usefulRatePercent).filter((v) => v !== null);
  const fpRates = scores.map((s) => s.falsePositiveRatePercent).filter((v) => v !== null);
  const avgUseful = average(usefulRates);
  const avgFp = average(fpRates);
  const avgGenerated = average(scores.map((s) => s.generatedCount));

  return {
    fixtureCount: scores.length,
    usefulRatePercent: avgUseful !== null ? toFixedOneDecimal(avgUseful) : null,
    falsePositiveRatePercent: avgFp !== null ? toFixedOneDecimal(avgFp) : null,
    avgSuggestionsPerFixture: avgGenerated !== null ? toFixedOneDecimal(avgGenerated) : null,
  };
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runMultiProviderEvaluation(input = {}) {
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
      `eval-multi-${createTimestamp()}.json`,
    );

  const providerModes = (process.env.EVAL_PROVIDERS ?? "heuristic")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const fixtureFileContent = await readFile(fixtureFilePath, "utf8");
  const parsed = JSON.parse(fixtureFileContent);
  const fixtures = Array.isArray(parsed.fixtures)
    ? parsed.fixtures.filter((fixture) => {
        return (
          fixture &&
          typeof fixture === "object" &&
          typeof fixture.fixtureId === "string" &&
          fixture.input !== undefined &&
          Array.isArray(fixture.expectedUsefulSuggestionIds)
        );
      })
    : [];

  const providerResults = {};

  for (const mode of providerModes) {
    const scores = [];

    for (const fixture of fixtures) {
      let result;

      if (mode === "heuristic") {
        result = evaluateFixtureForHeuristic(fixture);
      } else {
        result = await evaluateFixtureForLlmProvider(fixture, mode);
      }

      scores.push({
        ...scoreFixture(fixture, result.suggestions),
        error: result.error ?? null,
        payload: redactAiSuggestionPayload(result.payload),
      });
    }

    providerResults[mode] = {
      summary: summarizeResults(scores),
      fixtures: scores,
    };
  }

  const output = {
    generatedAt: new Date().toISOString(),
    fixtureFilePath,
    providerModes,
    redactionPolicyVersion: AI_SUGGESTION_REDACTION_POLICY_VERSION,
    providers: providerResults,
  };

  await mkdir(path.dirname(outputFilePath), { recursive: true });
  await writeFile(outputFilePath, JSON.stringify(output, null, 2), "utf8");
  return output;
}

async function main() {
  const fixtureFilePath = process.argv[2];
  const outputFilePath = process.argv[3];
  const result = await runMultiProviderEvaluation({ fixtureFilePath, outputFilePath });

  // Print summary table
  for (const [mode, data] of Object.entries(result.providers)) {
    const summary = data.summary;
    process.stdout.write(
      `${mode}: useful=${summary.usefulRatePercent ?? "N/A"}% fp=${summary.falsePositiveRatePercent ?? "N/A"}% avg_suggestions=${summary.avgSuggestionsPerFixture ?? "N/A"}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`multi-provider evaluation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
