const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const http = require("http");

const HTTP_PORT = 3456;

// HTTPサーバーの /api/update を叩いてステータスを同期する
// （MCPサーバーと HTTPサーバーは別プロセスなので、直接 state を触れない）
function callHttpUpdate(status, message) {
  return new Promise((resolve) => {
    const bodyBuf = Buffer.from(JSON.stringify({ status, message }), "utf8");
    const req = http.request(
      {
        hostname: "localhost",
        port: HTTP_PORT,
        path: "/api/update",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": bodyBuf.length,
        },
      },
      (res) => {
        res.resume(); // レスポンスボディを消費して接続を解放
        resolve({ ok: res.statusCode === 200 });
      }
    );
    req.on("error", () => resolve({ ok: false })); // HTTPサーバー未起動でもエラーにしない
    req.write(bodyBuf);
    req.end();
  });
}

async function startMcpServer() {
  const server = new McpServer({
    name: "zundamon-ui",
    version: "1.0.0",
  });

  server.tool(
    "update_status",
    "\u305a\u3093\u3060\u3082\u3093\u30b3\u30f3\u30d1\u30cb\u30aa\u30f3\u753b\u9762\u306e\u30b9\u30c6\u30fc\u30bf\u30b9\u3068\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u66f4\u65b0\u3059\u308b",
    {
      status: z
        .enum(["idle", "working", "complete", "error", "break"])
        .describe(
          'status: "idle"(\u5f85\u6a5f) | "working"(\u4f5c\u696d\u4e2d) | "complete"(\u5b8c\u4e86) | "error"(\u30a8\u30e9\u30fc) | "break"(\u4f11\u61a9)'
        ),
      message: z
        .string()
        .max(100)
        .describe(
          "\u5439\u304d\u51fa\u3057\u306b\u8868\u793a\u3059\u308b\u30e1\u30c3\u30bb\u30fc\u30b8\uff08100\u6587\u5b57\u4ee5\u5185\uff09"
        ),
    },
    async ({ status, message }) => {
      const result = await callHttpUpdate(status, message);
      if (result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `UI\u3092\u66f4\u65b0\u3057\u305f\u306e\u3060: [${status}] ${message}`,
            },
          ],
        };
      } else {
        // HTTPサーバーが起動していなくてもエラーにしない（サイレント）
        return {
          content: [
            {
              type: "text",
              text: `UI\u30b5\u30fc\u30d0\u30fc\u306b\u63a5\u7d9a\u3067\u304d\u306a\u304b\u3063\u305f\u306e\u3060\uff08\u30b5\u30fc\u30d0\u30fc\u304c\u8d77\u52d5\u3057\u3066\u3044\u306a\u3044\u304b\u3082\uff09`,
            },
          ],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

module.exports = { startMcpServer };
