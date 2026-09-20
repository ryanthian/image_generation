import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TEMPLATE_REGISTRY,
  adaptLegacyRecipe,
  buildAssetFilename,
  buildGenerationManifest,
  buildSessionPrompt,
  matchGenerationSlot,
  normalizeContentRecord,
  validateResolvedContent
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
