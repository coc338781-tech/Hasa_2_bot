import http from "node:http";
import { pathToFileURL } from "node:url";
import { acceptHeartbeat } from "./heartbeat.js";

const VERSION = "0.2.0";
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(encoded) });
  res.end(encoded);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

export function createAppServer({ agentStore = null, clock = () => Date.now() } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(res, 200, { service: "hasa-bot-network-api", status: "ok", version: VERSION, timestamp: new Date(clock()).toISOString() });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/agent/heartbeat") {
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || "");
      if (!match) { sendJson(res, 401, { error: "unauthorized" }); return; }
      try {
        const payload = await readJson(req);
        const result = await acceptHeartbeat({ token: match[1], payload, store: agentStore, now: clock() });
        sendJson(res, result.status, result.body || { error: result.error });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" });
      }
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}

async function main() {
  const host = process.env.HASA_API_HOST || "127.0.0.1";
  const port = Number(process.env.HASA_API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HASA_API_PORT must be an integer between 1 and 65535");
  const server = createAppServer();
  server.listen(port, host, () => console.log(`HASA BOT NETWORK API v${VERSION} listening on ${host}:${port}`));
  const shutdown = signal => server.close(error => {
    if (error) { console.error("API shutdown failed:", error.message); process.exitCode = 1; }
    else console.log(`Received ${signal}; API server closed.`);
  });
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("HASA API startup failed:", error.message); process.exitCode = 1; });
}
