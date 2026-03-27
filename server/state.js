// 共有状態シングルトン
// status: "idle" | "working" | "complete" | "error" | "break"
const state = {
  // ── グローバル（後方互換） ──────────────────────────────────────────
  status: "idle",
  message: "\u5f85\u6a5f\u4e2d\u306a\u306e\u3060", // 待機中なのだ
  timestamp: new Date().toISOString(),
  sseClients: [],

  // ── マルチセッション ────────────────────────────────────────────────
  // key: sessionId (UUID)
  // value: { sessionId, status, message, lastActivityAt, metadata: { slug, cwd } }
  sessions: new Map(),

  // ── 権限リクエスト (複数セッション対応) ────────────────────────────
  // key: permissionId (UUID)
  // value: { id, sessionId, tool_name, preview, decision: null|"allow"|"deny"|"always", createdAt }
  pendingPermissions: new Map(),

  // 後方互換: 最後の権限リクエスト
  get pendingPermission() {
    // Map の最後のエントリを返す
    let last = null;
    for (const v of this.pendingPermissions.values()) last = v;
    return last;
  },
};

// ── SSE ブロードキャスト ───────────────────────────────────────────────

state.broadcast = function (data) {
  const payload = JSON.stringify(data);
  this.sseClients = this.sseClients.filter((res) => {
    try {
      res.write(`event: statusUpdate\ndata: ${payload}\n\n`);
      return true;
    } catch {
      return false;
    }
  });
};

state.broadcastPermission = function (data) {
  const payload = JSON.stringify(data);
  this.sseClients = this.sseClients.filter((res) => {
    try {
      res.write(`event: permissionRequest\ndata: ${payload}\n\n`);
      return true;
    } catch {
      return false;
    }
  });
};

state.broadcastSessions = function () {
  const sessions = this.getActiveSessions();
  const payload = JSON.stringify(sessions);
  this.sseClients = this.sseClients.filter((res) => {
    try {
      res.write(`event: sessionsUpdate\ndata: ${payload}\n\n`);
      return true;
    } catch {
      return false;
    }
  });
};

// ── セッション管理 ─────────────────────────────────────────────────────

state.upsertSession = function (sessionId, status, message, metadata) {
  const existing = this.sessions.get(sessionId) || {};
  this.sessions.set(sessionId, {
    sessionId,
    status,
    message,
    lastActivityAt: Date.now(),
    metadata: { ...existing.metadata, ...metadata },
  });
  // グローバル状態も更新（最後に活動したセッションで代表）
  this.status = status;
  this.message = message;
  this.timestamp = new Date().toISOString();
  this.broadcast({ status, message, timestamp: this.timestamp, sessionId });
  this.broadcastSessions();
};

state.update = function (status, message, sessionId) {
  if (sessionId) {
    this.upsertSession(sessionId, status, message, {});
  } else {
    // sessionId なし → グローバルのみ更新（後方互換）
    this.status = status;
    this.message = message;
    this.timestamp = new Date().toISOString();
    this.broadcast({ status, message, timestamp: this.timestamp });
  }
};

state.getActiveSessions = function (expireMs) {
  const cutoff = expireMs ? Date.now() - expireMs : 0;
  const result = [];
  for (const s of this.sessions.values()) {
    if (cutoff && s.lastActivityAt < cutoff) continue;
    result.push(s);
  }
  // 最終活動時刻の降順（最近のものが先頭）
  return result.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
};

state.cleanupExpiredSessions = function (expireMs) {
  const cutoff = Date.now() - expireMs;
  for (const [id, s] of this.sessions) {
    if (s.lastActivityAt < cutoff) this.sessions.delete(id);
  }
};

// ── 権限リクエスト管理 ─────────────────────────────────────────────────

state.setPermission = function (data) {
  const entry = { ...data, decision: null, createdAt: Date.now() };
  this.pendingPermissions.set(data.id, entry);
  this.broadcastPermission(data);
};

state.resolvePermission = function (id, decision) {
  const p = this.pendingPermissions.get(id);
  if (p) p.decision = decision;
};

state.getPermission = function (id) {
  return this.pendingPermissions.get(id) || null;
};

state.cleanupPermissions = function (maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, p] of this.pendingPermissions) {
    if (p.createdAt < cutoff) this.pendingPermissions.delete(id);
  }
};

// ── 自動クリーンアップ (60秒ごと) ──────────────────────────────────────
const WORKING_TIMEOUT_MS = 5 * 60 * 1000; // 5分 hook がなければ working → idle

setInterval(() => {
  // 解決済み権限リクエストを5分後に削除
  state.cleanupPermissions(5 * 60 * 1000);

  // working のまま5分以上放置されたセッションを idle に戻す
  const now = Date.now();
  let changed = false;
  for (const s of state.sessions.values()) {
    if (s.status === "working" && now - s.lastActivityAt > WORKING_TIMEOUT_MS) {
      s.status = "idle";
      s.message = "\u5f85\u6a5f\u4e2d\u306a\u306e\u3060"; // 待機中なのだ
      changed = true;
    }
  }
  if (changed) state.broadcastSessions();
}, 60_000);

module.exports = state;
