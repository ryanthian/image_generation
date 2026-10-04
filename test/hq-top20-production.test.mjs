import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildGenerationManifest,
  normalizeContentRecord,
  runContentQc,
  validateResolvedContent
} from "../src/content-model.mjs";

const snapshot = JSON.parse(await readFile(new URL("../data/hq-top20-production-2026-10-04.json", import.meta.url), "utf8"));

test("HQ Top 20 snapshot contains exactly 20 production-ready records", () => {
  assert.equal(snapshot.sheetName, "HQ Top 20 Production - 2026-10-04");
  assert.equal(snapshot.recipes.length, 20);
  assert.deepEqual(
    snapshot.recipes.map((record) => record.Content_ID),
    Array.from({ length: 20 }, (_, index) => `GS-HQ-${String(index + 1).padStart(3, "0")}`)
  );
  assert.ok(snapshot.recipes.every((record) => record.Status === "CONTENT_READY"));
});

test("all HQ Top 20 records resolve through the current V4 content model", () => {
  let totalGenerationJobs = 0;
  for (const record of snapshot.recipes) {
    const content = normalizeContentRecord(record);
    const validation = validateResolvedContent(content);
    const qc = runContentQc(content);
    assert.equal(validation.valid, true, record.Content_ID);
    assert.equal(qc.failures.length, 0, `${record.Content_ID}: ${JSON.stringify(qc.failures)}`);
    totalGenerationJobs += buildGenerationManifest(content).expectedAssets;
  }
  assert.equal(totalGenerationJobs, 82);
});

test("HQ Top 20 keeps a fast visual plan", () => {
  for (const record of snapshot.recipes) {
    const content = normalizeContentRecord(record);
    const finalAssets = content.resolvedAssetPlan.length;
    assert.ok(finalAssets >= 4 && finalAssets <= 5, `${record.Content_ID} has ${finalAssets} final assets`);
  }
});
