<div align="center">

# Locus

**「差分の確認」から、「変更の意味を理解するプロセス」へ。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-rewriting-orange.svg)]()
[![en](https://img.shields.io/badge/lang-en-blue.svg)](README.md)

</div>

---

## ステータス: Rust + Slint へゼロから作り直し中

Locus は macOS 向けの **ローカルネイティブアプリ** として Rust + Slint で作り直しています。旧 Next.js 版は [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) ブランチに保全されています（force push / 削除保護済み）。

進行中: [`v1.0: Rust/Slint rewrite` マイルストーン](https://github.com/duck8823/locus/milestone/10)

## なぜ作り直すのか

元の prototype は Web SaaS としての形態を目指しており、その形態のために重装備（LLM provider adapter + guardrail、OAuth トークン暗号化、耐久ジョブキュー、plugin capability policy 等）を抱えていました。実際の使い方は「AI agent CLI（Claude Code / Codex / Gemini）と同居する個人用ローカル Viewer」に収束したため、SaaS 向けの装備はすべて不要になりました。

ネイティブ版でも Locus の**芯**は引き継ぎます:

- **アーキテクチャマップ** — この変更はシステムのどこにあるのか
- **セマンティック Diff** — 関数・メソッド単位の変更を parser adapter + 共通 IR で
- **ビジネスロジックコンテキスト** — 変更を要件まで遡って繋ぐ
- **「確認」ではなく「理解」** — *なぜ* を中心に据える

そして Web SaaS 形態のためだけに存在していたものはすべて捨てます。

## 設計上の最大の転換: LLM を内蔵しない

新しい Locus は **LLM を自前で呼びません**。代わりに `alacritty_terminal` + `portable-pty` で Terminal ペインを内蔵し、その中で Claude Code / Codex / Gemini を子プロセスとして動かします。Viewer は PR・diff・コメント選択から整形済みプロンプトを組み立て、**Terminal ペインに流し込む**だけに徹します。認証・プロバイダ選択・コスト管理・会話履歴はすべて選んだ Agent CLI 側に委ねます。

## 主なスタック

- **Rust + Slint** — ネイティブ UI
- **`alacritty_terminal` + `portable-pty`** — Agent CLI を同居させる Terminal ペイン
- **`tree-sitter-go`**（最初の対象言語）— セマンティック Diff
- **`octocrab`** — GitHub PR スナップショット

`cargo run -- bash` で現在のビルドを起動し、Slint ウィンドウ内の Terminal ペインで対話シェルが動くことを確認できます。`claude` / `codex` / `gemini` に置き換えれば各 Agent CLI を同居させられます。

## 現在このリポジトリに残っているもの

- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint 本体（Terminal ペイン動作確認済み）
- `docs/adr/0001`, `docs/adr/0004` — 方法論と semantic-change-IR の思想（継承）
- `docs/architecture/semantic-analysis-pipeline.*` — parser adapter + IR の設計
- `docs/mvp.*` — 参照用の過去 MVP スコープ

それ以外の Next.js 時代のファイルは [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) にあります。

## ライセンス

MIT License — 正本は [LICENSE](LICENSE) を参照してください。日本語参考訳は [LICENSE.ja.md](LICENSE.ja.md) です。
