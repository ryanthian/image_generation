import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  OPPORTUNITY_CANARY_SEEDS,
  approveOpportunity,
  buildOpportunity,
  buildOpportunityCanary,
  detectSaturation,
  extractFeatures,
  normalizePerformance,
  routeOpportunity
} from "../src/opportunity-engine.mjs";
import { TEMPLATE_REGISTRY, normalizeContentRecord } from "../src/content-model.mjs";

const history = JSON.parse(await readFile(new URL("../data/v4-2-historical-performance.json", import.meta.url), "utf8")).records;
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const opportunityUi = await readFile(new URL("../public/opportunities.js", import.meta.url), "utf8");

test("performance normalization preserves raw metrics and derives safe rates", () => {
  const normalized = normalizePerformance(history.find((item) => item.post_id === "HIST-COFFEE-001"));
  assert.equal(normalized.impressions, 46449);
  assert.equal(normalized.save_rate, 342 / 46449);
  assert.equal(normalized.share_rate, 409 / 46449);
  assert.equal(normalized.follow_per_1k, 81 / 46449 * 1000);
  assert.equal(normalized.revenue_rpm, .43 / 46449 * 1000);
});

test("zero impressions and missing metrics never produce false numeric rates", () => {
  const zero = normalizePerformance({ impressions: 0, saves: 3, shares: 2 });
  const missing = normalizePerformance({ saves: 3 });
  assert.equal(zero.save_rate, null); assert.equal(zero.share_rate, null); assert.equal(missing.follow_per_1k, null);
});

test("feature extraction distinguishes a topic from a transferable mechanism", () => {
  const features = extractFeatures({ title: "保温杯容量怎么选？", topic: "DRINKWARE", mechanism: "DECISION_GUIDE" });
  assert.equal(features.topic, "DRINKWARE"); assert.equal(features.content_mechanism, "DECISION_GUIDE"); assert.notEqual(features.topic, features.content_mechanism);
});

test("routing exposes controlled saveable and collection guides without changing recipe routing", () => {
  assert.equal(routeOpportunity({ title: "咖啡有什么不同？", mechanism: "REFERENCE_GUIDE" }), "SAVEABLE_GUIDE");
  assert.equal(routeOpportunity({ title: "6款家常菜", mechanism: "COLLECTION" }), "COLLECTION_GUIDE");
  assert.equal(routeOpportunity({ title: "蒸排骨", mechanism: "RECIPE_UTILITY" }), "RECIPE_STANDARD");
  assert.ok(TEMPLATE_REGISTRY.SAVEABLE_GUIDE); assert.ok(TEMPLATE_REGISTRY.COLLECTION_GUIDE);
});

test("repeated Asam Boi is explainably saturated rather than promoted as a winner", () => {
  const result = detectSaturation({ title: "Sarsi + Asam Boi", topic: "LOCAL_DRINK", mechanism: "LOCAL_FAMILIARITY" }, history, { now: "2026-07-01T00:00:00Z" });
  assert.equal(result.saturation, "HIGH"); assert.equal(result.novelty, "LOW"); assert.match(result.reasons.join(" "), /Asam Boi/);
});

test("opportunity evidence is explainable and does not contain an opaque overall score", () => {
  const opportunity = buildOpportunity(OPPORTUNITY_CANARY_SEEDS[1], history);
  assert.ok(opportunity.evidence_notes.length >= 3); assert.equal("score" in opportunity, false);
  assert.equal(opportunity.affiliate_fit, "HIGH"); assert.equal(opportunity.recommended_template, "SAVEABLE_GUIDE");
});

test("canary contains diverse mechanisms, local relevance, selection and affiliate transfer", () => {
  const canary = buildOpportunityCanary(history);
  assert.equal(canary.length, 12);
  assert.ok(new Set(canary.map((item) => item.content_mechanism)).size >= 5);
  assert.ok(canary.some((item) => item.topic === "JEWELRY_CRYSTAL_CULTURE"));
  assert.ok(canary.some((item) => item.title.includes("Kopitiam")));
  assert.ok(canary.some((item) => item.affiliate_fit === "HIGH"));
  assert.ok(canary.every((item) => item.approval_status === "PENDING"));
});

test("approval is explicit and produces a V4-compatible draft only", () => {
  const opportunity = buildOpportunity(OPPORTUNITY_CANARY_SEEDS[0], history);
  const approved = approveOpportunity(opportunity);
  assert.equal(approved.approval_status, "APPROVED"); assert.equal(approved.production_draft.Schema_Version, 4);
  assert.match(approved.production_draft.Hook_Text, /在一些佩戴文化中/);
  assert.equal(normalizeContentRecord(approved.production_draft).templateType, "SAVEABLE_GUIDE");
  assert.throws(() => approveOpportunity(approved), /pending/);
});

test("new guide templates normalize while legacy V4 production records remain valid", () => {
  const guide = normalizeContentRecord({ Schema_Version: 4, Content_ID: "OPP-GUIDE", Title: "容量怎么选", Topic: "DRINKWARE", Content_Type: "PRODUCT_GUIDE", Template_Type: "SAVEABLE_GUIDE" });
  assert.equal(guide.resolvedAssetPlan.length, 4);
  const collection = normalizeContentRecord({ Schema_Version: 4, Content_ID: "OPP-COLLECTION", Title: "6款家常菜", Topic: "HOME_COOKING", Content_Type: "COLLECTION", Template_Type: "COLLECTION_GUIDE" });
  assert.equal(collection.resolvedAssetPlan.length, 3);
});

test("approval routes into the existing read-only V4.1 production workflow without publishing", () => {
  assert.match(appSource, /V4\.2 Approved Opportunities/);
  assert.match(appSource, /Approved opportunity handoff/);
  assert.match(opportunityUi, /capc-approved-opportunity/);
  assert.match(opportunityUi, /has not created images, final assets, a Sheet record, a batch, or a Facebook post/i);
});
