// ===== 定数 =====
const STATUSES = ["idle", "working", "complete", "error", "break"];
const STATUS_LABELS = {
  idle:     "待機中",
  working:  "作業中",
  complete: "完了",
  error:    "エラー",
  break:    "休憩中",
};

// プログレスバーの最大トークン数（0 = バーを時間ベースで表示しない）
// ご自身のプランの制限値に合わせて変更してください
// 例: Max5h プランなら 140000 程度
const TOKEN_LIMIT = 0;

// ===== 時刻帯（窓の外の空の色） =====
const TIME_PERIODS = [
  { name: "dawn",    start: 5,  end: 8  }, // 夜明け: オレンジ〜ピンク
  { name: "morning", start: 8,  end: 12 }, // 朝〜昼: 水色
  { name: "noon",    start: 12, end: 17 }, // 昼: 明るい青
  { name: "evening", start: 17, end: 20 }, // 夕: オレンジ〜紫
  { name: "night",   start: 20, end: 24 }, // 夜: 濃紺+星
  { name: "night",   start: 0,  end: 5  }, // 深夜
];

function updateTimePeriod() {
  const h = new Date().getHours();
  const period = TIME_PERIODS.find((p) => h >= p.start && h < p.end) || TIME_PERIODS[4];
  const room = document.getElementById("room");
  if (room) room.dataset.time = period.name;
}

updateTimePeriod();
setInterval(updateTimePeriod, 60000); // 1分ごとに更新

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

// ===== ステータスUI更新 =====
function updateUI(status, message) {
  const bubble     = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubble-text");
  const badge      = document.getElementById("status-badge");
  const statusText = document.getElementById("status-text");
  const character  = document.getElementById("character");
  const room       = document.getElementById("room");
  const charArea   = document.getElementById("character-area");

  // メッセージ
  bubbleText.textContent = message;

  // クラス付与（全要素）
  STATUSES.forEach((s) => {
    bubble.classList.remove(s);
    badge.classList.remove(s);
    character.classList.remove(s);
    room.classList.remove(s);
    charArea.classList.remove(s);
  });
  bubble.classList.add(status);
  badge.classList.add(status);
  character.classList.add(status);
  room.classList.add(status);
  charArea.classList.add(status);

  // ステータステキスト
  statusText.textContent = STATUS_LABELS[status] ?? status;

  // 吹き出しのアニメーションリセット
  bubble.style.animation = "none";
  bubble.offsetHeight; // reflow
  bubble.style.animation = "";
}

// ===== 使用量ウィジェット =====
function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}

function updateUsageWidget(data) {
  const tokensEl  = document.getElementById("usage-tokens");
  const resetEl   = document.getElementById("usage-reset");
  const barEl     = document.getElementById("usage-bar");
  const wrapEl    = document.getElementById("usage-bar-wrap");
  const widgetEl  = document.getElementById("usage-widget");

  if (!data || data.error || data.totalTokens == null) {
    widgetEl.style.opacity = "0.45";
    tokensEl.textContent = "--";
    resetEl.textContent  = "";
    barEl.style.width    = "0%";
    return;
  }

  widgetEl.style.opacity = "1";
  tokensEl.textContent = formatTokens(data.totalTokens);

  // 5h リセット残り時間
  if (data.remainingFormatted) {
    resetEl.textContent = data.remainingFormatted;
    resetEl.title = data.resetAt
      ? "5hリセット: " + new Date(data.resetAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "";
  } else {
    resetEl.textContent = data.messageCount === 0 ? "使用なし" : "";
  }

  // 週次リセット表示（要素があれば）
  const weeklyEl = document.getElementById("usage-weekly");
  if (weeklyEl) {
    if (data.weeklyRemainingFormatted) {
      weeklyEl.textContent = "週次 " + data.weeklyRemainingFormatted;
      weeklyEl.title = data.weeklyResetAt
        ? "週次リセット(火14時JST): " + new Date(data.weeklyResetAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
        : "";
    } else {
      weeklyEl.textContent = "";
    }
  }

  // プログレスバー
  if (TOKEN_LIMIT > 0) {
    const pct = Math.min(100, (data.totalTokens / TOKEN_LIMIT) * 100);
    barEl.style.width = pct + "%";
    wrapEl.style.display = "block";
  } else {
    // TOKEN_LIMIT 未設定時：バー非表示
    wrapEl.style.display = "none";
  }
}

function pollUsage() {
  fetch("/api/usage")
    .then((r) => r.json())
    .then(updateUsageWidget)
    .catch(() => updateUsageWidget(null));
}

// 起動時と60秒ごとにポーリング
pollUsage();
setInterval(pollUsage, 60000);

// ===== 初期状態取得 =====
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
    updateUI(data.status, data.message);
  });

  es.onopen = () => {
    connDot.className = "conn-dot connected";
    connText.textContent = "接続中";
  };

  es.onerror = () => {
    connDot.className = "conn-dot";
    connText.textContent = "切断";
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

connectSSE();
