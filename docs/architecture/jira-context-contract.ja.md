# Jira issue-tracker read-only 契約 (H2-2)

> English: [jira-context-contract.md](jira-context-contract.md)

## 目的

Jira issue-tracker adapter の provider 非依存境界を定義し、capability flags と typed diagnostics を明示する。

## スコープ

- review context 拡張のための read-only issue 検索
- transient / terminal を分けた typed error 契約
- GitHub / Confluence / Jira の差分を表現できる capability flags モデル
- 既存 business-context diagnostics フィールドへの fallback マッピング
- OAuth bearer / Jira API token basic の認証方式取り扱い

非対象:
- Jira issue の作成/更新/遷移
- workflow automation や status 同期

## Port 契約

対象ファイル:
- `src/server/application/ports/jira-context-provider.ts`

```ts
interface JiraIssueContextRecord {
  provider: "jira"
  issueKey: string
  title: string
  summary: string | null
  url: string
  status: string | null
  updatedAt: string
}

interface JiraContextProvider {
  searchIssuesForReviewContext(input: {
    reviewId: string
    repositoryName: string
    branchLabel: string
    title: string
    accessToken: string | null
  }): Promise<JiraIssueContextRecord[]>
}
```

## エラー契約

- `JiraContextProviderTemporaryError`（`retryable=true`）
- `JiraContextProviderPermanentError`（`retryable=false`）

どちらも integration-failure 分類に基づく正規化 `reasonCode` を保持する。

## fallback 診断マッピング

Jira 取得が workspace context 読み込みに参加する場合、診断は既存 business-context フィールドへ写像する。

- `diagnostics.status`
- `diagnostics.retryable`
- `diagnostics.reasonCode`
- `diagnostics.message`
- `diagnostics.occurredAt`
- `diagnostics.cacheHit`
- `diagnostics.fallbackReason`

## Capability flags モデル

対象ファイル:
- `src/server/application/services/requirement-context-capabilities.ts`

```ts
interface RequirementContextCapabilityFlags {
  supportsIssueLinks: boolean
  supportsSpecPages: boolean
  supportsTaskTickets: boolean
  supportsLiveFetch: boolean
  supportsCandidateInference: boolean
}
```

provider 既定値:

- GitHub: issue links + live fetch + candidate inference
- Confluence: spec pages のみ（read-only）
- Jira: issue links + task tickets（read-only baseline）

このモデルは加算的に拡張でき、presentation DTO の破壊的変更を不要にする。

## Presentation 境界

- Jira 固有フィールド（`issueKey`, `status`）は adapter 契約内に閉じる。
- presentation 層 DTO は `sourceType/status/confidence` の provider 非依存セマンティクスを維持する。
- capability flags は application service で解決し、presentation 契約へ直接埋め込まない。

## 参照実装

対象ファイル:
- `src/server/infrastructure/context/jira-readonly-context-provider.ts`

挙動:
- read-only `/rest/api/3/search` を実行する
- issue 応答を正規化 record へマッピングする
- Jira の ADF description を summary テキストへ平坦化する
- `bearer` / `basic` の authorization scheme をサポートする
- 失敗を reason code 付き temporary/permanent typed error へ分類する

## テスト

対象ファイル:
- `src/server/infrastructure/context/jira-readonly-context-provider.test.ts`
- `src/server/application/services/requirement-context-capabilities.test.ts`

カバレッジ:
- マッピング成功、retryable/terminal failure 分類
- provider 別 capability flag 差分
- capability object の clone 保証（mutation 安全性）
