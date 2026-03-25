// Claude Code フックから呼ばれるステータス更新スクリプト
// 使い方: node status-update.js --status working
// stdinにClaudeのフックイベントJSON（tool_nameなど）が来る
"use strict";

const http = require("http");

// ツール名 → 日本語メッセージ
const TOOL_MESSAGES = {
  Edit:        "\u30d5\u30a1\u30a4\u30eb\u3092\u7de8\u96c6\u4e2d\u306a\u306e\u3060",     // ファイルを編集中なのだ
  Write:       "\u30d5\u30a1\u30a4\u30eb\u3092\u66f8\u304d\u8fbc\u307f\u4e2d\u306a\u306e\u3060",  // ファイルを書き込み中なのだ
  Read:        "\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u306a\u306e\u3060",  // ファイルを読み込み中なのだ
  Bash:        "\u30b3\u30de\u30f3\u30c9\u3092\u5b9f\u884c\u4e2d\u306a\u306e\u3060",     // コマンドを実行中なのだ
  Glob:        "\u30d5\u30a1\u30a4\u30eb\u3092\u691c\u7d22\u4e2d\u306a\u306e\u3060",     // ファイルを検索中なのだ
  Grep:        "\u30b3\u30fc\u30c9\u3092\u691c\u7d22\u4e2d\u306a\u306e\u3060",           // コードを検索中なのだ
  Agent:       "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u3092\u8d77\u52d5\u4e2d\u306a\u306e\u3060", // エージェントを起動中なのだ
  WebSearch:   "\u30a6\u30a7\u30d6\u3092\u691c\u7d22\u4e2d\u306a\u306e\u3060",           // ウェブを検索中なのだ
  WebFetch:    "\u30da\u30fc\u30b8\u3092\u53d6\u5f97\u4e2d\u306a\u306e\u3060",           // ページを取得中なのだ
  TodoWrite:   "\u30bf\u30b9\u30af\u3092\u6574\u7406\u4e2d\u306a\u306e\u3060",           // タスクを整理中なのだ
  NotebookEdit:"\u30ce\u30fc\u30c8\u3092\u7de8\u96c6\u4e2d\u306a\u306e\u3060",           // ノートを編集中なのだ
};

const DEFAULT_WORKING = "\u4f5c\u696d\u4e2d\u306a\u306e\u3060";  // 作業中なのだ
const DEFAULT_IDLE    = "\u5f85\u6a5f\u4e2d\u306a\u306e\u3060";  // 待機中なのだ

async function main() {
  // コマンドライン引数からステータスを取得
  const args = process.argv.slice(2);
  let status = "idle";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--status" && args[i + 1]) {
      status = args[i + 1];
    }
  }

  // stdin からフックイベントを読み込む
  let stdinRaw = "";
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinRaw += chunk;
      if (stdinRaw.length > 4096) break; // 過大なデータは打ち切る
    }
  } catch {}

  // メッセージを決定
  let message = status === "working" ? DEFAULT_WORKING : DEFAULT_IDLE;

  if (status === "working" && stdinRaw.trim()) {
    try {
      const event = JSON.parse(stdinRaw);
      const toolName = event.tool_name || event.toolName;
      if (toolName && TOOL_MESSAGES[toolName]) {
        message = TOOL_MESSAGES[toolName];
      } else if (toolName) {
        // 未定義ツールは名前をそのまま使う（文字数制限）
        const short = toolName.length > 20 ? toolName.slice(0, 20) : toolName;
        message = `${short}\u3092\u5b9f\u884c\u4e2d\u306a\u306e\u3060`; // を実行中なのだ
      }
    } catch {}
  }

  // HTTP サーバーの /api/update を叩く
  const body = Buffer.from(JSON.stringify({ status, message }), "utf8");
  await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 3456,
        path: "/api/update",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": body.length,
        },
        timeout: 2000,
      },
      (res) => { res.resume(); resolve(); }
    );
    req.on("error", resolve);
    req.on("timeout", () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

main().catch(() => process.exit(0));
