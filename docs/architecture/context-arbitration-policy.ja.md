# 要件コンテキスト競合解決ポリシー (H2-3)

> English: [context-arbitration-policy.md](context-arbitration-policy.md)

## 目的

複数のコンテキスト provider から重複した要件候補が返る場合に、決定的（deterministic）な選択ルールを定義する。

## スコープ

- 重複候補に対する arbitration の優先順位
- 運用観測向け conflict reason code 契約
- composition/application 層での裁定責務（presentation 層で分岐しない）

非スコープ:
- provider ごとの fetch 実装詳細
- diagnostics 消費を超える UI 表示仕様

## 実装境界

- Service: `src/server/application/services/arbitrate-business-context-candidates.ts`
- Composition 利用箇所: `src/server/infrastructure/context/live-business-context-provider.ts`

presentation DTO は、解決済みアイテムと diagnostics を受け取るだけに留める。

## 候補選択の優先順位

同じ dedupe key に属する候補は、次の順で優先度を判定する。

1. Confidence 優先（`high` > `medium` > `low`）
2. Source freshness（`updatedAt` が新しい方）
3. Provider 優先（`github` > `jira` > `confluence` > `stub`）
4. Status 優先（`linked` > `candidate` > `unavailable`）
5. Stable tie-breaker（`candidateId` の辞書順）

## Conflict reason codes

arbitration は diagnostics に次の reason code を出力する。

- `confidence_priority`
- `freshness_priority`
- `provider_priority`
- `status_priority`
- `stable_tie_breaker`

これらは観測性のための付加情報であり、presentation 契約の形を壊さない。
