# Business Context Bridge 契約

> English: [business-context-bridge.md](business-context-bridge.md)

## 目的

レビュー画面に要件/仕様コンテキストを接続するための Phase 2 ブリッジ契約を固定する。

これにより、Confluence / GitHub Issues の本実装前でも UI 配線とテストを先に安定化できる。

## スコープ

- `/reviews/[reviewId]` の read-only コンテキストパネル契約
- 要件メタデータの source/status 意味定義
- プロトタイプ向け stub provider の挙動

非スコープ:

- issue tracker との双方向同期
- Confluence 認証/セッション管理
- PR本文からの自動要件抽出

## DTO 契約

```ts
export interface ReviewWorkspaceBusinessContextItemDto {
  contextId: string
  sourceType: "github_issue" | "confluence_page"
  status: "linked" | "candidate" | "unavailable"
  confidence: "high" | "medium" | "low"
  inferenceSource:
    | "issue_url"
    | "repo_shorthand"
    | "same_repo_shorthand"
    | "same_repo_closing_keyword"
    | "branch_pattern"
    | "pull_request_fallback"
    | "none"
  title: string
  summary: string | null
  href: string | null
}

export interface ReviewWorkspaceBusinessContextDto {
  generatedAt: string
  provider: "stub" | "github_live" | "fallback"
  diagnostics: {
    status: "ok" | "fallback"
    retryable: boolean
    message: string | null
    occurredAt: string | null
  }
  items: ReviewWorkspaceBusinessContextItemDto[]
}
```

## 意味ルール

- `sourceType`
  - `github_issue`: GitHub 上の Issue / Project 系コンテキスト
  - `confluence_page`: Confluence 上の仕様ドキュメントコンテキスト
- `status`
  - `linked`: 要件リンクが確定している
  - `candidate`: 候補リンク（ユーザー確認が必要）
  - `unavailable`: 現在リンク可能な情報がない
- `confidence`
  - `high`: 明示的な手がかり（Issue URL、owner/repo表記、closing keyword）
  - `medium`: 推定だが妥当性のある手がかり（同一repo `#123`、branch pattern）
  - `low`: 弱いフォールバック、または unavailable placeholder
- `inferenceSource`
  - 行が生成された決定的な理由コード（`issue_url`, `branch_pattern` など）
  - unavailable placeholder では `none` を使う

## 現行プロトタイプ挙動

- `StubBusinessContextProvider` が決定的な placeholder コンテキストを返す。
- GitHub ソースのレビューでは PR タイトルから Issue 参照を推定する。
  - `owner/repo#123` と GitHub Issue URL は `linked` として返す
  - 同一リポジトリの `fixes #123` / `closes #123` 形式は `linked` として返す
  - 同一リポジトリの単独 `#123` は `candidate` として返す
  - ブランチ命名規約（`feature/123-*`, `issue-456` など）からも `candidate` を補完する
  - 明示参照がない場合は PR 番号を使った deterministic な候補を返す
- GitHub 以外のソースでは unavailable のみ返す。

## 失敗時ハンドリング (H3-4)

- live GitHub enrich が失敗しても stub 推定が利用可能な場合は、stub 候補行を保持したまま `provider: "fallback"` を返す。
- fallback snapshot も得られない失敗時は、API が `provider: "fallback"` を返し、決定的な unavailable 行を返す。
- `diagnostics` で次を返す:
  - `status: "fallback"`
  - UI 再試行可否の `retryable`
  - 取得できる範囲の `message`
  - 発生時刻 `occurredAt`
- UI は「今すぐ再読み込み」を案内しつつ、ワークスペース本体は継続利用可能にする。

## 拡張ポリシー

1. source/status の enum は加算的に拡張する。
2. 未知値に対する UI フォールバックを維持する。
3. unavailable 表現のため `href` は nullable を維持する。
4. `provider=stub` から実 adapter へ移行してもフィールド名は互換維持する。
