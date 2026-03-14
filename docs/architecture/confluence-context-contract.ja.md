# Confluence read-only コンテキスト契約 (H2-1)

> English: [confluence-context-contract.md](confluence-context-contract.md)

## 目的

Confluence 由来の要件/仕様コンテキストを取得する境界を定義し、**presentation DTO に Confluence 固有詳細を漏らさない**。

## スコープ

- read-only 取得のみ（作成/更新/書き戻しは対象外）
- Confluence adapter の input/output/typed error 契約
- workspace business-context 診断との fallback 連携

非対象:
- Confluence OAuth 導線
- 双方向同期や承認フロー

## Port 契約

対象ファイル:
- `src/server/application/ports/confluence-context-provider.ts`

```ts
interface ConfluencePageContextRecord {
  provider: "confluence"
  pageId: string
  spaceKey: string | null
  title: string
  summary: string | null
  url: string
  updatedAt: string
}

interface ConfluenceContextProvider {
  searchPagesForReviewContext(input: {
    reviewId: string
    repositoryName: string
    branchLabel: string
    title: string
    accessToken: string | null
  }): Promise<ConfluencePageContextRecord[]>
}
```

## エラー契約

Adapter 失敗は typed error に正規化する。

- `ConfluenceContextProviderTemporaryError`
  - `retryable = true`
  - 例: timeout/network/429/upstream 5xx
- `ConfluenceContextProviderPermanentError`
  - `retryable = false`
  - 例: auth失敗/not-found/non-retryable client error

どちらも integration-failure 分類由来の `reasonCode` を保持する。

## fallback 診断のマッピング

Confluence 取得失敗時は、既存の business-context 診断契約へ以下を写像する。

- `diagnostics.status`
- `diagnostics.retryable`
- `diagnostics.reasonCode`
- `diagnostics.message`
- `diagnostics.occurredAt`
- `diagnostics.cacheHit`
- `diagnostics.fallbackReason`

これにより UI 側は provider 非依存で扱える。

## 参照実装

対象ファイル:
- `src/server/infrastructure/context/confluence-readonly-context-provider.ts`

挙動:
- review metadata から read-only CQL を構築
- Confluence 応答を正規化ページレコードへ変換
- 失敗を temporary/permanent の typed error へ分類

## テスト

対象ファイル:
- `src/server/infrastructure/context/confluence-readonly-context-provider.test.ts`

カバレッジ:
- base URL 未設定時は空結果
- Confluence 応答のマッピング成功
- retryable failure -> temporary typed error
- terminal failure -> permanent typed error
