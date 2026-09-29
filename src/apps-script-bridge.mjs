const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CONTENT_REDIRECT_STATUSES = new Set([301, 302, 303]);

function endpointMetadata(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Google Sheets bridge URL is invalid."); }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error("Google Sheets bridge URL must be a direct HTTPS Apps Script Web App /exec endpoint without query parameters.");
  }
  return { url, host: url.hostname, path: "/macros/s/[deployment-id]/exec" };
}

function redirectMetadata(location, baseUrl) {
  let url;
  try { url = new URL(location, baseUrl); } catch { throw new Error("Apps Script returned an invalid redirect location."); }
  return { url, host: url.hostname, path: url.pathname };
}

function contentServiceRedirect(location, baseUrl) {
  const redirect = redirectMetadata(location, baseUrl);
  if (redirect.url.protocol !== "https:" || redirect.host !== "script.googleusercontent.com" || !redirect.path.startsWith("/macros/echo")) {
    throw new Error(`Apps Script returned an unexpected redirect target (${redirect.host}${redirect.path}); it was not followed.`);
  }
  return redirect;
}

/**
 * POSTs an authenticated Apps Script operation without automatic redirects.
 * Apps Script ContentService redirects its already-computed output to a
 * one-time script.googleusercontent.com URL. Only that response fetch is a
 * GET; credentials/body are never forwarded and redirects back to /exec are
 * rejected instead of accidentally invoking doGet.
 */
export async function postAppsScriptRequest(endpoint, body, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const target = endpointMetadata(endpoint);
  const startedAt = now();
  const trace = {
    action: typeof body?.action === "string" ? body.action : "unknown",
    request: { method: "POST", host: target.host, path: target.path },
    redirects: [],
    final: null,
    elapsedMs: null
  };

  const response = await fetchImpl(target.url.toString(), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  let finalResponse = response;
  if (REDIRECT_STATUSES.has(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw Object.assign(new Error("Apps Script returned a redirect without a Location header."), { trace });
    if (!CONTENT_REDIRECT_STATUSES.has(response.status)) {
      throw Object.assign(new Error(`Apps Script returned unsupported redirect status ${response.status}; the request was not replayed.`), { trace });
    }
    let redirect;
    try { redirect = contentServiceRedirect(location, target.url); }
    catch (error) { throw Object.assign(error, { trace }); }
    trace.redirects.push({ status: response.status, host: redirect.host, path: redirect.path, method: "GET" });
    // The one-time ContentService URL is output-only. No token header or POST
    // body crosses origins; reject any second redirect rather than following
    // an unknown destination or re-entering the Apps Script doGet handler.
    finalResponse = await fetchImpl(redirect.url.toString(), { method: "GET", redirect: "manual" });
    if (REDIRECT_STATUSES.has(finalResponse.status)) {
      throw Object.assign(new Error(`Apps Script ContentService returned an unexpected second redirect (${finalResponse.status}); it was not followed.`), { trace });
    }
  }
  trace.final = { method: trace.redirects.length ? "GET" : "POST", status: finalResponse.status };
  trace.elapsedMs = Math.max(0, now() - startedAt);
  return { response: finalResponse, trace };
}

export function logAppsScriptTrace(trace, logger = console.info) {
  if (typeof logger !== "function") return;
  // Trace deliberately excludes URL queries, headers, request bodies and
  // credentials. It records only the method/host/path/status chain.
  logger("apps_script_bridge", JSON.stringify(trace));
}
