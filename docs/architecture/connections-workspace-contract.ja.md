# Connections Workspace 契約

> English: [connections-workspace-contract.md](connections-workspace-contract.md)

## 目的

実際の OAuth 実装に入る前に、`/settings/connections` のサーバー→UI契約を固定する。

これにより、インフラ実装がスタブ段階でも provider の状態モデルを明示的に検証できる。

## スコープ

- 設定画面で使う connection catalog の形
- provider / status / authMode の意味
- 後方互換を保った拡張ルール

非スコープ:
- 本番向け資格情報の暗号化保存 / キーローテーション
- リフレッシュトークン運用（自動更新ワークフロー）
- マルチテナントの資格情報管理

## 現行 DTO 契約

```ts
export interface ConnectionsWorkspaceTransitionDto {
  transitionId: string
  previousStatus: string
  nextStatus: string
  changedAt: string
  reason: "manual" | "token-expired" | "webhook"
  actorType: "reviewer" | "system"
  actorId: string | null
  connectedAccountLabel: string | null
}

export interface ConnectionsWorkspaceConnectionDto {
  provider: "github" | "confluence" | "jira"
  status: string
  authMode: "oauth" | "none"
  statusUpdatedAt: string | null
  connectedAccountLabel: string | null
  stateSource: "catalog_default" | "persisted"
  capabilities: {
    supportsWebhook: boolean
    supportsIssueContext: boolean
  }
  recentTransitions: ConnectionsWorkspaceTransitionDto[]
  recentTransitionsTotalCount: number
  recentTransitionsHasMore: boolean
}

export interface ConnectionsWorkspaceDto {
  generatedAt: string // ISO-8601 UTC timestamp
  connections: ConnectionsWorkspaceConnectionDto[]
}
```

`generatedAt` は、そのリクエストでサーバーが catalog snapshot を生成した時刻を示す。

## 意味ルール

### `provider`

- ローカライズしない安定した機械キー
- UI 文言参照や将来の provider 別アクション判定に使用
- locale が変わっても同一値を維持する

### `status`

- `not_connected`: モデル上は利用可能だが、まだ接続されていない
- `planned`: このフェーズでは意図的に未提供
- `connected`: 対象 reviewer の OAuth 接続が完了している
- `reauth_required`: 既存接続が再認証を要求している
- 将来の未知値はそのまま透過し、UI 側フォールバックで安全に表示する

### `authMode`

- `oauth`: 本番では OAuth 接続を前提とする provider
- `none`: 認証連携を持たない provider

### `stateSource`

- `catalog_default`: provider カタログ既定値から解決された状態
- `persisted`: reviewer 単位の永続化状態から解決された状態

### `capabilities`

- `supportsWebhook`: provider からの inbound update を受け取れる
- `supportsIssueContext`: issue/spec 文脈を review に付与できる

### `recentTransitions`

- provider ごとの最新状態遷移を時刻降順で返す
- 状態の変化と、その時点で有効だった接続アカウント名を保持する
- prototype 段階のトラブルシュートと観測性向上を目的とする

### `reason`

- `manual`: 設定画面からの手動変更で発生した遷移
- `token-expired`: トークン有効性チェックにより発生した遷移
- `webhook`: provider の Webhook 入力により発生した遷移

### `actorType` / `actorId`

- `actorType` は遷移主体（`reviewer` / `system`）を表す
- `actorId` はレビュアー識別子またはシステムソース識別子を保持する
- `actorType=reviewer` では、未指定時に reviewerId を補完する

### `recentTransitionsTotalCount` / `recentTransitionsHasMore`

- `recentTransitions` は UI 可読性のためページングされる
- `recentTransitionsTotalCount` は provider 単位・フィルター適用後の総件数
- `recentTransitionsHasMore` は次ページの有無を示す

## 多言語化の責務境界

provider/status/auth の表示ラベルは presentation (`src/app/**`) 側でローカライズする。
DTO 値自体は言語非依存のまま維持する。

## 拡張ポリシー

この契約を拡張するときは以下を守る:

1. enum 値は加算的に追加する。
2. 既存値の意味を壊さない。
3. UI 側で未知の将来値にフォールバック表示を持つ。
4. infrastructure をつなぐ前に DTO / use case のテストを追加する。

## 現在のプロトタイプ実装範囲

- read path は provider の既定値と reviewer 単位の永続化状態をマージして返す。
- write path は `SetConnectionStateUseCase` + `setConnectionStateAction` で制御された状態遷移を扱う。
- 状態遷移は reason / actor 付きで reviewer 単位の監査履歴として保存する。
- 遷移履歴は SQLite 側で保持件数を圧縮する（`LOCUS_CONNECTION_TRANSITION_MAX_RETAINED`, 既定 200）。
- provider metadata は `ConnectionProviderCatalog` port と prototype adapter 経由で解決する。
- 接続状態の永続化は SQLite ベースに移行し、legacy の file record は遅延移行で読み込む。
- GitHub OAuth の start / callback ルートは file-backed repository に pending state と token を保存し、OAuth クライアント設定が無い場合はローカル demo fallback で接続動作を検証できる。
- 接続トークンの永続化は機密フィールドを AES-256-GCM で暗号化して保存し、鍵フォーマット検証を厳格化している。
- 鍵ローテーション向けに key ring をサポートする:
  - `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS`（カンマ区切り）を優先
  - 先頭鍵で暗号化し、全鍵で復号する
  - 既存の `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY` も後方互換で利用可能

## 次のステップ

1. 本番向けに managed key 配布（KMS/secret manager 連携）を追加する。
2. リフレッシュトークンのライフサイクル管理と自動再認証回復を追加する。
