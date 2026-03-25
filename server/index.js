const args = process.argv.slice(2);
const isMcpMode = args.includes("--mcp");

if (isMcpMode) {
  // Claude Code から stdio で起動される MCP モード
  const { startMcpServer } = require("./mcp-server");
  startMcpServer().catch((err) => {
    process.stderr.write(`MCP起動エラー: ${err.message}\n`);
    process.exit(1);
  });
} else {
  // ブラウザ向け HTTP サーバーモード
  const { createHttpServer } = require("./http-server");
  createHttpServer();
}
