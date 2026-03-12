# Plugin SDK 契約 (H5-1 / H5-2)

> English: [plugin-sdk-contract.md](plugin-sdk-contract.md)

## 目的

manifest / lifecycle / capability の最小契約を固定し、障害隔離可能なランタイムモデルを定義する。

## コア契約

定義場所:
- `src/server/application/plugins/plugin-sdk.ts`

### Manifest
- `pluginId`: 一意ID
- `displayName`: 表示名
- `version`: plugin バージョン
- `sdkVersion`: 現在 `1`
- `capabilities[]`: 実装能力の宣言

現時点の capability:
- `pull-request-snapshot-provider`
  - `provider`: code host 識別子（`github`, `sample` など）

### Lifecycle
- `activate(context)` は必須
  - context には `AbortSignal` と runtime logger を含む
- activate の戻り値:
  - capability 実装
  - 任意の `deactivate()` フック

### バリデーション規則
- manifest の必須項目は非空であること
- capability 宣言は重複不可
- activation result は宣言済み capability をすべて実装すること
- 未宣言 capability は拒否する

## Runtime 挙動

定義場所:
- `src/server/infrastructure/plugins/plugin-runtime.ts`

挙動:
- plugin module をロードし、manifest/activation result を検証
- provider 単位で capability を登録
- 同一 provider の重複登録は skip
- 実行時エラー（認証系を除く）で plugin を無効化し `deactivate` を呼び、本体プロセスは継続

## サンプル plugin

定義場所:
- `src/server/infrastructure/plugins/sample/sample-codehost-plugin.ts`

目的:
- 最小 provider（`provider: "sample"`）で SDK の実装可能性を検証
- 依存を持たないシンプルな実装を維持

## 互換性ポリシー（初版）

- 破壊的変更は `PLUGIN_SDK_VERSION` の major 更新を必須とする。
- 同一 major 内では加法的変更を許容する。
- runtime は未知/不正 capability を決定的に reject する。
