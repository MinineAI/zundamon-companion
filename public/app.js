// ===== 定数 =====
const STATUSES = ["idle", "working", "complete", "error", "break"];

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
  idle:       "待機中",
  working:    "作業中",
  complete:   "完了",
  error:      "エラー",
  break:      "休憩中",
  permission: "許可待ち",
};

// ===== マルチセッション =====
let activeSessions = [];
let selectedSessionId = null;
const pendingPermSessionIds = new Set(); // 許可待ちセッション追跡

function relativeTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60)  return "今";
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  return `${Math.floor(sec / 3600)}h前`;
}

// セッションの表示ステータスを決定（許可待ちを優先）
function getDisplayStatus(session) {
  if (pendingPermSessionIds.has(session.sessionId)) return "permission";
  return session.status || "idle";
}

function renderSessionList(sessions) {
  const list = document.getElementById("session-list");
  if (!list) return;

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="session-empty">セッションなし</div>';
    return;
  }

  list.innerHTML = "";
  for (const s of sessions) {
    const card = document.createElement("div");
    const displayStatus = getDisplayStatus(s);
    card.className = "session-card" + (s.sessionId === selectedSessionId ? " selected" : "");

    const dot = document.createElement("span");
    dot.className = "session-card-dot " + displayStatus;

    const name = document.createElement("span");
    name.className = "session-card-name";
    const fullName = s.metadata?.slug || s.sessionId.slice(0, 8);
    name.textContent = fullName.length > 30 ? fullName.slice(0, 30) + "…" : fullName;
    name.title = fullName;

    const badge = document.createElement("span");
    badge.className = "session-card-status s-" + displayStatus;
    badge.textContent = STATUS_LABELS[displayStatus] || displayStatus;

    card.appendChild(dot);
    card.appendChild(name);
    card.appendChild(badge);

    card.addEventListener("click", () => selectSession(s.sessionId, s));
    list.appendChild(card);
  }
}

function selectSession(sessionId, sessionData) {
  selectedSessionId = sessionId;
  renderSessionList(activeSessions);
  if (sessionData) {
    updateUI(sessionData.status, sessionData.message);
  }
  renderHistory(); // 選択セッション切替で履歴再描画
}

function handleSessionsUpdate(sessions) {
  activeSessions = sessions || [];
  if (!selectedSessionId && activeSessions.length > 0) {
    selectedSessionId = activeSessions[0].sessionId;
  }
  if (selectedSessionId && !activeSessions.find(s => s.sessionId === selectedSessionId)) {
    selectedSessionId = activeSessions.length > 0 ? activeSessions[0].sessionId : null;
  }
  renderSessionList(activeSessions);
  if (selectedSessionId) {
    const sel = activeSessions.find(s => s.sessionId === selectedSessionId);
    if (sel) updateUI(sel.status, sel.message);
  }
}

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

// ===== セッション別履歴 =====
const sessionHistoryMap = new Map(); // sessionId → array
let currentStatusStartMap = new Map(); // sessionId → timestamp
let lastKnownTokens = 0;

function getSessionHistory(sessionId) {
  if (!sessionId) return [];
  if (!sessionHistoryMap.has(sessionId)) sessionHistoryMap.set(sessionId, []);
  return sessionHistoryMap.get(sessionId);
}

function addToHistory(status, message, sessionId) {
  const sid = sessionId || selectedSessionId;
  if (!sid) return;
  const history = getSessionHistory(sid);
  const now = Date.now();
  const startTime = currentStatusStartMap.get(sid) || now;
  const elapsed = Math.round((now - startTime) / 1000);

  if (history.length > 0) {
    history[0].duration = elapsed;
    const delta = lastKnownTokens - (history[0].tokensStart || 0);
    history[0].tokensDelta = delta > 0 ? delta : null;
  }

  history.unshift({
    time: new Date(now),
    status,
    message,
    duration: null,
    tokensStart: lastKnownTokens,
    tokensDelta: null,
  });
  if (history.length > 12) history.pop();
  currentStatusStartMap.set(sid, now);
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
  const history = getSessionHistory(selectedSessionId);
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">まだ作業がありません</div>';
    return;
  }
  list.innerHTML = history
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
function updateUI(status, message, sessionId) {
  const bubble     = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubble-text");
  const character  = document.getElementById("character");
  const app        = document.getElementById("app");
  const charArea   = document.getElementById("character-area");

  bubbleText.textContent = message;

  STATUSES.forEach((s) => {
    bubble.classList.remove(s);
    character.classList.remove(s);
    app.classList.remove(s);
    charArea.classList.remove(s);
  });
  bubble.classList.add(status);
  character.classList.add(status);
  app.classList.add(status);
  charArea.classList.add(status);

  // 吹き出しアニメーションリセット
  bubble.style.animation = "none";
  bubble.offsetHeight;
  bubble.style.animation = "";

  switchCharacterImage(status);

  // 履歴追加（ステータスまたはメッセージが変化した場合のみ）
  const sid = sessionId || selectedSessionId;
  const history = getSessionHistory(sid);
  if (
    history.length === 0 ||
    history[0].status !== status ||
    history[0].message !== message
  ) {
    addToHistory(status, message, sid);
  }
}

// ===== 使用量ウィジェット（コンパクト） =====
function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function updateUsageWidget(data) {
  const tokensEl = document.getElementById("usage-tokens");
  const pctEl    = document.getElementById("usage-pct");
  const resetEl  = document.getElementById("usage-reset");
  const barEl    = document.getElementById("usage-bar");
  const wrapEl   = document.getElementById("usage-bar-wrap");
  const widgetEl = document.getElementById("usage-widget");

  if (!data || data.error || data.totalTokens == null) {
    if (widgetEl) widgetEl.style.opacity = "0.4";
    if (tokensEl) tokensEl.textContent = "--";
    if (pctEl)    pctEl.textContent    = "";
    if (resetEl)  resetEl.textContent  = "";
    if (barEl)    barEl.style.width    = "0%";
    return;
  }

  if (data.totalTokens !== lastKnownTokens) {
    lastKnownTokens = data.totalTokens;
    renderHistory();
  }

  if (widgetEl) widgetEl.style.opacity = "1";
  if (tokensEl) tokensEl.textContent = formatTokens(data.totalTokens) + " tok";
  if (pctEl) pctEl.textContent = data.sessionPercent != null ? `${data.sessionPercent}%` : "";
  if (resetEl) resetEl.textContent = data.remainingFormatted || "";

  if (data.sessionPercent != null) {
    if (barEl)  barEl.style.width    = data.sessionPercent + "%";
    if (wrapEl) wrapEl.style.display = "block";
  } else {
    if (wrapEl) wrapEl.style.display = "none";
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

// ===== 初期ステータス・セッション取得 =====
fetch("/api/status")
  .then((r) => r.json())
  .then((data) => updateUI(data.status, data.message))
  .catch(() => {});

fetch("/api/sessions")
  .then((r) => r.json())
  .then(handleSessionsUpdate)
  .catch(() => {});

// ===== SSE 接続 =====
function connectSSE() {
  const connDot = document.getElementById("conn-dot");
  const es = new EventSource("/events");

  es.addEventListener("statusUpdate", (e) => {
    const data = JSON.parse(e.data);
    pollUsage();
    // sessionId があればそのセッションのみ更新
    if (data.sessionId && data.sessionId === selectedSessionId) {
      updateUI(data.status, data.message, data.sessionId);
    } else if (!data.sessionId) {
      updateUI(data.status, data.message);
    }
    // 非選択セッションの場合もセッション一覧は更新される（sessionsUpdate で）
  });

  es.addEventListener("permissionRequest", (e) => {
    const data = JSON.parse(e.data);
    if (data.sessionId) pendingPermSessionIds.add(data.sessionId);
    renderSessionList(activeSessions); // 許可待ちバッジ更新
    showPermSheet(data);
  });

  es.addEventListener("sessionsUpdate", (e) => {
    const sessions = JSON.parse(e.data);
    handleSessionsUpdate(sessions);
  });

  es.onopen = () => {
    if (connDot) connDot.className = "conn-dot connected";
  };

  es.onerror = () => {
    if (connDot) connDot.className = "conn-dot";
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

connectSSE();

// ===== 権限リクエスト ボトムシート =====
let _permTimerInterval = null;
let _permCurrentId = null;

function _permKeyHandler(e) {
  if (!_permCurrentId) return;
  if (e.key === "Escape") {
    e.preventDefault();
    respondPerm(_permCurrentId, "deny");
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    respondPerm(_permCurrentId, "always");
  } else if (e.key === "Enter") {
    e.preventDefault();
    respondPerm(_permCurrentId, "allow");
  }
}

function showPermSheet({ id, tool_name, preview, sessionId }) {
  const sheet     = document.getElementById("perm-sheet");
  const toolEl    = document.getElementById("perm-tool");
  const previewEl = document.getElementById("perm-preview");
  const timerEl   = document.getElementById("perm-timer");
  const allowBtn  = document.getElementById("perm-allow");
  const alwaysBtn = document.getElementById("perm-always");
  const denyBtn   = document.getElementById("perm-deny");
  if (!sheet) return;

  _permCurrentId = id;

  toolEl.textContent    = "\u{1F6E0} " + (tool_name || "Unknown");
  previewEl.textContent = (preview || "").slice(0, 120);

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

  allowBtn.onclick  = () => respondPerm(id, "allow");
  alwaysBtn.onclick = () => respondPerm(id, "always");
  denyBtn.onclick   = () => respondPerm(id, "deny");

  document.removeEventListener("keydown", _permKeyHandler);
  document.addEventListener("keydown", _permKeyHandler);

  const bubble = document.getElementById("bubble-text");
  if (bubble) bubble.textContent = "確認してほしいのだ！";

  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
}

function hidePermSheet() {
  const sheet = document.getElementById("perm-sheet");
  if (!sheet) return;
  clearInterval(_permTimerInterval);
  _permCurrentId = null;
  document.removeEventListener("keydown", _permKeyHandler);
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
}

async function respondPerm(id, decision) {
  // 許可待ちを解除
  // permissionRequest SSEデータからsessionIdを見つける
  for (const s of activeSessions) {
    if (pendingPermSessionIds.has(s.sessionId)) {
      pendingPermSessionIds.delete(s.sessionId);
    }
  }
  renderSessionList(activeSessions);

  hidePermSheet();
  try {
    await fetch("/api/permission/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
  } catch (_) {}
}
