# ADR 0001: プロトタイプ先行の MVP 提供

> English: [0001-prototype-first-mvp.md](0001-prototype-first-mvp.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus には現在プロダクトの位置づけはあるものの、実行可能な成果物がありません。長期的な architecture-map プロダクトの余地を残しつつ、曖昧さを素早く減らせる進め方が必要です。

## Decision

まず **プロトタイプ先行の CLI package** を作り、JavaScript / TypeScript に対する semantic diff の価値を検証します。上流の連携はすべて明示的な adapter の背後に置きます。

parser layer については **差し替え可能な parser interface** を採用し、最初の adapter は Babel の JS / TS parser で実装します。これにより UX をすぐに検証できます。semantic-diff contract が安定した後の多言語対応では、引き続き Tree-sitter を本命候補とします。

## 検討した案

### Option A — プロトタイプ先行の semantic-diff engine（採用）

- まず CLI と test fixture を作る
- コア信号の信頼性が確認できるまで GitHub / storage / UI は後回しにする
- parser と provider の境界を最初から明示する

### Option B — 先にフル web application skeleton を作る

- analysis engine を検証する前に web / API / DB を立ち上げる
- 目に見える進捗は出るが、大半がプロダクト検証ではなく足場コードになる

### Option C — GitHub App integration を先に作る

- semantic grouping の品質を検証する前に PR ingestion と hosted flow を優先する
- end-to-end の物語は強いが、analysis quality の弱さが見えにくい

## Rationale

### Signal までの速さ

Option A は、Locus がレビュアーにとって本当に重要な変更を検出できるかを最短で見極められます。

### 技術リスク

このプロダクトで最も難しいのは CRUD や OAuth ではなく semantic grouping です。Option A はそこを正面から潰します。

### 再利用性

独立した engine は将来 web app、GitHub App、local CLI、IDE integration のいずれにも転用できます。UI 先行の土台には同じ移植性がありません。

### 変更コスト

parser と provider の contract を分離しておけば、semantic core を作り直さずに Tree-sitter、GitHub、GitLab、Bitbucket へ広げられます。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| CLI 先行だとプロダクトらしさが弱く見える | 出力を安定化し fixture-driven にして、将来 UI がそのまま利用できる形にする |
| Babel 先行が長期の Tree-sitter 方針からズレる | parser 出力を `collectCallables` / snapshot contract の背後に閉じ込める |
| JS / TS に絞ることで判断が早すぎる | MVP 境界を明記し、信号品質が証明されるまで拡張しない |

## 採用条件

- semantic-diff record は provider 非依存のまま保つ。
- parser 固有ロジックが上位レイヤーへ漏れない。
- prototype に構文形式を追加するたびに regression test を付ける。

## 却下条件

以下のいずれかが起きたら、この ADR は見直します。

- prototype ではレビュアーが必要とする callable-level changes を表現できない
- Babel parser の制約が JS / TS MVP を実質的に阻害する
- 最初の顧客シグナルとして、analysis engine より hosted GitHub workflow が必須だと判断された

## 次のアクション

1. JS / TS semantic-diff CLI をテスト付きで提供する。
2. GitHub ingestion が生成すべき PR snapshot contract を定義する。
3. 実際の pull request 由来の fixture を追加し、UI を作る前に精度を評価する。
