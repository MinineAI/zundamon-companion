// ===== 定数 =====
const STATUSES = ["idle", "working", "complete", "error", "break"];

// ステータス別キャラクター画像
// 対応する PNG を public/ に置くと自動的に切り替わります
// 例: zundamon-working.png, zundamon-complete.png など
const STATUS_IMAGES = {
  idle:     "/zundamon.png",
  working:  "/zundamon-working.png",
  complete: "/zundamon-complete.png",
  error:    "/zundamon-error.png",
  break:    "/zundamon-break.png",
};
const DEFAULT_IMAGE = "/zundamon.png";

let currentImageSrc = DEFAULT_IMAGE;

function switchCharacterImage(status) {
  const img = document.getElementById("zundamon-img");
  if (!img) return;
  const targetSrc = STATUS_IMAGES[status] || DEFAULT_IMAGE;
  if (targetSrc === currentImageSrc) return;

  // フェードアウト → 画像読み込み → フェードイン
  const testImg = new Image();
  testImg.onload = () => {
    img.classList.add("switching");
    setTimeout(() => {
      img.src = targetSrc;
      currentImageSrc = targetSrc;
      img.classList.remove("switching");
    }, 250);
  };
  testImg.onerror = () => {
    // ステータス別画像がなければデフォルトに戻す
    if (currentImageSrc !== DEFAULT_IMAGE) {
      img.classList.add("switching");
      setTimeout(() => {
        img.src = DEFAULT_IMAGE;
        currentImageSrc = DEFAULT_IMAGE;
        img.classList.remove("switching");
      }, 250);
    }
  };
  testImg.src = targetSrc;
}
const STATUS_LABELS = {
  idle:     "待機中",
  working:  "作業中",
  complete: "完了",
  error:    "エラー",
  break:    "休憩中",
};

const TOKEN_LIMIT = 0; // 0 = プログレスバー非表示

// ===== 時計 =====
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const el = document.getElementById("clock");
  if (el) el.textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 10000);

// ===== セッション履歴 =====
const sessionHistory = [];
let currentStatusStart = Date.now();
let lastKnownTokens = 0; // 最新の累計トークン数

function addToHistory(status, message) {
  const now = Date.now();
  const elapsed = Math.round((now - currentStatusStart) / 1000);

  // 直前のエントリに duration とトークン差分を記録
  if (sessionHistory.length > 0) {
    sessionHistory[0].duration = elapsed;
    // 前エントリ開始時点からの差分トークン数
    const delta = lastKnownTokens - (sessionHistory[0].tokensStart || 0);
    sessionHistory[0].tokensDelta = delta > 0 ? delta : null;
  }

  sessionHistory.unshift({
    time: new Date(now),
    status,
    message,
    duration: null,
    tokensStart: lastKnownTokens, // このエントリ開始時点のトークン数
    tokensDelta: null,
  });
  if (sessionHistory.length > 12) sessionHistory.pop();
  currentStatusStart = now;
  renderHistory();
}

function formatDuration(sec) {
  if (sec == null || sec <= 0) return "--";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${Math.floor(sec / 3600)}h${Math.round((sec % 3600) / 60)}m`;
}

function formatTokensDelta(n) {
  if (n == null || n <= 0) return "";
  if (n >= 1000) return `+${(n / 1000).toFixed(1)}K`;
  return `+${n}`;
}

function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  if (sessionHistory.length === 0) {
    list.innerHTML = '<div class="history-empty">まだ作業がありません</div>';
    return;
  }
  list.innerHTML = sessionHistory
    .map((item, i) => {
      const h = String(item.time.getHours()).padStart(2, "0");
      const m = String(item.time.getMinutes()).padStart(2, "0");
      const dur = i === 0 ? "現在" : formatDuration(item.duration);
      const tok = i === 0 ? "" : formatTokensDelta(item.tokensDelta);
      return `<div class="history-item ${item.status}">
        <span class="history-time">${h}:${m}</span>
        <span class="history-dot"></span>
        <span class="history-msg">${item.message}</span>
        <span class="history-dur">${dur}</span>${tok ? `<span class="history-tok">${tok}</span>` : ""}
      </div>`;
    })
    .join("");
}

// ===== ステータスUI更新 =====
function updateUI(status, message) {
  const bubble     = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubble-text");
  const badge      = document.getElementById("status-badge");
  const statusText = document.getElementById("status-text");
  const character  = document.getElementById("character");
  const app        = document.getElementById("app");
  const charArea   = document.getElementById("character-area");
  const statusSec  = document.getElementById("status-section");

  bubbleText.textContent = message;

  // クラス付け替え
  STATUSES.forEach((s) => {
    bubble.classList.remove(s);
    badge.classList.remove(s);
    character.classList.remove(s);
    app.classList.remove(s);
    charArea.classList.remove(s);
    if (statusSec) statusSec.classList.remove(s);
  });
  bubble.classList.add(status);
  badge.classList.add(status);
  character.classList.add(status);
  app.classList.add(status);
  charArea.classList.add(status);
  if (statusSec) statusSec.classList.add(status);

  statusText.textContent = STATUS_LABELS[status] ?? status;

  // 吹き出しアニメーションリセット
  bubble.style.animation = "none";
  bubble.offsetHeight;
  bubble.style.animation = "";

  // ステータス別画像切替
  switchCharacterImage(status);

  // 履歴追加（ステータスまたはメッセージが変化した場合のみ）
  if (
    sessionHistory.length === 0 ||
    sessionHistory[0].status !== status ||
    sessionHistory[0].message !== message
  ) {
    addToHistory(status, message);
  }
}

// ===== 使用量ウィジェット =====
function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}

function updateUsageWidget(data) {
  const tokensEl = document.getElementById("usage-tokens");
  const resetEl  = document.getElementById("usage-reset");
  const barEl    = document.getElementById("usage-bar");
  const wrapEl   = document.getElementById("usage-bar-wrap");
  const widgetEl = document.getElementById("usage-widget");
  const weeklyEl = document.getElementById("usage-weekly");

  if (!data || data.error || data.totalTokens == null) {
    if (widgetEl) widgetEl.style.opacity = "0.4";
    if (tokensEl) tokensEl.textContent = "--";
    if (resetEl)  resetEl.textContent  = "";
    if (barEl)    barEl.style.width    = "0%";
    return;
  }

  // 累計トークン数を更新し、履歴の現在エントリのトークン差分も再描画
  if (data.totalTokens !== lastKnownTokens) {
    lastKnownTokens = data.totalTokens;
    renderHistory(); // トークン情報を反映して再描画
  }

  if (widgetEl) widgetEl.style.opacity = "1";
  if (tokensEl) tokensEl.textContent = formatTokens(data.totalTokens);

  if (resetEl) {
    resetEl.textContent = data.remainingFormatted
      ? data.remainingFormatted
      : data.messageCount === 0 ? "使用なし" : "";
    resetEl.title = data.resetAt
      ? "5hリセット: " + new Date(data.resetAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "";
  }

  if (weeklyEl) {
    weeklyEl.textContent = data.weeklyRemainingFormatted
      ? "週次 " + data.weeklyRemainingFormatted
      : "";
    weeklyEl.title = data.weeklyResetAt
      ? "週次リセット(火14時JST): " + new Date(data.weeklyResetAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "";
  }

  if (TOKEN_LIMIT > 0) {
    const pct = Math.min(100, (data.totalTokens / TOKEN_LIMIT) * 100);
    if (barEl)  barEl.style.width      = pct + "%";
    if (wrapEl) wrapEl.style.display   = "block";
  } else {
    if (wrapEl) wrapEl.style.display   = "none";
  }
}

function pollUsage() {
  fetch("/api/usage")
    .then((r) => r.json())
    .then(updateUsageWidget)
    .catch(() => updateUsageWidget(null));
}

pollUsage();
setInterval(pollUsage, 60000);

// ===== 初期ステータス取得 =====
fetch("/api/status")
  .then((r) => r.json())
  .then((data) => updateUI(data.status, data.message))
  .catch(() => {});

// ===== SSE 接続 =====
function connectSSE() {
  const connDot  = document.getElementById("conn-dot");
  const connText = document.getElementById("conn-text");

  const es = new EventSource("/events");

  es.addEventListener("statusUpdate", (e) => {
    const data = JSON.parse(e.data);
    // ステータス変化時に即座に使用量を取得（トークン差分を正確にキャプチャ）
    pollUsage();
    updateUI(data.status, data.message);
  });

  es.addEventListener("permissionRequest", (e) => {
    const data = JSON.parse(e.data);
    showPermSheet(data);
  });

  es.onopen = () => {
    if (connDot)  connDot.className    = "conn-dot connected";
    if (connText) connText.textContent = "接続中";
  };

  es.onerror = () => {
    if (connDot)  connDot.className    = "conn-dot";
    if (connText) connText.textContent = "切断";
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

connectSSE();

// ===== 権限リクエスト ボトムシート =====
let _permTimerInterval = null;

function showPermSheet({ id, tool_name, preview }) {
  const sheet    = document.getElementById("perm-sheet");
  const toolEl   = document.getElementById("perm-tool");
  const previewEl= document.getElementById("perm-preview");
  const timerEl  = document.getElementById("perm-timer");
  const allowBtn = document.getElementById("perm-allow");
  const denyBtn  = document.getElementById("perm-deny");
  if (!sheet) return;

  // コンテンツ設定
  toolEl.textContent    = "🛠 " + (tool_name || "Unknown");
  previewEl.textContent = (preview || "").slice(0, 120);

  // タイマーリセット
  clearInterval(_permTimerInterval);
  let remaining = 60;
  timerEl.textContent = remaining + "s";
  _permTimerInterval = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining + "s";
    if (remaining <= 0) {
      clearInterval(_permTimerInterval);
      respondPerm(id, "deny");
    }
  }, 1000);

  // ボタン
  allowBtn.onclick = () => respondPerm(id, "allow");
  denyBtn.onclick  = () => respondPerm(id, "deny");

  // キャラクター吹き出しを更新
  const bubble = document.getElementById("bubble-text");
  if (bubble) bubble.textContent = "\u78ba\u8a8d\u3057\u3066\u307b\u3057\u3044\u306e\u3060\uff01";

  // シートを開く
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
}

function hidePermSheet() {
  const sheet = document.getElementById("perm-sheet");
  if (!sheet) return;
  clearInterval(_permTimerInterval);
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
}

async function respondPerm(id, decision) {
  hidePermSheet();
  try {
    await fetch("/api/permission/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
  } catch (_) {}
}
