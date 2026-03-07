# ADR 0002: TypeScript + Next.js による Web-first なプロダクト面を採用する

> English: [0002-web-first-nextjs-typescript.md](0002-web-first-nextjs-typescript.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus は本質的にレビュー支援プロダクトです。レビュアーは semantic change group、architecture context、関連要件、review progress を 1 つの workspace で往復する必要があります。加えて GitHub 連携のための認証付きサーバー面も必要です。

ユーザーは CLI-first や desktop-first ではなく、Web アプリを選びました。また、parser や実装言語の選定はまだ固定せずに、今進められる実装判断だけを先に置きたい状況です。

## Decision

最初の実装ターゲットおよび主たるプロダクト面として **TypeScript + Next.js App Router** を採用します。

Web アプリが担うもの:
- 認証付き review workspace UI
- webhook や API 入口を受ける route handlers
- application use case を呼び出す server-side composition
- Web の都合に閉じた cache / revalidation の処理

一方で、Web アプリは domain logic を直接持ちません。コアロジックは ADR 0003 で定義する layered server modules の下に置きます。

## 検討した案

### Option A — TypeScript + Next.js App Router による Web-first（採用）

- 主要なレビュー体験に最も合う
- UI と BFF を 1 つのコードベースで扱える
- Node.js / TypeScript から既存 parser ecosystem を扱いやすい

### Option B — CLI-first

- スパイクや fixture 検証には向く
- しかし map / progress state / multi-pane review flow といった本来のレビュー体験には弱い

### Option C — Desktop-first

- 一部のローカル専用環境には向く可能性がある
- ただし配布、更新、OS 差分、認証の複雑性を早い段階で背負う

## Rationale

### Product fit

主要なユーザージョブは、状態を持つリッチな review workspace で pull request を読むことです。これはまず Web の問題であり、terminal や desktop 配布の問題ではありません。

### 実装速度

Next.js App Router を使うと、UI、認証付き route handler、server-side composition を、初期段階で複数リポジトリに分けずに進められます。

### Ecosystem fit

TypeScript は parser-heavy なプロダクトと相性が悪くありません。Node.js から tree-sitter 系や言語固有 compiler API を束ねやすいからです。

### 制約管理

Next.js を product shell として選んでも、business logic を framework file に押し込む必要はありません。framework surface を薄く保てばよいです。

## Consequences

### Positive

- review UI と BFF を 1 つの実装面で進められる
- 認証付きレビュー導線を早く試せる
- route handler、server rendering、段階的な UI 実装に乗りやすい

### Negative

- Next.js の便利 API により framework concern が core logic に漏れやすい
- app router の file structure に引っ張られて feature code が route file に寄りやすい
- 長時間の analysis は明示的な background execution 境界が必要

## 採用条件

- `app/` 配下の file は薄く保ち、use case 呼び出しに徹する
- route handler や server action から DB / GitHub / parser を直接触らない
- 長時間の analysis は UI component の中で同期実行せず、application / infrastructure boundary の背後で扱う
- 未対応言語の analysis は parser adapter を差し替えるだけで拡張できるように保つ

## 却下条件

以下のいずれかが起きたら、この ADR は見直します。

- ローカル専用の product surface が主要要件になる
- MVP に必要な background analysis model を Next.js が実質的に阻害する
- 単一の web-first codebase がかえって逆効果になるほどプロダクト面が分裂する

## References

- Next.js App Router docs: https://nextjs.org/docs/app
- Next.js Route Handlers docs: https://nextjs.org/docs/app/getting-started/route-handlers-and-middleware
