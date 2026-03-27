const express = require("express");
const path = require("path");
const state = require("./state");
const { getUsage, formatRemaining, loadConfig, saveConfig, getSessionMeta } = require("./usage");
const { notifySessionStart, notifySessionComplete, notifyPermission } = require("./voicevox");

const PORT = 3456;

function createHttpServer() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(express.static(path.join(__dirname, "../public")));


  // 現在状態の取得（初期値用）
  app.get("/api/status", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      status: state.status,
      message: state.message,
      timestamp: state.timestamp,
    });
  });

  // 直接更新（フック・デバッグ用）— sessionId 対応
  app.post("/api/update", (req, res) => {
    const { status, message, sessionId, metadata } = req.body;
    if (!status || !message) {
      return res.status(400).json({ error: "status と message は必須なのだ" });
    }
    // 前回ステータスを取得（音声判定用）
    const prevStatus = sessionId ? (state.sessions.get(sessionId)?.status || null) : null;
    state.update(status, message, sessionId || null);
    // メタデータがあればセッションに補足
    if (sessionId && metadata) {
      const s = state.sessions.get(sessionId);
      if (s) s.metadata = { ...s.metadata, ...metadata };
    }
    // 音声通知: 開始 or 完了のみ
    if (sessionId) {
      const slug = state.sessions.get(sessionId)?.metadata?.slug || null;
      if (status === "working" && prevStatus !== "working") {
        notifySessionStart(slug, sessionId);
      } else if (status === "complete") {
        notifySessionComplete(slug, sessionId);
      }
    }
    res.json({ success: true });
  });

  // 使用量取得（全体）
  app.get("/api/usage", async (req, res) => {
    try {
      const usage = await getUsage();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        ...usage,
        remainingFormatted:       formatRemaining(usage.remainingMs),
        weeklyRemainingFormatted: formatRemaining(usage.weeklyRemainingMs),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // セッション一覧取得
  app.get("/api/sessions", async (req, res) => {
    const cfg = loadConfig();
    const expireMs = (cfg.sessionExpireHours || 8) * 3600 * 1000;
    const sessions = state.getActiveSessions(expireMs);

    // 各セッションにメタデータ（slug）を補完
    const enriched = await Promise.all(sessions.map(async (s) => {
      if (!s.metadata?.slug && s.sessionId) {
        const meta = await getSessionMeta(s.sessionId);
        if (meta) {
          const stored = state.sessions.get(s.sessionId);
          if (stored) stored.metadata = { ...stored.metadata, ...meta };
          return { ...s, metadata: { ...s.metadata, ...meta } };
        }
      }
      return s;
    }));

    res.json(enriched);
  });

  // SSE エンドポイント
  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // 接続時に現在状態を送信
    const current = JSON.stringify({
      status: state.status,
      message: state.message,
      timestamp: state.timestamp,
    });
    res.write(`event: statusUpdate\ndata: ${current}\n\n`);

    // 接続時にセッション一覧も送信
    const cfg = loadConfig();
    const expireMs = (cfg.sessionExpireHours || 8) * 3600 * 1000;
    const sessions = state.getActiveSessions(expireMs);
    if (sessions.length > 0) {
      res.write(`event: sessionsUpdate\ndata: ${JSON.stringify(sessions)}\n\n`);
    }

    // 接続時に未解決の権限リクエストも送信（再接続時にシートを復元）
    for (const [, perm] of state.pendingPermissions) {
      if (perm.decision === null) {
        res.write(`event: permissionRequest\ndata: ${JSON.stringify(perm)}\n\n`);
        break; // 最初の1件のみ
      }
    }

    state.sseClients.push(res);

    req.on("close", () => {
      state.sseClients = state.sseClients.filter((c) => c !== res);
    });
  });

  // ── 権限リクエスト API ──────────────────────────────────────────────

  app.post("/api/permission/request", (req, res) => {
    const { id, tool_name, preview, sessionId } = req.body;
    if (!id) return res.status(400).json({ error: "id is required" });
    state.setPermission({
      id,
      tool_name: tool_name || "Unknown",
      preview: preview || "",
      sessionId: sessionId || null,
    });
    // 音声通知: 許可待ち
    const slug = sessionId ? (state.sessions.get(sessionId)?.metadata?.slug || null) : null;
    notifyPermission(slug, sessionId);
    res.json({ ok: true });
  });

  app.get("/api/permission/poll/:id", (req, res) => {
    const p = state.getPermission(req.params.id);
    if (!p) return res.json({ decision: "deny" });
    res.json({ decision: p.decision }); // null | "allow" | "deny" | "always"
  });

  app.post("/api/permission/respond", (req, res) => {
    const { id, decision } = req.body;
    if (!id || !decision) return res.status(400).json({ error: "id and decision required" });
    state.resolvePermission(id, decision);
    res.json({ ok: true });
  });

  // ── 設定 API ──────────────────────────────────────────────────────────

  app.get("/api/settings", (req, res) => {
    res.json(loadConfig());
  });

  app.post("/api/settings", (req, res) => {
    const cfg = loadConfig();
    if (req.body.sessionLimitTokens != null) {
      cfg.sessionLimitTokens = Number(req.body.sessionLimitTokens);
    }
    if (req.body.sessionExpireHours != null) {
      cfg.sessionExpireHours = Number(req.body.sessionExpireHours);
    }
    saveConfig(cfg);
    res.json({ ok: true, config: cfg });
  });

  app.listen(PORT, () => {
    console.log(
      `ずんだもんコンパニオン起動なのだ！ → http://localhost:${PORT}`
    );
  });
}

module.exports = { createHttpServer };
