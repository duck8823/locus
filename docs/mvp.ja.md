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
   - 言語非依存の semantic change contract を定義する
   - 最初の縦切り検証は 1 つの暫定 parser / 言語の組み合わせで行う
   - 最初の検証では関数 / メソッド / 関数を値に持つ class property 単位で扱う
   - コメントだけ・空白だけの変更は無視する
3. **Architecture context v0**
   - import とディレクトリ規約から dependency graph を構築する
   - 変更ノードの直近 upstream / downstream のみ表示する
4. **Review progress tracking**
   - semantic change group を unread / in-progress / reviewed で管理する
5. **Web review workspace v0**
   - 単一 pull request を対象にした認証付き review workspace
   - semantic change list、detail pane、progress state を1画面にまとめる
   - Backend for Frontend (BFF) 形式のサーバー面

上の番号付き機能は MVP のスコープを示すもので、実装順ではありません。実装の進め方は後段の Delivery Slices で別に定義します。

### 対象外

- GitLab / Bitbucket 対応
- Confluence / Jira / Notion 連携
- このフェーズでの多言語の本格対応
- このフェーズで長期的な parser family や実装言語を固定すること
- GitHub へのレビューコメント自動書き戻し
- リアルタイム共同編集
- このフェーズでのネイティブ desktop アプリ対応
- 本番課金・テナンシー周りの設計

## 配送スライス

実装補助ドキュメント:
- [Webアプリケーション設計図](architecture/web-application-blueprint.ja.md)
- [セマンティック分析パイプライン](architecture/semantic-analysis-pipeline.ja.md)

### Slice 1 — Web shell と server boundary

- Next.js App Router のプロジェクト構造を確立する
- presentation / application / domain / infrastructure の境界を定義する
- 認証と空の review-workspace 導線を stub data で先に実装する
- 最初の Web workspace フローで review progress と workspace state を永続化する

Slice 1 では、最初の workspace を開き直せるだけの最小 persistence があれば十分です。長期的な review-session model 全体まではこの段階で固めません。

### Slice 2 — Semantic-diff contract と parser spike

- parser adapter と semantic change contract を定義する
- adapter 境界の背後に 1 つの暫定 probe 実装を置く
- probe 言語の主要 callable 形式をテストでカバーする

### Slice 3 — GitHub adapter

- PR diff を file snapshot に変換する
- changed files を semantic change record に対応付ける

### Slice 4 — Architecture context

- touched files から dependency graph を構築する
- 各 semantic change group に graph neighbor を付与する

## 成功条件

- レビュアーが 10 秒以内に変更された callable を見つけられる。
- コメントだけ・フォーマットだけの変更が semantic change として表示されない。
- 200 ファイル規模の GitHub PR を手作業なしで ingest / 要約できる。
- レビュアーが Web workspace を閉じて開き直しても review progress を失わない。
- 少なくとも 1 回の内部ドッグフーディングで、medium-sized PR に対して raw diff より semantic view の方が有用だと確認できる。

## リスク

| リスク | なぜ重要か | 対策 |
| --- | --- | --- |
| パーサー網羅性が進捗を止める | 構文対応漏れは信頼をすぐに損なう | まずは 1 つの暫定スパイクから始め、parser contract を差し替え可能に保つ |
| 暫定スパイクが最終的な基盤選定だと誤解される | 多言語ロードマップに対して偶発的なロックインが起きる | parser / 実装言語を固定する前に ADR を必須にする |
| Architecture map がノイジーになる | グラフが読みにくいとレビューで無視される | 最初は直近 neighbor のみ表示する |
| GitHub ingestion と analysis が密結合する | 将来のコードホスト追加コストが高くなる | provider-agnostic な snapshot contract を保つ |
| Next.js の便利 API でレイヤ境界が崩れる | サーバーのテスト性・差し替え性が下がる | コアロジックを `src/server` に閉じ込め、use case 経由を徹底する |
| UI を早く作りすぎる | 見た目でコア信号の弱さをごまかしてしまう | UI は薄く保ち、fixture と contract 検証を先に行う |
