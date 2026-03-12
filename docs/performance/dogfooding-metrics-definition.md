# Dogfooding Metrics Definition (H2-1)

> 日本語: [dogfooding-metrics-definition.ja.md](dogfooding-metrics-definition.ja.md)

## Purpose

Define a minimal, reproducible metric set for local dogfooding progress tracking.

## Data source

- Default file: `.locus-data/analysis-jobs/jobs.json`
- Override: `LOCUS_ANALYSIS_JOBS_FILE_PATH`

## Metrics

### 1) Speed: `averageDurationMs`

- Target population: terminal jobs (`succeeded` / `failed`)
- Formula: arithmetic mean of `durationMs` (non-negative finite values only)
- Unit: milliseconds

### 2) Failure: `failureRatePercent`

- Target population: terminal jobs (`succeeded` / `failed`)
- Formula: `failed / terminal * 100`
- Rounded to one decimal point

### 3) Recovery: `recoverySuccessRatePercent`

- Target population: jobs with `reason = manual_reanalysis`
- Formula: `succeeded_manual_reanalysis / manual_reanalysis * 100`
- Rounded to one decimal point

## Command

```bash
npm run dogfood:metrics
```

Outputs JSON with:
- `global`: whole dataset metrics
- `byReview[]`: per-review metrics

## Notes

- This metric set is intentionally local and lightweight.
- It is not intended for external benchmark ranking.
