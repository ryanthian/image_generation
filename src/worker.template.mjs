const DATA = __RECIPES_JSON__;
const INDEX = __INDEX_HTML__;
const CSS = __STYLES_CSS__;
const APP = __APP_JS__;
const SPREADSHEET_ID = "1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s";
const SHEET_NAME = "Eunice Recipe Draft 20 - 2026-09-19";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function bridgeRequest(env, action, payload = {}) {
  const bridge = env.GOOGLE_SHEETS_BRIDGE_URL;
  if (!bridge) throw new Error("Google Sheets bridge is not configured.");
  const response = action === "list"
    ? await fetch(`${bridge}?${new URLSearchParams({ action, spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME })}`, { redirect: "follow" })
    : await fetch(bridge, {
        method: "POST",
        redirect: "follow",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, ...payload })
      });
  if (!response.ok) throw new Error(`Sheet bridge returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "Sheet bridge request failed.");
  return result;
}

async function handleApi(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/recipes") {
    if (!env.GOOGLE_SHEETS_BRIDGE_URL) return json({ ok: true, source: "snapshot", writable: false, ...DATA });
    try {
      const result = await bridgeRequest(env, "list");
      return json({ ok: true, source: "sheet", writable: true, spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, ...result });
    } catch (error) {
      return json({ ok: true, source: "snapshot", writable: false, warning: error.message, ...DATA });
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/recipes\/([^/]+)\/status$/);
  if (request.method === "POST" && statusMatch) {
    if (!env.GOOGLE_SHEETS_BRIDGE_URL) return json({ ok: false, error: "Google Sheets bridge is not configured; Status was not changed." }, 503);
    const body = await request.json().catch(() => ({}));
    if (body.status !== "Posted") return json({ ok: false, error: "Only Status=Posted is allowed." }, 400);
    try {
      const result = await bridgeRequest(env, "markPosted", { contentId: decodeURIComponent(statusMatch[1]), status: "Posted" });
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
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    if (url.pathname === "/styles.css") return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/app.js") return new Response(APP, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public,max-age=300" } });
    if (url.pathname === "/favicon.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f96332"/><path d="M18 17h28v30H18z" fill="#fff"/><path d="M23 25h18M23 32h18M23 39h12" stroke="#f96332" stroke-width="4" stroke-linecap="round"/></svg>', { headers: { "content-type": "image/svg+xml" } });
    return new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" } });
  }
};
