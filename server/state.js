// 共有状態シングルトン
// status: "idle" | "working" | "complete" | "error" | "break"
const state = {
  status: "idle",
  // "待機中なのだ" (Unicode escape to avoid encoding issues on Windows)
  message: "\u5f85\u6a5f\u4e2d\u306a\u306e\u3060",
  timestamp: new Date().toISOString(),
  sseClients: [],
  // 権限リクエスト (危険操作のみ): { id, tool_name, preview, decision: null|"allow"|"deny" }
  pendingPermission: null,
};

state.broadcast = function (data) {
  // JSON文字列をUTF-8バッファとして明示的に扱う
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

state.update = function (status, message) {
  this.status = status;
  this.message = message;
  this.timestamp = new Date().toISOString();
  this.broadcast({ status, message, timestamp: this.timestamp });
};

// 権限リクエストをSSEでブロードキャスト
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

state.setPermission = function (data) {
  this.pendingPermission = { ...data, decision: null };
  this.broadcastPermission(data);
};

state.resolvePermission = function (id, decision) {
  if (this.pendingPermission && this.pendingPermission.id === id) {
    this.pendingPermission.decision = decision;
  }
};

module.exports = state;
