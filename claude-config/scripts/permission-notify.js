/**
 * PermissionRequest フック用フィルタースクリプト
 * ユーザーが実際にUIボタンをクリックする必要がある操作のみ音声通知する
 */

const http = require("http");
const https = require("https");

// 音声通知をスキップするツール（Claudeが自動的に呼ぶもの）
const SKIP_TOOLS = new Set([
  // MCP tools called automatically by Claude
  "mcp__voicevox__speak",
  "mcp__zundamon_ui__update_status",
  // Read-only / safe tools
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoRead",
  "WebSearch",
  "WebFetch",
]);

// 音声通知を行うツール（ユーザーのクリックが必要）
const NOTIFY_TOOLS = new Set([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Agent",
]);

async function readStdin() {
  let data = "";
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      data += chunk;
    }
  } catch {}
  return data;
}

async function playVoicevox(text) {
  return new Promise((resolve) => {
    try {
      const encoded = encodeURIComponent(text);
      const queryReq = http.request(
        {
          hostname: "localhost",
          port: 50021,
          path: `/audio_query?text=${encoded}&speaker=3`,
          method: "POST",
        },
        (queryRes) => {
          let body = "";
          queryRes.setEncoding("utf8");
          queryRes.on("data", (chunk) => (body += chunk));
          queryRes.on("end", () => {
            try {
              // synthesis
              const bodyBytes = Buffer.from(body, "utf8");
              const synthReq = http.request(
                {
                  hostname: "localhost",
                  port: 50021,
                  path: `/synthesis?speaker=3`,
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Content-Length": bodyBytes.length,
                  },
                },
                (synthRes) => {
                  const chunks = [];
                  synthRes.on("data", (c) => chunks.push(c));
                  synthRes.on("end", () => {
                    // WAVを一時ファイルに保存してPowerShellで再生
                    const wav = Buffer.concat(chunks);
                    const os = require("os");
                    const path = require("path");
                    const fs = require("fs");
                    const tmp = path.join(os.tmpdir(), `zunda_${Date.now()}.wav`);
                    fs.writeFileSync(tmp, wav);

                    const { spawn } = require("child_process");
                    const ps = spawn(
                      "powershell",
                      [
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        `$p = New-Object System.Media.SoundPlayer('${tmp}'); $p.PlaySync(); $p.Dispose(); Remove-Item '${tmp}' -ErrorAction SilentlyContinue`,
                      ],
                      { detached: true, stdio: "ignore" }
                    );
                    ps.unref();
                    resolve();
                  });
                  synthRes.on("error", resolve);
                }
              );
              synthReq.on("error", resolve);
              synthReq.write(bodyBytes);
              synthReq.end();
            } catch {
              resolve();
            }
          });
        }
      );
      queryReq.on("error", resolve);
      queryReq.end();
    } catch {
      resolve();
    }
  });
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

  // 通知対象ツール、またはその他未分類のツールは通知
  // （未分類はユーザーが判断できるよう通知する）
  await playVoicevox("許可を求めているのだ、確認してほしいのだ");

  process.exit(0);
}

main().catch(() => process.exit(0));
