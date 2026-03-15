# AIレビュー運用フロー

> English: [ai-review-workflow.md](ai-review-workflow.md)

このリポジトリでは、実装PRに対して以下のAIレビュー運用を使います。

1. まず **Draft PR** を作成する。
2. Gemini で一次レビューを行い、ブロッカーを解消する。
3. PR を Ready に変更する。
4. `@codex review` コメントで Codex レビューを依頼する。
5. Codex 指摘を反映し、指摘がなくなるまで再依頼する。
6. CI とレビューが通ったらマージする。

OAuth/token/data-handling に影響するPRでは、次も必須です。

- [`セキュリティレビュー・チェックリスト`](security-review-checklist.ja.md)
- PR description の Security セクション記入

## Codex環境の前提

Codex が次のメッセージを返した場合:

> To use Codex here, create an environment for this repo.

これはリポジトリに Codex environment が未設定であることを意味します。

リポジトリ管理者が Codex 設定で environment を作成してください。

- URL: `https://chatgpt.com/codex/settings/environments`
- `duck8823/locus` 用の environment を作成
- PR で `@codex review` を再実行

この設定がない状態では、Codex はPRレビューコメントを返せません。

## 最低限のマージ条件

- CI (`Lint / Typecheck / Unit / Build`, `E2E Smoke`) が成功
- Gemini のブロッカー指摘を解消
- Codex のブロッカー指摘を解消（または指摘なし）
- 連携影響変更では Security checklist を完了
