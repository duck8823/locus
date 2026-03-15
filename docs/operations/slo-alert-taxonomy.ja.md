# SLOダッシュボード基準とアラート分類

> English: [slo-alert-taxonomy.md](slo-alert-taxonomy.md)

運用ドキュメント一覧: [README.ja.md](README.ja.md)

## 目的

本番ロールアウト時に Locus を安全運用するための、最小 SLO ダッシュボード構成とアラート分類を定義する。

本ドキュメントは、現行アーキテクチャ/ランブックに存在する（または明示的に計画済みの）運用シグナルを対象とする。

## サービスレベル指標（SLI）基準

| SLI | 対象 | 計測ソース | 補足 |
| --- | --- | --- | --- |
| Workspace load success rate | review workspace API/read path | API成功/失敗ログ + synthetic smoke | クライアント描画崩れは除外 |
| Reanalysis completion rate | analysis queue job lifecycle | `analysis.job.*` イベント | retryable / terminal を分離 |
| Reanalysis p95 duration | ジョブ完了までのE2E遅延 | queue lifecycle events | 継続劣化傾向を監視 |
| Business-context live fetch success rate | live issue-context fetch | `business_context_fallback` と成功ログ | fallback利用率を可視化 |
| OAuth callback success rate | OAuth pending-state consume flow | oauth issue/consume イベント + callback エラー | scope/auth 退行の早期検知 |

## 初期 SLO 目標（ベースライン）

初期値は保守的な暫定値であり、本番実測に応じて更新する。

- Workspace load success rate: **>= 99.0%**（30日ローリング）
- Reanalysis completion rate: **>= 97.0%**（30日ローリング）
- Reanalysis p95 duration: **<= 120秒**（7日ローリング）
- Business-context live fetch success rate: **>= 95.0%**（30日ローリング）
- OAuth callback success rate: **>= 99.5%**（30日ローリング）

## アラート分類

重大度マッピング:
- **P1**: 大きなユーザー影響またはデータ整合性リスク
- **P2**: 継続的な部分劣化
- **P3**: 非クリティカルだが追跡が必要な異常

| Alert key | 重大度 | 初期トリガー基準 | 想定アクション |
| --- | --- | --- | --- |
| `workspace-load-success-drop` | P1 | success rate < 95% が10分継続 | インシデント開始 + rollback 判断 |
| `reanalysis-terminal-failure-spike` | P1 | terminal failure rate > 10% が15分継続 | トリガ集中抑制 + 原因切り分け |
| `reanalysis-p95-latency-degraded` | P2 | p95 > 180秒 が30分継続 | capacity/queue 診断と緩和 |
| `business-context-fallback-spike` | P2 | fallback 比率 > 20% が15分継続 | upstream/network/auth 診断 |
| `oauth-callback-failure-spike` | P1 | callback failure rate > 5% が10分継続 | auth flow インシデント対応 |
| `webhook-signature-rejection-spike` | P2 | rejection count が baseline の3倍超で10分継続 | secret/config/security 点検 |
| `audit-ingestion-gap` | P2 | 重要監査イベントが15分以上無発火 | telemetry pipeline 復旧 |
| `queue-stale-job-growth` | P3 | stale running jobs が30分増加 | worker 健全性確認 + cleanup 計画 |

`audit-ingestion-gap` 発火時は、次の順で切り分ける:
1. アプリ側ログ emitter 健全性（クラッシュ/再起動ループ有無）
2. アプリ→保管先間の log shipper/collector 健全性
3. 取り込み先 ingestion endpoint の可用性と認証状態

## ダッシュボード最小パネル

最低限、以下を構成する:

1. Workspace load success/error rate（5分/1時間）
2. Reanalysis queue:
   - queued/running/stale/failed 件数
   - completion rate / terminal failure rate
   - p50/p95 duration
3. Business-context live fetch success と fallback 比率
4. OAuth callback success/failure と主要 reason code
5. Webhook signature rejection 件数
6. 監査イベント取り込み heartbeat

## オンコール連携

アラート発火時:

- [incident-response-runbook.ja.md](incident-response-runbook.ja.md) に従う
- reason-code matrix で transient/terminal を分類
- クローズ時に timeline/blast radius/follow-up issue を記録

## レビュー周期

- 週次: ノイズ多発・低シグナルアラートを見直し閾値調整
- 月次: 実運用データで SLO 目標を再評価し本書を更新
- リリースゲート: 本番 cutover 前に dashboard/alert 配線を確認
