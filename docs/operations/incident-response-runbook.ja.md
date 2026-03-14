# インシデント対応ランブック: Context / Reanalysis Reliability

> English: [incident-response-runbook.md](incident-response-runbook.md)

## 目的

以下の障害に対して、オンコールが再現可能な手順で対応できるようにする。
- live business-context 取得失敗
- reanalysis queue の劣化・ジョブ失敗連鎖

対象は MVP（ローカル / file-backed）運用と内部ドッグフーディング。

## 初動（最初の5分）

1. 影響範囲を確定
   - 単一 review か、複数 review か
   - context のみか、queue のみか、両方か
2. 証跡を保全
   - 発生時刻前後のサーバーログ
   - 影響 `reviewId`, `jobId`, `reasonCode`
3. 診断値で分類
   - `timeout`, `network`, `rate_limit`, `auth`, `not_found`, `upstream_5xx`, `client_error`, `unknown`
4. 下表に対応する mitigation を実施
5. 収束判定前に smoke check を再実行

## reasonCode マトリクス（運用の正準）

| reasonCode | Retryable | 典型症状 | 一次対応 |
|---|---:|---|---|
| `timeout` | Yes | API timeout / abort | リトライ維持、上流遅延確認 |
| `network` | Yes | DNS/接続/リセット障害 | ネットワーク経路確認、復旧後リトライ |
| `rate_limit` | Yes | 429 / スロットリング | バックオフ、同時トリガ抑制 |
| `upstream_5xx` | Yes | provider 5xx | 上流状態監視、バックオフ付き再試行 |
| `auth` | No | 401/403, scope不足 | OAuth再接続・scope確認 |
| `not_found` | No | 404 issue/PR 不存在 | 参照先の妥当性を修正 |
| `client_error` | No | auth以外の4xx | リクエスト契約不整合を修正 |
| `unknown` | No | 分類不能エラー | 終端扱いで証跡付きエスカレーション |

## Playbook A: Business-context fallback 障害

### 症状
- Workspace の business context が fallback 表示に切り替わる。
- `business_context_fallback` ログが `reasonCode` 付きで出る。

### 診断
1. 対象 workspace で以下を確認
   - `businessContext.diagnostics.retryable`
   - `businessContext.diagnostics.reasonCode`
   - `businessContext.diagnostics.fallbackReason`
2. ログ確認
   - `business_context_fallback`
   - `Live business-context fetch failed`
3. `reasonCode=auth` の場合は OAuth scope/token 状態を確認

### Mitigation
- `timeout` / `network` / `rate_limit` / `upstream_5xx`
  - 自動リトライを維持し、上流/ネットワーク健全性を確認
- `auth`
  - GitHub OAuth を再接続し、issue-read scope（`repo` 等）が付与されていることを確認
- `not_found`
  - PR context の issue 参照を修正
- `client_error` / `unknown`
  - 無条件リトライを止め、入力/エラー証跡を添えて調査

### Rollback / 封じ込め
- fallback provider は維持し、workspace 読み込み自体は止めない。
- 直近リリース起因なら直前版へロールバックし、fallback挙動を再確認。

## Playbook B: Reanalysis queue 劣化障害

### 症状
- queue health が `degraded`。
- `analysis_queue_health_degraded`, `analysis_job_retry_scheduled`, `analysis_job_failed` が出る。

### 診断
1. queue signal を確認
   - queued/running/stale/failed 件数
   - latest failed job metadata
2. 失敗ログ確認
   - `analysis_job_failed` の `reasonCode`
3. 失敗が transient か terminal かを確定

### Mitigation
- Transient（`timeout`/`network`/`rate_limit`/`upstream_5xx`）
  - bounded retry を維持、トリガ集中を抑制、上流健全性を確認
- Terminal（`auth`/`not_found`/`client_error`/`unknown`）
  - 根本原因修正まで再試行しない（実装上も fail-fast）
  - `auth`: token/scope 復旧後に再キュー
  - `not_found`: 参照先修正後に再キュー

### Rollback / 封じ込め
- デプロイ起因なら直前版へロールバック。
- 手動クリーンアップ前に queue state とログを保全。

## 復旧確認チェック（post-mitigation）

リポジトリルートで実行:

```bash
npm run lint
npm run typecheck
npm run test
PLAYWRIGHT_PORT=3000 npm run test:e2e
```

その後に確認:
- workspace がクラッシュせず開く
- context fallback 診断（`retryable` + `reasonCode`）が整合する
- 影響 review の queue health が回復する

## クローズアウト記録テンプレート

- 発生〜収束時刻（UTC）:
- 影響範囲（review数 / ユーザー）:
- 主因 reasonCode:
- 実施 mitigation:
- rollback 実施有無:
- フォローアップ Issue:
