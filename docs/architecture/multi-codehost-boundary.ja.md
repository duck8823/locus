# Multi-codehost 境界ハードニング (H5-3)

> English: [multi-codehost-boundary.md](multi-codehost-boundary.md)

## 目的

GitHub 固有の暗黙前提を段階的に減らし、既存挙動を壊さずに code host 拡張点を明示化する。

## Port レベル変更

対象ファイル:
- `src/server/application/ports/pull-request-snapshot-provider.ts`

追加した概念:
- `PullRequestSourceRef`（provider-agnostic な参照）
- `PullRequestSnapshotProviderContract<TSource>`
- 後方互換 alias:
  - `PullRequestSnapshotProvider = PullRequestSnapshotProviderContract<GitHubPullRequestRef>`

これにより現行 GitHub 呼び出しを維持したまま、非 GitHub provider を plugin/runtime 経由で差し込める。

## Adapter 境界

- GitHub 固有実装は `src/server/infrastructure/github/*` に閉じ込める。
- GitLab read-only adapter は `src/server/infrastructure/gitlab/*` に配置し、merge request 変更を共通 snapshot pair へ変換する。
- provider-agnostic router は `src/server/infrastructure/code-host/*` に配置する。
- API 詳細や parse ロジックを application 契約へ漏らさない。
- plugin runtime で provider 追加を capability 登録として扱える。

## Composition flag

- `LOCUS_ENABLE_GITLAB_ADAPTER=true` で composition 上の GitLab adapter ルートを有効化する。
- 既定は無効で、現行 GitHub ingestion フローには影響しない。
- `LOCUS_GITLAB_API_BASE_URL` で GitLab API ベース URL を上書きできる（既定: `https://gitlab.com/api/v4`）。
- `GITLAB_TOKEN` は public repository では任意、private project ではトークンアクセスが必要。
- 無効/未対応 provider は generic error ではなく typed diagnostics（`PullRequestProviderUnsupportedCapabilityError`）を返す。

## 安全策

- `source.provider` で provider 識別を明示。
- capability 未登録時は `PluginCapabilityUnavailableError` を返す。
- capability 実行失敗時は該当 plugin のみ無効化し、本体停止を回避する。

## この段階の非対象

- GitLab の UX 導線や webhook/OAuth の本実装
- Bitbucket の本実装
- plugin マーケットプレイスや自動探索
- 本番での hot reload

## 現在のオーケストレーション適用範囲

- `ReviewSessionSource` は code-host として `github` / `gitlab` を第一級で扱う。
- 非同期解析オーケストレーションは provider-agnostic snapshot provider 経由で GitLab source の review session を処理できる。
- OAuth 再認証状態遷移は引き続き GitHub 認証失敗時に限定して扱う。

