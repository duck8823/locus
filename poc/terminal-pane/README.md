# locus PoC — Terminal Pane

Slint + alacritty_terminal + portable-pty で AI Agent CLI を同居させる Terminal ペインの実現性検証。

詳細: https://github.com/duck8823/locus/issues/194

## 実行

```bash
cargo run -- claude
# 任意のコマンドを試す
cargo run -- bash
```

## スコープ

含む: PTY 起動 / セルグリッド描画 / キー入力 / リサイズ追従
含まない: 色解決 / スクロールバック / マウス選択 / GitHub 連携
