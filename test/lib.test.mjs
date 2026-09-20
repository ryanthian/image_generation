import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSessionPrompt, fileSlot, parseOverlay, rowsToRecipes } from "../src/lib.mjs";

const data = JSON.parse(await readFile(new URL("../data/recipes.json", import.meta.url), "utf8"));
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const first = data.recipes[0];

test("snapshot contains exact acceptance recipe and full schema", () => {
  assert.equal(data.recipes.length, 20);
  assert.equal(first.Content_ID, "EN-NEW-001");
  assert.equal(first.Draft_Title, "姜葱香菇鸡腿煲");
  assert.match(first.Image_3_Step_6_Caption, /收汁葱绿出锅/);
  assert.equal(rowsToRecipes(data.headers, data.recipes.map((r) => data.headers.map((h) => r[h]))).length, 20);
});

test("session prompt is one ordered controller with all nine stages", () => {
  const prompt = buildSessionPrompt(first);
  assert.match(prompt, /Commands: N = generate the next asset; R = regenerate/);
  assert.match(prompt, /exactly ONE image per response/);
  assert.match(prompt, /01 Cover → 02 Ingredients → 03 M1 → 04 M2 → 05 M3 → 06 M4 → 07 M5 → 08 M6 → 09 Closeup/);
  assert.equal((prompt.match(/\d\d M[1-6] \[METHOD\]/g) || []).length, 6);
  assert.ok(prompt.indexOf("01 Cover") < prompt.indexOf("02 Ingredients"));
  assert.ok(prompt.indexOf("08 M6") < prompt.indexOf("09 Closeup"));
});

test("overlay and filename mapping preserve exact assets", () => {
  const overlay = parseOverlay(first);
  assert.equal(overlay.cover, "姜葱香菇鸡腿煲");
  assert.match(overlay.ingredients, /去骨鸡腿肉450g/);
  assert.match(overlay.closeup, /香菇会出水/);
  assert.equal(fileSlot("EN-NEW-001_method_M4.png"), "m4");
  assert.equal(fileSlot("closeup.webp"), "closeup");
});

test("Final Cover renders the Chinese title without internal recipe identifiers", () => {
  const coverSource = appSource.match(/async function buildCoverAsset\(assetItem\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(coverSource, "buildCoverAsset should exist");
  assert.match(coverSource, /assetItem\.overlay_text \|\| state\.content\.hookText \|\| state\.content\.title/);
  assert.doesNotMatch(coverSource, /Content_ID|recipe_id|content_id|row.?id|database.?id/i);
  assert.match(appSource, /filename: buildAssetFilename\(state\.content, assetItem\)/);
  assert.match(appSource, /canvas\.width = 1440;\s*canvas\.height = 1800;/);
});
