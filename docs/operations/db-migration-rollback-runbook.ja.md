# DB移行 / ロールバック ランブック（プロトタイプストア → 本番DB）

> English: [db-migration-rollback-runbook.md](db-migration-rollback-runbook.md)

運用ドキュメント一覧: [README.ja.md](README.ja.md)

## 目的

Locus の永続化をローカルプロトタイプストア（`.locus-data` + SQLite）から本番用リレーショナルDBへ移行するための、実行可能な運用手順とロールバック手順を定義する。

本ランブックは [production-baseline.ja.md](production-baseline.ja.md) の移行フェーズを具体化する。

## 対象範囲

対象:
- review sessions
- analysis jobs
- connection state / transitions
- OAuth pending states
- 暗号化済み connection token records

非対象:
- ベンダー固有のプロビジョニング詳細（managed Postgres の種類や IaC）
- ADR未確定のアプリスキーマ設計判断

## 役割と責任

| 役割 | 責任 |
| --- | --- |
| Migration Commander | 全体進行と go/no-go 判断 |
| Data Operator | スナップショット、バックフィル、検証実行 |
| App Operator | feature flag 適用とカットオーバー実施 |
| Incident Scribe | 時系列・証跡の記録 |

## 事前条件

- [ ] 対象コミットで CI が green。
- [ ] オンコール連絡先とエスカレーション先が周知済み。
- [ ] DB read/write cutover 用 feature flag が用意済み。
- [ ] スナップショット保管先と保持期間が合意済み。

## 実施手順

### Step 0 — スナップショットと凍結

1. 大規模再解析など write-heavy な運用を一時停止。
2. `.locus-data` をスナップショット化:
   - `connection-state.sqlite`
   - `connection-state.sqlite-wal`（存在時）
   - `connection-state.sqlite-shm`（存在時）
3. スナップショットの checksum と保管先を記録。

保全する証跡:
- スナップショット名 / checksum
- 実施者 / UTC時刻

### Step 1 — スキーマ移行（冪等）

1. 本番DB migration script を実行。
2. 同 migration script を再実行し、冪等性を確認。
3. schema version と実行結果を記録。

実施可否基準:
- migration が2回とも成功
- schema version が想定どおり

### Step 2 — バックフィル投入（冪等）

1. file store から投入:
   - `.locus-data/review-sessions/*.json`
   - `.locus-data/analysis-jobs/jobs.json`
   - `.locus-data/oauth/pending-states.json`
   - `.locus-data/connection-tokens/*.json`
2. SQLite から投入:
   - `connection_states`
   - `connection_state_transitions`
3. 1回再実行して重複副作用がないことを確認。

実施可否基準:
- 2回目実行で想定外差分が発生しない

### Step 3 — 整合検証

1. ドメイン別の件数一致確認。
2. payload サンプルの hash/checksum 一致確認。
3. token 機微項目が at-rest 暗号化を維持していることを確認。
4. mismatch レポートを記録（空、または承認済み waiver）。

実施可否基準:
- 件数不一致 0、または Migration Commander 承認済み waiver

### Step 4 — Read shadowing

1. DB read-shadow mode を有効化。
2. 1リリースサイクル、DB と legacy の読み取り結果差分を比較。
3. mismatch 比率と原因内訳を記録。

実施可否基準:
- サイクル内で mismatch 比率が閾値以下

### Step 5 — 段階カットオーバー

1. feature flag で production DB を primary read/write に切替。
2. 観測期間中は legacy rollback 経路を維持。
3. [slo-alert-taxonomy.ja.md](slo-alert-taxonomy.ja.md) のアラートを監視。

実施可否基準:
- 観測期間中、未解決 MUST インシデントなし

### Step 6 — Legacy 廃止

1. legacy スナップショットをアーカイブ。
2. 休眠 legacy write path を無効化/除去。
3. 復旧ドリル手順を参照可能状態で保持（本書の「ロールバック手順」節 + [production-baseline.ja.md](production-baseline.ja.md) の Phase 5）。

## ロールバック手順（Step 4以降で適用）

トリガー例:
- mismatch の継続的増加
- auth/token 整合性の退行
- データ欠損/破損の兆候

ロールバック手順:
1. production DB path への新規書き込みを凍結。
2. feature flag を legacy primary read/write に戻す。
3. legacy path で workspace/reanalysis/OAuth が正常動作することを確認。
4. production DB 側証跡（ログ、失敗行、mismatch）を保全。
5. [incident-response-runbook.ja.md](incident-response-runbook.ja.md) に従ってインシデント記録。

完了条件:
- legacy path でユーザー向けフローが安定
- rollback 理由と follow-up owner が記録済み

## オペレーター用チェックリスト（転記テンプレート）

移行チケットに以下を転記:

- [ ] Step 0 snapshot 完了（artifact + checksum 記録）
- [ ] Step 1 schema migration 冪等性確認
- [ ] Step 2 backfill 冪等性確認
- [ ] Step 3 verification mismatch レポート添付
- [ ] Step 4 read-shadow メトリクス記録
- [ ] Step 5 cutover 完了（中止時は理由記録）
- [ ] rollback 状態記録（未実施なら不要）
- [ ] incident / follow-up issue を紐付け
