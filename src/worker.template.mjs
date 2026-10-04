import { handleIntelligenceApi } from "./intelligence-server.mjs";
import { logAppsScriptTrace, postAppsScriptRequest } from "./apps-script-bridge.mjs";
import { buildOpportunityCanary, normalizePerformance } from "./opportunity-engine.mjs";
import { compileV4CanaryCandidate, V4_CANARY_HEADERS } from "./v4-preappend.mjs";
import { isSheetRegistryStale } from "./sheet-registry-cache.mjs";
import { deriveGenerationReadiness, normalizeContentRecordsSafely, normalizeContentRecord, runContentQc, runEditorialReview } from "./content-model.mjs";
import {applyEditorialWork,sourceFingerprint} from './editorial-pipeline.mjs';
import { D1ProductionStore, inspectSheetHeaders, isReservedSheetName, publicSheetTemplate, SHEET_TEMPLATES, handleProductionOperationsApi } from "./production-operations.mjs";
import { INITIAL_SOURCE_SEEDS } from "./sheet-contracts.mjs";

const DATA = __RECIPES_JSON__;
const V42_HISTORY = __V42_HISTORY_JSON__;
const INDEX = __INDEX_HTML__;
const CSS = __STYLES_CSS__;
const APP = __APP_JS__;
const CONTENT_MODEL = __CONTENT_MODEL_JS__;
const PRODUCTION_CORE = __PRODUCTION_CORE_JS__;
const CONTENT_QUALITY = __CONTENT_QUALITY_JS__;
const PRODUCTION_ASSISTANT = __PRODUCTION_ASSISTANT_JS__;
const EDITORIAL_PIPELINE = __EDITORIAL_PIPELINE_JS__;
const BATCH_01 = __BATCH_01_JSON__;
const CANONICAL_MAP = __CANONICAL_MAP_JSON__;
const BUILD_INFO = __BUILD_INFO_JSON__;
const INTELLIGENCE = __INTELLIGENCE_JS__;
const OPPORTUNITIES = __OPPORTUNITIES_JS__;
const SPREADSHEET_ID = "1AVWQTZarym7Q4nhCYrZdARVVJDluWCMol8maPR_aN4s";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function fetchBridgeRead(url, body) {
  // Apps Script's one-time ContentService output URL can intermittently return 404.
  // This helper is used only for read actions, so a fresh POST may be retried safely.
  const retryable = new Set([404, 429, 500, 502, 503, 504]);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { response, trace } = await postAppsScriptRequest(url, body);
      logAppsScriptTrace({ ...trace, attempt: attempt + 1 });
      if (retryable.has(response.status) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error.trace) logAppsScriptTrace({ ...error.trace, attempt: attempt + 1, error: error.message });
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`Google Sheets read bridge failed after a bounded retry: ${lastError?.message || "temporary HTTP error"}`);
}

async function bridgeRequest(env, action, sheetRef = null, payload = {}) {
  const bridge = env.GOOGLE_SHEETS_BRIDGE_URL;
  if (!bridge) throw new Error("Google Sheets bridge is not configured.");
  const bridgeToken = env.GOOGLE_SHEETS_BRIDGE_TOKEN;
  if (!bridgeToken) throw new Error("Secure Google Sheets bridge authentication is not configured.");
  const getActions = new Set(["list", "listSheets"]);
  const requestBody = {
    ...payload,
    action,
    spreadsheetId: SPREADSHEET_ID,
    bridgeToken,
    ...(sheetRef !== null ? {
      ...(typeof sheetRef === "number" || /^\d+$/.test(String(sheetRef || "")) ? { sheetId: sheetRef } : { sheetName: sheetRef })
    } : {})
  };
  const response = getActions.has(action)
    ? await fetchBridgeRead(bridge, requestBody)
    : await (async () => {
        const { response: result, trace } = await postAppsScriptRequest(bridge, requestBody);
        logAppsScriptTrace(trace);
        return result;
      })();
  if (!response.ok) throw new Error(`Sheet bridge returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "Sheet bridge request failed.");
  return result;
}

async function discoverContentSheets(env, store) {
  const result = await bridgeRequest(env, "listSheets");
  if (!Array.isArray(result.sheets)) throw new Error("Apps Script bridge did not return worksheet metadata.");
  const discovered = result.sheets.map((sheet) => ({ sheetId: Number(sheet.sheetId), title: String(sheet.title || ""), headers: Array.isArray(sheet.headers) ? sheet.headers : [], inspectionError: sheet.inspectionError || "" })).filter((sheet) => Number.isSafeInteger(sheet.sheetId) && sheet.sheetId > 0);
  if (await store.countSheets() === 0) await store.initializeBaseline(discovered, INITIAL_SOURCE_SEEDS);
  const presentIds = new Set(discovered.map((sheet) => sheet.sheetId));
  await store.markMissingSheets(presentIds);
  const current = new Map((await store.listSheets()).map((sheet) => [Number(sheet.sheetId), sheet]));
  const profiles = await store.listProfiles();
  for (const sheet of discovered) {
    let registered = current.get(sheet.sheetId);
    // Do not auto-enrol obvious workbook/system tabs, but leave them unregistered so a later
    // deliberate rename to a valid content tab can still be discovered by its stable sheetId.
    if (!registered && isReservedSheetName(sheet.title)) continue;
    if (!registered) {
      const schema = inspectSheetHeaders(sheet.headers);
      const schemaStatus = sheet.inspectionError ? "NEEDS_SETUP" : schema.setupStatus;
      const reasons = sheet.inspectionError ? [`Header inspection failed: ${sheet.inspectionError}`] : [...schema.reasons];
      const contentType = schema.schemaFamily === "V4_UNIVERSAL" ? "ROW_DEFINED" : schema.contentType;
      const schemaFamily = schema.schemaFamily;
      const schemaVersion = schema.schemaVersion;
      const templateId = schema.templateId;
      registered = await store.upsertDiscoveredSheet({ sheetId: sheet.sheetId, title: sheet.title, schemaFamily, schemaVersion, contentType, templateId, schemaStatus, setupReasons: reasons, targetPageProfileId: "", active: true, baselineState: "AUTO_DISCOVERED" });
    } else if (registered.baselineState !== "EXISTING_UNCONNECTED") {
      const updated = { ...registered, title: sheet.title };
      if (sheet.inspectionError) { updated.schemaStatus = "NEEDS_SETUP"; updated.setupReasons = [`Header inspection failed: ${sheet.inspectionError}`]; }
      else {
        const schema = inspectSheetHeaders(sheet.headers);
        updated.schemaFamily = schema.schemaFamily;
        updated.schemaVersion = schema.schemaVersion;
        updated.contentType = schema.schemaFamily === "V4_UNIVERSAL"
          ? registered.schemaFamily === "V4_UNIVERSAL" && registered.contentType ? registered.contentType : "ROW_DEFINED"
          : schema.contentType;
        updated.templateId = schema.templateId;
        updated.schemaStatus = schema.setupStatus;
        updated.setupReasons = [...schema.reasons];
      }
      registered = await store.upsertDiscoveredSheet(updated);
    }
  }
  const registry = await store.listSheets();
  return {
    // Existing unconnected tabs are retained but presumed to be system/research tabs until connected.
    sheets: registry.filter((sheet) => sheet.baselineState !== "EXISTING_UNCONNECTED").map((sheet) => publicSourceStateWithProfile(sheet, profiles)),
    registry,
    profiles
  };
}

function publicSourceStateWithProfile(sheet, profiles) {
  const profile = profiles.find((item) => item.profileId === sheet.targetPageProfileId);
  const profileReady = Boolean(profile?.active && profile.facebookPageId && profile.displayName && profile.audience && profile.primaryLanguage && profile.toneGuidance && profile.avoidTopics?.length);
  const setupStatus = sheet.schemaStatus === "UNAVAILABLE" ? "UNAVAILABLE" : !sheet.active ? "INACTIVE" : sheet.schemaStatus !== "READY" ? "NEEDS_SETUP" : "READY";
  const setupReasons = [...(sheet.setupReasons || [])];
  return {
    sheetId: Number(sheet.sheetId), name: sheet.title, title: sheet.title,
    contentType: sheet.contentType || "Unknown", templateId: sheet.templateId || "",
    schemaVersion: sheet.schemaVersion ?? null, schemaStatus: sheet.schemaStatus,
    setupStatus, setupReasons, active: Boolean(sheet.active),
    targetPageProfileId: sheet.targetPageProfileId || "",
    targetPageName: profile?.displayName || "Not assigned",
    publishingSetupBlockers: profileReady ? [] : ["Assign a complete target Facebook Page profile before publishing."],
    label: `${sheet.title} · ${sheet.contentType || "Needs Setup"} · ${profile?.displayName || "Page not assigned"}`
  };
}

async function resolveSourceRecords(env, source) {
  if (!source?.active) return { ok: false, status: 404, error: "This worksheet is registered but inactive." };
  if (source.schemaStatus === "UNAVAILABLE") return { ok: false, status: 503, error: source.setupReasons?.[0] || "Worksheet is unavailable." };
  if (source.schemaStatus !== "READY") return { ok: false, status: 422, error: "Worksheet needs setup and is not processed as content.", setupStatus: "NEEDS_SETUP", setupReasons: source.setupReasons || [] };
  try {
    const result = await bridgeRequest(env, "list", source.sheetId);
    const liveSchema = inspectSheetHeaders(result.headers || []);
    if (liveSchema.setupStatus !== "READY") {
      throw new Error(liveSchema.reasons.join(" ") || "Worksheet headers do not match a supported content contract.");
    }
    const records = result.records || result.recipes || [];
    const safe = normalizeContentRecordsSafely(records);
    return { ok: true, result, records: safe.records.map(item => item.raw), normalized: safe.records, rejected: safe.rejected, totalRows: records.length };
  } catch (error) {
    return { ok: false, status: 422, error: `Worksheet content failed strict validation: ${error.message}`, setupStatus: "NEEDS_SETUP", setupReasons: [error.message] };
  }
}

function sameOriginWriteAllowed(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  return (!fetchSite || ["same-origin", "none"].includes(fetchSite)) && request.headers.get("x-content-intelligence-request") === "1";
}

async function handleApi(request, env, url, executionContext) {
  const productionStore = env.DB ? new D1ProductionStore(env.DB) : null;
  if (request.method === "GET" && url.pathname === "/api/build") return json(BUILD_INFO);
  if (request.method === 'GET' && url.pathname === '/api/editorial/batch') return json({ok:true,batch:BATCH_01});
  if (request.method === 'GET' && url.pathname === '/api/editorial/canonical-map') return json({ok:true,map:CANONICAL_MAP});
  if (request.method === "POST" && url.pathname === "/api/bridge/diagnostics") {
    if (!sameOriginWriteAllowed(request)) return json({ ok: false, error: "Same-origin diagnostic request required." }, 403);
    if (!env.GOOGLE_SHEETS_BRIDGE_URL || !env.GOOGLE_SHEETS_BRIDGE_TOKEN || !env.GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN) {
      return json({ ok: false, error: "A secured Apps Script bridge setting is not configured." }, 503);
    }
    const common = { spreadsheetId: SPREADSHEET_ID };
    const probe = async (actionBody) => {
      const { response, trace } = await postAppsScriptRequest(env.GOOGLE_SHEETS_BRIDGE_URL, actionBody);
      logAppsScriptTrace(trace);
      const result = await response.json().catch(() => null);
      return { result, trace };
    };
    let validRead, invalidRead, missingRead, validEditorial, invalidEditorial, missingEditorial;
    try {
      [validRead, invalidRead, missingRead, validEditorial, invalidEditorial, missingEditorial] = await Promise.all([
        probe({ ...common, action: "listSheets", bridgeToken: env.GOOGLE_SHEETS_BRIDGE_TOKEN }),
        probe({ ...common, action: "listSheets", bridgeToken: "codex-invalid-bridge-probe" }),
        probe({ ...common, action: "listSheets" }),
        // The Apps Script handler checks editorial auth before Content_ID. The
        // intentionally invalid ID therefore proves token pairing without
        // reaching row lookup or changing any Sheet cell.
        probe({ ...common, action: "updateEditorialReview", bridgeToken: env.GOOGLE_SHEETS_BRIDGE_TOKEN, editorialReviewToken: env.GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN, contentId: "", reviewJson: "" }),
        probe({ ...common, action: "updateEditorialReview", bridgeToken: env.GOOGLE_SHEETS_BRIDGE_TOKEN, editorialReviewToken: "codex-invalid-editorial-probe", contentId: "", reviewJson: "" }),
        probe({ ...common, action: "updateEditorialReview", bridgeToken: env.GOOGLE_SHEETS_BRIDGE_TOKEN, contentId: "", reviewJson: "" })
      ]);
    } catch {
      return json({ ok: false, error: "The secured Apps Script bridge diagnostic did not complete; no Sheet write was attempted." }, 502);
    }
    const tabNames = Array.isArray(validRead.result?.sheets) ? validRead.result.sheets.map((tab) => String(tab.title || "")) : [];
    const expectedTabs = ["Eunice Recipe Draft 20 - 2026-09-19", "Eunice Recipe Draft 100 - 2026-09-20", "V4_CANARY"];
    const validEditorialStopsBeforeMutation = validEditorial.result?.ok === false
      && String(validEditorial.result.error || "").startsWith("Content_ID must be an opaque non-empty string.");
    return json({
      ok: true,
      probes: {
        validBridgeRead: validRead.result?.ok === true,
        invalidBridgeRejected: invalidRead.result?.ok === false,
        missingBridgeRejected: missingRead.result?.ok === false,
        validEditorialTokenAcceptedWithoutWrite: validEditorialStopsBeforeMutation,
        invalidEditorialRejected: invalidEditorial.result?.ok === false && String(invalidEditorial.result.error || "").includes("authorization failed"),
        missingEditorialRejected: missingEditorial.result?.ok === false && String(missingEditorial.result.error || "").includes("authorization failed"),
        editorialProbeWroteNothing: validEditorialStopsBeforeMutation
      },
      liveTabs: expectedTabs.filter((name) => tabNames.includes(name)),
      bridgeTrace: validRead.trace
    });
  }
  if (request.method === "GET" && url.pathname === "/api/sheets") {
    if (!productionStore) return json({ ok: false, error: "Production source registry is not configured." }, 503);
    try {
      const forceLiveRefresh = url.searchParams.get("refresh") === "1";
      const cachedRegistry = await productionStore.listSheets();
      if (!forceLiveRefresh && cachedRegistry.length > 0) {
        const profiles = await productionStore.listProfiles();
        const latestDiscovery = cachedRegistry.reduce((latest, sheet) => Math.max(latest, Date.parse(sheet.lastDiscoveredAt || "") || 0), 0);
        const response = {
          ok: true,
          source: "registry",
          sheets: cachedRegistry.filter((sheet) => sheet.baselineState !== "EXISTING_UNCONNECTED").map((sheet) => publicSourceStateWithProfile(sheet, profiles)),
          profiles,
          discoveredAt: latestDiscovery ? new Date(latestDiscovery).toISOString() : null
        };
        if (isSheetRegistryStale(cachedRegistry)) {
          if (executionContext?.waitUntil) {
            executionContext.waitUntil(discoverContentSheets(env, productionStore).catch(() => {
              console.warn("sheet_registry_background_refresh_failed");
            }));
          } else {
            const discovery = await discoverContentSheets(env, productionStore);
            return json({ ok: true, source: "sheet", sheets: discovery.sheets, profiles: discovery.profiles, discoveredAt: new Date().toISOString() });
          }
        }
        return json(response);
      }
      const discovery = await discoverContentSheets(env, productionStore);
      return json({ ok: true, source: "sheet", spreadsheetId: SPREADSHEET_ID, sheets: discovery.sheets, profiles: discovery.profiles, discoveredAt: new Date().toISOString() });
    } catch (error) { return json({ ok: false, error: error.message, sheets: await productionStore.listSheets().catch(() => []) }, 503); }
  }
  if (request.method === "GET" && url.pathname === "/api/sheet-templates") return json({ ok: true, templates: SHEET_TEMPLATES.map(publicSheetTemplate) });
  if (request.method === "POST" && url.pathname === "/api/sheets") {
    if (!sameOriginWriteAllowed(request)) return json({ ok: false, error: "Sheet creation requires a same-origin request." }, 403);
    if (!productionStore) return json({ ok: false, error: "Production source registry is not configured." }, 503);
    if (!env.GOOGLE_SHEETS_ADMIN_TOKEN) return json({ ok: false, error: "Secure worksheet creation is not configured." }, 503);
    const body = await request.json().catch(() => ({}));
    const template = SHEET_TEMPLATES.find((item) => item.templateId === body.templateId);
    const title = String(body.title || "").trim();
    if (!template) return json({ ok: false, error: "Choose a registered content template." }, 400);
    if (title.length < 3 || title.length > 90 || /[\[\]:*?\\/]/.test(title)) return json({ ok: false, error: "Worksheet name must be 3–90 characters and cannot contain [ ] : * ? \\ /." }, 400);
    if (isReservedSheetName(title)) return json({ ok: false, error: "That worksheet name is reserved for system or lifecycle use." }, 400);
    try {
      const discovery = await discoverContentSheets(env, productionStore);
      if (discovery.registry.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) return json({ ok: false, error: "A worksheet with this name already exists; existing tabs are never overwritten." }, 409);
      if (body.targetPageProfileId && !await productionStore.getProfile(body.targetPageProfileId)) return json({ ok: false, error: "Selected page profile does not exist." }, 400);
      const result = await bridgeRequest(env, "createSheet", null, { adminToken: env.GOOGLE_SHEETS_ADMIN_TOKEN, sheetName: title, templateId: template.templateId, headers: [...template.headers] });
      const sheet = await productionStore.upsertDiscoveredSheet({ sheetId: Number(result.sheetId), title: result.title || title, schemaFamily: template.schemaVersion === 4 ? "V4_UNIVERSAL" : "LEGACY_RECIPE", schemaVersion: template.schemaVersion, contentType: template.contentType, templateId: template.templateId, schemaStatus: "READY", setupReasons: [], targetPageProfileId: body.targetPageProfileId || "", active: true, baselineState: "APP_CREATED" });
      return json({ ok: true, sheet: publicSourceStateWithProfile(sheet, await productionStore.listProfiles()) }, 201);
    } catch (error) { return json({ ok: false, error: error.message }, 502); }
  }
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
    if (!productionStore) return json({ ok: false, error: "Production source registry is not configured; no static content fallback was used." }, 503);
    try {
      const requestedId = Number(url.searchParams.get("sheetId"));
      const requestedName = url.searchParams.get("sheetName");
      let registry = await productionStore.listSheets();
      let profiles = await productionStore.listProfiles();
      if (!registry.length || (requestedId && !registry.some((item) => Number(item.sheetId) === requestedId)) || (requestedName && !registry.some((item) => item.title === requestedName))) {
        const discovery = await discoverContentSheets(env, productionStore);
        registry = discovery.registry;
        profiles = discovery.profiles;
      }
      const availableSheets = registry.filter((item) => item.baselineState !== "EXISTING_UNCONNECTED").map((item) => publicSourceStateWithProfile(item, profiles));
      const sheet = registry.find((item) => requestedId ? Number(item.sheetId) === requestedId : requestedName ? item.title === requestedName : item.active && item.schemaStatus === "READY");
      if (!sheet) return json({ ok: false, error: "No registered production worksheet matches this request." }, 404);
      const sourceState = availableSheets.find((item) => item.sheetId === Number(sheet.sheetId));
      if (sheet.schemaStatus === "UNAVAILABLE") return json({ ok: true, source: "sheet", writable: false, sheetId: Number(sheet.sheetId), sheetName: sheet.title, setupStatus: "UNAVAILABLE", setupReasons: sheet.setupReasons || ["This worksheet is unavailable."], records: [], sheets: availableSheets });
      if (!sheet.active) return json({ ok: true, source: "sheet", writable: false, sheetId: Number(sheet.sheetId), sheetName: sheet.title, setupStatus: "INACTIVE", setupReasons: ["This worksheet is inactive in the Console registry."], records: [], sheets: availableSheets });
      if (sheet.schemaStatus !== "READY") return json({ ok: true, source: "sheet", writable: false, sheetId: Number(sheet.sheetId), sheetName: sheet.title, setupStatus: sourceState?.setupStatus || "NEEDS_SETUP", setupReasons: sourceState?.setupReasons || sheet.setupReasons || [], records: [], sheets: availableSheets });
      const loaded = await resolveSourceRecords(env, sheet);
      if (!loaded.ok) {
        await productionStore.upsertDiscoveredSheet({ ...sheet, schemaStatus: "NEEDS_SETUP", setupReasons: loaded.setupReasons || [loaded.error] });
        return json({ ok: true, source: "sheet", writable: false, sheetId: Number(sheet.sheetId), sheetName: sheet.title, setupStatus: "NEEDS_SETUP", setupReasons: loaded.setupReasons || [loaded.error], records: [], sheets: availableSheets });
      }
      const pageProfile = sheet.targetPageProfileId ? await productionStore.getProfile(sheet.targetPageProfileId) : null;
      const pageProfileComplete = Boolean(pageProfile?.active && pageProfile.facebookPageId && pageProfile.displayName && pageProfile.audience && pageProfile.primaryLanguage && pageProfile.toneGuidance && pageProfile.avoidTopics?.length);
      const savedWorks=await productionStore.listReviews(Number(sheet.sheetId));
      const workById=new Map(savedWorks.map(item=>[item.contentId,item]));
      const editorialWork=Object.fromEntries(await Promise.all(loaded.records.map(async record=>{const contentId=String(record.Content_ID||record.content_id||'');const saved=workById.get(contentId);return [contentId,saved?{...saved,stale:saved.review.sourceFingerprint!==await sourceFingerprint(record)}:null];})));
      return json({ ok: true, source: "sheet", writable: true, spreadsheetId: SPREADSHEET_ID, sheetId: Number(sheet.sheetId), sheetName: loaded.result.sheetName || sheet.title, sourceState, pageProfile, pageProfileComplete, publishingSetupBlockers: pageProfileComplete ? [] : ["Assign and activate a complete target Facebook Page profile before publishing."], sheets: availableSheets, profiles, headers: loaded.result.headers || [], records: loaded.records, editorialWork, rejected: loaded.rejected, totalRows: loaded.totalRows });
    } catch (error) { return json({ ok: false, source: "sheet", error: error.message, records: [] }, 503); }
  }

  const statusMatch = url.pathname.match(/^\/api\/recipes\/([^/]+)\/status$/);
  if (request.method === "POST" && statusMatch) {
    if (!sameOriginWriteAllowed(request)) return json({ ok: false, error: "Status writes require a same-origin request." }, 403);
    if (!env.GOOGLE_SHEETS_BRIDGE_URL || !productionStore) return json({ ok: false, error: "Google Sheets bridge is not configured; Status was not changed." }, 503);
    const body = await request.json().catch(() => ({}));
    if (body.status !== "Posted") return json({ ok: false, error: "Only Status=Posted is allowed." }, 400);
    try {
      const sheetId = Number(body.sheetId);
      const sheet = await productionStore.getSheet(sheetId);
      if (!sheet?.active || sheet.schemaStatus !== "READY") return json({ ok: false, error: "Selected worksheet is not an active, validated source." }, 422);
      const contentId = decodeURIComponent(statusMatch[1]);
      const loaded = await resolveSourceRecords(env, sheet);
      if (!loaded.ok) return json({ ok: false, error: loaded.error }, loaded.status || 422);
      const recordIndex = loaded.records.findIndex((record) => String(record.Content_ID || record.content_id || "") === contentId);
      if (recordIndex < 0) return json({ ok: false, error: "Content_ID was not found in the selected worksheet." }, 404);
      const pageProfile = sheet.targetPageProfileId ? await productionStore.getProfile(sheet.targetPageProfileId) : null;
      let content = loaded.normalized[recordIndex];
      if (pageProfile) content = { ...content, pageProfile };
      const savedWork=await productionStore.getReview(sheetId,contentId);
      if(savedWork)content=applyEditorialWork(content,savedWork,await sourceFingerprint(content.raw)).content;
      const contract = runContentQc(content);
      const editorial = runEditorialReview(content);
      const generation = deriveGenerationReadiness(content, { structuralQc: contract, editorialReview: editorial });
      const profileReady = Boolean(pageProfile?.active && pageProfile.facebookPageId && pageProfile.displayName && pageProfile.audience && pageProfile.primaryLanguage && pageProfile.toneGuidance && pageProfile.avoidTopics?.length);
      if (!profileReady || !generation.ready) return json({ ok: false, error: "Posting is blocked until the selected Page profile, structural contract and editorial review all pass.", contract: contract.status, editorial: editorial.status, generation: generation.status }, 422);
      if (body.requiredImagesPresent !== true || body.finalAssetsPresent !== true || body.visualQcPass !== true || body.technicalImageQcPass !== true || body.noStaleAssets !== true) return json({ ok: false, error: "Confirm all required source images, final assets and visual QC before marking Posted." }, 422);
      const workflow = await productionStore.getWorkflow(sheetId, contentId);
      if (!["SCHEDULED_PUBLISHED", "RESULTS_RECORDED"].includes(workflow?.stage)) return json({ ok: false, error: "Advance the recorded production workflow to Scheduled / Published first." }, 422);
      const results = await productionStore.listResults({ sheetId });
      const publication = results.publications.find((row) => row.contentId === contentId && row.pageProfileId === sheet.targetPageProfileId && row.postUrl && Number.isFinite(Date.parse(row.publishedAt)));
      if (!publication) return json({ ok: false, error: "A matching publication record with HTTPS post URL and publish date is required." }, 422);
      if (!env.GOOGLE_SHEETS_ADMIN_TOKEN) return json({ ok: false, error: "Secure Google Sheets write authorization is not configured." }, 503);
      const result = await bridgeRequest(env, "markPosted", sheetId, { contentId, status: "Posted", adminToken: env.GOOGLE_SHEETS_ADMIN_TOKEN });
      if (result.contentId !== contentId || Number(result.sheetId) !== sheetId || result.status !== "Posted") throw new Error("Status write readback did not match the selected record.");
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ ok: false, error: error.message }, 502);
    }
  }
  if (url.pathname.startsWith("/api/production/")) {
    const store = productionStore;
    const context = {
      isHeldDuplicate: (sheetId,contentId)=>CANONICAL_MAP.groups.some(group=>group.duplicates.some(item=>Number(item.sheetId)===Number(sheetId)&&item.contentId===contentId)),
      validateContentRef: async (sheetId, contentId) => {
        const source = await store.getSheet(sheetId);
        const loaded = await resolveSourceRecords(env, source);
        if (!loaded.ok) return { ok: false, status: loaded.status || 422, error: loaded.error };
        const index = loaded.records.findIndex((record) => String(record.Content_ID || record.content_id || "") === contentId);
        if (index < 0) return { ok: false, status: 404, error: "Content_ID was not found in the selected worksheet." };
        let content = loaded.normalized[index];
        if (source.targetPageProfileId) content = { ...content, pageProfile: await store.getProfile(source.targetPageProfileId) };
        return { ok: true, content };
      },
      persistEditorialReview: async (sheetId, contentId, reviewJson) => {
        if (!env.GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN) throw Object.assign(new Error("Secure Google Sheets editorial-review write authorization is not configured."), { status: 503 });
        const result = await bridgeRequest(env, "updateEditorialReview", sheetId, {
          contentId,
          reviewJson,
          editorialReviewToken: env.GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN
        });
        return { ...result, source: "sheet" };
      },
      getWorkflowGates: async (_sheetId, _contentId, content, review) => {
        if (review) content = { ...content, editorialReview: review.review };
        const contract = runContentQc(content);
        const editorial = runEditorialReview(content);
        const generation = deriveGenerationReadiness(content, { structuralQc: contract, editorialReview: editorial });
        return { generationReady: generation.ready };
      }
    };
    return handleProductionOperationsApi(request, env, url, store, context);
  }
  return json({ ok: false, error: "Not found" }, 404);
}

export default {
  async fetch(request, env = {}, executionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/intelligence/")) return handleIntelligenceApi(request, env, url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, executionContext);
    if (url.pathname === "/styles.css") return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/app.js") return new Response(APP, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/production-core.js") return new Response(PRODUCTION_CORE, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if ((url.pathname === "/content-quality.js" || url.pathname === "/content-quality.mjs")) return new Response(CONTENT_QUALITY, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === '/editorial-pipeline.js' || url.pathname === '/editorial-pipeline.mjs') return new Response(EDITORIAL_PIPELINE, {headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-cache'}});
    if (url.pathname === "/production-assistant.mjs") return new Response(PRODUCTION_ASSISTANT, {headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-cache"}});
    if (url.pathname === "/content-model.js" || url.pathname === "/content-model.mjs") return new Response(CONTENT_MODEL, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/intelligence.js") return new Response(INTELLIGENCE, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/opportunities.js") return new Response(OPPORTUNITIES, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (url.pathname === "/favicon.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f96332"/><path d="M18 17h28v30H18z" fill="#fff"/><path d="M23 25h18M23 32h18M23 39h12" stroke="#f96332" stroke-width="4" stroke-linecap="round"/></svg>', { headers: { "content-type": "image/svg+xml" } });
    return new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" } });
  }
};
