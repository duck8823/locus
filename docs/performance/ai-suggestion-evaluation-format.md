# AI Suggestion Evaluation Harness (Fixture-based)

> 日本語: [ai-suggestion-evaluation-format.ja.md](ai-suggestion-evaluation-format.ja.md)

## Goal

Provide a reproducible local/CI harness for Issue #71 to evaluate AI suggestion quality using stable fixtures.

## Command

```bash
npm run ai:suggest:evaluate
```

CI artifact + threshold gate:

```bash
npm run ai:suggest:evaluate:artifact -- \
  --fixtures-file scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json \
  --json-out artifacts/ai-suggestion-evaluation.json \
  --markdown-out artifacts/ai-suggestion-evaluation-summary.md \
  --min-useful-rate-percent 80 \
  --max-false-positive-rate-percent 20
```

Optional arguments:

```bash
npm run ai:suggest:evaluate -- scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json docs/performance/ai-suggestion-evaluations/custom-run.json
```

## Fixture schema

Fixture file: `scripts/fixtures/ai-suggestion-evaluation/*.json`

```json
{
  "fixtures": [
    {
      "fixtureId": "removed-symbol-high-risk",
      "input": { "...": "BuildAiSuggestionPayloadInput" },
      "expectedUsefulSuggestionIds": ["verify-removed-symbol-references"],
      "expectedFalsePositiveSuggestionIds": ["trace-requirement-context"]
    }
  ]
}
```

## Output artifact

Default output directory:
- `docs/performance/ai-suggestion-evaluations/eval-<timestamp>.json`

Top-level shape:

```json
{
  "generatedAt": "2026-03-12T00:00:00.000Z",
  "fixtureFilePath": "...",
  "outputFilePath": "...",
  "summary": {
    "fixtureCount": 2,
    "usefulRatePercent": 100,
    "falsePositiveRatePercent": 0
  },
  "fixtures": [
    {
      "fixtureId": "removed-symbol-high-risk",
      "generatedSuggestionIds": ["..."],
      "expectedUsefulCount": 1,
      "detectedUsefulCount": 1,
      "usefulRatePercent": 100,
      "expectedFalsePositiveCount": 1,
      "detectedFalsePositiveCount": 0,
      "falsePositiveRatePercent": 0,
      "payload": { "...": "generated payload snapshot" }
    }
  ]
}
```

## Notes

- `usefulRatePercent`: recall-like score on expected useful suggestions.
- `falsePositiveRatePercent`: hit ratio against expected false-positive suggestions.
- This harness is for trend comparison inside this repository, not cross-project leaderboard ranking.

## CI quality gate (Issue #138)

- Workflow job: `AI Suggestion Quality Gate` in `.github/workflows/ci.yml`
- Inputs:
  - `scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json`
- Outputs:
  - `artifacts/ai-suggestion-evaluation.json`
  - `artifacts/ai-suggestion-evaluation-summary.md`
- Gate thresholds:
  - `usefulRatePercent` must be `>= 80` (summary + each fixture)
  - `falsePositiveRatePercent` must be `<= 20` (summary + each fixture)
- On threshold violation, CI fails and the markdown artifact is used for PR diagnosis.

## Fixture maintenance policy

See [ai-suggestion-quality-gate-policy.md](ai-suggestion-quality-gate-policy.md) for:
- when fixture updates are allowed,
- required review evidence,
- and EN/JA documentation sync requirements.
