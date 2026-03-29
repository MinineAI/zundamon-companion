// サーバー側 VOICEVOX 音声通知（3イベントのみ）
// 開始・完了・許可待ち をセッション名付きで発声

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const VOICEVOX_PORT = 50021;
const SPEAKER_ID = 3;   // ずんだもん
const SPEED_SCALE = 1.3;

// VOICEVOX HTTP リクエスト
function voxReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const req = http.request(
      { hostname: "localhost", port: VOICEVOX_PORT, path: urlPath, method,
        headers: { "Content-Type": "application/json", ...(buf ? { "Content-Length": buf.length } : {}) },
        timeout: 6000 },
      (res) => { const c = []; res.on("data", d => c.push(d)); res.on("end", () => resolve(Buffer.concat(c))); }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (buf) req.write(buf);
    req.end();
  });
}

// WAV ファイルを rundll32 winmm.dll,PlaySound で再生
function playWavFile(wavPath) {
  const child = spawn("rundll32", ["winmm.dll,PlaySound", wavPath, "0", "131072"], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  child.on("error", () => {});
  const timer = setTimeout(() => {
    try { child.kill(); } catch {}
  }, 30000);
  child.on("exit", () => {
    clearTimeout(timer);
    try { fs.unlinkSync(wavPath); } catch {}
  });
}

// テキストを合成して再生
async function speak(text) {
  if (!text) return;
  try {
    const encoded = encodeURIComponent(text);
    const queryBuf = await voxReq("POST", `/audio_query?text=${encoded}&speaker=${SPEAKER_ID}`);
    const query = JSON.parse(queryBuf.toString("utf8"));
    query.speedScale = SPEED_SCALE;
    const wavBuf = await voxReq("POST", `/synthesis?speaker=${SPEAKER_ID}`, query);
    const tmp = path.join(os.tmpdir(), `zundamon_${Date.now()}.wav`);
    fs.writeFileSync(tmp, wavBuf);
    playWavFile(tmp);
  } catch {
    // VOICEVOX 未起動時は無視
  }
}

// セッション名を切り詰め
function truncName(name, max = 20) {
  if (!name) return "";
  return name.length <= max ? name : name.slice(0, max);
}

// 重複防止（5秒以内の同一イベントはスキップ）
let lastEvent = null; // "sessionId:eventType"
let lastEventTimer = null;

function isDuplicate(sessionId, eventType) {
  const key = `${sessionId || ""}:${eventType}`;
  if (key === lastEvent) return true;
  lastEvent = key;
  clearTimeout(lastEventTimer);
  lastEventTimer = setTimeout(() => { lastEvent = null; }, 5000);
  return false;
}

// ── 3つの音声イベント ──────────────────────────────────────────────

function notifySessionStart(sessionName, sessionId) {
  if (isDuplicate(sessionId, "start")) return;
  const name = truncName(sessionName);
  speak(name ? `${name}セッションが開始したのだ` : "作業を開始するのだ");
}

function notifySessionComplete(sessionName, sessionId) {
  if (isDuplicate(sessionId, "complete")) return;
  const name = truncName(sessionName);
  speak(name ? `${name}セッションが完了したのだ` : "作業が完了したのだ");
}

function notifyPermission(sessionName, sessionId, toolName) {
  if (isDuplicate(sessionId, "permission")) return;
  const name = truncName(sessionName);
  speak(name ? `${name}セッションが確認を求めているのだ` : "確認を求めているのだ");
}

module.exports = { speak, notifySessionStart, notifySessionComplete, notifyPermission };
