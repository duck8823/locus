# Locus へのコントリビュート

> English: [CONTRIBUTING.md](CONTRIBUTING.md)

Locus は現在、macOS 向け Rust + Slint ネイティブアプリとして作り直し中です。旧 Next.js プロトタイプは `legacy/nextjs` ブランチに保全されています。新規のコントリビューションは Rust 版に対して行ってください（旧版の保守調整を伴う場合は事前に合意してください）。

## 作業方針

- 曖昧さを減らせる薄い縦切りの変更を優先する。
- アーキテクチャ判断は `docs/adr/` に明示的に残す。
- プロバイダ固有実装の直書きより、parser / integration の抽象化を優先する。
- 暫定スパイクを長期的な基盤選定と誤認させない。

## 今ほしいコントリビューション

- セマンティック diff / アーキテクチャマップの具体化
- parser adapter 境界の整理
- issue 分解やレビューシナリオの具体化

## リポジトリ構成

- `README.md` / `README.ja.md` — プロダクト概要
- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint 本体
- `docs/adr/` — アーキテクチャ判断
- `docs/architecture/` — prototype から継承したアーキテクチャメモ
- `docs/mvp.md` / `docs/mvp.ja.md` — 過去 MVP スコープ参照
- `CONTRIBUTING.md` / `CONTRIBUTING.ja.md` — コントリビューション方針

## 変更ポリシー

以下の変更を行う前には、必ず ADR を新規作成または更新してください。

- 長期的な parser family を固定する
- parser abstraction strategy を置き換える
- Terminal ペイン / AI agent との受け渡しコントラクトを変更する
- `docs/mvp.md` / `docs/mvp.ja.md` で定義した MVP スコープを広げる

## Pull Request チェックリスト

- [ ] スコープが現行マイルストーンまたは承認済み ADR に一致している
- [ ] 日英の両ドキュメントが必要に応じて整合している
- [ ] 言語別ファイル間の導線が必要に応じて更新されている
- [ ] 方針変更があれば README / docs も更新している
- [ ] `cargo build` / `cargo clippy --all-targets` / `cargo test` がローカルで通っている
- [ ] AI レビューループ（Gemini scout + Codex verifier）を完了している、または実施不能理由を記録している
