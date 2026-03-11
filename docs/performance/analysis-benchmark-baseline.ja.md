# 解析ベンチマーク基準値（合成 200-file PR）

> English: [analysis-benchmark-baseline.md](analysis-benchmark-baseline.md)

## 目的

セマンティック解析のローカル基準値を記録し、性能劣化の早期検知に使う。

## ベンチマーク条件

- シナリオ: TypeScript 200ファイルの合成 PR
- 解析器: `analyzeSourceSnapshots` + `TypeScriptParserAdapter`
- フィクスチャ: 各ファイルで callable 本文を更新（1ファイルあたり1変更）
- 実行環境: ローカル開発機（macOS / Apple Silicon）

## 実行コマンド

```bash
ANALYZE_SNAPSHOTS_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/analyze-source-snapshots.large-pr.test.ts
```

## 基準値（2026-03-11）

- 処理ファイル数: 200
- 実行時間: **26 ms**

## 実PRフィクスチャ回帰ベースライン（2026-03-11）

- シナリオ: このリポジトリの実PR履歴から抽出した2ファイルペア
  - `set-workspace-locale-action.ts` のリダイレクト検証強化
  - `start-github-demo-session-action.ts` の構造化エラーコード化
- 解析器: `analyzeSourceSnapshots` + `TypeScriptParserAdapter`
- 実行コマンド:

```bash
ANALYZE_SNAPSHOTS_REAL_PR_BENCHMARK=1 \
  npx vitest run src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts
```

- 処理ファイル数: 2
- 実行時間: **4 ms**

## ガードレール

- 自動テストでは現在以下を検証:
  - `durationMs <= 10_000`
  - 期待する group/change 件数（`200`）
- 実PRフィクスチャ回帰テストでは追加で以下を検証:
  - `durationMs <= 5_000`
  - 2ファイル両方で semantic change を抽出できること

しきい値は CI 安定性のため緩めに設定している。トレンド監視は本ドキュメントの基準値を更新して行う。
