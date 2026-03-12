# ドッグフーディング指標定義 (H2-1)

> English: [dogfooding-metrics-definition.md](dogfooding-metrics-definition.md)

## 目的

ローカルドッグフーディングの進捗を追うための最小・再現可能な指標セットを定義する。

## データソース

- 既定ファイル: `.locus-data/analysis-jobs/jobs.json`
- 上書き: `LOCUS_ANALYSIS_JOBS_FILE_PATH`

## 指標

### 1) 速度: `averageDurationMs`

- 対象: 終端ジョブ（`succeeded` / `failed`）
- 算出: `durationMs` の単純平均（0以上の有限値のみ）
- 単位: ミリ秒

### 2) 失敗率: `failureRatePercent`

- 対象: 終端ジョブ（`succeeded` / `failed`）
- 算出: `failed / terminal * 100`
- 小数第1位で丸める

### 3) 復帰成功率: `recoverySuccessRatePercent`

- 対象: `reason = manual_reanalysis` のジョブ
- 算出: `succeeded_manual_reanalysis / manual_reanalysis * 100`
- 小数第1位で丸める

## コマンド

```bash
npm run dogfood:metrics
```

出力JSON:
- `global`: 全体指標
- `byReview[]`: レビュー単位指標

## 補足

- 本指標セットはローカル・軽量運用を前提とする。
- 外部ベンチマーク比較用途ではない。
