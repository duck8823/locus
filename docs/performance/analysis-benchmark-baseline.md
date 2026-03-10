# Analysis Benchmark Baseline (Synthetic 200-file PR)

> 日本語: [analysis-benchmark-baseline.ja.md](analysis-benchmark-baseline.ja.md)

## Purpose

Track a local baseline for semantic-analysis throughput and catch major regressions early.

## Benchmark Case

- Scenario: synthetic pull request with 200 TypeScript files
- Analyzer: `analyzeSourceSnapshots` + `TypeScriptParserAdapter`
- Fixture: callable body update in each file (`1 semantic change / file`)
- Environment: local development machine (macOS, Apple Silicon)

## Command

```bash
ANALYZE_SNAPSHOTS_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts
```

## Baseline Result (2026-03-11)

- Processed files: 200
- Duration: **26 ms**

## Guardrail

- The automated test currently enforces:
  - `durationMs <= 10_000`
  - expected group/change counts (`200`)

The threshold is intentionally loose for CI stability; track trend changes with this baseline document over time.
