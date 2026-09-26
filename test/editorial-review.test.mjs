import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildAssetSourceRevision,
  deriveGenerationReadiness,
  derivePublishingReadiness,
  isStoredAssetStale,
  buildSessionPrompt,
  normalizeContentRecord,
  runContentQc,
  runEditorialReview
} from "../src/content-model.mjs";

const canary = JSON.parse(await readFile(new URL("../data/content-v4-canary.json", import.meta.url), "utf8"));
const legacyRecipes = JSON.parse(await readFile(new URL("../data/recipes.json", import.meta.url), "utf8"));
const approvedPageProfile = {
  profileId: "test-page-1", facebookPageId: "test-page-1", updatedAt: "2026-09-26T07:00:00Z",
  displayName: "Test Food Page", audience: "Malaysian home cooks", primaryLanguage: "Malaysian Chinese",
  toneGuidance: "Practical, warm and direct.", avoidTopics: ["unsupported health claims"], active: true
};
const withApprovedPage = (record) => ({ ...record, pageProfile: approvedPageProfile });

function recipeRecord({ quantities = true, caption = "先煎香再焖熟，配热饭就是一顿简单晚餐。", source = "Recipe source: Reviewed Home Cooking, page 10." } = {}) {
  const assets = [
    { sequence: 1, asset_id: "cover", asset_type: "COVER", title: "Cover", purpose: "Show the finished dish", layout_type: "cover_overlay", overlay_text: "家常酱香鸡腿", image_prompt: "Photorealistic finished chicken and rice, no text.", required: true },
    { sequence: 2, asset_id: "ingredients", asset_type: "INGREDIENTS", title: "Ingredients", purpose: "Exact ingredient list", layout_type: "ingredients_compact", overlay_text: "鸡腿｜酱油", image_prompt: "Only the listed ingredients, no text.", ingredient_items: [{ name: "鸡腿", quantity: quantities ? "500g" : "" }, { name: "酱油", quantity: quantities ? "15ml" : "" }], coverage_point_ids: ["ING"], required: true },
    { sequence: 3, asset_id: "method", asset_type: "METHOD", title: "Method", purpose: "Ordered method", layout_type: "method_grid_adaptive", overlay_text: "煎香 → 焖熟", coverage_point_ids: ["M1", "M2"], required: true, generation_inputs: [
      { slot_id: "m1", label: "M1", method_step_id: "M1", step_heading: "擦干鸡腿", step_supporting_text: "下锅前擦干表面水分。", image_prompt: "Photorealistic raw chicken being dried, no text.", required: true },
      { slot_id: "m2", label: "M2", method_step_id: "M2", step_heading: "煎香后焖熟", step_supporting_text: "煎至上色，再焖至中心熟透。", image_prompt: "Same chicken being seared and then cooked through, no text.", required: true }
    ] },
    { sequence: 4, asset_id: "closeup", asset_type: "CLOSEUP", title: "Closeup", purpose: "Serving result", layout_type: "detail_overlay", overlay_text: "配热饭上桌", image_prompt: "Photorealistic cooked chicken served with rice, no text.", required: true }
  ];
  const editorial = {
    review_status: "PASS", reviewer: "Editor A", reviewed_at: "2026-09-26T08:00:00Z", page_profile_id: "test-page-1", page_profile_updated_at: "2026-09-26T07:00:00Z",
    audience_need: "需要一份简单的下班晚餐做法。", reader_value: "提供可照做的鸡腿饭步骤。",
    source_evidence_status: "VERIFIED", caption_review_status: "PASS", page_fit_status: "PASS", claim_evidence: "Reviewed recipe source, page 10.",
    recipe_precision: "EXACT", timing_guidance: "约12分钟，按鸡块大小检查熟透状态。", serving_expectation: "热鸡腿配白饭。"
  };
  return {
    Schema_Version: 4, Content_ID: "TEST-RECIPE", Title: "家常酱香鸡腿", Topic: "RECIPE", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD",
    Visual_Profile: "REALISTIC_MALAYSIAN_KITCHEN", Hook_Type: "HOW_TO", Hook_Text: "需要一份简单的下班晚餐做法吗？", Ready_To_Post_Caption: caption,
    Content_Body: "鸡腿擦干后煎至上色，再加入酱汁焖至中心完全熟透，约12分钟，搭配热饭。", Source_References: source,
    Editorial_Review_JSON: JSON.stringify(editorial), Asset_Plan_JSON: JSON.stringify({
      source_ingredients: ["鸡腿", "酱油"],
      coverage_points: ["ING", "M1", "M2"].map((id) => ({ id, text: id, required: true })),
      assets
    })
  };
}

test("structurally valid recipe missing quantities remains editorial REVIEW and blocks generation", () => {
  const content = normalizeContentRecord(recipeRecord({ quantities: false }));
  assert.equal(runContentQc(content).status, "PASS");
  const editorial = runEditorialReview(content);
  assert.equal(editorial.status, "REVIEW");
  assert.ok(editorial.issues.some((issue) => issue.code === "RECIPE_QUANTITIES_OR_APPROXIMATION_MISSING"));
  assert.equal(deriveGenerationReadiness(content, { structuralQc: runContentQc(content), editorialReview: editorial }).status, "GENERATION_BLOCKED");
});

test("temperature guidance is required only when the recipe specification marks it applicable", () => {
  const raw = recipeRecord();
  raw.Editorial_Review_JSON = JSON.stringify({ ...JSON.parse(raw.Editorial_Review_JSON), temperature_required: true });
  const editorial = runEditorialReview(normalizeContentRecord(raw));
  assert.ok(editorial.issues.some((issue) => issue.code === "RECIPE_TEMPERATURE_GUIDANCE_MISSING"));
});

test("internal claim-safety instruction in caption is editorial BLOCKED", () => {
  const content = normalizeContentRecord(recipeRecord({ caption: "不发布‘解暑、提神、开胃’等健康功效。" }));
  const editorial = runEditorialReview(content);
  assert.equal(editorial.status, "BLOCKED");
  assert.ok(editorial.issues.some((issue) => issue.code === "INTERNAL_NOTE_IN_READER_COPY"));
});

test("complete recipe with reviewer attestation can PASS editorial and become generation-ready", () => {
  const content = withApprovedPage(normalizeContentRecord(recipeRecord()));
  const structural = runContentQc(content);
  const editorial = runEditorialReview(content);
  assert.equal(structural.status, "PASS");
  assert.equal(editorial.status, "PASS");
  assert.equal(deriveGenerationReadiness(content, { structuralQc: structural, editorialReview: editorial }).status, "GENERATION_READY");
});

test("missing source/evidence is editorial REVIEW even when the production contract passes", () => {
  const content = normalizeContentRecord(recipeRecord({ source: "" }));
  const editorial = runEditorialReview(content);
  assert.equal(runContentQc(content).status, "PASS");
  assert.equal(editorial.status, "REVIEW");
  assert.ok(editorial.issues.some((issue) => issue.code === "SOURCE_EVIDENCE_MISSING"));
});

test("asset-plan text alone does not satisfy an explicit reader-value review", () => {
  const raw = recipeRecord();
  const review = JSON.parse(raw.Editorial_Review_JSON);
  delete review.reader_value;
  raw.Editorial_Review_JSON = JSON.stringify(review);
  const content = normalizeContentRecord(raw);
  assert.equal(runContentQc(content).status, "PASS");
  const editorial = runEditorialReview(content);
  assert.equal(editorial.status, "REVIEW");
  assert.ok(editorial.issues.some((issue) => issue.code === "READER_VALUE_NOT_EXPLICIT"));
});

test("structural PASS plus editorial REVIEW never becomes generation-ready", () => {
  const content = normalizeContentRecord(recipeRecord({ quantities: false }));
  const structural = runContentQc(content);
  const editorial = runEditorialReview(content);
  const readiness = deriveGenerationReadiness(content, { structuralQc: structural, editorialReview: editorial });
  assert.equal(structural.status, "PASS");
  assert.equal(editorial.status, "REVIEW");
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((reason) => reason.includes("Editorial status is REVIEW")));
});

test("publishing remains blocked until source images, finals and explicit visual review are complete", () => {
  const content = withApprovedPage(normalizeContentRecord(recipeRecord()));
  const generationReadiness = deriveGenerationReadiness(content);
  assert.equal(derivePublishingReadiness(content, { generationReadiness }).status, "NOT_READY");
  const ready = derivePublishingReadiness(content, { generationReadiness, requiredImagesPresent: true, finalAssetsPresent: true, visualQcStatus: "PASS" });
  assert.equal(ready.status, "READY");
});

test("replacing M3 invalidates only the final composition that consumes M3", () => {
  const method = { asset_id: "method", generation_inputs: ["m1", "m2", "m3", "m4", "m5"].map((slot_id) => ({ slot_id })) };
  const cover = { asset_id: "cover", generation_inputs: [{ slot_id: "cover" }] };
  const before = { m1: { updatedAt: 1 }, m2: { updatedAt: 1 }, m3: { updatedAt: 1 }, m4: { updatedAt: 1 }, m5: { updatedAt: 1 }, cover: { updatedAt: 1 } };
  const after = { ...before, m3: { updatedAt: 2 } };
  assert.notEqual(buildAssetSourceRevision(method, before), buildAssetSourceRevision(method, after));
  assert.equal(buildAssetSourceRevision(cover, before), buildAssetSourceRevision(cover, after));
  const legacyMethodAsset = { updatedAt: 1 };
  assert.equal(isStoredAssetStale(method, legacyMethodAsset, before), false);
  assert.equal(isStoredAssetStale(method, legacyMethodAsset, after), true);
  assert.equal(isStoredAssetStale(cover, { updatedAt: 1 }, before), false);
  assert.equal(isStoredAssetStale(method, { updatedAt: 1 }, { ...before, m3: undefined }), true);
});

test("existing structural QC keeps its contract and remains independent", () => {
  const content = normalizeContentRecord(canary.records.find((item) => item.Content_ID === "V4-RCP-001"));
  const structural = runContentQc(content);
  assert.equal(structural.status, "PASS");
  assert.deepEqual(Object.keys(structural), ["status", "failures", "warnings", "manualChecks"]);
});

test("editorial checks do not enrich or alter the legacy structural plan", () => {
  const legacy = normalizeContentRecord(legacyRecipes.recipes.find((item) => item.Content_ID === "EN-NEW-001"));
  const method = legacy.resolvedAssetPlan.find((item) => item.asset_type === "METHOD");
  const ingredients = legacy.resolvedAssetPlan.find((item) => item.asset_type === "INGREDIENTS");
  assert.equal(runContentQc(legacy).status, "PASS");
  assert.equal(legacy.sourceIngredients, undefined);
  assert.equal(ingredients.ingredient_items, undefined);
  assert.equal(method.generation_inputs[0].method_step_id, "");
  assert.equal(runEditorialReview(legacy).status, "REVIEW");
});

test("malformed optional editorial metadata does not reject structural V4 normalization", () => {
  const content = normalizeContentRecord({ ...recipeRecord(), Editorial_Review_JSON: "not-json" });
  assert.equal(runContentQc(content).status, "PASS");
  assert.equal(runEditorialReview(content).status, "REVIEW");
});

test("empty development handoffs remain NOT_REVIEWED, while an explicit editor block is retained", () => {
  const base = { Schema_Version: 4, Content_ID: "IDEA-1", Title: "Test idea", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD" };
  assert.equal(runEditorialReview(normalizeContentRecord(base)).status, "NOT_REVIEWED");
  const blocked = normalizeContentRecord({ ...base, Editorial_Review_JSON: JSON.stringify({ review_status: "BLOCKED" }) });
  assert.equal(runEditorialReview(blocked).status, "BLOCKED");
});

test("specific editorial source notes can supplement a generic canary provenance label", () => {
  const raw = recipeRecord();
  raw.Source_References = "Controlled V4 Google Sheet canary · 2026-09-21";
  const review = JSON.parse(raw.Editorial_Review_JSON);
  review.source_notes = "Reviewed home-cooking recipe source, section 2.";
  raw.Editorial_Review_JSON = JSON.stringify(review);
  const editorial = runEditorialReview(normalizeContentRecord(raw));
  assert.ok(!editorial.issues.some((issue) => issue.code === "SOURCE_EVIDENCE_IS_PLACEHOLDER"));
});

test("complete Mistake/Fix content checks cause, consequence, action and corrected result", () => {
  const content = withApprovedPage({
    title: "虾仁为什么会出水？", hookText: "虾仁为什么会出水？", contentType: "MISTAKE_FIX", templateType: "MISTAKE_BEFORE_AFTER",
    contentBody: "锅温不够时一次放入太多虾仁，因为锅温下降，虾仁会出水。先吸干水分，热锅后分批下锅，刚熟就离火。",
    caption: "虾仁出水不一定是虾的问题，先吸干水分、热锅分批下锅，刚熟就离火。",
    sourceReferences: "Reviewed culinary technique source, section 3.", sourceIngredients: [], coveragePoints: [], raw: {},
    editorialReview: { review_status: "PASS", reviewer: "Editor A", reviewed_at: "2026-09-26T08:00:00Z", page_profile_id: "test-page-1", page_profile_updated_at: "2026-09-26T07:00:00Z", audience_need: "避免虾仁炒出水", reader_value: "给出更稳妥的下锅顺序", source_evidence_status: "VERIFIED", caption_review_status: "PASS", page_fit_status: "PASS", claim_evidence: "Technique source, section 3.", cause_explanation: "锅温下降会令虾仁出水。", consequence: "虾仁出水且不易上色。", correction: "吸干、热锅、分批、刚熟离火。", expected_result: "表面有自然上色，虾仁不过熟。" },
    resolvedAssetPlan: [
      { asset_type: "WRONG_METHOD", overlay_text: "锅不够热｜一次放太多" },
      { asset_type: "CORRECT_METHOD", overlay_text: "吸干水分｜热锅｜分批下锅" },
      { asset_type: "FINAL_RESULT", overlay_text: "刚熟离火" }
    ]
  });
  assert.equal(runEditorialReview(content).status, "PASS");
});

test("complete Selection Guide checks decision criteria, suitability, trade-offs and logic", () => {
  const content = withApprovedPage({
    title: "西兰花怎么挑？", hookText: "买西兰花时看这四点。", contentType: "SELECTION_GUIDE", templateType: "COMPARE_CHECKLIST",
    contentBody: "检查花球紧实度、花蕾、切口和手感；同样大小可比较拿在手里的分量。",
    caption: "挑西兰花先看花球、花蕾和切口；同样大小再比较手感，遇到状态不确定时可再看切口是否新鲜。",
    sourceReferences: "Reviewed fresh produce selection source, page 4.", sourceIngredients: [], raw: {},
    coveragePoints: [{ id: "HEAD", text: "花球紧实", required: true }, { id: "BUD", text: "花蕾细密", required: true }],
    editorialReview: { review_status: "PASS", reviewer: "Editor A", reviewed_at: "2026-09-26T08:00:00Z", page_profile_id: "test-page-1", page_profile_updated_at: "2026-09-26T07:00:00Z", audience_need: "在市场挑选新鲜西兰花", reader_value: "提供可逐项检查的标准", source_evidence_status: "VERIFIED", caption_review_status: "PASS", page_fit_status: "PASS", claim_evidence: "Produce source, page 4.", option_suitability: "适合购买新鲜西兰花时逐项比较。", tradeoffs: "手感只是其中一个参考，不单独决定新鲜度。", decision_logic: "优先选择花球紧、花蕾细密且切口状态好的个体。" },
    resolvedAssetPlan: [
      { asset_type: "COVER", title: "Cover", purpose: "Introduce the question", overlay_text: "怎么挑西兰花？", coverage_point_ids: [] },
      { asset_type: "INSPECTION_DETAIL", title: "Head", purpose: "Show head criterion", overlay_text: "花球紧实", coverage_point_ids: ["HEAD"] },
      { asset_type: "CHECKLIST", title: "Checklist", purpose: "Recap criteria", overlay_text: "花球紧｜花蕾密", coverage_point_ids: ["BUD"] }
    ]
  });
  assert.equal(runEditorialReview(content).status, "PASS");
});

test("internal claim notes stay separate from the reader-facing session prompt", () => {
  const raw = recipeRecord();
  const review = JSON.parse(raw.Editorial_Review_JSON);
  review.internal_claim_notes = "Do not state unsupported health effects.";
  raw.Editorial_Review_JSON = JSON.stringify(review);
  const content = normalizeContentRecord(raw);
  const prompt = buildSessionPrompt(content);
  assert.equal(content.editorialReview.internal_claim_notes, "Do not state unsupported health effects.");
  assert.doesNotMatch(prompt, /Do not state unsupported health effects/);
  assert.match(prompt, /SOURCE-OF-TRUTH RECIPE/);
});
