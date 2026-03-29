/**
 * PermissionRequest フック — 危険操作はWeb UIで承認、安全操作は自動承認
 *
 * 危険パターン (CRITICAL_PATTERNS) に一致した場合のみ:
 *   1. HTTP POST でずんだもんコンパニオン UI に通知
 *   2. ユーザーがブラウザで [許可] or [拒否] をクリックするまでポーリング待機
 *   3. 結果を stdout に出力 → Claude Code が続行/中止
 *
 * UIサーバーが起動していない場合は従来の音声警告にフォールバック。
 * 安全な操作は変更なし（即座に自動承認）。
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const UI_BASE = "http://localhost:3456";
const POLL_INTERVAL_MS = 600;
const TIMEOUT_MS = 60000;
const PS1_PATH = path.join(__dirname, "voicevox-notify.ps1");

// ===== ツール名で判断する「絶対に自動承認しない」リスト =====
// ExitPlanMode: プランモードから実行フェーズへの移行承認（ユーザー確認必須）
const NEVER_AUTO_APPROVE_TOOLS = new Set([
  "ExitPlanMode",
]);

// ===== 危険パターン（Bash コマンド用） =====
const CRITICAL_PATTERNS = [
  /git\s+push\s+.*(?:--force|-f)(?:\s|$)/i,
  /git\s+reset\s+--hard/i,
  /git\s+rebase\s+.*(?:--onto|--exec)/i,
  /git\s+clean\s+.*-[a-z]*f/i,
  /rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i,
  /del\s+\/[sf]/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM\s+\w+\s*(?:;|$)/i,
  /TRUNCATE\s+TABLE/i,
  /kill\s+-9/i,
  /--dangerously/i,
];

function isCritical(toolName, input) {
  // ツール名で絶対ブロック
  if (NEVER_AUTO_APPROVE_TOOLS.has(toolName)) return true;

  if (toolName === "Bash") {
    const cmd = (input && input.command) ? input.command : "";
    return CRITICAL_PATTERNS.some((re) => re.test(cmd));
  }
  return false;
}

// ===== HTTP ユーティリティ =====
function httpPostFast(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = http.request(
      { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
        method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => { res.resume(); resolve(true); }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

function httpPost(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = http.request(
      { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
        method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request(
      { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ===== ポーリング =====
async function pollDecision(id) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await httpGet(`${UI_BASE}/api/permission/poll/${id}`);
    if (result && result.decision !== null && result.decision !== undefined) {
      return result.decision; // "allow" | "deny"
    }
  }
  return null; // タイムアウト
}

// ===== 音声警告（同期・フォールバック用） =====
function playWarningVoiceSync() {
  try {
    spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", PS1_PATH,
       "-Text", "\u8b66\u544a\uff01\u5371\u967a\u306a\u64cd\u4f5c\u306e\u8a31\u53ef\u3092\u6c42\u3081\u3066\u3044\u308b\u306e\u3060\u3001\u78ba\u8a8d\u3057\u3066\u307b\u3057\u3044\u306e\u3060"],
      { stdio: "ignore", timeout: 5000 }
    );
  } catch {}
}

// ===== 音声警告（非同期・ポーリング中に再生） =====
function playWarningVoiceAsync() {
  try {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", PS1_PATH,
       "-Text", "\u8b66\u544a\uff01\u5371\u967a\u306a\u64cd\u4f5c\u306e\u8a31\u53ef\u3092\u6c42\u3081\u3066\u3044\u308b\u306e\u3060\u3001\u78ba\u8a8d\u3057\u3066\u307b\u3057\u3044\u306e\u3060"],
      { stdio: "ignore", detached: true }
    );
    child.unref();
  } catch {}
}

async function readStdin() {
  let data = "";
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 8192) break;
    }
  } catch {}
  return data;
}

async function main() {
  const stdinData = await readStdin();
  let event = {};
  try { event = JSON.parse(stdinData); } catch {}

  const toolName = event.tool_name || "";
  const input = event.tool_input || {};
  const permissionMode = event.permission_mode || "";
  const sessionId = event.session_id || null;

  // プランモード中は一切自動承認しない（選択肢・承認ステップをスキップしないため）
  if (permissionMode === "plan") {
    process.exit(0);
  }

  // 安全な操作 → 音声通知（await、最大800ms）してから即時自動承認
  if (!isCritical(toolName, input)) {
    // process.exit() 前に await しないとリクエストが届かない
    await httpPostFast(`${UI_BASE}/api/permission/request`, {
      id: crypto.randomUUID(),
      tool_name: toolName,
      preview: "",
      sessionId,
      voiceOnly: true,
    });

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    }));
    process.exit(0);
  }

  // 危険操作 → Web UI に通知してポーリング
  const id = crypto.randomUUID();
  const preview = (input.command || JSON.stringify(input)).slice(0, 100);

  const posted = await httpPost(`${UI_BASE}/api/permission/request`, {
    id,
    tool_name: toolName,
    preview,
    sessionId,
  });

  if (!posted) {
    // UIサーバー未起動 → 従来の音声警告にフォールバック（同期・完了まで待つ）
    playWarningVoiceSync();
    process.exit(0);
  }

  // UI通知成功時も音声を再生（非同期・ポーリングをブロックしない）
  playWarningVoiceAsync();

  // ユーザーの応答を待つ
  const decision = await pollDecision(id);

  const behavior = (decision === "allow" || decision === "always") ? "allow" : "deny";
  const message = decision === null ? "Timeout (60s)" : decision === "deny" ? "User denied via web UI" : undefined;
  const out = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior } } };
  if (message) out.hookSpecificOutput.decision.message = message;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
