# 本番運用ベースライン（移行 / 監視 / セキュリティ）

> English: [production-baseline.md](production-baseline.md)

## 目的

Issue #75 に向け、現行プロトタイプの永続化と運用を、より安全な本番運用へ段階的に移行するための最小ベースラインを定義する。

## 前提 / 非対象

前提:
- 現行ランタイムは `.locus-data` 配下のファイルストアと一部 SQLite を利用している。
- 本番では managed relational DB（例: PostgreSQL）への集約が有力である。
- 本番環境ではログ/メトリクスの集中管理が利用可能である。

非対象:
- ベンダー選定、IaC の詳細、最終 SLO 値は本ドキュメントで固定しない。
- SOC 2 / ISO 27001 の完全な証跡要件は対象外とする。

## 現行の永続化ベースライン

| ドメイン | 現行ストレージ | 補足 |
|---|---|---|
| Review sessions | `.locus-data/review-sessions/*.json` | review単位のファイル保存 |
| Analysis jobs | `.locus-data/analysis-jobs/jobs.json` | ファイルベースのキュー兼履歴 |
| Connection states | `.locus-data/connection-state.sqlite` | 現行の主ストア。旧ファイルから lazy migration あり |
| Legacy connection states | `.locus-data/connection-states/*.json` | オンデマンド読込される旧形式 |
| OAuth pending states | `.locus-data/oauth/pending-states.json` | ファイルベース state ストア |
| Connection tokens | `.locus-data/connection-tokens/*.json` | 機密項目は AES-256-GCM で暗号化 |

## 段階DB移行計画（File/SQLite → Production DB）

### Phase 0: 棚卸しとバックアップ固定

1. `.locus-data` をスナップショット化（SQLite の WAL/SHM も含む）。
2. ドメイン別に件数を記録する。
3. ロールバック用アーティファクト保管場所と責任者を決める。

完了条件:
- 非本番で 1 回以上、復元手順を検証済み。

### Phase 1: ターゲットスキーマとアダプタ整備

1. 現行レコードと等価なテーブルを production DB に定義する。
2. 既存 port の背後に新アダプタを追加する。
3. この段階では legacy を正とし、新DBは shadow write で検証する。

完了条件:
- スキーマ migration が冪等。
- legacy/new 双方で write-path テストが通る。

### Phase 2: バックフィルと整合確認

1. 次の入力源から冪等インポートを実行:
   - file stores（`review-sessions`, `analysis-jobs`, `oauth`, `connection-tokens`）
   - SQLite（`connection_states`, `connection_state_transitions`）
2. 件数一致とサンプルハッシュを記録する。
3. 再実行して重複副作用が出ないことを確認する。

完了条件:
- 件数不一致が 0（例外は明示的に承認）。

### Phase 3: 読み取りシャドー運用

1. shadow mode で production DB 読み取りを実行する。
2. legacy 読み取り結果との差分をイベントとして記録する。
3. 差分傾向が許容されるまで、ユーザー応答は legacy を正とする。

完了条件:
- 合意した期間で mismatch 率が閾値以下。

### Phase 4: 段階カットオーバー

1. feature flag で production DB を primary read/write に切り替える。
2. 一定期間は legacy へのロールバック経路を維持する。
3. 安定確認後に legacy write を凍結する。

完了条件:
- カットオーバー期間中に未解決 MUST インシデントがない。

### Phase 5: legacy 廃止

1. legacy ファイル/SQLite スナップショットをアーカイブする。
2. 休眠した legacy write パスを削除する。
3. アーカイブからの復旧手順を残す。

完了条件:
- アーカイブ復旧ドリルが成功。

## 監視 / 監査の必須イベント

全イベント共通の最小項目:
- `eventId`, `eventName`, `occurredAt`（ISO-8601 UTC）
- `environment`, `requestId`（取得可能時）
- `actorType`, `actorId`（または `null`）
- 関連時は `reviewId` / `provider`
- `outcome`（`success` / `failure`）と `errorCode`（失敗時）

必須イベント:

| イベント名 | 発火条件 | 追加必須項目 |
|---|---|---|
| `analysis.job.scheduled` | 再解析ジョブを受理 | `jobId`, `reason`, `queuedAt` |
| `analysis.job.started` | ワーカーがジョブ開始 | `jobId`, `attempt`, `startedAt` |
| `analysis.job.succeeded` | ジョブ成功終了 | `jobId`, `durationMs`, `completedAt` |
| `analysis.job.failed` | ジョブ実行失敗 | `jobId`, `attempt`, `durationMs`, `errorCode` |
| `analysis.job.retry_queued` | 失敗後に再キュー化 | `jobId`, `nextAttempt` |
| `analysis.job.stale_recovered` | stale running ジョブを復旧 | `jobId`, `staleThresholdMs` |
| `review.reanalysis.requested` | 手動/APIで再解析要求 | `reviewId`, `requestedAt` |
| `review.reanalysis.completed` | 再解析結果を保存 | `reviewId`, `snapshotPairCount` |
| `review.reanalysis.failed` | 再解析が終端失敗 | `reviewId`, `errorCode` |
| `connection.state.changed` | 連携状態遷移を保存 | `transitionId`, `provider`, `previousStatus`, `nextStatus`, `reason` |
| `oauth.state.issued` | OAuth pending state 作成 | `provider`, `reviewerId`, `expiresAt` |
| `oauth.state.consumed` | OAuth callback で state 消費 | `provider`, `reviewerId` |
| `webhook.signature.rejected` | Webhook署名検証失敗 | `provider`, `sourceIpHash` |
| `authz.denied` | 認可ルールで拒否 | `resource`, `action` |

## セキュリティ運用チェックリスト

### リリース前

- [ ] `GITHUB_WEBHOOK_SECRET` を secret manager 経由で設定（ハードコード禁止）。
- [ ] `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS` を順序付き key ring（先頭で暗号化、全キーで復号）として設定し、無停止ローテーションを可能にする。
- [ ] `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY` は後方互換・移行フォールバック用途に限定する。
- [ ] OAuth クライアント認証情報のローテーション責任者/期限を明記。
- [ ] CI 品質ゲート（`lint`, `typecheck`, `test`, `build`）が成功。

### 日次 / 常時

- [ ] analysis failure rate と retry loop を監視。
- [ ] webhook 署名拒否の急増を監視。
- [ ] OAuth pending state の異常増加を監視。
- [ ] 監査イベント取り込み停止（ギャップ長時間化）を監視。

### 週次 / 月次

- [ ] production DB バックアップ復元テストを実施。
- [ ] DB/ログ/シークレットの最小権限を見直し。
- [ ] 依存ライブラリとベースイメージの更新適用。
- [ ] 鍵/トークンローテーション履歴と未対応例外を確認。

### インシデント時の最低対応

- [ ] 流出疑いのある連携トークンを失効。
- [ ] 漏えい疑い時は暗号鍵 / webhook secret をローテーション。
- [ ] クリーンアップ前に必要監査ログを保全。
- [ ] 発生時系列・影響範囲・再発防止タスクを記録。
