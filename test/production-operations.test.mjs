import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  WORKFLOW_STAGES,
  D1ProductionStore,
  MemoryProductionStore,
  handleProductionOperationsApi,
  hasReportedPerformanceMetric,
  inspectSheetHeaders,
  isReservedSheetName,
  publicSourceState,
  summarizeManualResults,
  validateManualResult,
  validateWorkflowTransition
} from "../src/production-operations.mjs";
import { LEGACY_RECIPE_BASE_HEADERS, LEGACY_RECIPE_HEADERS, SHEET_TEMPLATES } from "../src/sheet-contracts.mjs";
import { V4_CANARY_BASE_HEADERS, V4_CANARY_HEADERS } from "../src/v4-preappend.mjs";
import { applyMigrations, LocalD1Database } from "../src/local-d1-sqlite.mjs";

const profile = {
  profileId: "page-main", facebookPageId: "page-123", displayName: "Kuching Kitchen",
  audience: "Malaysian Chinese home cooks", primaryLanguage: "Malaysian Chinese",
  toneGuidance: "Practical, warm, direct.", avoidTopics: ["Unsupported health claims"],
  contentPillars: ["Home cooking"], suitableFormats: ["Carousel"], monetizationTypes: ["Meta"], active: true,
  updatedAt: "2026-09-26T09:00:00.000Z"
};
const sheet = { sheetId: 321, title: "Recipes", schemaFamily: "V4_UNIVERSAL", schemaVersion: 4, contentType: "RECIPE", templateId: "RECIPE_STANDARD", schemaStatus: "READY", setupReasons: [], targetPageProfileId: profile.profileId, active: true, baselineState: "APP_CREATED" };
const content = { contentId: "RCP-TEST-01", contentType: "RECIPE", templateType: "RECIPE_STANDARD", title: "家常鸡腿饭", contentBody: "鸡腿先煎香，再焖至完全熟透。", caption: "鸡腿先煎香再焖熟，配热饭就是一顿简单晚餐。" };
const sheetReviews = new Map();
const contentKey = (sheetId, contentId) => `${sheetId}:${contentId}`;
function rawContentRecord(contentId, reviewJson = "") {
  return { Schema_Version: 4, Content_ID: contentId, Title: content.title, Topic: "RECIPE", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD", Visual_Profile: "REALISTIC_MALAYSIAN_KITCHEN", Hook_Type: "HOW_TO", Hook_Text: "家常鸡腿饭怎么做？", Ready_To_Post_Caption: content.caption, Content_Body: content.contentBody, Source_References: "Recipe source, section 2.", Asset_Plan_JSON: "", Editorial_Review_JSON: reviewJson };
}
const context = {
  validateContentRef: async (sheetId, contentId) => {
    if (Number(sheetId) !== sheet.sheetId || contentId !== content.contentId) return { ok: false, status: 404, error: "not found" };
    const reviewJson = sheetReviews.get(contentKey(sheetId, contentId)) || "";
    const review = reviewJson ? JSON.parse(reviewJson) : {};
    return { ok: true, content: { ...content, pageProfile: profile, editorialReview: review, editorialReviewPresent: Boolean(reviewJson), raw: rawContentRecord(contentId, reviewJson) } };
  },
  persistEditorialReview: async (sheetId, contentId, reviewJson) => {
    sheetReviews.set(contentKey(sheetId, contentId), reviewJson);
    const record = rawContentRecord(contentId, reviewJson);
    return { ok: true, source: "sheet", record, reviewJson, rowNumber: 2 };
  },
  getWorkflowGates: async () => ({ generationReady: true })
};

function request(path, method = "GET", body, extraHeaders = {}) {
  return new Request(`https://console.example${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const sameOrigin = { "x-content-intelligence-request": "1", "sec-fetch-site": "same-origin" };
async function call(store, path, method = "GET", body, headers = {}, operationContext = context) {
  const response = await handleProductionOperationsApi(request(path, method, body, headers), {}, new URL(`https://console.example${path}`), store, operationContext);
  return { status: response.status, body: await response.json() };
}

function seededStore() {
  const store = new MemoryProductionStore();
  store.sheets.set(sheet.sheetId, structuredClone(sheet));
  store.profiles.set(profile.profileId, structuredClone(profile));
  return store;
}

test("sheet contracts distinguish supported legacy/V4 schemas and keep system tabs reserved", () => {
  assert.equal(inspectSheetHeaders(LEGACY_RECIPE_BASE_HEADERS).setupStatus, "READY", "frozen 25-column legacy rows remain readable");
  assert.equal(inspectSheetHeaders(LEGACY_RECIPE_HEADERS).setupStatus, "READY");
  assert.equal(inspectSheetHeaders(V4_CANARY_BASE_HEADERS).schemaFamily, "V4_UNIVERSAL", "frozen 16-column V4 rows remain readable");
  assert.equal(inspectSheetHeaders(V4_CANARY_HEADERS).schemaFamily, "V4_UNIVERSAL");
  assert.equal(inspectSheetHeaders(["Content_ID", "Title"]).setupStatus, "NEEDS_SETUP");
  assert.equal(isReservedSheetName("Dashboard"), true);
  assert.equal(isReservedSheetName("V4_CANARY_BACKUP_20260926"), true);
  assert.equal(isReservedSheetName("Copy of V4_CANARY"), true);
  assert.equal(isReservedSheetName("Fresh Recipe Ideas"), false);
  assert.ok(SHEET_TEMPLATES.some((item) => item.templateId === "V4_RECIPE_STANDARD"));
});

test("Apps Script editorial review write is source-allowlisted, locked, single-cell and readback-verified", async () => {
  const source = await readFile(fileURLToPath(new URL("../apps-script/Code.gs", import.meta.url)), "utf8");
  const endpoint = source.slice(source.indexOf("function updateEditorialReview_"), source.indexOf("function resolveSheet_"));
  assert.match(source, /body\.action === 'updateEditorialReview'/);
  assert.match(endpoint, /CONSOLE_EDITORIAL_REVIEW_TOKEN/);
  assert.match(endpoint, /2026091901:[\s\S]*812541719:[\s\S]*433728120:/);
  assert.match(endpoint, /LockService\.getScriptLock\(\)/);
  assert.match(endpoint, /reviewCell\.getFormula\(\)/);
  assert.match(endpoint, /reviewCell\.setValue\(body\.reviewJson\)/);
  assert.match(endpoint, /readBack !== body\.reviewJson/);
  assert.match(endpoint, /record\.Content_ID !== body\.contentId/);
  assert.doesNotMatch(endpoint, /Logger\.(?:log|info|warning|severe)\([^\n]*(?:Token|token|body\.editorialReviewToken)/);
});

test("Site bridge sends review writes only to the Apps Script action and never to a query string", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/worker.template.mjs", import.meta.url)), "utf8");
  const start = source.indexOf("persistEditorialReview:");
  const end = source.indexOf("getWorkflowGates:", start);
  const endpoint = source.slice(start, end);
  assert.match(endpoint, /bridgeRequest\(env, "updateEditorialReview", sheetId/);
  assert.match(endpoint, /GOOGLE_SHEETS_EDITORIAL_REVIEW_TOKEN/);
  assert.match(endpoint, /editorialReviewToken:/);
  assert.doesNotMatch(endpoint, /searchParams\.set\([^\n]*Token/i);
});

test("editorial review records Page fit as deferred when no complete Page profile is assigned", async () => {
  const store = seededStore();
  sheetReviews.delete(contentKey(sheet.sheetId, content.contentId));
  const noPageContext = {
    ...context,
    validateContentRef: async () => ({
      ok: true,
      content: { ...content, pageProfile: null, editorialReview: {}, editorialReviewPresent: false, raw: rawContentRecord(content.contentId) }
    })
  };
  const saved = await call(store, "/api/production/editorial-review", "POST", {
    sheetId: sheet.sheetId, contentId: content.contentId, reviewer: "Editor", reviewStatus: "REVIEW",
    audienceNeed: "家中用冷饭炒饭、遇到结块，想知道下锅前怎么处理。", readerValue: "提供拨松和分次下锅的方法。",
    evidenceType: "UNVERIFIED", pageFitApproved: false
  }, sameOrigin, noPageContext);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.review.review.page_fit_status, "DEFERRED");
  assert.equal(saved.body.review.review.page_profile_id, "");
});

test("unavailable worksheet registrations are retained and surfaced even when inactive", async () => {
  const store = seededStore();
  await store.saveSheetSettings(sheet.sheetId, profile.profileId, false);
  await store.markMissingSheets(new Set());
  const registered = await store.getSheet(sheet.sheetId);
  assert.equal(registered.schemaStatus, "UNAVAILABLE");
  assert.equal(registered.active, false);
  assert.equal(publicSourceState(registered, [profile]).setupStatus, "UNAVAILABLE");
});

test("a valid worksheet stays available for generation without a Page profile; profile is a publishing blocker", () => {
  const unassigned = publicSourceState({ ...sheet, targetPageProfileId: "" }, []);
  assert.equal(unassigned.setupStatus, "READY");
  assert.deepEqual(unassigned.setupReasons, []);
  assert.ok(unassigned.publishingSetupBlockers.some((reason) => reason.includes("before publishing")));

  const incomplete = publicSourceState({ ...sheet, targetPageProfileId: "draft-page" }, [
    { profileId: "draft-page", displayName: "Draft page", active: false }
  ]);
  assert.equal(incomplete.setupStatus, "READY");
  assert.ok(incomplete.publishingSetupBlockers.length > 0);
});

test("worker keeps target Page assignment on the posting gate, not the generation gate", async () => {
  const source = await readFile(fileURLToPath(new URL("../src/worker.template.mjs", import.meta.url)), "utf8");
  const workflowGates = source.slice(source.indexOf("getWorkflowGates:"), source.indexOf("return handleProductionOperationsApi", source.indexOf("getWorkflowGates:")));
  const postingGate = source.slice(source.indexOf("if (request.method === \"POST\" && statusMatch)"), source.indexOf("if (url.pathname.startsWith(\"/api/production/\"))"));
  assert.match(workflowGates, /generationReady: generation\.ready\s*\}/);
  assert.doesNotMatch(workflowGates, /generation\.ready\s*&&\s*profileReady/);
  assert.match(postingGate, /if \(!profileReady \|\| !generation\.ready\)/);
});

test("memory worksheet registry returns the persisted item for local Add Sheet verification", async () => {
  const store = new MemoryProductionStore();
  const created = await store.upsertDiscoveredSheet({ sheetId: 901, title: "Local Preview", schemaFamily: "V4_UNIVERSAL", schemaVersion: 4, schemaStatus: "READY", active: true });
  assert.equal(created.sheetId, 901);
  assert.equal((await store.getSheet(901)).title, "Local Preview");
});

test("editorial review writes require same-origin and verified Sheet readback without D1 as source of truth", async () => {
  const store = seededStore();
  sheetReviews.delete(contentKey(sheet.sheetId, content.contentId));
  const body = { sheetId: sheet.sheetId, contentId: content.contentId, reviewer: "Editor", reviewStatus: "REVIEW", audienceNeed: "A practical dinner idea", readerValue: "Ordered cooking guidance", evidenceType: "SOURCE_DIRECT", evidenceReferences: ["Recipe source, section 2."], evidenceVerified: true, captionApproved: true, pageFitApproved: true };
  const rejected = await call(store, "/api/production/editorial-review", "POST", body);
  assert.equal(rejected.status, 403);
  const saved = await call(store, "/api/production/editorial-review", "POST", body, sameOrigin);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.recomputedFrom, "sheet-readback");
  assert.equal(saved.body.review.source, "sheet");
  assert.equal(saved.body.review.review.page_profile_id, profile.profileId);
  assert.equal(saved.body.review.review.page_profile_updated_at, "2026-09-26T09:00:00.000Z");
  assert.equal(JSON.parse(sheetReviews.get(contentKey(sheet.sheetId, content.contentId))).schema_version, 1);
  assert.equal(await store.getReview(sheet.sheetId, content.contentId), null);
  const fetched = await call(store, `/api/production/editorial-review?sheetId=${sheet.sheetId}&contentId=${content.contentId}`);
  assert.equal(fetched.body.review.source, "sheet");
  assert.equal(fetched.body.review.review.review_status, "REVIEW");
});

test("editorial PASS is rejected before persistence when completeness rules still block it", async () => {
  const store = seededStore();
  sheetReviews.delete(contentKey(sheet.sheetId, content.contentId));
  const result = await call(store, "/api/production/editorial-review", "POST", {
    sheetId: sheet.sheetId, contentId: content.contentId, reviewer: "Editor", reviewStatus: "PASS",
    evidenceType: "SOURCE_DIRECT", evidenceReferences: ["Recipe source, section 2."], evidenceVerified: true,
    audienceNeed: "需要一份可在下班后完成的家常晚餐做法。", readerValue: "说明准备与烹调顺序。",
    captionApproved: true, readerFacingCopyReviewed: true, internalNoteLeakage: false,
    claimSafetyOk: true, pageFitApproved: true
  }, sameOrigin);
  assert.equal(result.status, 422);
  assert.equal(result.body.reviewStatus, "REVIEW");
  assert.equal(sheetReviews.has(contentKey(sheet.sheetId, content.contentId)), false);
  assert.equal(await store.getReview(sheet.sheetId, content.contentId), null);
});

test("workflow advances one stage at a time and refuses client-asserted publication without a stored post record", async () => {
  const store = seededStore();
  const key = store.reviewKey(sheet.sheetId, content.contentId);
  sheetReviews.set(contentKey(sheet.sheetId, content.contentId), JSON.stringify({ schema_version: 1, review_status: "REVIEW" }));
  await store.saveWorkflow({ sheetId: sheet.sheetId, contentId: content.contentId, stage: "COPY_DRAFT", actor: "", note: "", updatedAt: "2026-09-26T09:00:00.000Z" });
  const post = (nextStage, extra = {}) => call(store, "/api/production/workflow", "POST", { sheetId: sheet.sheetId, contentId: content.contentId, actor: "Operator", note: "Checked", nextStage, ...extra }, sameOrigin);
  assert.equal((await post("EDITORIAL_REVIEW")).status, 200);
  assert.equal((await post("COPY_APPROVED")).status, 422);
  sheetReviews.set(contentKey(sheet.sheetId, content.contentId), JSON.stringify({ schema_version: 1, review_status: "PASS" }));
  assert.equal((await post("COPY_APPROVED")).status, 200);
  assert.equal((await post("ASSET_CREATED", { requiredImagesPresent: true, finalAssetsPresent: true })).status, 422);
  assert.equal((await post("VISUAL_VIDEO_PROMPT")).status, 200);
  assert.equal((await post("ASSET_CREATED", { requiredImagesPresent: true, finalAssetsPresent: true })).status, 200);
  assert.equal((await post("QC_PASSED", { visualQcPass: false })).status, 422);
  assert.equal((await post("QC_PASSED", { visualQcPass: true })).status, 200);
  assert.equal((await post("SCHEDULED_PUBLISHED", { published: true })).status, 422);
  assert.deepEqual(WORKFLOW_STAGES.slice(0, 3), ["IDEA", "COPY_DRAFT", "EDITORIAL_REVIEW"]);
  assert.equal(validateWorkflowTransition("COPY_DRAFT", "QC_PASSED", {}).valid, false);
  assert.ok(key);
});

test("workflow reads use D1 without fetching the full worksheet again", async () => {
  const store = seededStore();
  const path = `/api/production/workflow?sheetId=${sheet.sheetId}&contentId=${content.contentId}`;
  const noBridge = { validateContentRef: async () => { throw new Error("Unexpected Sheet bridge read"); } };
  const empty = await call(store, path, "GET", undefined, {}, noBridge);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.workflow, null);
  await store.saveWorkflow({ sheetId: sheet.sheetId, contentId: content.contentId, stage: "EDITORIAL_REVIEW", actor: "Editor", note: "In review", updatedAt: "2026-10-03T00:00:00.000Z" });
  const saved = await call(store, path, "GET", undefined, {}, noBridge);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.workflow.stage, "EDITORIAL_REVIEW");
});

test("manual publication can be recorded without inventing zero metrics; result snapshots need an observed metric", async () => {
  const store = seededStore();
  const publication = { sheetId: sheet.sheetId, contentId: content.contentId, pageProfileId: profile.profileId, contentType: "RECIPE", contentFormat: "Carousel", publishedAt: "2026-09-25", postUrl: "https://facebook.com/posts/123", currency: "MYR", enteredBy: "Operator", publicationOnly: true };
  const created = await call(store, "/api/production/results", "POST", publication, sameOrigin);
  assert.equal(created.status, 201);
  assert.equal(created.body.snapshot, null);
  const noMetric = await call(store, "/api/production/results", "POST", { ...publication, publicationOnly: false, publicationId: created.body.publication.publicationId }, sameOrigin);
  assert.equal(noMetric.status, 400);
  const withMetric = await call(store, "/api/production/results", "POST", { ...publication, publicationOnly: false, publicationId: created.body.publication.publicationId, reach: "0", qualifiedViews: "40", shares: "3", affiliateClicks: "", affiliateCommission: "", metaEarnings: "" }, sameOrigin);
  assert.equal(withMetric.status, 201);
  assert.equal(withMetric.body.snapshot.reach, 0);
  assert.equal(withMetric.body.snapshot.affiliateCommission, null);
  const data = await call(store, `/api/production/results?sheetId=${sheet.sheetId}&pageProfileId=${profile.profileId}`);
  assert.equal(data.body.summary.rows[0].metrics.qualifiedViews, 40);
  assert.equal(data.body.summary.byPage[0].affiliateCommission, null);
  assert.equal(hasReportedPerformanceMetric({}), false);
  assert.equal(hasReportedPerformanceMetric({ reach: 0 }), true);
});

test("optional manual metrics remain NULL and ratios are withheld when denominators are missing", () => {
  const { record, errors } = validateManualResult({ sheetId: sheet.sheetId, contentId: content.contentId, pageProfileId: profile.profileId, contentType: "RECIPE", contentFormat: "Carousel", publishedAt: "2026-09-25", postUrl: "https://facebook.com/posts/123", enteredBy: "Operator" });
  assert.deepEqual(errors, []);
  assert.equal(record.reach, null);
  const summary = summarizeManualResults([{ publicationId: "pub-1", contentId: content.contentId, pageDisplayName: "Kuching Kitchen", contentType: "RECIPE", contentFormat: "Carousel", productionMinutes: 0 }], []);
  assert.equal(summary.byPage[0].qualifiedViews, null);
  assert.equal(summary.byPage[0].metaEarningsPerProductionMinute, null);
});

test("production operations migration creates durable D1 tables and stores page/content-linked records", async () => {
  const db = new LocalD1Database();
  try {
    const migrationDir = fileURLToPath(new URL("../db/migrations", import.meta.url));
    const files = await applyMigrations(db, migrationDir);
    assert.ok(files.includes("0004_production_operations.sql"));
    const store = new D1ProductionStore(db);
    await store.saveProfile(profile);
    await store.writeSheet(sheet);
    await store.saveWorkflow({ sheetId: sheet.sheetId, contentId: content.contentId, stage: "COPY_DRAFT", actor: "Editor", note: "Initial draft", updatedAt: "2026-09-26T09:00:00.000Z" });
    const savedWorkflow = await store.getWorkflow(sheet.sheetId, content.contentId);
    assert.equal(savedWorkflow.stage, "COPY_DRAFT");
    await store.createPublication({ publicationId: "pub-d1", sheetId: sheet.sheetId, contentId: content.contentId, pageProfileId: profile.profileId, contentType: "RECIPE", contentFormat: "Carousel", publishedAt: "2026-09-25", postUrl: "https://facebook.com/posts/d1", productionMinutes: null, directCost: null, currency: "MYR" });
    const publication = await store.getPublication("pub-d1");
    assert.equal(publication.contentId, content.contentId);
    assert.equal(publication.pageProfileId, profile.profileId);
    assert.equal(publication.productionMinutes, null);
  } finally { db.close(); }
});

test("the browser controller selects worksheets by stable ID and persists source keys by that ID", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /apiJson\("\/api\/sheets"\)/);
  assert.match(app, /new URLSearchParams\(\{ sheetId: String\(source\.sheetId\) \}\)/);
  assert.match(app, /const sourceKey = \(\) => state\.sourceId \? String\(state\.sourceId\)/);
  assert.doesNotMatch(app, /api\/recipes\?[^\n]*sheetName=/);
});

test("authenticated Apps Script bridge sends bearer credentials in POST bodies, never query URLs", async () => {
  const worker = await readFile(new URL("../src/worker.template.mjs", import.meta.url), "utf8");
  const bridgeClient = await readFile(new URL("../src/apps-script-bridge.mjs", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  assert.match(worker, /fetchBridgeRead\(bridge, requestBody\)/);
  assert.match(worker, /postAppsScriptRequest\(bridge, requestBody\)/);
  assert.match(bridgeClient, /method: "POST"[\s\S]*body: JSON\.stringify\(body\)/);
  assert.doesNotMatch(worker, /appendBridgeQuery|URLSearchParams\(.*bridgeToken/);
  assert.doesNotMatch(bridgeClient, /URLSearchParams|searchParams\.set/);
  assert.match(bridge, /GET is disabled for the authenticated worksheet bridge/);
  assert.match(bridge, /assertBridgeToken_\(body\.bridgeToken\)/);
});
