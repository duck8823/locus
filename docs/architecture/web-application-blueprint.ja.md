# Webアプリケーション設計図

> English: [web-application-blueprint.md](web-application-blueprint.md)

## 目的

この文書は、上位 ADR を「最初の Locus Web アプリをどう実装するか」という粒度まで落とした blueprint です。

答えたいこと:
- 実行時の主要コンポーネントは何か
- Next.js プロジェクト内のどこにコードを置くか
- リクエストが各層をどう流れるか
- Web shell と analysis core の責務をどう分けるか

関連ドキュメント:
- [セマンティック分析パイプライン](semantic-analysis-pipeline.ja.md)

## Runtime 概要

```text
Browser
  -> Next.js App Router (UI + Backend for Frontend (BFF) surface)
    -> Application use cases
      -> Domain contracts
        -> Infrastructure adapters
          -> GitHub API / Database / Queue / Blob Store / Parser Runtime / LLM API
```

### 主要コンポーネント

1. **Browser UI**
   - review workspace
   - 認証フロー
   - integration 設定画面
2. **Next.js Web application**
   - route handlers
   - server rendering
   - UI 局所の mutation に使う server actions
3. **Background execution**
   - pull request ingestion
   - semantic analysis job
   - architecture-context enrichment
4. **Persistence**
   - review session と metadata を置く relational database
   - raw snapshot や大きな中間成果物を置く optional な blob storage
5. **External systems**
   - GitHub
   - 将来の context source（Confluence, Jira, Notion）
   - optional な LLM provider

## 推奨プロジェクト構成

```text
src/
  app/
    (marketing)/
      page.tsx
    (workspace)/
      reviews/
        [reviewId]/
          page.tsx
          loading.tsx
          error.tsx
      settings/
        connections/page.tsx
    api/
      github/
        webhooks/route.ts
      reviews/
        [reviewId]/
          progress/route.ts
          reanalyze/route.ts
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
      storage/
```

## Web アプリ内のレイヤ対応

### `src/app/**`
framework surface のみを置きます。

許可するもの:
- route file
- page/layout/loading/error file
- UI component と use case の接続
- request params / cookies / headers / session の読み取り

置かないもの:
- 生の database query
- GitHub SDK の直接呼び出し
- parser の直接呼び出し
- use case / domain に属する business rule

### `src/server/presentation/**`
presentation helper だが、framework file に直接書きたくないものを置きます。

例:
- `presentReviewWorkspace.ts`
- `parseProgressRequest.ts`
- `toReviewWorkspaceDto.ts`

### `src/server/application/**`
workflow orchestration を置きます。

候補 use case:
- `ConnectGitHubAccount`
- `IngestPullRequest`
- `OpenReviewWorkspace`
- `MarkSemanticChangeReviewed`
- `ReanalyzeReview`
- `GetArchitectureContext`

### `src/server/domain/**`
framework 非依存の概念を置きます。

候補 entity / value object:
- `ReviewId`
- `PullRequestRef`
- `ReviewSession`
- `ReviewProgress`
- `SemanticChange`
- `SemanticChangeGroup`
- `ArchitectureNode`

### `src/server/infrastructure/**`
provider 固有の実装を置きます。

例（技術選定を固定しないプレースホルダー名）:
- `ReviewSessionRepositoryAdapter`
- `CodeHostPullRequestClient`
- `TemporarySemanticParserAdapter`
- `LLMReviewAssistantAdapter`

## 主要ユーザーフロー

### 1. GitHub ingestion flow

```text
GitHub webhook
  -> app/api/github/webhooks/route.ts
  -> presentation parser/validator
  -> application.IngestPullRequest
  -> infrastructure.github fetches changed files
  -> infrastructure.queue schedules analysis
  -> infrastructure.db stores review shell
```

### 2. Open review workspace

```text
GET /reviews/:reviewId
  -> app/(workspace)/reviews/[reviewId]/page.tsx
  -> application.OpenReviewWorkspace
  -> domain assembles review state
  -> presentation DTO mapper
  -> server-rendered workspace page
```

### 3. Mark progress

```text
POST /api/reviews/:reviewId/progress
  -> route handler
  -> request mapper
  -> application.MarkSemanticChangeReviewed
  -> domain ReviewSession updates progress rules
  -> repository persists state
  -> response DTO
```

## 最初の workspace 画面構成

最初の review workspace は、1 画面でレビューの往復を完結できることを重視します。

最低限必要な pane / component:
- **Change group list** — semantic change group の安定した並び
- **Detail pane** — 選択中 change の summary、before/after 説明、file reference
- **Architecture pane** — 直近の upstream/downstream neighbor のみ
- **Progress state** — unread / in-progress / reviewed

後回しでよいもの:
- spec context pane
- AI review comments pane
- collaborator cursor / presence

## Server Actions の扱い

Server Actions を使ってよいのは、次をすべて満たす場合だけです。
- mutation が現在の UI からしか発生しない
- public API としての HTTP semantics が不要
- action の本体は即座に application use case に委譲する

background job を queue に積むこと自体は許容しますが、その場合も Server Action から直接 infrastructure code を触るのではなく、application use case を経由する必要があります。

Route Handler を使うべきケース:
- GitHub や外部システムから呼ばれる
- 将来的に複数クライアントから呼ばれる可能性がある
- HTTP semantics を明示したまま保ちたい

## Persistence boundary

最初の実装で最低限必要なのは次です。
- review session table
- pull request snapshot metadata table
- semantic change group table
- review progress state table

Raw source snapshot は、DB row size が問題になるまでは blob storage を固定しなくてよいです。その判断は、最初の web shell を立ち上げる前に確定している必要はありません。

## Background job boundary

長時間の analysis は request/response path から外します。

background job の対象:
- pull request snapshot ingestion
- parser-based semantic analysis
- architecture graph enrichment
- 将来の AI review generation

Web shell は job を起動し、state を poll / subscribe してよいですが、重い解析を同期実行してはいけません。

## 実装順メモ

実装順の正本は [`../mvp.ja.md`](../mvp.ja.md) の Delivery Slices です。この blueprint は runtime boundary と request flow の説明に専念し、別のスライス計画は持ちません。

## 最初の実装でやらないこと

- native desktop packaging
- multi-client API platform としての一般化
- plugin marketplace
- 完全な real-time collaboration
