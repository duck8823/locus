# Locus へのコントリビュート

> English: [CONTRIBUTING.md](CONTRIBUTING.md)

Locus はまだプロトタイプ段階です。現時点の目標は、フル機能のホスト型プロダクトへ投資する前に、レビュアー体験の価値を検証することです。

## 作業方針

- プロダクト価値を検証できる、薄い縦切りの変更を優先する。
- アーキテクチャ判断は `docs/adr/` に明示的に残す。
- プロバイダ固有実装を直書きするのではなく、パーサー / 連携の抽象化を優先する。
- 現在の parser / 実装言語は、ADR で明示的に確定するまで暫定扱いにする。
- semantic diff の回帰を直したら、必ず対応するテストを追加する。

## ローカル開発

```bash
npm install
npm run build
npm test
```

現在の CLI プロトタイプを 2 つのソースファイルに対して実行する例:

```bash
npm run semantic-diff -- path/to/before.ts path/to/after.ts
```

JSON 出力は `--json` で利用できます。

## リポジトリ構成

- `docs/` — プロダクト方針とアーキテクチャ判断
- `packages/semantic-diff` — parser contract の背後にある現在の実行可能 semantic-diff スパイク

## 変更ポリシー

以下の変更を行う前には、必ず ADR を新規作成または更新してください。

- パーサー戦略を置き換える
- 長期的な parser family または実装言語を固定する
- 新しい永続化レイヤーを導入する
- GitHub ingestion を diff engine に直接結合する
- `docs/mvp.md` / `docs/mvp.ja.md` で定義した MVP スコープを広げる

## Pull Request チェックリスト

- [ ] スコープが現行 MVP または承認済み ADR に一致している
- [ ] `npm run build` が通る
- [ ] `npm test` が通る
- [ ] 振る舞いが変わる場合は README / docs も更新している
