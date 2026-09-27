import { inspectSheetHeaders, isReservedSheetName, publicSheetTemplate, SHEET_TEMPLATES } from "./sheet-contracts.mjs";

export const WORKFLOW_STAGES = Object.freeze([
  "IDEA", "COPY_DRAFT", "EDITORIAL_REVIEW", "COPY_APPROVED", "VISUAL_VIDEO_PROMPT",
  "ASSET_CREATED", "QC_PASSED", "SCHEDULED_PUBLISHED", "RESULTS_RECORDED"
]);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const asText = (value) => String(value ?? "").trim();
const parseArray = (value) => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } };

function writeGuard(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return "Cross-site writes are not allowed.";
  if (request.headers.get("x-content-intelligence-request") !== "1") return "Missing same-origin request marker.";
  return "";
}

async function readBody(request, limit = 256 * 1024) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw Object.assign(new Error("Request exceeds the allowed size."), { status: 413 });
  try { return JSON.parse(text); } catch (_) { throw Object.assign(new Error("Request body is not valid JSON."), { status: 400 }); }
}

function normalizeProfile(input = {}) {
  const profile = {
    profileId: asText(input.profileId) || id("page"),
    facebookPageId: asText(input.facebookPageId),
    displayName: asText(input.displayName),
    audience: asText(input.audience),
    primaryLanguage: asText(input.primaryLanguage),
    toneGuidance: asText(input.toneGuidance),
    contentPillars: Array.isArray(input.contentPillars) ? input.contentPillars.map(asText).filter(Boolean) : [],
    suitableFormats: Array.isArray(input.suitableFormats) ? input.suitableFormats.map(asText).filter(Boolean) : [],
    avoidTopics: Array.isArray(input.avoidTopics) ? input.avoidTopics.map(asText).filter(Boolean) : [],
    monetizationTypes: Array.isArray(input.monetizationTypes) ? input.monetizationTypes.map(asText).filter(Boolean) : [],
    active: input.active === true
  };
  const errors = [];
  if (!profile.displayName) errors.push("Page display name is required.");
  const activationErrors = [];
  if (!profile.facebookPageId) activationErrors.push("Facebook Page ID is required before a profile can be activated.");
  if (!profile.audience) activationErrors.push("Audience/niche description is required before a profile can be activated.");
  if (!profile.primaryLanguage) activationErrors.push("Primary language is required before a profile can be activated.");
  if (!profile.toneGuidance) activationErrors.push("Tone and style guidance is required before a profile can be activated.");
  if (!profile.avoidTopics.length) activationErrors.push("List topics/claims to avoid, or explicitly enter None before activation.");
  if (profile.active) errors.push(...activationErrors);
  return { profile, errors };
}

const numericFields = ["reach", "qualifiedViews", "engagement", "shares", "saves", "retentionRate", "metaEarnings", "affiliateClicks", "affiliateOrders", "affiliateCommission", "productionMinutes", "directCost"];
const performanceMetricFields = ["reach", "qualifiedViews", "engagement", "shares", "saves", "retentionRate", "metaEarnings", "affiliateClicks", "affiliateOrders", "affiliateCommission"];
export function hasReportedPerformanceMetric(record = {}) {
  return performanceMetricFields.some((field) => record[field] !== null && record[field] !== undefined && record[field] !== "");
}
function parseOptionalNumber(value, name, errors, { integer = false, max = Infinity } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) {
    errors.push(`${name} must be ${integer ? "a non-negative whole number" : "a valid non-negative number"}${Number.isFinite(max) ? ` no greater than ${max}` : ""}.`);
    return null;
  }
  return number;
}

export function validateManualResult(input = {}) {
  const errors = [];
  const record = {
    publicationId: asText(input.publicationId) || id("publication"),
    sheetId: Number(input.sheetId),
    contentId: asText(input.contentId),
    pageProfileId: asText(input.pageProfileId),
    contentType: asText(input.contentType),
    contentFormat: asText(input.contentFormat),
    publishedAt: asText(input.publishedAt),
    postUrl: asText(input.postUrl),
    currency: asText(input.currency || "MYR").toUpperCase(),
    enteredBy: asText(input.enteredBy),
    capturedAt: asText(input.capturedAt || now())
  };
  if (!Number.isSafeInteger(record.sheetId) || record.sheetId <= 0) errors.push("A valid worksheet sheetId is required.");
  if (!record.contentId || !record.pageProfileId) errors.push("Content_ID and target page profile are required.");
  if (!record.contentType || !record.contentFormat) errors.push("Content type and format are required.");
  if (!record.publishedAt || !Number.isFinite(Date.parse(record.publishedAt))) errors.push("A valid publish date is required.");
  if (record.postUrl && !/^https:\/\//i.test(record.postUrl)) errors.push("Post URL must use HTTPS.");
  if (!record.enteredBy) errors.push("Enter the operator who recorded these manual metrics.");
  if (!/^[A-Z]{3}$/.test(record.currency)) errors.push("Currency must be a three-letter code such as MYR.");
  const integers = new Set(["reach", "qualifiedViews", "engagement", "shares", "saves", "affiliateClicks", "affiliateOrders"]);
  for (const field of numericFields) record[field] = parseOptionalNumber(input[field], field, errors, { integer: integers.has(field), max: field === "retentionRate" ? 1 : Infinity });
  if (record.affiliateOrders !== null && record.affiliateClicks !== null && record.affiliateOrders > record.affiliateClicks) errors.push("Affiliate orders cannot exceed affiliate clicks.");
  return { record, errors };
}

function latestSnapshots(rows) {
  const result = new Map();
  for (const row of rows) {
    const current = result.get(row.publicationId);
    if (!current || row.capturedAt > current.capturedAt) result.set(row.publicationId, row);
  }
  return [...result.values()];
}

function rate(numerator, denominator) {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}

export function summarizeManualResults(publications = [], snapshots = []) {
  const latest = latestSnapshots(snapshots);
  const rows = publications.map((publication) => ({ ...publication, metrics: latest.find((item) => item.publicationId === publication.publicationId) || null }));
  const group = (key) => {
    const groups = new Map();
    for (const row of rows) {
      const label = row[key] || "Unspecified";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    }
    return [...groups.entries()].map(([label, items]) => summarizeGroup(label, items));
  };
  return {
    totalPublications: rows.length,
    metricSnapshots: snapshots.length,
    byPage: group("pageDisplayName"),
    byContentType: group("contentType"),
    byFormat: group("contentFormat"),
    topByQualifiedViews: rows.filter((row) => row.metrics?.qualifiedViews !== null && row.metrics?.qualifiedViews !== undefined).sort((a, b) => b.metrics.qualifiedViews - a.metrics.qualifiedViews).slice(0, 10),
    rows
  };
}

function summarizeGroup(label, rows) {
  const metricSum = (key) => {
    const values = rows.map((row) => row.metrics?.[key]).filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  };
  const metaEarnings = metricSum("metaEarnings");
  const affiliateCommission = metricSum("affiliateCommission");
  const qualifiedViews = metricSum("qualifiedViews");
  const affiliateClicks = metricSum("affiliateClicks");
  const affiliateOrders = metricSum("affiliateOrders");
  const minutes = rows.map((row) => row.productionMinutes).filter((value) => value !== null && value !== undefined);
  const totalProductionMinutes = minutes.length ? minutes.reduce((sum, value) => sum + Number(value), 0) : null;
  return {
    label, publications: rows.length, metaEarnings, affiliateCommission, qualifiedViews,
    metaEarningsPerQualifiedView: rate(metaEarnings, qualifiedViews),
    affiliateClickToOrderRate: rate(affiliateOrders, affiliateClicks),
    metaEarningsPerProductionMinute: rate(metaEarnings, totalProductionMinutes),
    affiliateCommissionPerProductionMinute: rate(affiliateCommission, totalProductionMinutes)
  };
}

export function validateWorkflowTransition(currentStage, nextStage, gates = {}) {
  const currentIndex = WORKFLOW_STAGES.indexOf(currentStage);
  const nextIndex = WORKFLOW_STAGES.indexOf(nextStage);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) return { valid: false, reason: "Workflow can advance only one stage at a time." };
  if (nextStage === "COPY_APPROVED" && gates.editorialStatus !== "PASS") return { valid: false, reason: "Editorial PASS is required before copy approval." };
  if (nextStage === "VISUAL_VIDEO_PROMPT" && gates.generationReady !== true) return { valid: false, reason: "Generation readiness must pass before prompt work." };
  if (nextStage === "ASSET_CREATED" && (gates.requiredImagesPresent !== true || gates.finalAssetsPresent !== true)) return { valid: false, reason: "Required source images and final assets must be present." };
  if (nextStage === "QC_PASSED" && gates.visualQcPass !== true) return { valid: false, reason: "A recorded visual QC pass is required." };
  if (nextStage === "SCHEDULED_PUBLISHED" && gates.published !== true) return { valid: false, reason: "Confirm publication and the post URL/date before advancing." };
  if (nextStage === "RESULTS_RECORDED" && gates.resultRecorded !== true) return { valid: false, reason: "Save at least one manual result snapshot first." };
  return { valid: true, reason: "" };
}

export function inferWorkflowStage(status, hasContent = true) {
  const value = asText(status).toUpperCase();
  if (value === "POSTED" || value === "PUBLISHED") return "SCHEDULED_PUBLISHED";
  if (value === "QC_PASSED") return "QC_PASSED";
  if (value === "ASSET_CREATED") return "ASSET_CREATED";
  if (value === "APPROVED" || value === "COPY_APPROVED") return "COPY_APPROVED";
  if (value.includes("REVIEW")) return "EDITORIAL_REVIEW";
  return hasContent ? "COPY_DRAFT" : "IDEA";
}

export class MemoryProductionStore {
  constructor() {
    this.sheets = new Map(); this.profiles = new Map(); this.reviews = new Map(); this.workflows = new Map();
    this.publications = new Map(); this.snapshots = [];
  }
  async listSheets() { return [...this.sheets.values()].map((item) => structuredClone(item)); }
  async getSheet(sheetId) { const item = this.sheets.get(Number(sheetId)); return item ? structuredClone(item) : null; }
  async countSheets() { return this.sheets.size; }
  async initializeBaseline(discovered, activeSeeds) {
    const active = new Map(activeSeeds.map((seed) => [Number(seed.sheetId), seed]));
    for (const sheet of discovered) {
      const seed = active.get(Number(sheet.sheetId));
      this.sheets.set(Number(sheet.sheetId), { sheetId: Number(sheet.sheetId), title: sheet.title, schemaFamily: seed?.schemaFamily || "UNCONNECTED", schemaVersion: null, contentType: seed?.schemaFamily === "LEGACY_RECIPE" ? "RECIPE" : seed ? "ROW_DEFINED" : "", templateId: seed?.schemaFamily || "", schemaStatus: seed ? "READY" : "NOT_SCANNED", setupReasons: [], targetPageProfileId: "", active: Boolean(seed), baselineState: seed ? "CURRENT_SOURCE" : "EXISTING_UNCONNECTED", lastDiscoveredAt: now() });
    }
    for (const seed of activeSeeds) if (!this.sheets.has(Number(seed.sheetId))) this.sheets.set(Number(seed.sheetId), { sheetId: Number(seed.sheetId), title: seed.title, schemaFamily: seed.schemaFamily, schemaVersion: null, contentType: "", templateId: seed.schemaFamily, schemaStatus: "UNAVAILABLE", setupReasons: ["Worksheet could not be found in the connected workbook."], targetPageProfileId: "", active: true, baselineState: "CURRENT_SOURCE", lastDiscoveredAt: now() });
  }
  async upsertDiscoveredSheet(sheet) {
    const saved = { ...(this.sheets.get(Number(sheet.sheetId)) || {}), ...structuredClone(sheet), sheetId: Number(sheet.sheetId), lastDiscoveredAt: now() };
    this.sheets.set(Number(sheet.sheetId), saved);
    return structuredClone(saved);
  }
  async markMissingSheets(presentIds) { for (const item of this.sheets.values()) if (!presentIds.has(Number(item.sheetId))) { item.schemaStatus = "UNAVAILABLE"; item.setupReasons = ["Worksheet was deleted or is currently inaccessible; registry and linked records were retained."]; } }
  async listProfiles() { return [...this.profiles.values()].map((item) => structuredClone(item)); }
  async getProfile(profileId) { const item = this.profiles.get(profileId); return item ? structuredClone(item) : null; }
  async saveProfile(profile) { this.profiles.set(profile.profileId, { ...structuredClone(profile), updatedAt: now() }); return this.getProfile(profile.profileId); }
  async saveSheetSettings(sheetId, targetPageProfileId, active) { const item = this.sheets.get(Number(sheetId)); if (!item) return null; if (targetPageProfileId !== undefined) item.targetPageProfileId = targetPageProfileId || ""; if (active !== undefined) item.active = Boolean(active); item.lastDiscoveredAt = now(); return structuredClone(item); }
  reviewKey(sheetId, contentId) { return `${Number(sheetId)}:${contentId}`; }
  async getReview(sheetId, contentId) { const value = this.reviews.get(this.reviewKey(sheetId, contentId)); return value ? structuredClone(value) : null; }
  async saveReview(review) { this.reviews.set(this.reviewKey(review.sheetId, review.contentId), structuredClone(review)); return structuredClone(review); }
  async getWorkflow(sheetId, contentId) { return structuredClone(this.workflows.get(this.reviewKey(sheetId, contentId)) || null); }
  async saveWorkflow(workflow) { this.workflows.set(this.reviewKey(workflow.sheetId, workflow.contentId), structuredClone(workflow)); return structuredClone(workflow); }
  async createPublication(record) { this.publications.set(record.publicationId, structuredClone(record)); return structuredClone(record); }
  async getPublication(publicationId) { return structuredClone(this.publications.get(publicationId) || null); }
  async updatePublication(record) { if (!this.publications.has(record.publicationId)) return null; this.publications.set(record.publicationId, structuredClone(record)); return structuredClone(record); }
  async insertSnapshot(snapshot) { this.snapshots.push(structuredClone(snapshot)); return structuredClone(snapshot); }
  async listResults(filters = {}) { const publications = [...this.publications.values()].filter((row) => (!filters.sheetId || row.sheetId === Number(filters.sheetId)) && (!filters.pageProfileId || row.pageProfileId === filters.pageProfileId)); const ids = new Set(publications.map((row) => row.publicationId)); return { publications: structuredClone(publications), snapshots: structuredClone(this.snapshots.filter((row) => ids.has(row.publicationId))) }; }
}

export class D1ProductionStore {
  constructor(db) { this.db = db; }
  async all(sql, ...values) { return (await this.db.prepare(sql).bind(...values).all()).results || []; }
  async one(sql, ...values) { return this.db.prepare(sql).bind(...values).first(); }
  async run(sql, ...values) { return this.db.prepare(sql).bind(...values).run(); }
  mapSheet(row) { return row ? { sheetId: Number(row.sheet_id), title: row.current_title, schemaFamily: row.schema_family, schemaVersion: row.schema_version, contentType: row.content_type, templateId: row.template_id, schemaStatus: row.schema_status, setupReasons: parseArray(row.setup_reasons_json), targetPageProfileId: row.target_page_profile_id || "", active: Boolean(row.active), baselineState: row.baseline_state, lastDiscoveredAt: row.last_discovered_at } : null; }
  async listSheets() { return (await this.all("SELECT * FROM production_sheet_registry ORDER BY active DESC, current_title")).map((row) => this.mapSheet(row)); }
  async getSheet(sheetId) { return this.mapSheet(await this.one("SELECT * FROM production_sheet_registry WHERE sheet_id=?", Number(sheetId))); }
  async countSheets() { const row = await this.one("SELECT COUNT(*) AS count FROM production_sheet_registry"); return Number(row?.count || 0); }
  async writeSheet(item) { await this.run(`INSERT INTO production_sheet_registry (sheet_id,current_title,schema_family,schema_version,content_type,template_id,schema_status,setup_reasons_json,target_page_profile_id,active,baseline_state,last_discovered_at,last_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sheet_id) DO UPDATE SET current_title=excluded.current_title,schema_family=excluded.schema_family,schema_version=excluded.schema_version,content_type=excluded.content_type,template_id=excluded.template_id,schema_status=excluded.schema_status,setup_reasons_json=excluded.setup_reasons_json,target_page_profile_id=excluded.target_page_profile_id,active=excluded.active,baseline_state=excluded.baseline_state,last_discovered_at=excluded.last_discovered_at,last_updated_at=excluded.last_updated_at`, Number(item.sheetId), item.title, item.schemaFamily || "UNKNOWN", item.schemaVersion ?? null, item.contentType || "", item.templateId || "", item.schemaStatus || "NEEDS_SETUP", JSON.stringify(item.setupReasons || []), item.targetPageProfileId || "", item.active ? 1 : 0, item.baselineState || "AUTO_DISCOVERED", now(), now()); return this.getSheet(item.sheetId); }
  async initializeBaseline(discovered, activeSeeds) {
    const active = new Map(activeSeeds.map((seed) => [Number(seed.sheetId), seed]));
    const entries = discovered.map((sheet) => {
      const seed = active.get(Number(sheet.sheetId));
      return { sheetId: sheet.sheetId, title: sheet.title, schemaFamily: seed?.schemaFamily || "UNCONNECTED", schemaVersion: null, contentType: seed?.schemaFamily === "LEGACY_RECIPE" ? "RECIPE" : seed ? "ROW_DEFINED" : "", templateId: seed?.schemaFamily || "", schemaStatus: seed ? "READY" : "NOT_SCANNED", setupReasons: [], targetPageProfileId: "", active: Boolean(seed), baselineState: seed ? "CURRENT_SOURCE" : "EXISTING_UNCONNECTED" };
    });
    for (const seed of activeSeeds) if (!entries.some((item) => Number(item.sheetId) === Number(seed.sheetId))) entries.push({ sheetId: seed.sheetId, title: seed.title, schemaFamily: seed.schemaFamily, schemaVersion: null, contentType: "", templateId: seed.schemaFamily, schemaStatus: "UNAVAILABLE", setupReasons: ["Worksheet could not be found in the connected workbook."], targetPageProfileId: "", active: true, baselineState: "CURRENT_SOURCE" });
    for (const entry of entries) await this.writeSheet(entry);
  }
  async upsertDiscoveredSheet(item) { const prior = await this.getSheet(item.sheetId); return this.writeSheet({ ...prior, ...item, targetPageProfileId: item.targetPageProfileId ?? prior?.targetPageProfileId ?? "", active: item.active ?? prior?.active ?? true, baselineState: item.baselineState || prior?.baselineState || "AUTO_DISCOVERED" }); }
  async markMissingSheets(presentIds) { for (const item of await this.listSheets()) if (!presentIds.has(Number(item.sheetId))) { item.schemaStatus = "UNAVAILABLE"; item.setupReasons = ["Worksheet was deleted or is currently inaccessible; registry and linked records were retained."]; await this.writeSheet(item); } }
  mapProfile(row) { return row ? { profileId: row.profile_id, facebookPageId: row.facebook_page_id, displayName: row.display_name, audience: row.audience, primaryLanguage: row.primary_language, toneGuidance: row.tone_guidance, contentPillars: parseArray(row.content_pillars_json), suitableFormats: parseArray(row.suitable_formats_json), avoidTopics: parseArray(row.avoid_topics_json), monetizationTypes: parseArray(row.monetization_types_json), active: Boolean(row.active), updatedAt: row.updated_at } : null; }
  async listProfiles() { return (await this.all("SELECT * FROM production_page_profiles ORDER BY active DESC, display_name")).map((row) => this.mapProfile(row)); }
  async getProfile(profileId) { return this.mapProfile(await this.one("SELECT * FROM production_page_profiles WHERE profile_id=?", profileId)); }
  async saveProfile(p) { await this.run(`INSERT INTO production_page_profiles (profile_id,facebook_page_id,display_name,audience,primary_language,tone_guidance,content_pillars_json,suitable_formats_json,avoid_topics_json,monetization_types_json,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET facebook_page_id=excluded.facebook_page_id,display_name=excluded.display_name,audience=excluded.audience,primary_language=excluded.primary_language,tone_guidance=excluded.tone_guidance,content_pillars_json=excluded.content_pillars_json,suitable_formats_json=excluded.suitable_formats_json,avoid_topics_json=excluded.avoid_topics_json,monetization_types_json=excluded.monetization_types_json,active=excluded.active,updated_at=excluded.updated_at`, p.profileId, p.facebookPageId, p.displayName, p.audience, p.primaryLanguage, p.toneGuidance, JSON.stringify(p.contentPillars), JSON.stringify(p.suitableFormats), JSON.stringify(p.avoidTopics), JSON.stringify(p.monetizationTypes), p.active ? 1 : 0, now()); return this.getProfile(p.profileId); }
  async saveSheetSettings(sheetId, pageProfileId, active) { const item = await this.getSheet(sheetId); if (!item) return null; if (pageProfileId !== undefined) item.targetPageProfileId = pageProfileId || ""; if (active !== undefined) item.active = Boolean(active); return this.writeSheet(item); }
  mapReview(row) { return row ? { sheetId: Number(row.sheet_id), contentId: row.content_id, review: JSON.parse(row.review_json), reviewer: row.reviewer_name, status: row.review_status, reviewedAt: row.reviewed_at } : null; }
  async getReview(sheetId, contentId) { return this.mapReview(await this.one("SELECT * FROM production_editorial_reviews WHERE sheet_id=? AND content_id=?", Number(sheetId), contentId)); }
  async saveReview(r) { await this.run(`INSERT INTO production_editorial_reviews (sheet_id,content_id,review_json,reviewer_name,review_status,reviewed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(sheet_id,content_id) DO UPDATE SET review_json=excluded.review_json,reviewer_name=excluded.reviewer_name,review_status=excluded.review_status,reviewed_at=excluded.reviewed_at`, Number(r.sheetId), r.contentId, JSON.stringify(r.review), r.reviewer, r.status, r.reviewedAt); return this.getReview(r.sheetId, r.contentId); }
  mapWorkflow(row) { return row ? { sheetId: Number(row.sheet_id), contentId: row.content_id, stage: row.stage, actor: row.actor, note: row.note, updatedAt: row.updated_at } : null; }
  async getWorkflow(sheetId, contentId) { return this.mapWorkflow(await this.one("SELECT * FROM production_workflows WHERE sheet_id=? AND content_id=?", Number(sheetId), contentId)); }
  async saveWorkflow(w) { await this.run(`INSERT INTO production_workflows (sheet_id,content_id,stage,actor,note,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(sheet_id,content_id) DO UPDATE SET stage=excluded.stage,actor=excluded.actor,note=excluded.note,updated_at=excluded.updated_at`, Number(w.sheetId), w.contentId, w.stage, w.actor, w.note, w.updatedAt); return this.getWorkflow(w.sheetId, w.contentId); }
  mapPublication(row) { return { publicationId: row.publication_id, sheetId: Number(row.sheet_id), contentId: row.content_id, pageProfileId: row.page_profile_id, pageDisplayName: row.page_display_name || "", contentType: row.content_type, contentFormat: row.content_format, publishedAt: row.published_at, postUrl: row.post_url, productionMinutes: row.production_minutes === null ? null : Number(row.production_minutes), directCost: row.direct_cost === null ? null : Number(row.direct_cost), currency: row.currency, createdAt: row.created_at, updatedAt: row.updated_at }; }
  async createPublication(r) { await this.run(`INSERT INTO production_publications (publication_id,sheet_id,content_id,page_profile_id,content_type,content_format,published_at,post_url,production_minutes,direct_cost,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.publicationId, Number(r.sheetId), r.contentId, r.pageProfileId, r.contentType, r.contentFormat, r.publishedAt, r.postUrl, r.productionMinutes, r.directCost, r.currency, now(), now()); return this.getPublication(r.publicationId); }
  async getPublication(publicationId) { return this.mapPublication(await this.one("SELECT pp.*, pr.display_name AS page_display_name FROM production_publications pp LEFT JOIN production_page_profiles pr ON pr.profile_id=pp.page_profile_id WHERE pp.publication_id=?", publicationId)); }
  async updatePublication(r) { await this.run("UPDATE production_publications SET content_format=?,published_at=?,post_url=?,production_minutes=?,direct_cost=?,currency=?,updated_at=? WHERE publication_id=?", r.contentFormat, r.publishedAt, r.postUrl, r.productionMinutes, r.directCost, r.currency, now(), r.publicationId); return this.getPublication(r.publicationId); }
  async insertSnapshot(s) { await this.run(`INSERT INTO production_result_snapshots (snapshot_id,publication_id,captured_at,reach,qualified_views,engagement,shares,saves,retention_rate,meta_earnings,affiliate_clicks,affiliate_orders,affiliate_commission,entered_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, s.snapshotId, s.publicationId, s.capturedAt, s.reach, s.qualifiedViews, s.engagement, s.shares, s.saves, s.retentionRate, s.metaEarnings, s.affiliateClicks, s.affiliateOrders, s.affiliateCommission, s.enteredBy, now()); return s; }
  async listResults(filters = {}) { const where = []; const values = []; if (filters.sheetId) { where.push("pp.sheet_id=?"); values.push(Number(filters.sheetId)); } if (filters.pageProfileId) { where.push("pp.page_profile_id=?"); values.push(filters.pageProfileId); } if (filters.from) { where.push("pp.published_at>=?"); values.push(filters.from); } if (filters.to) { where.push("pp.published_at<=?"); values.push(filters.to); } const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""; const publications = (await this.all(`SELECT pp.*,pr.display_name AS page_display_name FROM production_publications pp LEFT JOIN production_page_profiles pr ON pr.profile_id=pp.page_profile_id ${clause} ORDER BY pp.published_at DESC`, ...values)).map((row) => this.mapPublication(row)); const snapshots = (await this.all(`SELECT rs.* FROM production_result_snapshots rs JOIN production_publications pp ON pp.publication_id=rs.publication_id ${clause} ORDER BY rs.captured_at DESC`, ...values)).map((row) => ({ snapshotId: row.snapshot_id, publicationId: row.publication_id, capturedAt: row.captured_at, reach: row.reach === null ? null : Number(row.reach), qualifiedViews: row.qualified_views === null ? null : Number(row.qualified_views), engagement: row.engagement === null ? null : Number(row.engagement), shares: row.shares === null ? null : Number(row.shares), saves: row.saves === null ? null : Number(row.saves), retentionRate: row.retention_rate === null ? null : Number(row.retention_rate), metaEarnings: row.meta_earnings === null ? null : Number(row.meta_earnings), affiliateClicks: row.affiliate_clicks === null ? null : Number(row.affiliate_clicks), affiliateOrders: row.affiliate_orders === null ? null : Number(row.affiliate_orders), affiliateCommission: row.affiliate_commission === null ? null : Number(row.affiliate_commission), enteredBy: row.entered_by })); return { publications, snapshots }; }
}

function profileIsComplete(profile) {
  return Boolean(profile?.active && profile.facebookPageId && profile.displayName && profile.audience && profile.primaryLanguage && profile.toneGuidance && profile.avoidTopics?.length);
}

export function publicSourceState(sheet, profiles = []) {
  const profile = profiles.find((item) => item.profileId === sheet.targetPageProfileId) || null;
  const status = sheet.schemaStatus === "UNAVAILABLE" ? "UNAVAILABLE" : !sheet.active ? "INACTIVE" : sheet.schemaStatus !== "READY" ? "NEEDS_SETUP" : profileIsComplete(profile) ? "READY" : "NEEDS_SETUP";
  const reasons = [...(sheet.setupReasons || [])];
  if (sheet.schemaStatus === "READY" && !profile) reasons.push("Assign a complete Facebook page profile before generation.");
  else if (profile && !profileIsComplete(profile)) reasons.push("The selected Facebook page profile is incomplete or inactive.");
  return {
    sheetId: Number(sheet.sheetId), name: sheet.title, title: sheet.title,
    contentType: sheet.contentType || "Unknown", templateId: sheet.templateId || "",
    schemaVersion: sheet.schemaVersion ?? null, schemaStatus: sheet.schemaStatus,
    setupStatus: status, setupReasons: reasons, active: Boolean(sheet.active),
    targetPageProfileId: sheet.targetPageProfileId || "", targetPageName: profile?.displayName || "Not assigned",
    label: `${sheet.title} · ${sheet.contentType || "Needs Setup"} · ${profile?.displayName || "Page not assigned"}`
  };
}

async function validateRef(context, sheetId, contentId) {
  if (!context?.validateContentRef) return null;
  const result = await context.validateContentRef(Number(sheetId), asText(contentId));
  if (!result?.ok) throw Object.assign(new Error(result?.error || "Content record could not be verified from the connected worksheet."), { status: result?.status || 422 });
  return result.content;
}

export async function handleProductionOperationsApi(request, env, url, injectedStore = null, context = {}) {
  const store = injectedStore || (env?.DB ? new D1ProductionStore(env.DB) : null);
  if (!store) return json({ ok: false, error: "Production operations storage is not configured." }, 503);
  try {
    if (request.method === "GET" && url.pathname === "/api/production/page-profiles") return json({ ok: true, profiles: await store.listProfiles() });
    if (request.method === "POST" && url.pathname === "/api/production/page-profiles") {
      const error = writeGuard(request); if (error) return json({ ok: false, error }, 403);
      const { profile, errors } = normalizeProfile(await readBody(request));
      if (errors.length) return json({ ok: false, error: errors.join(" "), fieldErrors: errors }, 400);
      const saved = await store.saveProfile(profile);
      return json({ ok: true, profile: saved }, 201);
    }
    if (request.method === "POST" && url.pathname === "/api/production/sheets/settings") {
      const error = writeGuard(request); if (error) return json({ ok: false, error }, 403);
      const body = await readBody(request); const sheetId = Number(body.sheetId);
      if (!Number.isSafeInteger(sheetId) || sheetId <= 0) return json({ ok: false, error: "A valid sheetId is required." }, 400);
      if (body.targetPageProfileId && !await store.getProfile(body.targetPageProfileId)) return json({ ok: false, error: "Selected page profile does not exist." }, 400);
      const sheet = await store.saveSheetSettings(sheetId, body.targetPageProfileId, body.active);
      return sheet ? json({ ok: true, sheet }) : json({ ok: false, error: "Worksheet registry entry not found." }, 404);
    }
    if (request.method === "GET" && url.pathname === "/api/production/editorial-review") {
      const sheetId = Number(url.searchParams.get("sheetId")); const contentId = asText(url.searchParams.get("contentId"));
      if (!sheetId || !contentId) return json({ ok: false, error: "sheetId and contentId are required." }, 400);
      const content = await validateRef(context, sheetId, contentId);
      const rawJson = content.raw?.Editorial_Review_JSON || content.raw?.editorial_review_json || "";
      return json({ ok: true, review: rawJson ? { sheetId, contentId, source: "sheet", review: content.editorialReview, rawJson: String(rawJson) } : null, parseError: content.editorialReviewParseError || "" });
    }
    if (request.method === "POST" && url.pathname === "/api/production/editorial-review") {
      const error = writeGuard(request); if (error) return json({ ok: false, error }, 403);
      const body = await readBody(request); const content = await validateRef(context, body.sheetId, body.contentId);
      if (!content) return json({ ok: false, error: "Content verification is unavailable." }, 503);
      const reviewStatus = asText(body.reviewStatus).toUpperCase();
      if (!["REVIEW", "PASS", "BLOCKED"].includes(reviewStatus)) return json({ ok: false, error: "Review status must be REVIEW, PASS or BLOCKED." }, 400);
      const reviewer = asText(body.reviewer);
      if (!reviewer) return json({ ok: false, error: "Reviewer name is required." }, 400);
      const evidenceType = asText(body.evidenceType).toUpperCase();
      if (!["SOURCE_DIRECT", "SOURCE_GENERAL", "HEURISTIC", "UNVERIFIED"].includes(evidenceType)) return json({ ok: false, error: "Choose a supported evidence classification." }, 400);
      const review = {
        schema_version: 1,
        ...(content.editorialReview || {}),
        review_status: reviewStatus,
        reviewer,
        reviewed_at: now(),
        review_note: asText(body.reviewNote),
        audience_need: Object.hasOwn(body, "audienceNeed") ? asText(body.audienceNeed) : content.editorialReview?.audience_need || "",
        reader_value: Object.hasOwn(body, "readerValue") ? asText(body.readerValue) : content.editorialReview?.reader_value || "",
        source_notes: Object.hasOwn(body, "sourceNotes") ? asText(body.sourceNotes) : content.editorialReview?.source_notes || "",
        evidence_type: evidenceType,
        evidence: {
          type: evidenceType,
          references: Array.isArray(body.evidenceReferences) ? body.evidenceReferences.map(asText).filter(Boolean) : [],
          notes: asText(body.evidenceNotes || body.sourceNotes)
        },
        source_evidence_status: body.evidenceVerified === true ? "VERIFIED" : "UNVERIFIED",
        caption_review_status: body.captionApproved === true ? "PASS" : "REVIEW",
        reader_facing_copy_reviewed: body.readerFacingCopyReviewed === true,
        internal_note_leakage: body.internalNoteLeakage === true,
        claim_safety_ok: body.claimSafetyOk === true,
        page_fit_status: body.pageFitApproved === true ? "PASS" : "REVIEW",
        page_profile_id: content.pageProfile?.profileId || "",
        page_profile_updated_at: content.pageProfile?.updatedAt || "",
        limitations: Object.hasOwn(body, "limitations") ? asText(body.limitations) : content.editorialReview?.limitations || "",
        claim_evidence: Object.hasOwn(body, "claimEvidence") ? asText(body.claimEvidence) : content.editorialReview?.claim_evidence || "",
        internal_claim_notes: Object.hasOwn(body, "internalClaimNotes") ? asText(body.internalClaimNotes) : content.editorialReview?.internal_claim_notes || "",
        editorial_notes: Object.hasOwn(body, "editorialNotes") ? asText(body.editorialNotes) : content.editorialReview?.editorial_notes || "",
        approximate_recipe: body.approximateRecipe === true,
        recipe_precision: body.approximateRecipe === true ? "APPROXIMATE" : asText(body.recipePrecision),
        timing_guidance: asText(body.timingGuidance),
        temperature_required: body.temperatureRequired === true,
        temperature_guidance: asText(body.temperatureGuidance),
        serving_expectation: asText(body.servingExpectation),
        mistake_problem: asText(body.mistakeProblem),
        cause_explanation: asText(body.causeExplanation),
        consequence: asText(body.consequence),
        expected_result: asText(body.expectedResult),
        option_suitability: asText(body.optionSuitability),
        tradeoffs: asText(body.tradeoffs),
        decision_logic: asText(body.decisionLogic)
      };
      const reviewContent = { ...content, editorialReview: review, editorialReviewPresent: true, editorialReviewParseError: "" };
      const { runEditorialReview } = await import("./content-model.mjs");
      const evaluated = runEditorialReview(reviewContent);
      if (reviewStatus === "PASS" && evaluated.status !== "PASS") return json({ ok: false, error: "Editorial PASS was not recorded because required review checks remain.", reviewStatus: evaluated.status, issues: evaluated.issues }, 422);
      if (!context.persistEditorialReview) return json({ ok: false, error: "Google Sheets editorial-review write/readback is not configured; no review was saved." }, 503);
      const serialized = JSON.stringify(review);
      const saved = await context.persistEditorialReview(Number(body.sheetId), asText(body.contentId), serialized);
      if (saved?.source !== "sheet" || saved?.record?.Content_ID !== asText(body.contentId) || saved?.record?.Editorial_Review_JSON !== serialized || saved?.reviewJson !== serialized) {
        return json({ ok: false, error: "Google Sheets review readback did not match the submitted row/cell; treat save as failed." }, 502);
      }
      const { normalizeContentRecord } = await import("./content-model.mjs");
      const reread = normalizeContentRecord(saved.record);
      const rereadEvaluation = runEditorialReview(reread);
      if (reviewStatus === "PASS" && rereadEvaluation.status !== "PASS") return json({ ok: false, error: "Sheet readback no longer satisfies Editorial PASS; the saved review is not generation-approved.", reviewStatus: rereadEvaluation.status, issues: rereadEvaluation.issues }, 502);
      return json({ ok: true, review: { sheetId: Number(body.sheetId), contentId: asText(body.contentId), source: "sheet", review: reread.editorialReview, rawJson: serialized, rowNumber: saved.rowNumber }, evaluated: rereadEvaluation, recomputedFrom: "sheet-readback" }, 201);
    }
    if (request.method === "GET" && url.pathname === "/api/production/workflow") {
      const sheetId = Number(url.searchParams.get("sheetId")); const contentId = asText(url.searchParams.get("contentId"));
      if (!sheetId || !contentId) return json({ ok: false, error: "sheetId and contentId are required." }, 400);
      const stored = await store.getWorkflow(sheetId, contentId);
      const content = await validateRef(context, sheetId, contentId);
      return json({ ok: true, workflow: stored || { sheetId, contentId, stage: inferWorkflowStage(content?.lifecycleStatus, Boolean(content?.contentBody || content?.caption)), actor: "", note: "", updatedAt: null } });
    }
    if (request.method === "POST" && url.pathname === "/api/production/workflow") {
      const error = writeGuard(request); if (error) return json({ ok: false, error }, 403);
      const body = await readBody(request); const sheetId = Number(body.sheetId); const contentId = asText(body.contentId);
      const content = await validateRef(context, sheetId, contentId);
      if (!content) return json({ ok: false, error: "Content verification is unavailable." }, 503);
      const prior = await store.getWorkflow(sheetId, contentId);
      const currentStage = prior?.stage || inferWorkflowStage(content.lifecycleStatus, Boolean(content.contentBody || content.caption));
      const review = content.editorialReviewPresent ? { source: "sheet", review: content.editorialReview } : null;
      const gates = await context.getWorkflowGates?.(sheetId, contentId, content, review, body) || {};
      if (!asText(body.actor)) return json({ ok: false, error: "Record the operator name for this workflow transition." }, 400);
      if (["ASSET_CREATED", "QC_PASSED", "SCHEDULED_PUBLISHED"].includes(asText(body.nextStage)) && !asText(body.note)) return json({ ok: false, error: "Add a short human verification note for this production transition." }, 400);
      let resultRecorded = false;
      let published = false;
      if (asText(body.nextStage) === "SCHEDULED_PUBLISHED") {
        const results = await store.listResults({ sheetId });
        published = results.publications.some((row) => row.contentId === contentId && row.postUrl && Number.isFinite(Date.parse(row.publishedAt)));
      }
      if (asText(body.nextStage) === "RESULTS_RECORDED") {
        const results = await store.listResults({ sheetId });
        const snapshotsByPublication = new Set(results.snapshots.filter(hasReportedPerformanceMetric).map((row) => row.publicationId));
        resultRecorded = results.publications.some((row) => row.contentId === contentId && snapshotsByPublication.has(row.publicationId));
      }
      const transition = validateWorkflowTransition(currentStage, asText(body.nextStage), {
        editorialStatus: review?.status || content.editorialReview?.review_status,
        generationReady: gates.generationReady === true,
        requiredImagesPresent: body.requiredImagesPresent === true,
        finalAssetsPresent: body.finalAssetsPresent === true,
        visualQcPass: body.visualQcPass === true,
        published,
        resultRecorded
      });
      if (!transition.valid) return json({ ok: false, error: transition.reason, currentStage }, 422);
      const saved = await store.saveWorkflow({ sheetId, contentId, stage: asText(body.nextStage), actor: asText(body.actor), note: asText(body.note), updatedAt: now() });
      return json({ ok: true, workflow: saved });
    }
    if (request.method === "GET" && url.pathname === "/api/production/results") {
      const results = await store.listResults({ sheetId: url.searchParams.get("sheetId"), pageProfileId: url.searchParams.get("pageProfileId"), from: url.searchParams.get("from"), to: url.searchParams.get("to") });
      const profiles = await store.listProfiles();
      const withNames = results.publications.map((row) => ({ ...row, pageDisplayName: profiles.find((profile) => profile.profileId === row.pageProfileId)?.displayName || row.pageDisplayName || "" }));
      return json({ ok: true, summary: summarizeManualResults(withNames, results.snapshots) });
    }
    if (request.method === "POST" && url.pathname === "/api/production/results") {
      const error = writeGuard(request); if (error) return json({ ok: false, error }, 403);
      const body = await readBody(request); const { record, errors } = validateManualResult(body);
      if (errors.length) return json({ ok: false, error: errors.join(" "), fieldErrors: errors }, 400);
      const publicationOnly = body.publicationOnly === true;
      if (publicationOnly && !record.postUrl) return json({ ok: false, error: "A published post URL is required before confirming the publication stage." }, 400);
      if (!publicationOnly && !hasReportedPerformanceMetric(record)) return json({ ok: false, error: "Enter at least one observed performance metric. Blank metrics are kept unknown, not recorded as zero." }, 400);
      const content = await validateRef(context, record.sheetId, record.contentId);
      if (!content) return json({ ok: false, error: "Content_ID was not found in the selected worksheet." }, 404);
      const sheet = await store.getSheet(record.sheetId); const profile = await store.getProfile(record.pageProfileId);
      if (!sheet || sheet.targetPageProfileId !== record.pageProfileId) return json({ ok: false, error: "The results page must match the page profile assigned to this worksheet." }, 422);
      if (!profileIsComplete(profile)) return json({ ok: false, error: "The selected Facebook page profile is not complete and active." }, 422);
      record.contentType = content.contentType;
      let publication;
      if (body.publicationId) {
        const existing = await store.getPublication(body.publicationId);
        if (!existing || existing.sheetId !== record.sheetId || existing.contentId !== record.contentId || existing.pageProfileId !== record.pageProfileId) return json({ ok: false, error: "Publication record does not match this content and page." }, 404);
        publication = await store.updatePublication({ ...existing, ...record,
          contentFormat: record.contentFormat || existing.contentFormat,
          publishedAt: record.publishedAt || existing.publishedAt,
          postUrl: record.postUrl || existing.postUrl,
          productionMinutes: record.productionMinutes ?? existing.productionMinutes,
          directCost: record.directCost ?? existing.directCost,
          currency: record.currency || existing.currency
        });
      } else publication = await store.createPublication(record);
      const snapshot = publicationOnly ? null : await store.insertSnapshot({ ...record, publicationId: publication.publicationId, snapshotId: id("metric"), capturedAt: record.capturedAt });
      return json({ ok: true, publication, snapshot, note: "Meta earnings and affiliate commission are stored separately; missing values remain unknown." }, 201);
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message || "Unexpected production operations error." }, error.status || 500);
  }
}

export { inspectSheetHeaders, isReservedSheetName, publicSheetTemplate, SHEET_TEMPLATES };
