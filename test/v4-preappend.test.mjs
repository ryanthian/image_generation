import assert from "node:assert/strict";
import test from "node:test";
import { appendCompiledV4CanaryCandidate, compileV4CanaryCandidate } from "../src/v4-preappend.mjs";

function recipe(id = "GS-V4-EXP-001") {
  const assets = [
    { sequence: 1, asset_id: "cover", asset_type: "COVER", title: "Cover", purpose: "Hook", layout_type: "cover_overlay", overlay_text: "菠萝酸柑 Asam Boi 气泡饮", image_prompt: "Finished drink with only listed ingredients.", required: true },
    { sequence: 2, asset_id: "ingredients", asset_type: "INGREDIENTS", title: "Ingredients", purpose: "Exact ingredients", layout_type: "ingredients_compact", overlay_text: "菠萝｜酸柑｜asam boi｜气泡水｜冰块", image_prompt: "Only pineapple, calamansi, asam boi, sparkling water and ice.", required: true, ingredient_items: ["菠萝", "酸柑", "asam boi", "气泡水", "冰块"] },
    { sequence: 3, asset_id: "method", asset_type: "METHOD", title: "Method", purpose: "Chronological preparation", layout_type: "method_grid_adaptive", overlay_text: "准备 → 加入 → 倒入", image_prompt: "Three chronological drink stages.", required: true, coverage_point_ids: ["combine"], generation_inputs: [
      { slot_id: "m1", label: "M1", method_step_id: "M1", step_heading: "准备材料", step_supporting_text: "准备好菠萝、酸柑、asam boi 和冰块。", image_prompt: "Prepared listed drink ingredients.", required: true },
      { slot_id: "m2", label: "M2", method_step_id: "M2", step_heading: "加入酸柑和 asam boi", step_supporting_text: "把酸柑和 asam boi 放入杯中。", image_prompt: "Calamansi and asam boi added to glass.", required: true },
      { slot_id: "m3", label: "M3", method_step_id: "M3", step_heading: "倒入气泡水", step_supporting_text: "倒入气泡水。", image_prompt: "Sparkling water poured into same glass.", required: true }
    ] },
    { sequence: 4, asset_id: "closeup", asset_type: "CLOSEUP", title: "Closeup", purpose: "Finished drink", layout_type: "detail_overlay", overlay_text: "酸甜带一点话梅香", image_prompt: "Finished listed drink closeup.", required: true, coverage_point_ids: ["combine"] }
  ];
  return { Schema_Version: "4", Content_ID: id, Title: "菠萝酸柑 Asam Boi 气泡饮", Topic: "DRINK", Content_Type: "DRINK", Template_Type: "RECIPE_STANDARD", Visual_Profile: "REALISTIC_KOPITIAM", Hook_Type: "LOCAL_TWIST", Hook_Text: "菠萝很甜？加酸柑和 asam boi，味道马上不一样", Ready_To_Post_Caption: "简单冰饮。", Content_Body: "准备菠萝、酸柑、asam boi、气泡水和冰块，依序组合。", Source_References: "Source note", Affiliate_Fit: "MEDIUM", Monetization_Angle: "", Status: "CONTENT_READY", Asset_Plan_JSON: JSON.stringify({ coverage_points: [{ id: "combine", text: "组合所有列出的材料", required: true }], source_ingredients: ["菠萝", "酸柑", "asam boi", "气泡水", "冰块"], assets }) };
}

test("EXP-001 strict generation-ready candidate passes and appends atomically", async () => {
  let writes = 0;
  const result = await appendCompiledV4CanaryCandidate(recipe(), async (row) => { writes += 1; assert.equal(row[1], "GS-V4-EXP-001"); });
  assert.equal(result.ok, true); assert.equal(result.appended, true); assert.equal(result.manifest.expectedAssets, 6); assert.equal(writes, 1);
});

test("EXP-002 LOCAL_DRINK_HACK with DRINK_STANDARD passes and appends atomically", async () => {
  const candidate = { ...recipe("GS-V4-EXP-002"), Content_Type: "LOCAL_DRINK_HACK", Template_Type: "DRINK_STANDARD" };
  let writes = 0; const result = await appendCompiledV4CanaryCandidate(candidate, async (row) => { writes += 1; assert.equal(row[1], "GS-V4-EXP-002"); });
  assert.equal(result.ok, true); assert.equal(result.status, "PASS"); assert.equal(result.content.contentType, "LOCAL_DRINK_HACK"); assert.equal(result.content.templateType, "DRINK_STANDARD"); assert.equal(result.manifest.expectedAssets, 6); assert.equal(writes, 1);
});

test("current EXP-043 HOW_TO_GUIDE is rejected before append", () => {
  const invalid = { ...recipe("GS-V4-EXP-043"), Content_Type: "EVERYDAY_HACK", Template_Type: "HOW_TO_GUIDE" };
  const result = compileV4CanaryCandidate(invalid);
  assert.equal(result.status, "REJECTED"); assert.match(result.reason, /Unknown Template_Type: HOW_TO_GUIDE/);
});

test("incomplete RECIPE_STANDARD without chronological METHOD inputs is rejected", () => {
  const invalid = recipe("INCOMPLETE-RECIPE"); const plan = JSON.parse(invalid.Asset_Plan_JSON);
  plan.assets.find((asset) => asset.asset_type === "METHOD").generation_inputs = [{ slot_id: "m1", label: "M1", image_prompt: "One generic method image.", required: true }];
  invalid.Asset_Plan_JSON = JSON.stringify(plan);
  const result = compileV4CanaryCandidate(invalid);
  assert.equal(result.status, "REJECTED"); assert.match(result.reason, /at least two explicit chronological generation inputs/);
});

test("existing valid recipe contract passes the same compiler", () => {
  const result = compileV4CanaryCandidate(recipe("GS-V4-RCP-VALID"));
  assert.equal(result.ok, true); assert.equal(result.content.templateType, "RECIPE_STANDARD");
});

test("a Content_ID is never numerically coerced or reformatted", () => {
  const candidate = recipe("GS-V4-RCP-000000001");
  const result = compileV4CanaryCandidate(candidate);
  assert.equal(result.ok, true); assert.equal(result.record.Content_ID, "GS-V4-RCP-000000001");
});
