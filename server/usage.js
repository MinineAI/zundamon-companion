const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const WINDOW_MS = 5 * 60 * 60 * 1000; // 5時間
const CACHE_TTL_MS = 60 * 1000;        // 1分キャッシュ
const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { sessionLimitTokens: 0 };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

// ── 固定スケジュールのアンカー ──────────────────────────────────────────────
// MAX5X プラン: 5hウィンドウは 19:00/00:00/05:00/10:00/15:00 UTC でリセット
// JST換算: 04:00/09:00/14:00/19:00/00:00 JST
// 2026-03-28 JST 04:00 にリセット確認済み → UTC 2026-03-27 19:00 をアンカーに設定
const ANCHOR_UTC_MS = Date.UTC(2026, 2, 27, 19, 0, 0); // 2026-03-27T19:00:00Z

// 現在時刻から「今の5hウィンドウ」の開始時刻を計算
function getWindowStart(now) {
  const elapsed = now - ANCHOR_UTC_MS;
  const idx = Math.floor(elapsed / WINDOW_MS);
  return ANCHOR_UTC_MS + idx * WINDOW_MS;
}

// 次の5hリセット時刻を計算
function getNextReset(now) {
  return getWindowStart(now) + WINDOW_MS;
}

// ── 週次リセット: 毎週金曜日 23:00 JST = 14:00 UTC ──────────────────────────
// MAX5X プラン: 来週金曜日 23:00 JST (= UTC 14:00) でリセット
function getNextWeeklyReset(now) {
  const d = new Date(now);
  const utcDay  = d.getUTCDay();   // 0=Sun,1=Mon,...,5=Fri,6=Sat
  const utcHour = d.getUTCHours();
  const utcMin  = d.getUTCMinutes();

  // 今週の金曜日 14:00 UTC までの日数
  let days = (5 - utcDay + 7) % 7;
  // 今日が金曜でかつ 14:00 UTC を過ぎていたら来週
  if (days === 0 && (utcHour > 14 || (utcHour === 14 && utcMin > 0))) {
    days = 7;
  }

  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + days,
    14, 0, 0, 0   // 14:00 UTC = 23:00 JST
  );
}

// ── ファイル列挙 ─────────────────────────────────────────────────────────────
let cache = { data: null, expireAt: 0 };

function listJsonlFiles() {
  const files = [];
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return files;
  for (const proj of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
    const projPath = path.join(CLAUDE_PROJECTS_DIR, proj);
    try {
      if (!fs.statSync(projPath).isDirectory()) continue;
      for (const file of fs.readdirSync(projPath)) {
        if (file.endsWith(".jsonl")) files.push(path.join(projPath, file));
      }
    } catch {}
  }
  return files;
}

function readJsonlFile(filePath, windowStart) {
  return new Promise((resolve) => {
    const entries = [];
    try {
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== "assistant") return;
          const usage = obj.message && obj.message.usage;
          if (!usage || !obj.timestamp) return;
          const ts = new Date(obj.timestamp).getTime();
          if (isNaN(ts) || ts < windowStart) return;
          entries.push({ ts, usage });
        } catch {}
      });
      rl.on("close", () => resolve(entries));
      rl.on("error",  () => resolve(entries));
    } catch {
      resolve(entries);
    }
  });
}

// ── メイン計算 ───────────────────────────────────────────────────────────────
async function calculateUsage() {
  const now         = Date.now();
  const windowStart = getWindowStart(now);
  const resetAt     = getNextReset(now);
  const remainingMs = resetAt - now;
  const weeklyResetAt  = getNextWeeklyReset(now);
  const weeklyRemainingMs = weeklyResetAt - now;

  const files = listJsonlFiles();
  let allEntries = [];
  for (const file of files) {
    const entries = await readJsonlFile(file, windowStart);
    allEntries = allEntries.concat(entries);
  }

  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0;
  for (const { usage } of allEntries) {
    inputTokens         += usage.input_tokens                || 0;
    outputTokens        += usage.output_tokens               || 0;
    cacheCreationTokens += usage.cache_creation_input_tokens || 0;
    cacheReadTokens     += usage.cache_read_input_tokens     || 0;
  }

  const totalTokens = inputTokens + outputTokens + cacheCreationTokens;
  const cfg = loadConfig();
  const limit = cfg.sessionLimitTokens || 0;
  const sessionPercent = limit > 0 ? Math.min(100, Math.round(totalTokens / limit * 100)) : null;

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    sessionPercent,
    sessionLimitTokens: limit,
    windowStart:        new Date(windowStart).toISOString(),
    resetAt:            new Date(resetAt).toISOString(),
    remainingMs:        Math.max(0, remainingMs),
    weeklyResetAt:      new Date(weeklyResetAt).toISOString(),
    weeklyRemainingMs:  Math.max(0, weeklyRemainingMs),
    messageCount:       allEntries.length,
  };
}

// "あとX時間Y分" 形式
function formatRemaining(ms) {
  if (ms == null || ms < 0) return null;
  if (ms === 0) return "\u307e\u3082\u306a\u304f\u30ea\u30bb\u30c3\u30c8"; // まもなくリセット
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h === 0) return `\u3042\u3068${m}\u5206`;            // あとN分
  if (m === 0) return `\u3042\u3068${h}\u6642\u9593`;      // あとN時間
  return `\u3042\u3068${h}\u6642\u9593${m}\u5206`;         // あとN時間M分
}

// キャッシュ付き取得
async function getUsage() {
  const now = Date.now();
  if (cache.data && now < cache.expireAt) return cache.data;
  const data = await calculateUsage();
  cache = { data, expireAt: now + CACHE_TTL_MS };
  return data;
}

// ── セッションメタデータ抽出 ───────────────────────────────────────────
// .jsonl の最初の user メッセージからタイトルと cwd を取得
async function getSessionMeta(sessionId) {
  if (!sessionId) return null;
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;

  for (const proj of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, proj, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) continue;

    let slug = null;
    let cwd = null;
    try {
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          // cwd はシステム行に含まれる場合がある
          if (obj.cwd && !cwd) cwd = obj.cwd;
          // 最初の user メッセージをタイトルとして使う
          if (obj.cwd && !cwd) cwd = obj.cwd;
          // 最初の user メッセージ本文をタイトルとして使う（GUI と一致）
          if (obj.type === "user" && !slug) {
            const content = obj.message?.content;
            let text = "";
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              text = content.find(c => c.type === "text")?.text || "";
            }
            // URL や長い前置きを除いて最初の意味ある行を取る
            const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("http"));
            slug = (lines[0] || text).slice(0, 50).trim() || null;
          }
          if (slug && cwd) break;
        } catch {}
      }
      rl.close();
    } catch {}

    return { slug, cwd, projectFolder: proj };
  }
  return null;
}

module.exports = { getUsage, formatRemaining, loadConfig, saveConfig, getSessionMeta };
