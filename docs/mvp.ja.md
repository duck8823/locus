# Locus MVP 定義

> English: [mvp.md](mvp.md)

## プロダクト目標

レビュアーが pull request の*変更の意味*を、従来の unified diff より速く理解できるようにする。

## 主なユーザー

- 中〜大規模の GitHub pull request をレビューするシニア / スタッフエンジニア
- 承認前にレイヤー横断の影響範囲を把握したいテックリード

## ユーザージョブ

1. フォーマットノイズに埋もれず、本質的なロジック変更を特定する。
2. 変更されたコードがシステムのどこに位置するかを理解する。
3. 大きなレビューを途中再開しても、どこまで見たかを失わない。

## MVP スコープ

### 対象に含むもの

1. **GitHub pull request ingestion**
   - 変更ファイルと patch metadata を取得する
   - 後続の解析に使える snapshot 形式へ正規化する
2. **Semantic diff v0**
   - まずは JavaScript / TypeScript を対象にする
   - 関数 / メソッド / 関数を値に持つ class property 単位で扱う
   - コメントだけ・空白だけの変更は無視する
3. **Architecture context v0**
   - import とディレクトリ規約から dependency graph を構築する
   - 変更ノードの直近 upstream / downstream のみ表示する
4. **Review progress tracking**
   - semantic change group を unread / in-progress / reviewed で管理する

### 対象外

- GitLab / Bitbucket 対応
- Confluence / Jira / Notion 連携
- JS / TS を超える多言語パース
- GitHub へのレビューコメント自動書き戻し
- リアルタイム共同編集
- 本番課金・テナンシー周りの設計

## 配送スライス

### Slice 1 — Parser と semantic diff engine

- before / after snapshot をパースする
- 安定した change record を出力する
- 主要な JS / TS callable 形式をテストでカバーする

### Slice 2 — GitHub adapter

- PR diff を file snapshot に変換する
- changed files を semantic change record に対応付ける

### Slice 3 — Architecture context

- touched files から dependency graph を構築する
- 各 semantic change group に graph neighbor を付与する

### Slice 4 — Review session state

- review progress を永続化する
- 同じ PR を開き直したときに途中位置を復元する

## 成功条件

- レビュアーが 10 秒以内に変更された callable を見つけられる。
- コメントだけ・フォーマットだけの変更が semantic change として表示されない。
- 200 ファイル規模の GitHub PR を手作業なしで ingest / 要約できる。
- 少なくとも 1 回の内部ドッグフーディングで、medium-sized PR に対して raw diff より semantic view の方が有用だと確認できる。

## リスク

| リスク | なぜ重要か | 対策 |
| --- | --- | --- |
| パーサー網羅性が進捗を止める | 構文対応漏れは信頼をすぐに損なう | JS / TS から始め、parser interface を差し替え可能に保つ |
| Architecture map がノイジーになる | グラフが読みにくいとレビューで無視される | 最初は直近 neighbor のみ表示する |
| GitHub ingestion と analysis が密結合する | 将来のコードホスト追加コストが高くなる | provider-agnostic な snapshot contract を保つ |
| UI を早く作りすぎる | 見た目でコア信号の弱さをごまかしてしまう | UI より先に CLI と fixture で精度を検証する |
