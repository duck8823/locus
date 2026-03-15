# AI提案評価ハーネス（fixtureベース）

> English: [ai-suggestion-evaluation-format.md](ai-suggestion-evaluation-format.md)

## 目的

Issue #71 に向けて、固定 fixture を使って AI提案品質を再現可能に評価できるローカル/CI ハーネスを提供する。

## 実行コマンド

```bash
npm run ai:suggest:evaluate
```

CI用アーティファクト + 閾値ゲート:

```bash
npm run ai:suggest:evaluate:artifact -- \
  --fixtures-file scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json \
  --json-out artifacts/ai-suggestion-evaluation.json \
  --markdown-out artifacts/ai-suggestion-evaluation-summary.md \
  --min-useful-rate-percent 80 \
  --max-false-positive-rate-percent 20
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
  "audit": {
    "provider": "heuristic",
    "promptTemplateId": "heuristic.rule_set.v1",
    "promptVersion": "heuristic.v1",
    "redactionPolicyVersion": "ai_suggestion_redaction.v1"
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
      "payload": { "...": "redaction済みpayloadスナップショット" }
    }
  ]
}
```

## 補足

- `usefulRatePercent`: 期待有用提案に対する再現率（recall相当）
- `falsePositiveRatePercent`: 期待誤検知提案に対する検出比率
- `payload`: `audit.redactionPolicyVersion` で示されるポリシーに基づいて redaction 済み
- このハーネスは本リポジトリ内の継続比較を目的とし、外部比較ランキング用途ではない

## CI品質ゲート（Issue #138）

- ワークフロージョブ: `.github/workflows/ci.yml` の `AI Suggestion Quality Gate`
- 入力:
  - `scripts/fixtures/ai-suggestion-evaluation/sample-fixtures.json`
- 出力:
  - `artifacts/ai-suggestion-evaluation.json`
  - `artifacts/ai-suggestion-evaluation-summary.md`
- ゲート閾値:
  - `usefulRatePercent` は `>= 80`（summary + fixture単位）
  - `falsePositiveRatePercent` は `<= 20`（summary + fixture単位）
- 閾値違反時はCIをfailし、PRではmarkdown artifactを根拠に診断する。

## fixtureメンテナンスポリシー

更新ルールは [ai-suggestion-quality-gate-policy.ja.md](ai-suggestion-quality-gate-policy.ja.md) を参照:
- fixture更新を許可する条件
- レビューで必要な根拠
- EN/JAドキュメント同期要件
