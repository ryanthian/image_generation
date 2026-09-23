import { handleIntelligenceApi } from "./intelligence-server.mjs";
import { buildOpportunityCanary, normalizePerformance } from "./opportunity-engine.mjs";
import { compileV4CanaryCandidate, V4_CANARY_HEADERS } from "./v4-preappend.mjs";

const DATA = __RECIPES_JSON__;
const CANARY = __CANARY_JSON__;
const V42_HISTORY = __V42_HISTORY_JSON__;
const INDEX = __INDEX_HTML__;
const CSS = __STYLES_CSS__;
const APP = __APP_JS__;
const CONTENT_MODEL = __CONTENT_MODEL_JS__;
const INTELLIGENCE = __INTELLIGENCE_JS__;
const OPPORTUNITIES = __OPPORTUNITIES_JS__;
const SPREADSHEET_ID = "1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s";
const SHEETS = [
  { name: "Eunice Recipe Draft 20 - 2026-09-19", label: "All Eunice recipes · 120" },
  { name: "Eunice Recipe Draft 100 - 2026-09-20", label: "New ranked batch · 100" },
  { name: "V4_CANARY", label: "V4 Google Sheet canary · 10" }
];
const CANARY_SOURCE = { name: CANARY.sourceName, label: CANARY.label };
const SOURCES = [...SHEETS, CANARY_SOURCE];
const DEFAULT_SHEET = SHEETS[0].name;

function allowedSheet(value) {
  return SHEETS.some((sheet) => sheet.name === value) ? value : DEFAULT_SHEET;
}

function allowedSource(value) {
  return SOURCES.some((source) => source.name === value) ? value : DEFAULT_SHEET;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function appendBridgeQuery(bridge, params) {
  return `${bridge}${bridge.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`;
}

async function bridgeRequest(env, action, sheetName, payload = {}) {
  const bridge = env.GOOGLE_SHEETS_BRIDGE_URL;
  if (!bridge) throw new Error("Google Sheets bridge is not configured.");
  const response = action === "list"
    ? await fetch(appendBridgeQuery(bridge, { action, spreadsheetId: SPREADSHEET_ID, sheetName }), { redirect: "follow" })
    : await fetch(bridge, {
        method: "POST",
        redirect: "follow",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, spreadsheetId: SPREADSHEET_ID, sheetName, ...payload })
      });
  if (!response.ok) throw new Error(`Sheet bridge returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "Sheet bridge request failed.");
  return result;
}

async function handleApi(request, env, url) {
  if (request.method === "POST" && url.pathname === "/api/v4-canary/append") {
    if (env.V4_APPEND_ENABLED !== "true" || !env.V4_APPEND_GATE_TOKEN || !env.V4_APPEND_API_TOKEN) return json({ ok: false, error: "The V4 append gate is not enabled." }, 503);
    if (request.headers.get("x-v4-append-api-token") !== env.V4_APPEND_API_TOKEN) return json({ ok: false, error: "V4 append authorization failed." }, 401);
    const body = await request.json().catch(() => ({}));
    const compiled = compileV4CanaryCandidate(body.record);
    if (!compiled.ok) return json(compiled, 422);
    try {
      const result = await bridgeRequest(env, "appendV4Candidate", "V4_CANARY", {
        gateToken: env.V4_APPEND_GATE_TOKEN,
        headers: V4_CANARY_HEADERS,
        row: V4_CANARY_HEADERS.map((header) => compiled.record[header] ?? "")
      });
      return json({ ok: true, status: "APPENDED", contentId: compiled.content.contentId, rowNumber: result.rowNumber });
    } catch (error) {
      return json({ ok: false, error: error.message }, 502);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/opportunities/canary") {
    const historical = V42_HISTORY.records.map(normalizePerformance);
    return json({ ok: true, engine: "v4.2-explainable-opportunity-engine", historical, opportunities: buildOpportunityCanary(historical) });
  }
  if (request.method === "GET" && url.pathname === "/api/recipes") {
    const requestedSource = allowedSource(url.searchParams.get("sheetName"));
    if (requestedSource === CANARY_SOURCE.name) return json({ ok: true, source: "canary", writable: false, sheetName: CANARY_SOURCE.name, sheets: SOURCES, records: CANARY.records });
    const sheetName = allowedSheet(requestedSource);
    if (!env.GOOGLE_SHEETS_BRIDGE_URL) return json({ ok: true, source: "snapshot", writable: false, sheetName: DEFAULT_SHEET, sheets: SOURCES, ...DATA });
    try {
      const result = await bridgeRequest(env, "list", sheetName);
      return json({ ok: true, source: "sheet", writable: true, spreadsheetId: SPREADSHEET_ID, sheetName, sheets: SOURCES, ...result });
    } catch (error) {
      return json({ ok: true, source: "snapshot", writable: false, sheetName: DEFAULT_SHEET, sheets: SOURCES, warning: error.message, ...DATA });
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/recipes\/([^/]+)\/status$/);
  if (request.method === "POST" && statusMatch) {
    if (!env.GOOGLE_SHEETS_BRIDGE_URL) return json({ ok: false, error: "Google Sheets bridge is not configured; Status was not changed." }, 503);
    const body = await request.json().catch(() => ({}));
    if (body.status !== "Posted") return json({ ok: false, error: "Only Status=Posted is allowed." }, 400);
    try {
      const sheetName = allowedSheet(body.sheetName);
      const result = await bridgeRequest(env, "markPosted", sheetName, { contentId: decodeURIComponent(statusMatch[1]), status: "Posted" });
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ ok: false, error: error.message }, 502);
    }
  }
  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/intelligence/")) return handleIntelligenceApi(request, env, url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    if (url.pathname === "/styles.css") return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/app.js") return new Response(APP, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/content-model.js") return new Response(CONTENT_MODEL, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/intelligence.js") return new Response(INTELLIGENCE, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/opportunities.js") return new Response(OPPORTUNITIES, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/favicon.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f96332"/><path d="M18 17h28v30H18z" fill="#fff"/><path d="M23 25h18M23 32h18M23 39h12" stroke="#f96332" stroke-width="4" stroke-linecap="round"/></svg>', { headers: { "content-type": "image/svg+xml" } });
    return new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" } });
  }
};
