# GitHub Issue read-only 契約 (H3-1)

## Motivation
- Business Context を推定のみから実データ参照へ進めるため、先に契約を固定する。
- UI統合前に、application層で provider-agnostic な境界を用意する。

## 契約
- Port: `IssueContextProvider`（`src/server/application/ports/issue-context-provider.ts`）
- 現在対応する参照: `provider: "github"` + `owner/repository/issueNumber`
- 返却レコード:
  - 識別: provider, owner, repository, issueNumber
  - 本文: title, body
  - 状態: `open | closed`
  - メタデータ: labels, author, htmlUrl, updatedAt

## Adapter 方針
- `StubIssueContextProvider`
  - ローカルで決定的なテストデータを返す
  - ネットワーク非依存
- `GitHubIssueContextProvider`
  - `GET /repos/{owner}/{repo}/issues/{number}` を利用
  - Issues APIが返す pull request payload を除外
  - `404` は `null`（未存在）として扱い、それ以外の非2xxはエラー

## 差し替え境界
- application / service は `IssueContextProvider` のみを参照する。
- 実装差し替えは composition root で行う。
- live provider 統合前でも既存 stub business-context は維持可能。

## Non-Goals
- UI統合
- Issue の作成/更新など write-back
- 複数code hostの具体実装（本Issueでは契約下地のみ）
