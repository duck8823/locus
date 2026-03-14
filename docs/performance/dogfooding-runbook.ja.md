# ドッグフーディング実行手順（200ファイル級レビュー再現）

> English: [dogfooding-runbook.md](dogfooding-runbook.md)

## 目的

合成 **200ファイル** 解析を中心に、大規模レビュー相当のドッグフーディングを再現可能な形で実施する。

## 前提 / 非対象

前提:
- 本手順は Issue #63 向けのローカル検証を対象にする。
- Node.js `22.5+` と `npm` が利用可能である。
- リポジトリのルートディレクトリで実行する。

非対象:
- 本番負荷試験の代替にはしない。
- マシン間の性能比較を確定する用途には使わない。

## 事前準備

```bash
npm install
npm run demo:data:reseed
```

任意（集計対象の jobs ファイルを切り替える場合）:

```bash
export LOCUS_ANALYSIS_JOBS_FILE_PATH=/absolute/path/to/jobs.json
```

## 再現手順

### 1) 推奨: ワンコマンド実行

```bash
npm run dogfood:run
```

実行内容:
1. `npm run demo:data:reseed`
2. 合成200ファイルのベンチマークテスト
3. 実PRフィクスチャの回帰テスト
4. テスト標準出力から session ベンチマーク指標を抽出
5. jobs ストア由来のドッグフーディング指標を算出
6. `docs/performance/dogfooding-runs/run-<timestamp>.json` へ記録

実行後に、生成された artifact のパスが標準出力に表示される。
ベンチマーク計測の可視化のため、`ANALYZE_SNAPSHOTS_BENCHMARK=1` と `ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK=1` は自動設定される。

### 2) 手動ステップ確認（任意）

```bash
npm run demo:data:reseed

ANALYZE_SNAPSHOTS_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts

ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts

npm run dogfood:metrics
```

## 指標コマンド

`npm run dogfood:metrics` は次の JSON を返す:
- `global.totalJobs`
- `global.terminalJobs`
- `global.averageDurationMs`
- `global.failureRatePercent`
- `global.recoverySuccessRatePercent`
- `byReview[]` のレビュー単位内訳

`npm run dogfood:run` は指標算出前に synthetic benchmark job を追記するため、通常は当該セッションを反映した KPI になる。

artifact 形式の詳細: [dogfooding-runs/README.ja.md](dogfooding-runs/README.ja.md)

## CI Artifact

CI では fixture 入力
（`scripts/fixtures/dogfooding-metrics/ci-jobs.json`）を使って
`npm run dogfood:metrics:artifact` を実行し、次を artifact として保存する。
- `dogfooding-metrics.json`
- `dogfooding-metrics-summary.md`

CI コマンドでは、極端な回帰を検知するしきい値も適用する。
- `failureRatePercent` の上限
- `averageDurationMs` の上限
- `recoverySuccessRatePercent` の下限

## 記録フォーマット（日時 / 環境 / 結果）

各実行で以下テンプレートを使う:

```md
## Dogfooding Record
- Date/Time (UTC):
- Date/Time (Local):
- Operator:
- Git branch / commit:

### Environment
- OS / CPU:
- Node.js / npm:
- LOCUS_ANALYSIS_JOBS_FILE_PATH (override時):

### Result
- 実行コマンド: `npm run dogfood:run` または手動ステップ
- Artifact path:
- 200-file benchmark duration (ms):
- Real-PR fixture duration (ms):
- averageDurationMs:
- failureRatePercent:
- recoverySuccessRatePercent:

### Notes
- 既知の制約:
- 次アクション:
```
