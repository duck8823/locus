# セキュリティレビュー・チェックリスト（OAuth / Token / データ取り扱い）

> English: [security-review-checklist.md](security-review-checklist.md)

## 目的

認証・認可、トークン取り扱い、データ露出境界に関わるPRに対して、再現可能なレビューゲートを定義します。

以下のいずれかを変更するPRで使用してください。

- OAuth callback / token exchange / token persistence / token revocation ロジック
- credential の読み込み・暗号化・保存経路
- ユーザー/リポジトリデータを扱う外部API連携境界
- 機微情報が混入し得る log / metrics / error payload

## 必須チェック項目（連携影響PR）

OAuth/token/data-handling に影響があるPRでは、PR description で以下をすべて確認します。

1. **AuthN/AuthZ 境界レビュー**
   - scope/permission は最小権限になっている
   - 境界越えごとにサーバー側の認可チェックが明示されている
2. **Token ライフサイクルレビュー**
   - token を平文永続化していない
   - rotation/revocation 経路が維持されている
   - log / error payload に token 値が出ない
3. **データ露出レビュー**
   - request/response payload が必要に応じて redaction されている
   - analytics/audit artifact に secret・個人情報が漏れない
4. **障害時挙動レビュー**
   - fallback/error handling で auth gate を迂回しない
   - retry/timeout で権限付き副作用を重複実行しない
5. **Sign-off**
   - merge 前に担当レビュアーが security セクションへ署名する

## 重大度分類

セキュリティ指摘は以下を既定分類として扱います。

| 重大度 | 意味 | 既定の扱い |
| --- | --- | --- |
| Critical | credential 露出、auth bypass、権限昇格、遠隔悪用可能な経路 | merge ブロック。即時修正必須 |
| Major | scope gate 不備、機微情報の過剰露出リスク、現実的悪用経路のある unsafe fallback | 原則 merge ブロック（owner 明示承認時のみ例外） |
| Minor | 直ちに悪用されにくい hardening ギャップ | 追跡Issueを作成した上で merge 可 |

指摘を waiver する場合は以下を必ず記録してください。

- rationale（理由）
- owner
- tracking issue / PR
- remediation 予定日

## 自動サニティチェック

ローカル/CI で `npm run security:sanity` を実行してください。現時点の自動チェックは次のとおりです。

- `.env*` の追跡ファイルを禁止（`.env.example` / `.env.sample` / `.env.template` は許可）
- 既知の高リスクtokenパターン（GitHub PAT / OpenAI key-like / AWS access key-like / Slack token-like）を追跡テキストファイルから走査

このチェックは最低限の安全網であり、手動レビューの代替ではありません。

