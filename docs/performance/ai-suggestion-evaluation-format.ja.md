# AI提案評価ハーネス（fixtureベース）

> English: [ai-suggestion-evaluation-format.md](ai-suggestion-evaluation-format.md)

## 目的

Issue #71 に向けて、固定 fixture を使って AI提案品質を再現可能に評価できるローカル/CI ハーネスを提供する。

## 実行コマンド

```bash
npm run ai:suggest:evaluate
```

引数指定（任意）:

```bash
npm run ai:suggest:evaluate -- scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json docs/performance/ai-suggestion-evaluations/custom-run.json
```

## fixture 形式

fixture ファイル: `scripts/fixtures/ai-suggestion-evaluation/*.json`

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

## 出力アーティファクト

デフォルト出力先:
- `docs/performance/ai-suggestion-evaluations/eval-<timestamp>.json`

トップレベル形式:

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
      "payload": { "...": "生成payloadスナップショット" }
    }
  ]
}
```

## 補足

- `usefulRatePercent`: 期待有用提案に対する再現率（recall相当）
- `falsePositiveRatePercent`: 期待誤検知提案に対する検出比率
- このハーネスは本リポジトリ内の継続比較を目的とし、外部比較ランキング用途ではない
