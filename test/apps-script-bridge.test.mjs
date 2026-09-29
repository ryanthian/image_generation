import test from "node:test";
import assert from "node:assert/strict";
import { logAppsScriptTrace, postAppsScriptRequest } from "../src/apps-script-bridge.mjs";
import { isSheetRegistryStale, SHEET_REGISTRY_MAX_AGE_MS } from "../src/sheet-registry-cache.mjs";

const endpoint = "https://script.google.com/macros/s/deployment-id/exec";

test("Apps Script bridge uses authenticated POST and does not auto-follow the initial request", async () => {
  const calls = [];
  const body = { action: "listSheets", bridgeToken: "must-not-be-logged" };
  const { response, trace } = await postAppsScriptRequest(endpoint, body, {
    now: (() => { let time = 100; return () => time++; })(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, sheets: [] }), { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(JSON.parse(calls[0].options.body).bridgeToken, body.bridgeToken);
  assert.deepEqual(trace.request, { method: "POST", host: "script.google.com", path: "/macros/s/[deployment-id]/exec" });
  assert.deepEqual(trace.final, { method: "POST", status: 200 });
});

test("ContentService redirect follows only the one-time output URL as credential-free GET", async () => {
  const calls = [];
  const { response, trace } = await postAppsScriptRequest(endpoint, { action: "updateEditorialReview", editorialReviewToken: "secret-body" }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=one-time-secret" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.redirect, "manual");
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls[1].options.headers, undefined);
  assert.deepEqual(trace.redirects, [{ status: 302, host: "script.googleusercontent.com", path: "/macros/echo", method: "GET" }]);
  assert.deepEqual(trace.final, { method: "GET", status: 200 });
  const logged = [];
  logAppsScriptTrace(trace, (...args) => logged.push(args.join(" ")));
  assert.doesNotMatch(JSON.stringify({ trace, logged }), /one-time-secret|secret-body|user_content_key=/);
});

test("unexpected redirect back to Apps Script is rejected without invoking doGet", async () => {
  const calls = [];
  await assert.rejects(() => postAppsScriptRequest(endpoint, { action: "listSheets" }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(null, { status: 302, headers: { location: endpoint } });
    }
  }), /unexpected redirect target \(script\.google\.com\/macros\/s\/deployment-id\/exec\); it was not followed/);
  assert.equal(calls.length, 1, "the redirect is not followed as GET");
});

test("unsafe endpoint URLs and method-preserving redirects are rejected", async () => {
  await assert.rejects(() => postAppsScriptRequest(`${endpoint}?bridgeToken=secret`, { action: "listSheets" }), /without query parameters/);
  let calls = 0;
  await assert.rejects(() => postAppsScriptRequest(endpoint, { action: "updateEditorialReview" }, {
    fetchImpl: async () => { calls += 1; return new Response(null, { status: 307, headers: { location: "https://script.googleusercontent.com/macros/echo?key=hidden" } }); }
  }), /unsupported redirect status 307/);
  assert.equal(calls, 1, "a 307 is not replayed to a second host");
});

test("worker discovery is metadata-only and the diagnostic editorial probe cannot reach row mutation", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.template.mjs", import.meta.url), "utf8");
  const discovery = worker.slice(worker.indexOf("async function discoverContentSheets"), worker.indexOf("function publicSourceStateWithProfile"));
  const diagnostic = worker.slice(worker.indexOf('if (request.method === "POST" && url.pathname === "/api/bridge/diagnostics")'), worker.indexOf('request.method === "GET" && url.pathname === "/api/sheets"'));
  assert.notEqual(diagnostic.indexOf("if (request.method"), -1);
  assert.match(diagnostic, /sameOriginWriteAllowed\(request\)/);
  assert.doesNotMatch(discovery, /bridgeRequest\(env,\s*["']list["']/);
  assert.match(worker, /const result = await bridgeRequest\(env, "list", source\.sheetId\)/, "selected records are still read and strictly normalized");
  assert.match(worker, /const validEditorialStopsBeforeMutation[\s\S]*Content_ID must be an opaque non-empty string/);
  assert.match(diagnostic, /editorialReviewToken: env\.GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN/);
  assert.match(diagnostic, /contentId: "", reviewJson: ""/);
  assert.doesNotMatch(diagnostic, /setValue|updateEditorialReview_\(/);
});

test("worksheet registry cache serves known tabs while stale refresh remains explicit and background-safe", async () => {
  const now = Date.parse("2026-09-29T10:00:00.000Z");
  const fresh = [{ baselineState: "CURRENT_SOURCE", lastDiscoveredAt: new Date(now - 1000).toISOString() }];
  const stale = [{ baselineState: "CURRENT_SOURCE", lastDiscoveredAt: new Date(now - SHEET_REGISTRY_MAX_AGE_MS - 1).toISOString() }];
  assert.equal(isSheetRegistryStale([], now), true);
  assert.equal(isSheetRegistryStale(fresh, now), false);
  assert.equal(isSheetRegistryStale(stale, now), true);

  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.template.mjs", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  const route = worker.slice(worker.indexOf('if (request.method === "GET" && url.pathname === "/api/sheets")'), worker.indexOf('if (request.method === "GET" && url.pathname === "/api/sheet-templates")'));
  assert.match(route, /url\.searchParams\.get\("refresh"\) === "1"/);
  assert.match(route, /source: "registry"/);
  assert.match(route, /executionContext\.waitUntil\(discoverContentSheets/);
  assert.match(app, /refreshSheets\(true, true\)/, "the explicit Refresh Sheets action forces live discovery");
  assert.match(build, /copyFile\("src\/sheet-registry-cache\.mjs", "dist\/server\/sheet-registry-cache\.mjs"\)/,
    "the production Worker archive includes the registry cache dependency");
});
