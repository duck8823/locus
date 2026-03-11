# 実PRフィクスチャ（TypeScript parser 回帰テスト）

> English: [README.md](README.md)

このフィクスチャは、このリポジトリの実際のコミット履歴から抽出した before/after ペアです。  
synthetic だけに依存せず、実運用に近い差分で parser 回帰を確認するために使います。

## フィクスチャ元

1. `set-workspace-locale-action.before.ts.txt` / `set-workspace-locale-action.after.ts.txt`
   - 参照コミット: `37d2437187bae19206238d9833f0b448eeeeb060`
   - 変更テーマ: redirect-path 検証強化（`\\` バイパス拒否）

2. `start-github-demo-session-action.before.ts.txt` / `start-github-demo-session-action.after.ts.txt`
   - 参照コミット: `13e9fb4eb253c57a8fbd619999e20ce371e94a2f`
   - 変更テーマ: GitHub demo エラーコードの構造化リファクタ

このフィクスチャを使う回帰テスト:
- `src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts`
