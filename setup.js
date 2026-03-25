/**
 * ずんだもんコンパニオン セットアップスクリプト
 * 新しいPCで `node setup.js` を実行すると Claude Code の設定が自動で行われます
 *
 * 実行内容:
 *   1. ~/.claude/settings.json に MCP サーバーとフックを追加
 *   2. claude-config/scripts/ → ~/.claude/scripts/ にコピー
 *   3. claude-config/CLAUDE-zundamon.md の内容を ~/.claude/CLAUDE.md に追記
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ---- パス定義 ----
const PROJECT_DIR    = __dirname;
const CLAUDE_DIR     = path.join(os.homedir(), ".claude");
const SETTINGS_PATH  = path.join(CLAUDE_DIR, "settings.json");
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, "CLAUDE.md");
const SCRIPTS_SRC    = path.join(PROJECT_DIR, "claude-config", "scripts");
const SCRIPTS_DEST   = path.join(CLAUDE_DIR, "scripts");

// Windows パス（バックスラッシュをエスケープ）
const PROJECT_DIR_WIN  = PROJECT_DIR.replace(/\//g, "\\");
const SCRIPTS_DEST_WIN = SCRIPTS_DEST.replace(/\//g, "\\");

function log(msg)  { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function step(msg) { console.log(`\n📌 ${msg}`); }

// ---- Step 1: settings.json の更新 ----
function updateSettings() {
  step("Claude Code settings.json を更新中...");

  // 既存の settings.json を読み込む（なければ空オブジェクト）
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    } catch {
      warn("settings.json の解析に失敗しました。新規作成します。");
    }
  }

  // mcpServers をマージ
  if (!settings.mcpServers) settings.mcpServers = {};

  settings.mcpServers.voicevox = {
    command: "npx",
    args: ["-y", "@t09tanaka/mcp-simple-voicevox"],
  };

  settings.mcpServers["zundamon-ui"] = {
    command: "node",
    args: [`${PROJECT_DIR_WIN}\\server\\index.js`, "--mcp"],
  };

  // hooks をマージ
  if (!settings.hooks) settings.hooks = {};

  const scriptNode = (script, status) =>
    `node "${SCRIPTS_DEST_WIN}\\${script}" --status ${status}`;

  settings.hooks.PreToolUse = [
    { matcher: "", hooks: [{ type: "command", command: scriptNode("status-update.js", "working"), async: true }] },
  ];
  settings.hooks.PostToolUse = [
    { matcher: "", hooks: [{ type: "command", command: scriptNode("status-update.js", "working"), async: true }] },
  ];
  settings.hooks.Stop = [
    { matcher: "", hooks: [{ type: "command", command: scriptNode("status-update.js", "idle"), async: true }] },
  ];
  settings.hooks.PermissionRequest = [
    { matcher: "", hooks: [{ type: "command", command: `node "${SCRIPTS_DEST_WIN}\\permission-notify.js"`, async: true }] },
  ];

  // 書き込み
  if (!fs.existsSync(CLAUDE_DIR)) fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
  log(`settings.json を更新しました: ${SETTINGS_PATH}`);
}

// ---- Step 2: スクリプトのコピー ----
function copyScripts() {
  step("スクリプトをコピー中...");

  if (!fs.existsSync(SCRIPTS_DEST)) {
    fs.mkdirSync(SCRIPTS_DEST, { recursive: true });
  }

  const files = fs.readdirSync(SCRIPTS_SRC);
  for (const file of files) {
    const src  = path.join(SCRIPTS_SRC, file);
    const dest = path.join(SCRIPTS_DEST, file);
    fs.copyFileSync(src, dest);
    log(`コピー完了: ${file} → ${dest}`);
  }
}

// ---- Step 3: CLAUDE.md への追記 ----
function updateClaudeMd() {
  step("CLAUDE.md を更新中...");

  const templatePath = path.join(PROJECT_DIR, "claude-config", "CLAUDE-zundamon.md");
  const template = fs.readFileSync(templatePath, "utf8");

  // 重複チェック
  const MARKER = "# 音声通知ルール（VOICEVOX / ずんだもん）";
  if (fs.existsSync(CLAUDE_MD_PATH)) {
    const existing = fs.readFileSync(CLAUDE_MD_PATH, "utf8");
    if (existing.includes(MARKER)) {
      warn("CLAUDE.md にずんだもんルールが既に存在します。スキップします。");
      return;
    }
    // 既存内容の末尾に追記
    fs.appendFileSync(CLAUDE_MD_PATH, "\n\n" + template, "utf8");
  } else {
    fs.writeFileSync(CLAUDE_MD_PATH, template, "utf8");
  }
  log(`CLAUDE.md を更新しました: ${CLAUDE_MD_PATH}`);
}

// ---- メイン ----
function main() {
  console.log("🎋 ずんだもんコンパニオン セットアップ開始なのだ！\n");
  console.log(`   プロジェクト: ${PROJECT_DIR}`);
  console.log(`   Claude設定先: ${CLAUDE_DIR}`);

  try {
    updateSettings();
    copyScripts();
    updateClaudeMd();

    console.log("\n✨ セットアップ完了なのだ！");
    console.log("\n次のステップ:");
    console.log("  1. Claude Code を再起動する");
    console.log("  2. VOICEVOX を起動する");
    console.log("  3. start.bat をダブルクリックしてコンパニオンを起動");
    console.log("  4. http://localhost:3456 をブラウザで開く\n");
  } catch (err) {
    console.error("\n❌ エラーが発生したのだ:", err.message);
    process.exit(1);
  }
}

main();
