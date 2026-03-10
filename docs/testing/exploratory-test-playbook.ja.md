# 探索的テスト・プレイブック（Web Workspace v0）

> English: [exploratory-test-playbook.md](exploratory-test-playbook.md)

## 目的

外部システムに依存せず、`locus` プロトタイプを再現可能に探索的テストするための共通手順を定義する。

## 対象範囲

対象:
- マーケティングページ（`/`）
- レビューワークスペース（`/reviews/[reviewId]`）
- 接続設定ページ（`/settings/connections`）
- ローカルデモデータ運用（`.locus-data`）

対象外:
- private GitHub リポジトリや OAuth 連携
- 実運用 webhook 配信との署名検証
- 本番デプロイ固有の課題

## 事前準備

```bash
npm install
# ローカルデモデータ初期化（スクリプト非依存）
rm -rf .locus-data
mkdir -p .locus-data/review-sessions .locus-data/analysis-jobs
printf '{\n  "jobs": []\n}\n' > .locus-data/analysis-jobs/jobs.json
npm run dev
```

必要に応じてセッション前後で実行:

```bash
npm run lint
npm run typecheck
npm test
```

## セッション・チャーター

各チャーターを 20〜30 分で time-box して実施する。

### チャーター1: 初回起動体験（キャッシュなし）

1. `.locus-data` を初期化（上記セットアップ手順を使用）。
2. `/` を開き、シードデモを開始する。
3. 次を確認する:
   - ワークスペースが即時表示される
   - 初回解析ステータス遷移が見える
   - 手動連打せず変更グループが表示される

確認したいリスク:
- 解析中に「止まっている」ように見える

### チャーター2: 長文・多言語レイアウト耐性

1. `/` と `/reviews/[reviewId]` で日本語/英語を切り替える。
2. 狭い画面幅（モバイル相当）で表示確認する。
3. とくに以下を確認:
   - ボタンの折返し
   - グループタイトル/概要のはみ出し
   - セマンティック差分メタ情報のはみ出し
   - ステータス/ヒント文が操作部を圧迫しないか

確認したいリスク:
- 日本語長文や密なメタ情報で UI が崩れる

### チャーター3: レビュー進捗の継続性

1. ワークスペースでグループ選択・状態変更（`unread` / `in_progress` / `reviewed`）を行う。
2. リロードし、再度ワークスペースを開く。
3. 選択グループと状態が保持されることを確認する。

確認したいリスク:
- リロード/再表示で状態が失われる

### チャーター4: 再解析とリトライ挙動

1. ワークスペースから手動再解析を実行する。
2. queued/running/succeeded の遷移を確認する。
3. 可能なら失敗系も発生させ、再試行操作を確認する。
4. ステータス文言・時刻表示の整合を確認する。

確認したいリスク:
- requested/completed/error の時系列が不整合になる

### チャーター5: ローカルデモデータ運用

1. ローカルデモデータの reset/reseed を手動実行する:
   - `.locus-data` を削除
   - `.locus-data/review-sessions` と `.locus-data/analysis-jobs` を再作成
   - `.locus-data/analysis-jobs/jobs.json` に `{ "jobs": [] }` を作成
2. ブランチに `npm run demo:data:*` がある場合は、そのコマンドも確認する。
3. 操作が安全かつ予測可能に動作するか確認する。
4. シードデモ再表示でワークスペースが再生成されるか確認する。

確認したいリスク:
- `.locus-data` 以外への破壊的操作

## 記録テンプレート

以下形式で記録する:

```text
Charter:
Timestamp:
Scenario:
Observed:
Expected:
Impact:
Repro Steps:
Screenshots/Logs:
Severity: MUST / SHOULD / NIT
```

## 完了条件

- MUST が未解決で残っていない。
- 頻度の高い SHOULD に追跡チケットがある。
- 採用した指摘はすべて再現手順つきで記録済み。
