# ADR 0001: parser / 言語選定を固定しないプロトタイプ先行 MVP 提供

> English: [0001-prototype-first-mvp.md](0001-prototype-first-mvp.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus には現在プロダクトの位置づけはあるものの、実行可能な成果物がありません。長期的な多言語対応の方向性を残しつつ、曖昧さを素早く減らせる進め方が必要です。

## Decision

まず **プロトタイプ先行の実装方針** を取り、semantic-diff contract とレビュアー体験を早期に検証します。上流の連携はすべて明示的な adapter の背後に置きます。

このフェーズでは、長期的な parser family や実装言語を **固定しません**。最初の parser / 言語実装は、adapter 境界の背後にある **捨て可能なスパイク** として扱い、リポジトリ全体の設計判断とは見なしません。

## 検討した案

### Option A — parser / 言語の確定を遅らせたプロトタイプ先行実装（採用）

- まず最初の縦切りを早めに作る
- parser / provider の境界を最初から明示する
- 最初の parser / 言語実装は、評価基準を満たすまで暫定扱いにする

### Option B — parser / 言語を先に固定したプロトタイプ先行

- 同じく prototype は作るが、parser family と実装言語を最初から長期判断として宣言する
- 短期的には説明が楽だが、多言語要件の根拠が揃う前にロックインを生む

### Option C — contract を明示する前にフル実装へ進む

- analysis contract を固める前にプロダクト面を大きく進める
- 目に見える進捗は出るが、弱い analysis 前提を後から差し替えにくくなる

## Rationale

### Signal までの速さ

Option A でも、Locus がレビュアーにとって重要な変更を検出できるかを最短で見極められます。

### 早すぎるロックインを避ける

Locus は多言語対応を目指しています。精度や保守コストのデータがない段階で parser family や実装言語を固定するのは設計ミスです。

### 技術リスク

このプロダクトで最も難しいのは CRUD や OAuth ではなく semantic grouping です。Option A はそこを正面から潰しつつ、最初のスパイクを最終基盤だと誤認しない進め方です。

### 再利用性

境界を先に固めた実装は、将来 web app、GitHub App、local CLI、IDE integration に転用できます。上位 contract が安定していれば、下位の捨て可能スパイクは許容できます。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| 最初のスパイクが最終アーキテクチャだと誤解される | 暫定実装であることを文書化し、parser / 実装言語を固定する前に ADR を必須にする |
| 捨て可能スパイクが非効率に見える | adapter 境界を狭く保ち、置き換えコストを制御する |
| 初期言語の偏りがロードマップを歪める | 明示的な評価基準を先に置き、実 fixture が揃った段階で再評価する |

## 採用条件

- semantic-diff record と snapshot contract は provider 非依存のまま保つ。
- parser 固有ロジックが上位レイヤーへ漏れない。
- 最初の実装を置き換えても上位 contract を変えずに済む。
- 長期的な parser family や実装言語を固定する前に ADR 承認を必須にする。
- 最初のスパイクに構文形式を追加するたびに regression test を付ける。

## 却下条件

以下のいずれかが起きたら、この ADR は見直します。

- adapter 境界のせいで十分な速度で前進できない
- 暫定スパイクではレビュアーが必要とする callable-level changes を表現できない
- MVP を出すためには parser / 言語を早期固定する必要があるという根拠が揃う

## 次のアクション

1. 最初のスパイクを adapter contract の背後に置いたまま fixture で検証する。
2. 長期的な parser / 言語選定をする前に、評価基準を定義する。
3. 実際の pull request 由来の fixture を追加し、UI を作る前に精度を評価する。
