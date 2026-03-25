const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const WINDOW_MS = 5 * 60 * 60 * 1000; // 5時間
const CACHE_TTL_MS = 60 * 1000;        // 1分キャッシュ

// ── 固定スケジュールのアンカー ──────────────────────────────────────────────
// ユーザー確認: 次のリセットは 2026-03-25 19:00 JST (= 10:00 UTC)
// JST = UTC+9
const ANCHOR_UTC_MS = Date.UTC(2026, 2, 25, 10, 0, 0); // 2026-03-25T10:00:00Z

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

// ── 週次リセット: 毎週火曜日 14:00 JST = 05:00 UTC ──────────────────────────
function getNextWeeklyReset(now) {
  const d = new Date(now);
  const utcDay  = d.getUTCDay();   // 0=Sun,1=Mon,2=Tue,...
  const utcHour = d.getUTCHours();
  const utcMin  = d.getUTCMinutes();

  // 今週の火曜日 05:00 UTC までの日数
  let days = (2 - utcDay + 7) % 7;
  // 今日が火曜でかつ 05:00 UTC を過ぎていたら来週
  if (days === 0 && (utcHour > 5 || (utcHour === 5 && utcMin > 0))) {
    days = 7;
  }

  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + days,
    5, 0, 0, 0   // 05:00 UTC = 14:00 JST
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

  return {
    totalTokens: inputTokens + outputTokens + cacheCreationTokens,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
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

module.exports = { getUsage, formatRemaining };
