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
- OAuth トークン保存
- provider callback handler
- マルチテナントの資格情報管理

## 現行 DTO 契約

```ts
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
- `persisted`: reviewer 単位の永続化状態（`.locus-data/connection-states`）から解決された状態

### `capabilities`

- `supportsWebhook`: provider からの inbound update を受け取れる
- `supportsIssueContext`: issue/spec 文脈を review に付与できる

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
- provider metadata は `ConnectionProviderCatalog` port と prototype adapter 経由で解決する。
- file-backed の状態ロードは record 形状を検証し、壊れた entry は安全にスキップする。

## 次のステップ

1. 状態遷移の監査履歴（誰が・いつ・なぜ）を追加し、運用時の追跡性を上げる。
2. file-backed 実装を本番用の永続化基盤へ置き換える。
3. prototype 前提の OAuth 表現を実トークン/コールバックフローに置き換える。
