# ADR 0003: 参照した Go 規約の設計概念を取り込んだ layered server architecture を採用する

> English: [0003-layered-server-architecture.md](0003-layered-server-architecture.md)

- Status: Accepted
- Date: 2026-03-07

## Context

参照した Go コーディング規約から借りたいのは、**Go 固有のテクニック**ではなく**設計概念**です。

欲しい状態は次のとおりです。
- Next.js の product shell の下に、テスト可能な server core がある
- 依存方向が明示されている
- framework の都合で domain boundary が壊れない
- GitHub / parser / storage / LLM を追加しても route file の塊にならない

## Decision

TypeScript の Web アプリ内で、次の 4 層アーキテクチャを採用します。

```text
Presentation -> Application -> Domain <- Infrastructure
```

### 各層の責務

#### Presentation
- Next.js route handlers
- server actions
- request validation と response shaping
- auth / session boundary の変換

#### Application
- use case
- workflow orchestration
- transaction boundary
- use case に紐づく authorization check
- idempotency / job triggering policy

#### Domain
- entity と value object
- domain service と invariant
- domain aggregate の repository interface
- framework や parser に依存しない semantic analysis 概念

#### Infrastructure
- database access
- GitHub API 実装
- parser adapter 実装
- queue / blob / cache 連携
- LLM provider 連携

## 依存ルール

- Presentation は Application の DTO / use case に依存してよいが、Infrastructure 実装には依存しない
- Application は Domain と抽象 port / interface に依存してよいが、framework 固有の request/response 型には依存しない
- Domain は Next.js / Prisma / GitHub SDK / parser SDK / provider 固有型に依存しない
- Infrastructure は Domain/Application の抽象に依存して実装してよいが、その逆は不可

## Go 規約の概念をどう適用するか

参照先の Go 規約は presentation / application / domain / infrastructure を強く分離しています。この考え方は維持しつつ、TypeScript 向けに次のように読み替えます。

- **HTTP handler を薄くする** の代わりに **route file を薄くする**
- **request/response 変換** と **use-case orchestration** を分離する
- **repository interface / analysis contract** を framework file の外に置く
- ORM 型や provider 型が domain に漏れないよう **mapper を明示する**
- parser adapter は **domain ではなく infrastructure** として扱う

この ADR の運用ルールは、この文書だけで理解・適用できるように自己完結させます。元の参照資料へアクセスできなくても、実装判断に困らないことを前提にします。

## 推奨プロジェクト構成

```text
src/
  app/
    api/
      github/
        webhooks/route.ts
      reviews/
        [reviewId]/progress/route.ts
    reviews/
      [reviewId]/page.tsx
  server/
    presentation/
      api/
      actions/
      dto/
      mappers/
    application/
      usecases/
      services/
      ports/
    domain/
      entities/
      value-objects/
      repositories/
      services/
    infrastructure/
      db/
      github/
      parser/
      llm/
      queue/
      cache/
```

## Consequences

### Positive

- framework file を差し替えやすい
- analysis core を UI 抜きでテストしやすい
- GitHub / parser / persistence の変更影響を局所化しやすい

### Negative

- mapper や構造化の boilerplate が増える
- 境界をショートカットしない discipline が必要

## 採用条件

- 新しい server feature は `src/server/**` の下で設計する
- `src/app/**` の framework file は use case 呼び出しに徹する
- infrastructure 型は Domain/Application に入る前に mapper を通す
- レビューでは境界違反を style ではなく設計問題として扱う

## 参照メモ

この ADR は内部の Go コーディング規約文書から着想を得ていますが、規範となる内容は上記にすべて記載しています。今後の実装判断やレビューでは、外部リポジトリの可用性ではなく、この ADR 自体を参照してください。
