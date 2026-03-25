# バックログ

## 既知の問題・改善候補

### 🟡 PermissionRequest の音声通知が `allow` リストを考慮しない

**概要**
`PermissionRequest` フックはClaude Codeの `permissions.allow` チェックより前に発火するため、
`allow` に登録済みで実際にはダイアログが表示されない操作でも音声通知が鳴ってしまう。

**詳細**
- `Bash(git config:*)` など `settings.local.json` の `allow` に入っているBashコマンドは
  ボタンなしで自動承認されるが、`permission-notify.js` はBash全般を通知対象にしているため音が鳴る
- MCP ツールや読み取り専用ツールはすでに `SKIP_TOOLS` でフィルター済み

**対応案**
`permission-notify.js` に `~/.claude/settings.json` と `settings.local.json` の
`permissions.allow` リストを読み込み、マッチする操作をスキップするロジックを追加する。
ただし allow パターンが `Bash(git config:*)` のようなワイルドカード形式のため、
パターンマッチングの実装が必要でやや複雑。

**優先度**: 低（実用上は許容範囲）

---

## 完了済み

- [x] 文字化け修正（start.bat の日本語コメントをASCIIに変更）
- [x] PermissionRequest フックで音が鳴らないバグ修正（detached PowerShell → spawnSync に変更）
- [x] GitHubへの公開・他PCデプロイ用 setup.js 作成
- [x] コントリビューターが MinineHUB になっていた問題を修正（git config を MinineAI に更新）
