import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { handleIntelligenceApi, MemoryIntelligenceStore } from "../src/intelligence-server.mjs";

const port = Number(process.env.PORT || 4173);
const store = new MemoryIntelligenceStore();
const files = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/content-model.js": ["src/content-model.mjs", "text/javascript; charset=utf-8"],
  "/intelligence.js": ["public/intelligence.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["public/favicon.svg", "image/svg+xml"]
};
const recipes = JSON.parse(await readFile("data/recipes.json", "utf8"));
const canary = JSON.parse(await readFile("data/content-v4-canary.json", "utf8"));
const sources = [
  { name: "Local verification snapshot", label: "Local verification snapshot · 20" },
  { name: canary.sourceName, label: canary.label }
];

createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, `http://${incoming.headers.host}`);
  if (url.pathname.startsWith("/api/intelligence/")) {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(chunks) });
    const response = await handleIntelligenceApi(request, {}, url, store);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (incoming.method === "GET" && url.pathname === "/api/recipes") {
    if (url.searchParams.get("sheetName") === canary.sourceName) {
      outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ ok: true, source: "canary", writable: false, sheetName: canary.sourceName, sheets: sources, records: canary.records }));
      return;
    }
    outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, source: "snapshot", writable: false, sheetName: "Local verification snapshot", sheets: sources, ...recipes }));
    return;
  }
  if (files[url.pathname]) {
    const [path, type] = files[url.pathname];
    outgoing.writeHead(200, { "content-type": type });
    outgoing.end(await readFile(path));
    return;
  }
  outgoing.writeHead(404, { "content-type": "text/plain" });
  outgoing.end("Not found");
}).listen(port, "127.0.0.1", () => console.log(`Local verification server: http://127.0.0.1:${port}`));
