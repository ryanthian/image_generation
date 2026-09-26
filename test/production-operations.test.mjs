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
import { LEGACY_RECIPE_HEADERS, SHEET_TEMPLATES } from "../src/sheet-contracts.mjs";
import { V4_CANARY_HEADERS } from "../src/v4-preappend.mjs";
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
const context = {
  validateContentRef: async (sheetId, contentId) => Number(sheetId) === sheet.sheetId && contentId === content.contentId ? { ok: true, content: { ...content, pageProfile: profile } } : { ok: false, status: 404, error: "not found" },
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
async function call(store, path, method = "GET", body, headers = {}) {
  const response = await handleProductionOperationsApi(request(path, method, body, headers), {}, new URL(`https://console.example${path}`), store, context);
  return { status: response.status, body: await response.json() };
}

function seededStore() {
  const store = new MemoryProductionStore();
  store.sheets.set(sheet.sheetId, structuredClone(sheet));
  store.profiles.set(profile.profileId, structuredClone(profile));
  return store;
}

test("sheet contracts distinguish supported legacy/V4 schemas and keep system tabs reserved", () => {
  assert.equal(inspectSheetHeaders(LEGACY_RECIPE_HEADERS).setupStatus, "READY");
  assert.equal(inspectSheetHeaders(V4_CANARY_HEADERS).schemaFamily, "V4_UNIVERSAL");
  assert.equal(inspectSheetHeaders(["Content_ID", "Title"]).setupStatus, "NEEDS_SETUP");
  assert.equal(isReservedSheetName("Dashboard"), true);
  assert.equal(isReservedSheetName("V4_CANARY_BACKUP_20260926"), true);
  assert.equal(isReservedSheetName("Copy of V4_CANARY"), true);
  assert.equal(isReservedSheetName("Fresh Recipe Ideas"), false);
  assert.ok(SHEET_TEMPLATES.some((item) => item.templateId === "V4_RECIPE_STANDARD"));
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

test("memory worksheet registry returns the persisted item for local Add Sheet verification", async () => {
  const store = new MemoryProductionStore();
  const created = await store.upsertDiscoveredSheet({ sheetId: 901, title: "Local Preview", schemaFamily: "V4_UNIVERSAL", schemaVersion: 4, schemaStatus: "READY", active: true });
  assert.equal(created.sheetId, 901);
  assert.equal((await store.getSheet(901)).title, "Local Preview");
});

test("editorial review writes require a same-origin marker and save the current Page profile revision", async () => {
  const store = seededStore();
  const body = { sheetId: sheet.sheetId, contentId: content.contentId, reviewer: "Editor", reviewStatus: "REVIEW", audienceNeed: "A practical dinner idea", readerValue: "Ordered cooking guidance", evidenceVerified: true, captionApproved: true, pageFitApproved: true };
  const rejected = await call(store, "/api/production/editorial-review", "POST", body);
  assert.equal(rejected.status, 403);
  const saved = await call(store, "/api/production/editorial-review", "POST", body, sameOrigin);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.review.review.page_profile_id, profile.profileId);
  assert.equal(saved.body.review.review.page_profile_updated_at, "2026-09-26T09:00:00.000Z");
  const fetched = await call(store, `/api/production/editorial-review?sheetId=${sheet.sheetId}&contentId=${content.contentId}`);
  assert.equal(fetched.body.review.status, "REVIEW");
});

test("workflow advances one stage at a time and refuses client-asserted publication without a stored post record", async () => {
  const store = seededStore();
  const key = store.reviewKey(sheet.sheetId, content.contentId);
  await store.saveWorkflow({ sheetId: sheet.sheetId, contentId: content.contentId, stage: "COPY_DRAFT", actor: "", note: "", updatedAt: "2026-09-26T09:00:00.000Z" });
  await store.saveReview({ sheetId: sheet.sheetId, contentId: content.contentId, review: { review_status: "REVIEW" }, reviewer: "Editor", status: "REVIEW", reviewedAt: "2026-09-26T09:00:00.000Z" });
  const post = (nextStage, extra = {}) => call(store, "/api/production/workflow", "POST", { sheetId: sheet.sheetId, contentId: content.contentId, actor: "Operator", note: "Checked", nextStage, ...extra }, sameOrigin);
  assert.equal((await post("EDITORIAL_REVIEW")).status, 200);
  assert.equal((await post("COPY_APPROVED")).status, 422);
  await store.saveReview({ sheetId: sheet.sheetId, contentId: content.contentId, review: { review_status: "PASS" }, reviewer: "Editor", status: "PASS", reviewedAt: "2026-09-26T09:00:00.000Z" });
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
  const bridge = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  assert.match(worker, /fetchBridgeRead\(bridge, requestBody\)/);
  assert.match(worker, /method: "POST"[\s\S]*body: JSON\.stringify\(requestBody\)/);
  assert.doesNotMatch(worker, /appendBridgeQuery|URLSearchParams\(.*bridgeToken/);
  assert.match(bridge, /GET is disabled for the authenticated worksheet bridge/);
  assert.match(bridge, /assertBridgeToken_\(body\.bridgeToken\)/);
});
