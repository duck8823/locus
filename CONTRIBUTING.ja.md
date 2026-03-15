# Locus へのコントリビュート

> English: [CONTRIBUTING.md](CONTRIBUTING.md)

Locus は現在 documentation-first なリポジトリです。長期的な実装路線を固定する前に、プロダクトスコープ・アーキテクチャ境界・評価基準を揃えることを当面の目的にしています。

## 作業方針

- 曖昧さを減らせる薄い縦切りの変更を優先する。
- アーキテクチャ判断は `docs/adr/` に明示的に残す。
- プロバイダ固有実装の直書きより、parser / integration の抽象化を優先する。
- parser や実装言語の選定は、ADR で明示的に固定するまで暫定扱いにする。
- 暫定スパイクを長期的な基盤選定と誤認させない。

## 今ほしいコントリビューション

- MVP 定義の具体化
- ADR や判断基準の明確化
- 日英ドキュメント品質の改善
- plugin / parser / adapter 境界の整理
- issue 分解やレビューシナリオの具体化

## リポジトリ構成

- `README.md` / `README.ja.md` — プロダクト概要
- `docs/mvp.md` / `docs/mvp.ja.md` — MVP スコープと配送スライス
- `docs/adr/` — アーキテクチャ判断
- `docs/operations/` — レビュー/運用/セキュリティ関連ランブック
- `CONTRIBUTING.md` / `CONTRIBUTING.ja.md` — コントリビューション方針

## 変更ポリシー

以下の変更を行う前には、必ず ADR を新規作成または更新してください。

- 長期的な parser family を固定する
- 長期的な実装言語を固定する
- parser abstraction strategy を置き換える
- 永続化レイヤーを導入する
- GitHub ingestion を diff engine に直接結合する
- `docs/mvp.md` / `docs/mvp.ja.md` で定義した MVP スコープを広げる

## Pull Request チェックリスト

- [ ] スコープが現行 MVP または承認済み ADR に一致している
- [ ] 日英の両ドキュメントが必要に応じて整合している
- [ ] 言語別ファイル間の導線が必要に応じて更新されている
- [ ] 方針変更があれば README / docs も更新している
- [ ] AI レビューループ（Gemini + Codex）を完了している、または実施不能理由を記録している
- [ ] OAuth/token/data-handling に影響する場合、PR本文の Security checklist を完了している

## AIレビュー運用

以下を参照してください。

- [`docs/operations/ai-review-workflow.ja.md`](docs/operations/ai-review-workflow.ja.md)
- [`docs/operations/ai-review-workflow.md`](docs/operations/ai-review-workflow.md)
- [`docs/operations/security-review-checklist.ja.md`](docs/operations/security-review-checklist.ja.md)
- [`docs/operations/security-review-checklist.md`](docs/operations/security-review-checklist.md)
