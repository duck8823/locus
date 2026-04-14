# ADR 0005: Locus を Rust + Slint ネイティブアプリに作り直し、AI 連携は内蔵 Terminal ペインに委譲する

> English: [0005-rust-slint-native-rewrite.md](0005-rust-slint-native-rewrite.md)

- Status: Accepted
- Date: 2026-04-15

## Context

当初の Locus プロトタイプ（ADR 0002、ADR 0003）は Web SaaS 形態を前提に、Next.js + TypeScript の上に layered server を同居させる構成でした。その形態のために以下の装備が必要でした。

- guardrail / prompt version / コスト見積もり付きの LLM provider adapter
- OAuth トークン暗号化と接続遷移監査
- リトライと stale-running 検知付きの耐久分析ジョブキュー
- capability policy 付きの Plugin SDK
- マルチコードホスト adapter（GitHub / GitLab / 将来の Bitbucket）

しかし実際の使われ方は **「AI Agent CLI と同居する個人用ローカル Viewer」** に収束しました。ユーザーの手元ではすでに Claude Code / Codex / Gemini がターミナルで動いています。Locus 側で LLM provider に認証し、プロンプトテンプレートを管理し、コスト上限を設けて監査ログを永続化する必要はありません。選んだ Agent CLI 側がすべて持っていますし、Locus 内部の adapter 層よりも速く進化します。

SaaS 向けの重装備は、得られる価値に見合わないコストに変わってしまいました。

加えて、プロトタイプでのセマンティック diff 実装経験から技術面での 2 つの嗜好が明確になりました。

1. **`tree-sitter` が多言語セマンティック diff の正解**。TypeScript 側の `tree-sitter` バインディングは動いたものの、Rust ネイティブの `tree-sitter` エコシステムの方が直接的で、対象言語（Go、TypeScript、Rust、Python、Dart、GDScript 等）を広くカバーしています。
2. **AI Agent との受け渡しは HTTP ではなく PTY が本質**。Locus の価値は「整形済みプロンプト（ファイル・行・diff 断片・コメント）を組み立て、ユーザーが使っている Agent に渡すこと」にあります。Web アプリ内部でネットワーク境界を介して仲介するのは、レイテンシと設定項目が増えるだけで得るものがありません。

## Decision

Locus を **Rust + Slint ネイティブアプリ**として作り直し、初期は **macOS** を対象とします。以下の設計コミットメントに従います。

### 1. 形態

- Rust + Slint バイナリをデスクトップアプリとして配布
- macOS 優先。Linux / Windows は最初のリリースでは明示的に対象外
- アプリ内 Web サーバーなし、HTTP 認証なし、既定で永続化 DB なし

### 2. AI 連携を Terminal ペインに委譲する

- Locus は **LLM を自前で呼ばない**
- Slint 内蔵の Terminal ペイン（`alacritty_terminal` + `portable-pty`）で Agent CLI を子プロセスとして起動する（Claude Code / Codex / Gemini をユーザーが選択）
- Viewer は PR・diff・コメント選択から整形済みプロンプトを組み立て、**PTY に書き込む**だけ
- 認証・プロバイダ選択・コスト管理・レート制限・会話履歴・レビュー記憶はすべて Agent CLI 側にある
- 本方針を支える PoC は [#197](https://github.com/duck8823/locus/pull/197) で合流し、[#198](https://github.com/duck8823/locus/pull/198) でリポジトリ root に昇格した

### 3. セマンティック diff は `tree-sitter` で

- 最初の対象言語: **Go**（`tree-sitter-go` は公式・高品質）
- [ADR 0004](0004-semantic-change-ir.ja.md) の parser-adapter + 共通 Semantic Change IR 境界は維持する。移動するのは具体 adapter 実装のみ（TypeScript → Rust）
- 新しい言語は同じ IR 境界の裏側に `tree-sitter-*` crate を差し替えるだけで追加できる

### 4. 明示的に捨てるもの

- LLM provider adapter 層（heuristic / `openai_compat` / guardrail / prompt template）
- AI suggestion の監査・redaction policy・永続化
- 耐久分析ジョブキューとリトライポリシー
- OAuth トークン暗号化、接続遷移監査、OAuth start / callback フロー
- Plugin SDK と capability policy
- GitLab / Bitbucket コードホスト adapter
- マーケティングページ、サインインフロー、SaaS オンボーディング導線

いずれも SaaS 形態では本当に意味のあった装備ですが、「Agent CLI と同居するローカル Viewer」という現実には合わず、保守予算を消費するだけになっていました。

### 5. 明示的に残すもの

- **プロダクトの芯**: アーキテクチャマップ + セマンティック diff + ビジネスロジックコンテキスト + 「確認」ではなく「理解」
- [ADR 0001](0001-prototype-first-mvp.ja.md) prototype-first な進め方
- [ADR 0004](0004-semantic-change-ir.ja.md) parser-adapter + Semantic Change IR 境界（実装は移るが抽象は動かない）
- `docs/architecture/semantic-analysis-pipeline.*` にまとめた思想

## Consequences

### ポジティブ

- SaaS インフラの大半が消え、長期保守コストが大幅に下がる
- Rust の `tree-sitter` はセマンティック diff と直接的に噛み合う
- PTY 経由の Agent 委譲により、Claude Code / Codex / Gemini の改善をそのまま享受できる
- ローカル完結なので OAuth トークンストレージ・暗号鍵・監査保存期間・プロバイダレート制限の政治から完全に解放される
- `tree-sitter-go` に絞ることで、実在する Go プロジェクト（ユーザー自身のもの）でセマンティック diff UX を検証してから言語を広げられる

### ネガティブ

- ホスト型マルチユーザーレビューの可能性は、もう一度作り直さない限り放棄する
- コントリビューターは Rust + Slint の知識が必要になる。TypeScript + Next.js 時代の貢献者がそのまま移行できるわけではない
- macOS 優先のため、Linux / Windows ユーザーは最初のリリースでは一切使えない
- ターミナルエミュレータ（`alacritty_terminal`）の埋め込みは難度が高く、ANSI / キーボード / リサイズ / フォーカスなど継続的な保守源になる
- アプリ内 LLM 体験を *好む* ユーザー層は他ツールに譲ることになる

### 可逆性

- この作り直しは形態の hard fork であってプロダクトアイデアの hard fork ではない。判断が誤りだった場合、Next.js プロトタイプは `legacy/nextjs` ブランチ（force push / 削除保護済み）から再開できる
- `tree-sitter` + Semantic Change IR 境界はホスト言語非依存なので、将来再度ホスト言語を変える場合でも parser 戦略を考え直す必要はない

## 他 ADR との関係

- [ADR 0001 — Prototype-first MVP](0001-prototype-first-mvp.ja.md): 有効。本 ADR 自体が prototype-first な動きである（「PTY 経由の Agent 委譲が正しい受け渡しか」を SaaS より安くローカルバイナリで検証する）
- [ADR 0002 — Web-first + Next.js](0002-web-first-nextjs-typescript.ja.md): 本 ADR により **superseded**
- [ADR 0003 — Layered server architecture](0003-layered-server-architecture.ja.md): 本 ADR により **superseded**。レイヤ責務の原則は Rust 版のモジュール構成を考える際の参考にはなり得るが、新規作業を規範的には拘束しない
- [ADR 0004 — Parser-adapter + Semantic Change IR](0004-semantic-change-ir.ja.md): 有効。変わるのは具体 adapter 実装のみ

## 備考

本 ADR は、PoC (#197) と Next.js 資産削除 (#198) がすでに `main` に合流した後に遡及的に記述しました。それらの PR を規範的にゲートするためではなく、その PR 群が従った決定を記録するためのものです。
