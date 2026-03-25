/**
 * PermissionRequest フック用フィルタースクリプト
 * ユーザーが実際にUIボタンをクリックする必要がある操作のみ音声通知する
 *
 * 修正: voicevox-notify.ps1 を spawnSync で呼び出す（確実に音が鳴る）
 */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

// 音声通知をスキップするツール（Claudeが自動的に呼ぶもの・読み取り専用）
const SKIP_TOOLS = new Set([
  "mcp__voicevox__speak",
  "mcp__zundamon_ui__update_status",
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoRead",
  "WebSearch",
  "WebFetch",
]);

// voicevox-notify.ps1 のパス（このスクリプトと同じディレクトリ）
const PS1_PATH = path.join(__dirname, "voicevox-notify.ps1");

async function readStdin() {
  let data = "";
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 4096) break;
    }
  } catch {}
  return data;
}

async function main() {
  const stdinData = await readStdin();

  let event = {};
  try {
    event = JSON.parse(stdinData);
  } catch {}

  const toolName = event.tool_name || "";

  // スキップ対象ツールは無視
  if (SKIP_TOOLS.has(toolName)) {
    process.exit(0);
  }

  // mcp__ で始まるツールは基本スキップ（自動MCP呼び出し）
  if (toolName.startsWith("mcp__")) {
    process.exit(0);
  }

  // voicevox-notify.ps1 を同期実行（完了まで待つ）
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle", "Hidden",
      "-File", PS1_PATH,
      "-Text", "\u8a31\u53ef\u3092\u6c42\u3081\u3066\u3044\u308b\u306e\u3060\u3001\u78ba\u8a8d\u3057\u3066\u307b\u3057\u3044\u306e\u3060",
    ],
    { stdio: "ignore" }
  );

  process.exit(0);
}

main().catch(() => process.exit(0));
