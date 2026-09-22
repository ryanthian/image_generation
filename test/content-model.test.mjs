import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TEMPLATE_REGISTRY,
  adaptLegacyRecipe,
  buildAssetFilename,
  buildGenerationManifest,
  buildSessionPrompt,
  calculateAdaptivePanel,
  calculateMethodGrid,
  matchGenerationSlot,
  normalizeContentRecord,
  normalizeContentRecordsSafely,
  validateResolvedContent,
  runContentQc
} from "../src/content-model.mjs";

const legacyData = JSON.parse(await readFile(new URL("../data/recipes.json", import.meta.url), "utf8"));
const canaryData = JSON.parse(await readFile(new URL("../data/content-v4-canary.json", import.meta.url), "utf8"));

test("legacy recipe adapter preserves four final assets and nine generation stages", () => {
  const content = adaptLegacyRecipe(legacyData.recipes[0]);
  assert.equal(content.schemaVersion, 2);
  assert.equal(content.contentType, "RECIPE");
  assert.equal(content.templateType, "RECIPE_STANDARD");
  assert.deepEqual(content.resolvedAssetPlan.map((item) => item.asset_type), ["COVER", "INGREDIENTS", "METHOD", "CLOSEUP"]);
  assert.deepEqual(buildGenerationManifest(content).entries.map((entry) => entry.slotId), ["cover", "ingredients", "m1", "m2", "m3", "m4", "m5", "m6", "closeup"]);
  assert.match(buildSessionPrompt(content), /Console overlay: 鸡腿香菇切块/);
  assert.equal(buildAssetFilename(content, content.resolvedAssetPlan[0]), "EN-NEW-001-cover-1440x1800.png");
});

test("template registry separates content type, template, visual profile and hook", () => {
  const record = normalizeContentRecord(canaryData.records.find((item) => item.Content_ID === "V4-SG-001"));
  assert.equal(record.topic, "VEGETABLE");
  assert.equal(record.contentType, "SELECTION_GUIDE");
  assert.equal(record.templateType, "COMPARE_CHECKLIST");
  assert.equal(record.visualProfile, "REALISTIC_MARKET_GUIDE");
  assert.equal(record.hookType, "HOW_TO_CHOOSE");
  assert.deepEqual(TEMPLATE_REGISTRY.COMPARE_CHECKLIST.compatible_content_types, ["SELECTION_GUIDE"]);
});

test("canary contains twelve isolated records covering the V4 MVP", () => {
  assert.equal(canaryData.records.length, 12);
  const records = canaryData.records.map(normalizeContentRecord);
  const counts = records.reduce((result, item) => ({ ...result, [item.contentType]: (result[item.contentType] || 0) + 1 }), {});
  assert.deepEqual(counts, { RECIPE: 3, MISTAKE_FIX: 3, SELECTION_GUIDE: 3, STORAGE_GUIDE: 1, KITCHEN_HACK: 2 });
  assert.ok(records.every((item) => validateResolvedContent(item).valid));
});

test("resolved asset plans support 3, 4, 5, 6 and 7 assets without numbered columns", () => {
  const base = {
    Schema_Version: 4,
    Content_ID: "DYNAMIC",
    Title: "Dynamic",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE"
  };
  const types = ["HOOK", "PROBLEM", "TECHNIQUE", "SEQUENCE", "DETAIL", "CHECKPOINT", "FINAL_RESULT"];
  for (const count of [3, 4, 5, 6, 7]) {
    const selected = count === 3 ? ["HOOK", "TECHNIQUE", "FINAL_RESULT"] : types.slice(0, count - 1).concat("FINAL_RESULT");
    const record = normalizeContentRecord({
      ...base,
      Content_ID: `DYNAMIC-${count}`,
      assets: selected.map((assetType, index) => ({ asset_type: assetType, title: assetType, purpose: assetType, layout_type: index === 0 ? "cover_overlay" : "information_card", image_prompt: assetType }))
    });
    assert.equal(record.resolvedAssetPlan.length, count);
    assert.equal(buildGenerationManifest(record).expectedAssets, count);
  }
});

test("generation manifest drives filename matching and V4 export order", () => {
  const content = normalizeContentRecord(canaryData.records.find((item) => item.Content_ID === "V4-SG-001"));
  const manifest = buildGenerationManifest(content);
  assert.equal(manifest.expectedAssets, 6);
  assert.equal(matchGenerationSlot("IMG_03_inspection.png", manifest), manifest.entries[2].slotId);
  assert.equal(buildAssetFilename(content, content.resolvedAssetPlan[5]), "V4-SG-001_06_CLOSEUP.png");
});

test("V4 generation inputs remain independent from final assets", () => {
  const content = normalizeContentRecord({
    Schema_Version: 4,
    Content_ID: "GS-V4-N-TO-M",
    Title: "N to M",
    Topic: "RECIPE",
    Content_Type: "RECIPE",
    Template_Type: "RECIPE_STANDARD",
    assets: [
      { asset_type: "COVER", asset_id: "cover", title: "Cover", layout_type: "cover_overlay", generation_inputs: [{ slot_id: "cover", label: "Cover", image_prompt: "cover" }] },
      { asset_type: "METHOD", asset_id: "method", title: "Method", layout_type: "method_grid_2x3", generation_inputs: [1, 2, 3, 4, 5].map((step) => ({ slot_id: `m${step}`, label: `M${step}`, image_prompt: `step ${step}`, overlay_text: `步骤 ${step}` })) },
      { asset_type: "CLOSEUP", asset_id: "closeup", title: "Closeup", layout_type: "detail_overlay", generation_inputs: [{ slot_id: "closeup", label: "Closeup", image_prompt: "closeup" }] }
    ]
  });
  const manifest = buildGenerationManifest(content);
  assert.equal(manifest.expectedAssets, 7);
  assert.equal(content.resolvedAssetPlan.length, 3);
  assert.deepEqual(content.resolvedAssetPlan[1].generation_inputs.map((input) => input.slot_id), ["m1", "m2", "m3", "m4", "m5"]);
  assert.match(buildSessionPrompt(content), /GENERATION MANIFEST — 7 IMAGES/);
});

test("generation manifest rejects duplicate stable input IDs", () => {
  const content = normalizeContentRecord({
    Schema_Version: 4,
    Content_ID: "GS-V4-DUPLICATE",
    Title: "Duplicate",
    Topic: "RECIPE",
    Content_Type: "RECIPE",
    Template_Type: "RECIPE_STANDARD",
    assets: [
      { asset_type: "COVER", title: "Cover", layout_type: "cover_overlay", generation_inputs: [{ slot_id: "same", image_prompt: "cover" }] },
      { asset_type: "METHOD", title: "Method", layout_type: "information_card", generation_inputs: [{ slot_id: "same", image_prompt: "method" }] },
      { asset_type: "CLOSEUP", title: "Closeup", layout_type: "detail_overlay", generation_inputs: [{ slot_id: "closeup", image_prompt: "closeup" }] }
    ]
  });
  assert.throws(() => buildGenerationManifest(content), /Duplicate generation input ID: same/);
});

test("generic generation-to-final mappings remain data-defined", () => {
  for (const [generationCount, finalCount] of [[4, 4], [5, 3], [6, 4], [7, 5], [9, 4]]) {
    const finalTypes = ["COVER", "METHOD", "CLOSEUP", "INGREDIENTS", "TIP"].slice(0, finalCount);
    const extraInputs = generationCount - finalCount;
    const content = normalizeContentRecord({
      Schema_Version: 4,
      Content_ID: `MAP-${generationCount}-${finalCount}`,
      Title: "Mapping",
      Topic: "RECIPE",
      Content_Type: "RECIPE",
      Template_Type: "RECIPE_STANDARD",
      assets: finalTypes.map((assetType, index) => ({
        asset_type: assetType,
        title: assetType,
        layout_type: assetType === "METHOD" ? "method_grid_2x3" : "information_card",
        generation_inputs: Array.from({ length: index === 1 ? extraInputs + 1 : 1 }, (_, inputIndex) => ({
          slot_id: `${index}-${inputIndex}`,
          label: `${assetType} ${inputIndex + 1}`,
          image_prompt: `${assetType} ${inputIndex + 1}`
        }))
      }))
    });
    assert.equal(buildGenerationManifest(content).expectedAssets, generationCount);
    assert.equal(content.resolvedAssetPlan.length, finalCount);
  }
});

test("unsupported price and percentage claims are downgraded", () => {
  const price = normalizeContentRecord(canaryData.records.find((item) => item.Content_ID === "V4-KH-002"));
  assert.equal(price.priceClaim.verified, false);
  assert.equal(price.hookText, "外面吃不便宜，自己做其实简单很多");
  const percentage = normalizeContentRecord({
    Schema_Version: 4,
    Content_ID: "SAFE-001",
    Title: "Safety",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE",
    Hook_Text: "90%的人第一步就做错"
  });
  assert.equal(percentage.hookText, "很多人第一步就做错");
});

test("Sheet Asset_Plan_JSON round-trips Unicode, quotes, newlines and optional slots", () => {
  const assetPlan = [
    { sequence: 1, asset_id: "01-hook", asset_type: "HOOK", title: "Hook", purpose: "问题", image_prompt: "Real kitchen capture with a quoted cue: \"good\".", overlay_text: "第一行\n第二行", layout_type: "cover_overlay", required: true },
    { sequence: 2, asset_id: "02-technique", asset_type: "TECHNIQUE", title: "Technique", purpose: "方法", image_prompt: "Hands demonstrating the technique, no text.", overlay_text: "保留中文引号“正确”", layout_type: "information_card", required: false },
    { sequence: 3, asset_id: "03-result", asset_type: "FINAL_RESULT", title: "Result", purpose: "结果", image_prompt: "Finished result, no text.", overlay_text: "完成", layout_type: "detail_overlay", required: true }
  ];
  const content = normalizeContentRecord({
    Schema_Version: 4,
    Content_ID: "GS-V4-ROUNDTRIP",
    Title: "中文与“引号”测试",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE",
    Source_References: "Sheet source reference",
    Content_Body: "第一行\n第二行",
    Asset_Plan_JSON: JSON.stringify(assetPlan)
  });
  assert.equal(content.source, "Sheet source reference");
  assert.equal(content.contentBody, "第一行\n第二行");
  assert.deepEqual(content.resolvedAssetPlan.map((item) => item.asset_id), ["01-hook", "02-technique", "03-result"]);
  assert.deepEqual(buildGenerationManifest(content).entries.map((entry) => entry.required), [true, false, true]);
  assert.match(content.resolvedAssetPlan[0].image_prompt, /"good"/);
  assert.equal(content.resolvedAssetPlan[0].overlay_text, "第一行\n第二行");
});

test("Sheet Asset_Plan_JSON rejects malformed data and uses template defaults when empty", () => {
  const base = {
    Schema_Version: 4,
    Content_ID: "GS-V4-JSON",
    Title: "JSON test",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE"
  };
  assert.throws(() => normalizeContentRecord({ ...base, Asset_Plan_JSON: "[{bad json}]" }), /Invalid Asset Plan JSON/);
  const empty = normalizeContentRecord({ ...base, Asset_Plan_JSON: "" });
  assert.equal(empty.resolvedAssetPlan.length, TEMPLATE_REGISTRY.KITCHEN_TECHNIQUE.default_asset_plan.length);
});

test("Sheet records resolve 3 through 7 assets while legacy Recipe remains compatible", () => {
  const requiredTypes = {
    3: ["HOOK", "TECHNIQUE", "FINAL_RESULT"],
    4: ["HOOK", "PROBLEM", "TECHNIQUE", "FINAL_RESULT"],
    5: ["HOOK", "PROBLEM", "TECHNIQUE", "SEQUENCE", "FINAL_RESULT"],
    6: ["HOOK", "PROBLEM", "TECHNIQUE", "DETAIL", "SEQUENCE", "FINAL_RESULT"],
    7: ["HOOK", "PROBLEM", "TECHNIQUE", "DETAIL", "SEQUENCE", "CHECKPOINT", "FINAL_RESULT"]
  };
  for (const [count, types] of Object.entries(requiredTypes)) {
    const content = normalizeContentRecord({
      Schema_Version: 4,
      Content_ID: `GS-V4-${count}`,
      Title: `Sheet ${count}`,
      Topic: "KITCHEN",
      Content_Type: "KITCHEN_HACK",
      Template_Type: "KITCHEN_TECHNIQUE",
      Asset_Plan_JSON: JSON.stringify(types.map((assetType, index) => ({ sequence: index + 1, asset_id: `${index + 1}-${assetType}`, asset_type: assetType, title: assetType, purpose: assetType, image_prompt: assetType, layout_type: index ? "information_card" : "cover_overlay", required: true })))
    });
    assert.equal(content.resolvedAssetPlan.length, Number(count));
    assert.equal(buildGenerationManifest(content).expectedAssets, Number(count));
  }
  assert.equal(normalizeContentRecord(legacyData.recipes[0]).schemaVersion, 2);
});

test("longform belief template encodes non-scientific framing", () => {
  assert.match(TEMPLATE_REGISTRY.LONGFORM_GUIDE.visual_consistency_rules.join(" "), /tradition|custom|personal sharing/i);
});

test("adaptive information panels shrink for short copy and grow for long copy", () => {
  const short = calculateAdaptivePanel({ label: "食材", body: "鸡腿｜姜｜蒜｜酱油｜白饭" });
  const long = calculateAdaptivePanel({ label: "食材", heading: "准备这些", body: Array(18).fill("长内容").join("\n") });
  assert.ok(short.panelHeight < long.panelHeight);
  assert.ok(short.imageHeight > long.imageHeight);
  assert.equal(short.panelHeight + short.imageHeight, 1800);
  assert.ok(short.imageHeight / 1800 >= 0.65);
});

test("adaptive Method grids balance 4, 5, 6 and 7 steps without an orphan", () => {
  assert.deepEqual(calculateMethodGrid(4).map((tile) => tile.fullWidth), [false, false, false, false]);
  const five = calculateMethodGrid(5);
  assert.equal(five[4].fullWidth, true);
  assert.equal(five[4].width, 1440);
  assert.equal(five[4].x, 0);
  assert.ok(calculateMethodGrid(6).every((tile) => !tile.fullWidth));
  assert.equal(calculateMethodGrid(7)[6].fullWidth, true);
});

test("content QC reports source coverage, ingredient fidelity and redundant purposes", () => {
  const content = normalizeContentRecord({
    Schema_Version: 4, Content_ID: "QC-1", Title: "Recipe", Topic: "RECIPE", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD",
    Asset_Plan_JSON: JSON.stringify({
      coverage_points: [{ id: "A", text: "Point A" }, { id: "B", text: "Point B" }],
      source_ingredients: ["排骨", "淀粉"],
      assets: [
        { asset_type: "COVER", title: "Cover", purpose: "Cover", layout_type: "cover_overlay", coverage_point_ids: ["A"] },
        { asset_type: "INGREDIENTS", title: "食材", purpose: "Ingredients", layout_type: "ingredients_compact", ingredient_items: ["排骨", "姜"] },
        { asset_type: "METHOD", title: "做法", purpose: "Method", layout_type: "method_grid_adaptive", generation_inputs: [1, 2].map((n) => ({ slot_id: `m${n}`, method_step_id: `M${n}`, overlay_text: `步骤${n}` })) },
        { asset_type: "CLOSEUP", title: "Closeup", purpose: "Closeup", layout_type: "detail_overlay" }
      ]
    })
  });
  const qc = runContentQc(content);
  assert.equal(qc.status, "FAIL");
  assert.ok(qc.failures.some((item) => item.code === "UNCOVERED_SOURCE_POINT" && item.detail === "Point B"));
  assert.ok(qc.failures.some((item) => item.code === "MISSING_REQUIRED_INGREDIENT" && item.detail === "淀粉"));
  assert.ok(qc.failures.some((item) => item.code === "UNSUPPORTED_INGREDIENT" && item.detail === "姜"));
});

test("complete source coverage and exact ingredients pass deterministic QC", () => {
  const content = normalizeContentRecord({
    Schema_Version: 4, Content_ID: "QC-2", Title: "Recipe", Topic: "RECIPE", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD",
    Asset_Plan_JSON: JSON.stringify({ coverage_points: [{ id: "A", text: "A" }], source_ingredients: ["排骨", "淀粉"], assets: [
      { asset_type: "COVER", title: "Cover", purpose: "Cover", layout_type: "cover_overlay", coverage_point_ids: ["A"] },
      { asset_type: "INGREDIENTS", title: "食材", purpose: "Ingredients", layout_type: "ingredients_compact", ingredient_items: ["排骨", "淀粉"] },
      { asset_type: "METHOD", title: "做法", purpose: "Method", layout_type: "method_grid_adaptive", generation_inputs: [1, 2].map((n) => ({ slot_id: `m${n}`, method_step_id: `M${n}` })) },
      { asset_type: "CLOSEUP", title: "Closeup", purpose: "Closeup", layout_type: "detail_overlay" }
    ] })
  });
  assert.equal(runContentQc(content).status, "PASS");
});

test("DRINK_STANDARD accepts the staging drink contract without recipe assets", () => {
  const title = "荔枝酸柑话梅冰饮";
  const content = normalizeContentRecord({
    Schema_Version: 4,
    Content_ID: "GS-V4-EXP-002",
    Title: title,
    Topic: "DRINK",
    Content_Type: "LOCAL_DRINK_HACK",
    Template_Type: "DRINK_STANDARD",
    Visual_Profile: "REALISTIC_KOPITIAM",
    Hook_Type: "LOCAL_TWIST",
    Hook_Text: "荔枝太甜？加酸柑和话梅，味道更有层次",
    Content_Body: "准备荔枝、酸柑、话梅、冰块和气泡水。",
    Asset_Plan_JSON: JSON.stringify({
      coverage_points: [{ id: "CORE", text: title, required: true }],
      assets: [
        { asset_id: "01-cover", asset_type: "COVER", title: "Cover", purpose: "Finished drink", layout_type: "cover_overlay", overlay_text: title, image_prompt: "Finished drink", required: true },
        { asset_id: "02-ingredients", asset_type: "INGREDIENTS", title: "Ingredients", purpose: "Ingredients", layout_type: "information_card", overlay_text: "荔枝｜酸柑｜话梅｜冰块｜气泡水", image_prompt: "Ingredients", required: true },
        { asset_id: "03-mix", asset_type: "MIX", title: "Mix", purpose: "Mixing action", layout_type: "information_card", overlay_text: "先加酸柑和话梅", image_prompt: "Mixing", required: true },
        { asset_id: "04-final", asset_type: "FINAL", title: "Final", purpose: "Completed drink", layout_type: "information_card", overlay_text: "完成", image_prompt: "Final", required: true }
      ]
    })
  });
  assert.deepEqual(content.resolvedAssetPlan.map((asset) => asset.asset_type), ["COVER", "INGREDIENTS", "MIX", "FINAL"]);
  assert.equal(buildGenerationManifest(content).expectedAssets, 4);
  assert.equal(runContentQc(content).status, "PASS");
});

test("safe source normalization skips invalid rows while preserving later valid records", () => {
  const valid = {
    Schema_Version: 4,
    Content_ID: "SAFE-VALID",
    Title: "Valid",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE"
  };
  const result = normalizeContentRecordsSafely([
    valid,
    { ...valid, Content_ID: "SAFE-BAD-TEMPLATE", Template_Type: "HOW_TO_GUIDE" },
    { ...valid, Content_ID: "SAFE-AFTER" }
  ]);
  assert.deepEqual(result.records.map((record) => record.contentId), ["SAFE-VALID", "SAFE-AFTER"]);
  assert.deepEqual(result.rejected.map((record) => record.contentId), ["SAFE-BAD-TEMPLATE"]);
  assert.match(result.rejected[0].message, /Unknown Template_Type/);
});

test("safe source normalization reports unknown template, incompatible type and malformed JSON independently", () => {
  const valid = {
    Schema_Version: 4,
    Content_ID: "SAFE-VALID",
    Title: "Valid",
    Topic: "KITCHEN",
    Content_Type: "KITCHEN_HACK",
    Template_Type: "KITCHEN_TECHNIQUE"
  };
  const allValid = normalizeContentRecordsSafely([{ ...valid, Content_ID: "SAFE-1" }, { ...valid, Content_ID: "SAFE-2" }]);
  assert.deepEqual(allValid.records.map((record) => record.contentId), ["SAFE-1", "SAFE-2"]);
  assert.equal(allValid.rejected.length, 0);

  const result = normalizeContentRecordsSafely([
    { ...valid, Content_ID: "SAFE-UNKNOWN", Template_Type: "HOW_TO_GUIDE" },
    { ...valid, Content_ID: "SAFE-INCOMPATIBLE", Content_Type: "RECIPE" },
    { ...valid, Content_ID: "SAFE-BAD-JSON", Asset_Plan_JSON: "{bad json}" },
    { ...valid, Content_ID: "SAFE-AFTER" }
  ]);
  assert.deepEqual(result.records.map((record) => record.contentId), ["SAFE-AFTER"]);
  assert.deepEqual(result.rejected.map((record) => record.contentId), ["SAFE-UNKNOWN", "SAFE-INCOMPATIBLE", "SAFE-BAD-JSON"]);
  assert.match(result.rejected[0].message, /Unknown Template_Type/);
  assert.match(result.rejected[1].message, /not compatible/);
  assert.match(result.rejected[2].message, /Invalid Asset Plan JSON/);
});

test("duplicate or reordered Method step mappings are rejected", () => {
  const base = { Schema_Version: 4, Content_ID: "QC-METHOD", Title: "Recipe", Topic: "RECIPE", Content_Type: "RECIPE", Template_Type: "RECIPE_STANDARD" };
  const assets = (ids) => [
    { asset_type: "COVER", title: "Cover", layout_type: "cover_overlay" },
    { asset_type: "METHOD", title: "Method", layout_type: "method_grid_adaptive", generation_inputs: ids.map((id, index) => ({ slot_id: `slot-${index}`, method_step_id: id })) },
    { asset_type: "CLOSEUP", title: "Closeup", layout_type: "detail_overlay" }
  ];
  assert.throws(() => normalizeContentRecord({ ...base, assets: assets(["M1", "M1"]) }), /Duplicate Method step mapping/);
  assert.throws(() => normalizeContentRecord({ ...base, assets: assets(["M1", "M3"]) }), /Missing or reordered Method step mapping/);
});
