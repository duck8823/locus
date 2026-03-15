# AI提案 Audit + Redaction ポリシー

> English: [ai-suggestion-audit-redaction-policy.md](ai-suggestion-audit-redaction-policy.md)

## 目的

AI提案生成時の prompt メタデータ記録方法と、ログ/アーティファクトでの機微情報 redaction 方針を定義する。

## Audit メタデータ契約

各 AI提案生成は workspace DTO の `aiSuggestionAudit` に以下を返す:

- `requestedMode`: env で要求された provider mode（`heuristic` / `openai_compat`）
- `provider`: 実際に提案生成に使われた provider
- `fallbackProvider`: 決定論的 fallback provider
- `promptTemplateId`: 安定したテンプレート識別子
- `promptVersion`: 解決済み prompt version
- `generatedAt`: payload 生成時刻
- `redactionPolicyVersion`: 適用中の redaction ポリシーバージョン

これにより、機微な生payload本文を保持せずに prompt-template/version とのトレースを可能にする。

## Redaction ポリシー（v1）

ポリシーバージョン: `ai_suggestion_redaction.v1`

以下の free-text を redaction 対象とする:
- review title / branch label
- semantic symbol名 / signature / summary / location
- architecture label / group・file path label
- business context の title / summary / href
- AI suggestion の headline / recommendation / rationale（ログ/アーティファクト用途）

以下の構造情報は保持する:
- ID、enum、count、status/confidence
- repository name（ルーティング/診断用途）

## 適用ポイント

- 実行時エラーログ（`ai_suggestion_provider_failed`）には:
  - audit metadata
  - redaction済み payload snapshot
- fixture 評価アーティファクトには:
  - audit ブロック
  - redaction済み payload snapshot

## 非対象

- 本ポリシー文書での runtime telemetry 全体暗号化
- データ保持期間やアクセス制御ポリシーの置換
