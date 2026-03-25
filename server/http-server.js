const express = require("express");
const path = require("path");
const state = require("./state");
const { getUsage, formatRemaining } = require("./usage");

const PORT = 3456;

function createHttpServer() {
  const app = express();
  app.use(express.json());
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

  // 直接更新（デバッグ・テスト用）
  app.post("/api/update", (req, res) => {
    const { status, message } = req.body;
    if (!status || !message) {
      return res.status(400).json({ error: "status と message は必須なのだ" });
    }
    state.update(status, message);
    res.json({ success: true });
  });

  // 使用量取得
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

    state.sseClients.push(res);

    req.on("close", () => {
      state.sseClients = state.sseClients.filter((c) => c !== res);
    });
  });

  app.listen(PORT, () => {
    console.log(
      `ずんだもんコンパニオン起動なのだ！ → http://localhost:${PORT}`
    );
  });
}

module.exports = { createHttpServer };
