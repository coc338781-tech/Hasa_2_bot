import http from "node:http";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";

export function createAppServer() {
  return http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET" && req.url === "/healthz") {
      const body = JSON.stringify({
        service: "hasa-bot-network-api",
        status: "ok",
        version: VERSION,
        timestamp: new Date().toISOString()
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    const body = JSON.stringify({ error: "not_found" });
    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
  });
}

async function main() {
  const host = process.env.HASA_API_HOST || "127.0.0.1";
  const port = Number(process.env.HASA_API_PORT || 8787);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HASA_API_PORT must be an integer between 1 and 65535");
  }

  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`HASA BOT NETWORK API v${VERSION} listening on ${host}:${port}`);
  });

  const shutdown = signal => {
    console.log(`Received ${signal}; closing API server.`);
    server.close(error => {
      if (error) {
        console.error("API shutdown failed:", error.message);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("HASA API startup failed:", error.message);
    process.exitCode = 1;
  });
}
