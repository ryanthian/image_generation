import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildGenerationManifest, normalizeContentRecord, runContentQc, validateResolvedContent } from "../src/content-model.mjs";

const batch = JSON.parse(await readFile(new URL("../data/v4-production-batch-01.json", import.meta.url), "utf8"));
const expectedTitles = [
  "第一次买手串，珠子大小怎么选？",
  "保温杯容量怎么选？350ml、500ml、750ml分别适合谁？",
  "买西兰花别只看颜色，记住这4点",
  "白虾、明虾、老虎虾有什么区别？",
  "6款月底家常菜，不知道煮什么就看这张",
  "蒸蛋为什么总是有蜂窝？",
  "Kopitiam常见冰饮有什么不同？",
  "豆豉蒸排骨怎么做才入味？"
];

test("V4_PRODUCTION_BATCH_01 contains exactly the eight explicitly approved opportunities", () => {
  assert.equal(batch.batch_id, "V4_PRODUCTION_BATCH_01");
  assert.equal(batch.records.length, 8);
  assert.deepEqual(batch.records.map((record) => record.Content_ID), Array.from({ length: 8 }, (_, index) => `PROD-V4-${String(index + 1).padStart(3, "0")}`));
  assert.deepEqual(batch.records.map((record) => record.Title), expectedTitles);
  assert.ok(batch.records.every((record) => record.Status === "APPROVED_FOR_PRODUCTION"));
});

test("every batch specification resolves through the existing V4.1 model with explicit plans", () => {
  for (const record of batch.records) {
    const content = normalizeContentRecord(record);
    const manifest = buildGenerationManifest(content);
    assert.equal(validateResolvedContent(content).valid, true, record.Content_ID);
    assert.equal(manifest.expectedAssets, record.Generation_Plan.length, `${record.Content_ID} generation plan`);
    assert.equal(content.resolvedAssetPlan.length, record.Final_Asset_Plan.length, `${record.Content_ID} final asset plan`);
    assert.deepEqual(manifest.entries.map((entry) => entry.slotId), record.Generation_Plan, `${record.Content_ID} stable input order`);
    assert.deepEqual(content.resolvedAssetPlan.map((item) => item.asset_id), record.Final_Asset_Plan, `${record.Content_ID} final asset order`);
    assert.equal(record.Composition_Plan.length, record.Final_Asset_Plan.length, `${record.Content_ID} composition plan`);
    assert.ok(record.Composition_Plan.every((item) => item.source_input_ids.length), `${record.Content_ID} composition sources`);
    assert.ok(record.Ready_To_Post_Caption && record.Source_References && record.SAVE_TRIGGER && record.SHARE_TRIGGER, `${record.Content_ID} production metadata`);
  }
});

test("the ribs recipe preserves a supported seven-to-four generation/composition/final mapping", () => {
  const record = batch.records.find((item) => item.Content_ID === "PROD-V4-008");
  const content = normalizeContentRecord(record);
  assert.equal(buildGenerationManifest(content).expectedAssets, 7);
  assert.equal(content.resolvedAssetPlan.length, 4);
  assert.deepEqual(record.Composition_Plan.find((item) => item.final_asset_id === "method").source_input_ids, ["m1", "m2", "m3", "m4"]);
  content.sourceIngredients = record.source_ingredients;
  assert.equal(runContentQc(content).status, "PASS");
  assert.match(record.assets.find((item) => item.asset_id === "ingredients").overlay_text, /淀粉/);
  assert.doesNotMatch(record.assets.find((item) => item.asset_id === "ingredients").overlay_text, /姜/);
});

test("bracelet production copy uses cultural framing and no objective outcome claim", () => {
  const record = batch.records.find((item) => item.Content_ID === "PROD-V4-001");
  assert.match(record.Ready_To_Post_Caption, /传统寓意/);
  assert.doesNotMatch(`${record.Hook_Text}\n${record.Ready_To_Post_Caption}`, /招财|治愈|改善睡眠|改变心理|保佑/);
});
