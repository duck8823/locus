# ドッグフーディング実行アーティファクト

> English: [README.md](README.md)

このディレクトリには、次のコマンドで生成される JSON を格納する。

```bash
npm run dogfood:run
```

## ファイル名形式

- `run-<ISO timestamp の ':' '.' を '-' に置換>.json`
- 例: `run-2026-03-12T08-12-45-123Z.json`

## JSON 形式

```json
{
  "generatedAt": "2026-03-12T08:12:45.123Z",
  "commands": [
    {
      "command": "npm run demo:data:reseed",
      "status": "succeeded",
      "stdout": "...",
      "stderr": ""
    }
  ],
  "sessionMetrics": {
    "syntheticLargePrDurationMs": 1234,
    "realPrFixtureDurationMs": 210,
    "failedCommandCount": 0
  },
  "metrics": {
    "generatedAt": "2026-03-12T08:12:45.120Z",
    "jobsFilePath": ".../jobs.json",
    "global": {
      "totalJobs": 0,
      "terminalJobs": 0,
      "averageDurationMs": null,
      "failureRatePercent": null,
      "recoverySuccessRatePercent": null
    },
    "byReview": []
  },
  "warnings": []
}
```

## 運用メモ

- トレンド比較や障害調査のため、生データは一定期間保持する。
- 当該実行のベンチマーク値は `sessionMetrics.*DurationMs` を参照する。
- `metrics` は永続化済み analysis-job ストアの集計値。`warnings` に no-job 警告がある場合、当該実行のKPIとしては扱わない。
- コマンド出力に機密情報が含まれる場合、外部共有前にマスクする。
