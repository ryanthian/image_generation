import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSessionPrompt, fileSlot, parseOverlay, rowsToRecipes } from "../src/lib.mjs";

const data = JSON.parse(await readFile(new URL("../data/recipes.json", import.meta.url), "utf8"));
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
  assert.match(prompt, /Commands: N = generate the next stage; R = regenerate/);
  assert.match(prompt, /exactly ONE image per response/);
  assert.match(prompt, /COVER → INGREDIENTS → M1 → M2 → M3 → M4 → M5 → M6 → CLOSEUP/);
  assert.equal((prompt.match(/\nM[1-6]:/g) || []).length, 6);
  assert.ok(prompt.indexOf("COVER:") < prompt.indexOf("INGREDIENTS:"));
  assert.ok(prompt.indexOf("M6:") < prompt.indexOf("CLOSEUP:"));
});

test("overlay and filename mapping preserve exact assets", () => {
  const overlay = parseOverlay(first);
  assert.equal(overlay.cover, "姜葱香菇鸡腿煲");
  assert.match(overlay.ingredients, /去骨鸡腿肉450g/);
  assert.match(overlay.closeup, /香菇会出水/);
  assert.equal(fileSlot("EN-NEW-001_method_M4.png"), "m4");
  assert.equal(fileSlot("closeup.webp"), "closeup");
});
