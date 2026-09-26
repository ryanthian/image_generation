import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { handleIntelligenceApi, MemoryIntelligenceStore } from "../src/intelligence-server.mjs";
import { buildOpportunityCanary, normalizePerformance } from "../src/opportunity-engine.mjs";
import { deriveGenerationReadiness, normalizeContentRecord, runContentQc, runEditorialReview } from "../src/content-model.mjs";
import { MemoryProductionStore, handleProductionOperationsApi, publicSourceState, publicSheetTemplate, SHEET_TEMPLATES } from "../src/production-operations.mjs";
import { INITIAL_SOURCE_SEEDS } from "../src/sheet-contracts.mjs";

const port = Number(process.env.PORT || 4173);
const store = new MemoryIntelligenceStore();
const files = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/content-model.js": ["src/content-model.mjs", "text/javascript; charset=utf-8"],
  "/intelligence.js": ["public/intelligence.js", "text/javascript; charset=utf-8"],
  "/opportunities.js": ["public/opportunities.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["public/favicon.svg", "image/svg+xml"]
};
const recipes = JSON.parse(await readFile("data/recipes.json", "utf8"));
const canary = JSON.parse(await readFile("data/content-v4-canary.json", "utf8"));
const opportunityHistory = JSON.parse(await readFile("data/v4-2-historical-performance.json", "utf8"));
const productionStore = new MemoryProductionStore();
const previewProfile = {
  profileId: "LOCAL_PREVIEW_PAGE", facebookPageId: "LOCAL_PREVIEW_ONLY", displayName: "Local Preview Page",
  audience: "Local UI verification only", primaryLanguage: "Malaysian Chinese", toneGuidance: "Practical and warm.",
  contentPillars: ["Home cooking"], suitableFormats: ["Carousel"], avoidTopics: ["Unsupported claims"],
  monetizationTypes: ["Manual testing only"], active: true, updatedAt: "2026-09-26T00:00:00.000Z"
};
const contentBySheetId = new Map([
  [2026091901, { ...recipes, records: recipes.recipes }],
  [812541719, { records: [] }],
  [433728120, { ...canary, records: canary.records }]
]);
const discoveredPreviewSheets = INITIAL_SOURCE_SEEDS.map((seed) => ({ ...seed, headers: [], rowCount: contentBySheetId.get(seed.sheetId)?.records.length || 0 }));
await productionStore.initializeBaseline(discoveredPreviewSheets, INITIAL_SOURCE_SEEDS);
await productionStore.saveProfile(previewProfile);
for (const seed of INITIAL_SOURCE_SEEDS) await productionStore.saveSheetSettings(seed.sheetId, previewProfile.profileId, true);
let nextPreviewSheetId = 900000001;
async function listPreviewSources() {
  const profiles = await productionStore.listProfiles();
  return (await productionStore.listSheets())
    .filter((item) => item.baselineState !== "EXISTING_UNCONNECTED")
    .map((item) => ({ ...publicSourceState(item, profiles), rowCount: contentBySheetId.get(item.sheetId)?.records.length || 0 }));
}
const previewContext = {
  validateContentRef: async (sheetId, contentId) => {
    const raw = contentBySheetId.get(Number(sheetId))?.records.find((item) => String(item.Content_ID || "") === String(contentId));
    if (!raw) return { ok: false, status: 404, error: "Content_ID was not found in this local preview snapshot." };
    return { ok: true, content: { ...normalizeContentRecord(raw), pageProfile: previewProfile } };
  },
  getWorkflowGates: async (sheetId, contentId, record, review) => {
    if (review) record = { ...record, editorialReview: review.review };
    const structuralQc = runContentQc(record);
    const editorialReview = runEditorialReview(record);
    const readiness = deriveGenerationReadiness(record, { structuralQc, editorialReview });
    return { generationReady: readiness.ready && previewProfile.active };
  }
};

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
  if (incoming.method === "GET" && url.pathname === "/api/opportunities/canary") {
    const historical = opportunityHistory.records.map(normalizePerformance);
    outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, engine: "v4.2-explainable-opportunity-engine", historical, opportunities: buildOpportunityCanary(historical) }));
    return;
  }
  if (incoming.method === "GET" && url.pathname === "/api/recipes") {
    const sheetId = Number(url.searchParams.get("sheetId"));
    const source = await productionStore.getSheet(sheetId || INITIAL_SOURCE_SEEDS[0].sheetId);
    if (!source) { outgoing.writeHead(404, { "content-type": "application/json; charset=utf-8" }); outgoing.end(JSON.stringify({ ok: false, error: "Local preview worksheet was not found." })); return; }
    const snapshot = contentBySheetId.get(source.sheetId) || { records: [] };
    const profiles = await productionStore.listProfiles();
    const selectedProfile = profiles.find((item) => item.profileId === source.targetPageProfileId) || null;
    const sheets = await listPreviewSources();
    const sourceState = sheets.find((item) => item.sheetId === source.sheetId);
    outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, source: "local-preview", writable: false, sheetId: source.sheetId, sheetName: source.title, setupStatus: sourceState?.setupStatus, setupReasons: sourceState?.setupReasons || [], sourceState, pageProfile: selectedProfile, pageProfileComplete: Boolean(selectedProfile?.active), profiles, sheets, records: source.active && source.schemaStatus === "READY" ? snapshot.records : [] }));
    return;
  }
  if (incoming.method === "GET" && url.pathname === "/api/sheets") {
    const sheets = await listPreviewSources();
    outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, spreadsheetId: "LOCAL_PREVIEW_ONLY", sheets, profiles: await productionStore.listProfiles() }));
    return;
  }
  if (incoming.method === "GET" && url.pathname === "/api/sheet-templates") {
    outgoing.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, templates: SHEET_TEMPLATES.map(publicSheetTemplate) }));
    return;
  }
  if (incoming.method === "POST" && url.pathname === "/api/sheets") {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (incoming.headers["x-content-intelligence-request"] !== "1") { outgoing.writeHead(403, { "content-type": "application/json; charset=utf-8" }); outgoing.end(JSON.stringify({ ok: false, error: "Local preview requires the same-origin marker." })); return; }
    const template = SHEET_TEMPLATES.find((item) => item.templateId === body.templateId);
    const title = String(body.title || "").trim();
    const registered = await productionStore.listSheets();
    if (!template || title.length < 3 || registered.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) { outgoing.writeHead(400, { "content-type": "application/json; charset=utf-8" }); outgoing.end(JSON.stringify({ ok: false, error: "Choose a supported template and a unique local worksheet name." })); return; }
    const created = await productionStore.upsertDiscoveredSheet({ sheetId: nextPreviewSheetId++, title, schemaFamily: template.schemaVersion === 4 ? "V4_UNIVERSAL" : "LEGACY_RECIPE", schemaVersion: template.schemaVersion, contentType: template.contentType, templateId: template.templateId, schemaStatus: "READY", setupReasons: [], targetPageProfileId: body.targetPageProfileId || "", active: true, baselineState: "APP_CREATED" });
    contentBySheetId.set(created.sheetId, { records: [] });
    const sheet = publicSourceState(created, await productionStore.listProfiles());
    outgoing.writeHead(201, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: true, sheet }));
    return;
  }
  if (url.pathname.startsWith("/api/production/")) {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(chunks) });
    const response = await handleProductionOperationsApi(request, {}, url, productionStore, previewContext);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
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
