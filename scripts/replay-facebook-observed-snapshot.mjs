import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDirectVerificationCandidates, buildReplayCandidates, replayBatches, SNAPSHOT_REPLAY_DEFAULTS, validateObservedSnapshot } from "../src/facebook-snapshot-replay.mjs";
import { handleIntelligenceApi, MemoryIntelligenceStore } from "../src/intelligence-server.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultInput = resolve(projectRoot, "research/facebook-collections/2026-09-20-my-page-200-observed-reel-identities.json");
const defaultOutput = resolve(projectRoot, "research/facebook-collections/2026-09-20-my-page-200-observed-canonical-checkpoint.json");
const inputPath = resolve(process.argv[2] || defaultInput);
const outputPath = resolve(process.argv[3] || defaultOutput);
const collectionResearchDir = resolve(projectRoot, "research/facebook-collections");
const directPaths = process.argv.slice(4).map((path) => resolve(path));
if (!directPaths.length) {
  const defaultDirectFiles = (await readdir(collectionResearchDir))
    .filter((file) => /^2026-09-20-my-page-direct-verification-batch-\d{3}\.json$/.test(file))
    .sort();
  directPaths.push(...defaultDirectFiles.map((file) => resolve(collectionResearchDir, file)));
}
const snapshot = JSON.parse(await readFile(inputPath, "utf8"));
const validation = validateObservedSnapshot(snapshot);
if (!validation.valid) throw new Error(validation.errors.join(" "));

const store = new MemoryIntelligenceStore();
const request = async (path, body) => {
  const webRequest = new Request(`https://local.replay${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-content-intelligence-request": "1" },
    body: JSON.stringify(body)
  });
  const response = await handleIntelligenceApi(webRequest, {}, new URL(webRequest.url), store);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${payload.error || `HTTP ${response.status}`}`);
  return payload;
};

const candidates = buildReplayCandidates(snapshot);
const directGroups = [];
if (Array.isArray(snapshot.reel_subcanary) && snapshot.reel_subcanary.length) {
  directGroups.push(buildDirectVerificationCandidates(snapshot, snapshot.reel_subcanary));
}
for (const path of directPaths) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(payload.records)) throw new Error(`${path} does not contain a records array.`);
  directGroups.push(buildDirectVerificationCandidates(snapshot, payload.records.filter((record) => record?.success !== false)));
}
const started = await request("/api/intelligence/collections", {
  source_id: SNAPSHOT_REPLAY_DEFAULTS.source_id,
  dataset_label: snapshot.dataset_label,
  target_posts: candidates.length
});
const collectionId = started.collection.collection_batch_id;
const batchResults = [];
for (const batch of replayBatches(candidates)) {
  batchResults.push((await request(`/api/intelligence/collections/${collectionId}/records`, { candidates: batch })).result);
}
for (const group of directGroups) {
  for (const batch of replayBatches(group)) {
    batchResults.push((await request(`/api/intelligence/collections/${collectionId}/records`, { candidates: batch })).result);
  }
}
const completed = (await request(`/api/intelligence/collections/${collectionId}/complete`, { status: candidates.length === 200 ? "COMPLETED" : "PARTIAL" })).collection;

const checkpoint = {
  checkpoint_version: "1.0.0",
  generated_at: new Date().toISOString(),
  source_snapshot: inputPath,
  direct_verification_files: directPaths,
  direct_verification_records: directGroups.reduce((total, group) => total + group.length, 0),
  source_validation: validation,
  collection: completed,
  batch_results: batchResults,
  canonical_counts: {
    posts: store.posts.length,
    metric_snapshots: store.metrics.length,
    raw_observations: store.observations.length,
    media_references: store.media.length
  },
  sources: store.sources,
  posts: store.posts,
  metric_snapshots: store.metrics,
  raw_observations: store.observations,
  media_references: store.media
};
await writeFile(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, output: outputPath, collection_status: completed.status, quality: completed.quality, counts: checkpoint.canonical_counts }, null, 2));
