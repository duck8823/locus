# AI提案品質ゲート運用ポリシー

> English: [ai-suggestion-quality-gate-policy.md](ai-suggestion-quality-gate-policy.md)

## 目的

Issue #138 に向けて、fixtureメンテナンス手順を固定し、CI品質ゲート変更を監査可能かつ意図的に保つ。

## 対象

以下に適用する:
- `scripts/fixtures/ai-suggestion-evaluation/*.json`
- `scripts/export-ai-suggestion-evaluation-artifacts.mjs`
- `docs/performance/ai-suggestion-evaluation-format*.md`

## 更新ルール

1. **1 issue 1 PR**
   - fixture更新・閾値変更・ハーネスロジック変更は、PRのmotivationで追跡可能にする。
2. **Why now（motivation）必須**
   - PR description に「どの品質リスクを下げるか / どの新しいシグナルを取るか」を明記する。
3. **閾値緩和を黙って行わない**
   - `min-useful-rate-percent` 引き下げ、`max-false-positive-rate-percent` 引き上げは、明示的理由とレビュー承認を必須とする。
4. **回帰根拠を必ず添付**
   - PRノートに before/after の summary 指標と fixture差分を記載する。
5. **EN/JA同時更新**
   - fixture意味論や閾値変更時は英語・日本語ドキュメントを同一PRで更新する。

## fixture/閾値変更時のPRチェックリスト

- [ ] motivation がユーザー影響または品質影響を説明している
- [ ] `npm run ai:suggest:evaluate:artifact` の出力（summary + fixture table）をPRに添付
- [ ] 変更したfixtureに expectedUseful/expectedFalsePositive の理由がある
- [ ] 閾値変更時に理由とレビュー確認を記録している
- [ ] 関連ドキュメントを EN/JA 両方更新している

## 非対象

- リポジトリ横断のベンチマーク順位付け
- 単一スカラー指標だけで人間レビューを置き換えること
