# Dogfooding Runbook (200-file Review Reproduction)

> 日本語: [dogfooding-runbook.ja.md](dogfooding-runbook.ja.md)

## Purpose

Define a repeatable dogfooding flow for large-review scenarios, centered on a synthetic **200-file** analysis run.

## Assumptions / Non-goals

Assumptions:
- This runbook targets local validation for Issue #63.
- Node.js `22.5+` and `npm` are available.
- The repository is opened at project root.

Non-goals:
- This is not a production load test.
- This does not establish cross-machine performance ranking.

## Prerequisites

```bash
npm install
npm run demo:data:reseed
```

Optional (use a custom jobs file for metric aggregation):

```bash
export LOCUS_ANALYSIS_JOBS_FILE_PATH=/absolute/path/to/jobs.json
```

## Reproduction Procedure

### 1) Recommended: one-command dogfooding run

```bash
npm run dogfood:run
```

What it does:
1. `npm run demo:data:reseed`
2. Run synthetic 200-file benchmark test
3. Run real-PR fixture regression test
4. Compute dogfooding metrics
5. Write JSON artifact to `docs/performance/dogfooding-runs/run-<timestamp>.json`

The command prints the artifact path to stdout.

### 2) Step-by-step verification (optional)

```bash
npm run demo:data:reseed

ANALYZE_SNAPSHOTS_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts

ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts

npm run dogfood:metrics
```

## Metrics Command

`npm run dogfood:metrics` returns JSON with:
- `global.totalJobs`
- `global.terminalJobs`
- `global.averageDurationMs`
- `global.failureRatePercent`
- `global.recoverySuccessRatePercent`
- `byReview[]` breakdown

For artifact format details: [dogfooding-runs/README.md](dogfooding-runs/README.md)

## Recording Format (Date / Environment / Result)

Use this template for each run:

```md
## Dogfooding Record
- Date/Time (UTC):
- Date/Time (Local):
- Operator:
- Git branch / commit:

### Environment
- OS / CPU:
- Node.js / npm:
- LOCUS_ANALYSIS_JOBS_FILE_PATH (if overridden):

### Result
- Run command: `npm run dogfood:run` or step-by-step
- Artifact path:
- 200-file benchmark duration (ms):
- Real-PR fixture duration (ms):
- averageDurationMs:
- failureRatePercent:
- recoverySuccessRatePercent:

### Notes
- Known limitations:
- Follow-up actions:
```
