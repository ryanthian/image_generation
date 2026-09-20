import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildImportPreview,
  detectFieldMappings,
  parseCsv,
  parseJson,
  validateClassificationPatch
} from "../src/intelligence-core.mjs";
import { handleIntelligenceApi, MemoryIntelligenceStore } from "../src/intelligence-server.mjs";
import { persistGateA3Checkpoint } from "../src/facebook-gate-a3-persistence.mjs";
import {
  OBSERVED_DATASET_LABEL,
  deriveCanonicalIdentity,
  normalizeObservedCandidate,
  normalizeObservedBatch,
  observedQuality
} from "../src/facebook-collection-core.mjs";
import { buildDirectVerificationCandidates, buildReplayCandidates, parseFacebookCount, replayBatches, validateObservedSnapshot } from "../src/facebook-snapshot-replay.mjs";
import { applyMigrations, LocalD1Database } from "../src/local-d1-sqlite.mjs";
import { D1IntelligenceStore } from "../src/intelligence-server.mjs";

const audienceCsv = await readFile(new URL("fixtures/audience_import_sample.csv", import.meta.url), "utf8");
const benchmarkCsv = await readFile(new URL("fixtures/benchmark_import_sample.csv", import.meta.url), "utf8");
const observedSnapshot = JSON.parse(await readFile(new URL("../research/facebook-collections/2026-09-20-my-page-200-observed-reel-identities.json", import.meta.url), "utf8"));
const gateA2CheckpointUrl = new URL("../research/facebook-collections/2026-09-20-my-page-200-observed-canonical-checkpoint.json", import.meta.url);
const migrationsDir = resolve(new URL("..", import.meta.url).pathname, "db/migrations");

function writeRequest(path, body, method = "POST") {
  return new Request(`https://local.test${path}`, { method, headers: { "content-type": "application/json", "x-content-intelligence-request": "1" }, body: JSON.stringify(body) });
}

async function api(store, request) {
  const response = await handleIntelligenceApi(request, {}, new URL(request.url), store);
  return { status: response.status, body: await response.json() };
}

async function preview(store, body) {
  return api(store, writeRequest("/api/intelligence/import/preview", body));
}

async function confirm(store, body) {
  const checked = await preview(store, body);
  assert.equal(checked.status, 200);
  return api(store, writeRequest("/api/intelligence/import/confirm", { ...body, mapping: checked.body.preview.mapping, preview_hash: checked.body.preview.preview_hash }));
}

async function startCollection(store, body = {}) {
  return api(store, writeRequest("/api/intelligence/collections", { source_id: "source_my_page", ...body }));
}

async function addCollectionRecords(store, collectionId, candidates) {
  return api(store, writeRequest(`/api/intelligence/collections/${collectionId}/records`, { candidates }));
}

test("CSV parser handles quoted commas/newlines and rejects malformed CSV", () => {
  const parsed = parseCsv('ID,Message\n1,"hello, world"\n2,"two\nlines"');
  assert.equal(parsed.records[0].Message, "hello, world");
  assert.equal(parsed.records[1].Message, "two\nlines");
  assert.throws(() => parseCsv('ID,Message\n1,"broken'), /Malformed CSV/);
});

test("JSON parser accepts arrays and common containers, and rejects malformed JSON", () => {
  assert.equal(parseJson('[{"ID":"1"}]').records.length, 1);
  assert.equal(parseJson('{"data":[{"ID":"1"}]}').records.length, 1);
  assert.equal(parseJson('{"posts":[{"ID":"1"}]}').records.length, 1);
  assert.throws(() => parseJson("{"), /Malformed JSON/);
  assert.throws(() => parseJson('{"other":[]}'), /data or posts array/);
});

test("aliases detect fields but ambiguous Likes requires manual mapping", () => {
  const detected = detectFieldMappings(["Post ID", "Message", "Created Time", "Likes"]);
  assert.equal(detected.mapping.external_post_id, "Post ID");
  assert.equal(detected.mapping.caption, "Message");
  assert.equal(detected.mapping.published_at, "Created Time");
  assert.equal(detected.mapping.reaction_count, null);
  assert.deepEqual(detected.ambiguous.reaction_count, ["Likes"]);
  assert.deepEqual(detected.ambiguous.like_count, ["Likes"]);
});

test("manual mapping resolves ambiguity, preserves missing values as NULL, and reports invalid values", async () => {
  const content = "ID,Date,Message,Likes,Views\nA-1,not-a-date,,bad,";
  const result = await buildImportPreview({ source_id: "source_my_page", file_name: "test.csv", content, mapping: { external_post_id: "ID", published_at: "Date", caption: "Message", reaction_count: "Likes", like_count: null, view_count: "Views" } });
  assert.deepEqual(result.fatal_errors, []);
  assert.equal(result.normalized_rows[0].post.published_at, null);
  assert.equal(result.normalized_rows[0].post.caption, null);
  assert.equal(result.normalized_rows[0].metrics.reaction_count, null);
  assert.equal(result.normalized_rows[0].metrics.view_count, null);
  assert.ok(result.warnings.some((warning) => warning.code === "INVALID_DATE"));
  assert.ok(result.warnings.some((warning) => warning.code === "INVALID_METRIC"));
});

test("controlled taxonomy rejects unknown manual classifications", () => {
  assert.equal(validateClassificationPatch({ topic: "food", hook: "question" }).errors.length, 0);
  assert.match(validateClassificationPatch({ topic: "made_up" }).errors[0], /controlled taxonomy/);
});

test("source seeds preserve audience and benchmark analytical roles", async () => {
  const store = new MemoryIntelligenceStore();
  const sources = await store.listSources();
  assert.equal(sources.find((source) => source.facebook_id === "100044347487511").source_role, "audience");
  assert.equal(sources.find((source) => source.facebook_id === "100033687097155").source_role, "benchmark");
});

test("CSV import stores raw rows, canonical posts and metric snapshots", async () => {
  const store = new MemoryIntelligenceStore();
  const result = await confirm(store, { source_id: "source_my_page", file_name: "audience_import_sample.csv", content: audienceCsv, captured_at: "2026-09-05T00:00:00Z", metric_scope: "public" });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.posts_imported, 4);
  assert.equal(store.raws.length, 4);
  assert.equal(store.posts.length, 4);
  assert.equal(store.metrics.length, 4);
  assert.equal(store.posts.find((post) => post.external_post_id === "TEST-AUD-003").caption.includes("missing metrics"), true);
  const missing = store.metrics.find((snapshot) => snapshot.post_id === store.posts.find((post) => post.external_post_id === "TEST-AUD-003").post_id);
  assert.equal(missing.view_count, null);
});

test("duplicate file is warned and requires controlled reprocessing", async () => {
  const store = new MemoryIntelligenceStore();
  const body = { source_id: "source_eunice_benchmark", file_name: "benchmark_import_sample.csv", content: benchmarkCsv, captured_at: "2026-08-15T00:00:00Z", metric_scope: "public" };
  await confirm(store, body);
  const checked = await preview(store, body);
  assert.ok(checked.body.preview.duplicate_import);
  const blocked = await api(store, writeRequest("/api/intelligence/import/confirm", { ...body, mapping: checked.body.preview.mapping, preview_hash: checked.body.preview.preview_hash }));
  assert.equal(blocked.status, 409);
});

test("preview counts duplicate canonical posts inside one file", async () => {
  const content = "Post ID,Message,Created Time\nDUP-1,First,2026-09-01\nDUP-1,Updated,2026-09-01";
  const result = await buildImportPreview({ source_id: "source_my_page", file_name: "duplicates.csv", content });
  assert.equal(result.quality.duplicates, 1);
});

test("CRITICAL: same post with newer metrics creates one post and two snapshots", async () => {
  const store = new MemoryIntelligenceStore();
  const first = "Post ID,Message,Created Time,Reactions,Comments,Shares\nSAME-1,First caption,2026-09-01T00:00:00Z,10,2,1";
  const second = "Post ID,Message,Created Time,Reactions,Comments,Shares\nSAME-1,First caption,2026-09-01T00:00:00Z,25,5,3";
  const base = { source_id: "source_my_page", file_name: "day1.csv", content: first, captured_at: "2026-09-02T00:00:00Z", metric_scope: "public" };
  assert.equal((await confirm(store, base)).status, 200);
  assert.equal((await confirm(store, { ...base, file_name: "day3.csv", content: second, captured_at: "2026-09-04T00:00:00Z" })).status, 200);
  assert.equal(store.posts.length, 1);
  assert.equal(store.metrics.length, 2);
  assert.deepEqual(store.metrics.map((item) => item.reaction_count), [10, 25]);
});

test("manual classification override has precedence and remains source-specific", async () => {
  const store = new MemoryIntelligenceStore();
  const body = { source_id: "source_my_page", file_name: "one.csv", content: "Post ID,Message,Created Time\nOVERRIDE-1,Hello,2026-09-01", captured_at: "2026-09-02T00:00:00Z" };
  await confirm(store, body);
  const post = store.posts[0];
  const response = await api(store, writeRequest(`/api/intelligence/posts/${post.post_id}/classification`, { topic: "food", hook: "question", emotion: "appetizing", content_format: "single_image", visual: "realistic_food", intent: "engagement" }, "PATCH"));
  assert.equal(response.status, 200);
  assert.equal(response.body.post.classification.classification_source, "manual");
  assert.equal(response.body.post.classification.topic, "food");
  assert.equal(response.body.post.source_role, "audience");
});

test("manual override can explicitly clear a prior classification value", async () => {
  const store = new MemoryIntelligenceStore();
  await confirm(store, { source_id: "source_my_page", file_name: "clear.csv", content: "Post ID,Message,Created Time\nCLEAR-1,Hello,2026-09-01", captured_at: "2026-09-02T00:00:00Z" });
  const post = store.posts[0];
  store.classifications.push({ classification_id: "class_ai", post_id: post.post_id, topic: "food", hook: "question", classification_source: "ai", confidence: 0.7, created_at: "2026-09-03T00:00:00Z" });
  await store.saveClassification(post.post_id, { topic: null, secondary_topic: null, hook: null, emotion: null, content_format: null, visual: null, intent: null, confidence: null, notes: "Cleared after review" });
  const resolved = await store.getPost(post.post_id);
  assert.equal(resolved.classification.topic, null);
  assert.equal(resolved.classification.hook, null);
  assert.equal(resolved.classification.classification_source, "manual");
});

test("posts API filters and sorts without converting missing metrics to zero", async () => {
  const store = new MemoryIntelligenceStore();
  await confirm(store, { source_id: "source_my_page", file_name: "audience_import_sample.csv", content: audienceCsv, captured_at: "2026-09-05T00:00:00Z" });
  const response = await api(store, new Request("https://local.test/api/intelligence/posts?format=video&sort=reactions"));
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.posts[0].external_post_id, "TEST-AUD-002");
  assert.equal(store.metrics.find((item) => item.post_id === store.posts.find((post) => post.external_post_id === "TEST-AUD-003").post_id).reaction_count, null);
});

test("200-row import succeeds and respects the canonical model", async () => {
  const rows = Array.from({ length: 200 }, (_, index) => `ROW-${index + 1},TEST DATA ${index + 1},2026-09-${String(index % 28 + 1).padStart(2, "0")},${index}`).join("\n");
  const content = `Post ID,Message,Created Time,Reactions\n${rows}`;
  const store = new MemoryIntelligenceStore();
  const result = await confirm(store, { source_id: "source_my_page", file_name: "200.csv", content, captured_at: "2026-09-30T00:00:00Z" });
  assert.equal(result.status, 200);
  assert.equal(store.posts.length, 200);
  assert.equal(store.raws.length, 200);
  assert.equal(store.metrics.length, 200);
});

test("write APIs reject missing same-origin request marker", async () => {
  const store = new MemoryIntelligenceStore();
  const request = new Request("https://local.test/api/intelligence/import/preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const response = await api(store, request);
  assert.equal(response.status, 403);
});

test("observed collector derives canonical Facebook identity without caption or feed position", () => {
  const fromPermalink = deriveCanonicalIdentity({ post_url: "https://www.facebook.com/permalink.php?story_fbid=pfbid02ABC&id=100044347487511&ref=embed" });
  assert.equal(fromPermalink.external_post_id, "pfbid02ABC");
  assert.equal(fromPermalink.canonical_identity, "facebook:pfbid02ABC");
  const fromCarousel = deriveCanonicalIdentity({ post_url: "https://www.facebook.com/photo/?fbid=111&set=pcb.987654321" });
  assert.equal(fromCarousel.external_post_id, "111");
  assert.equal(fromCarousel.canonical_identity, "facebook:111");
  const fromExplicit = deriveCanonicalIdentity({ external_post_id: "POST-123", caption: "Not identity" });
  assert.equal(fromExplicit.canonical_identity, "facebook:POST-123");
});

test("observed normalization expands captions, preserves relative age and rejects weak timestamps", async () => {
  const result = await normalizeObservedCandidate({
    external_post_id: "OBS-1",
    caption: "Full expanded caption",
    caption_expanded: true,
    visible_relative_age: "6h",
    published_at: "2026-09-20T08:00:00Z",
    metrics: { reaction_count: 12, comment_count: 1, share_count: 5 },
    verification: { identity_verified: true, caption_verified: true, metrics_verified: true, media_verified: true }
  });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.caption_capture_status, "full");
  assert.equal(result.candidate.published_at, null);
  assert.equal(result.candidate.published_at_confidence, "relative_only");
  assert.ok(result.warnings.some((warning) => warning.includes("Rejected a non-original publication timestamp")));
});

test("observed batch rejects duplicate feed elements but preserves duplicate raw records later", async () => {
  const normalized = await normalizeObservedBatch([
    { external_post_id: "DUP-FEED-1", caption: "A" },
    { external_post_id: "DUP-FEED-1", caption: "A again" }
  ]);
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.duplicate_records.length, 1);
  assert.equal(normalized.duplicates, 1);
});

test("observed collection API appends metric snapshots for changed public metrics", async () => {
  const store = new MemoryIntelligenceStore();
  const start = await startCollection(store, { target_posts: 2 });
  assert.equal(start.status, 201);
  assert.equal(start.body.collection.dataset_label, OBSERVED_DATASET_LABEL);
  const collectionId = start.body.collection.collection_batch_id;
  const first = await addCollectionRecords(store, collectionId, [{
    external_post_id: "OBS-METRIC-1",
    caption: "First",
    caption_expanded: true,
    discovered_at: "2026-09-20T01:00:00.000Z",
    metrics: { reaction_count: 7, comment_count: 1, share_count: 4 },
    verification: { identity_verified: true, caption_verified: true, metrics_verified: true, media_verified: true },
    media: [{ provider_media_id: "photo-1", media_type: "image", media_url: "https://www.facebook.com/photo/?fbid=photo-1" }]
  }]);
  assert.equal(first.body.result.new_posts, 1);
  const second = await addCollectionRecords(store, collectionId, [{
    external_post_id: "OBS-METRIC-1",
    caption: "First",
    caption_expanded: true,
    discovered_at: "2026-09-20T02:00:00.000Z",
    metrics: { reaction_count: 12, comment_count: 1, share_count: 5 },
    verification: { identity_verified: true, caption_verified: true, metrics_verified: true, media_verified: true },
    media: [{ provider_media_id: "photo-1", media_type: "image", media_url: "https://www.facebook.com/photo/?fbid=photo-1" }]
  }]);
  assert.equal(second.body.result.duplicate_posts, 1);
  assert.equal(store.posts.length, 1);
  assert.equal(store.metrics.length, 2);
  assert.equal(store.observations.some((item) => item.validation_status === "DUPLICATE"), true);
});

test("observed collection preserves carousel association and reel/video NULL metrics", async () => {
  const store = new MemoryIntelligenceStore();
  const collectionId = (await startCollection(store, { target_posts: 3 })).body.collection.collection_batch_id;
  await addCollectionRecords(store, collectionId, [
    {
      external_post_id: "CAROUSEL-1",
      caption: "Carousel post",
      caption_expanded: true,
      metrics: { reaction_count: 4, comment_count: 0, share_count: 1 },
      verification: { identity_verified: true, caption_verified: true, metrics_verified: true, media_verified: true },
      media: [
        { provider_media_id: "img-1", media_type: "image", media_url: "https://www.facebook.com/photo/?fbid=img-1" },
        { provider_media_id: "img-2", media_type: "image", media_url: "https://www.facebook.com/photo/?fbid=img-2" }
      ]
    },
    {
      external_post_id: "REEL-1",
      post_type: "reel",
      caption_capture_status: "collapsed",
      caption: "Collapsed reel caption",
      metrics: { reaction_count: 10, comment_count: 2, share_count: 3, view_count: null },
      verification: { identity_verified: true, caption_verified: false, metrics_verified: true, media_verified: true },
      media: [{ provider_media_id: "reel-1", media_type: "reel", media_url: "https://www.facebook.com/reel/REEL-1", thumbnail_url: "https://www.facebook.com/reel/REEL-1" }]
    }
  ]);
  const carousel = store.posts.find((post) => post.external_post_id === "CAROUSEL-1");
  const reel = store.posts.find((post) => post.external_post_id === "REEL-1");
  assert.equal(carousel.content_format, "multi_image");
  assert.equal(store.media.filter((item) => item.post_id === carousel.post_id).length, 2);
  assert.equal(reel.content_format, "reel");
  assert.equal(store.metrics.find((item) => item.post_id === reel.post_id).view_count, null);
});

test("observed collection quality reports components and does not mark incomplete sample complete", async () => {
  const store = new MemoryIntelligenceStore();
  const collectionId = (await startCollection(store, { target_posts: 2 })).body.collection.collection_batch_id;
  await addCollectionRecords(store, collectionId, [{
    external_post_id: "QUALITY-1",
    caption: "Quality",
    caption_expanded: true,
    published_at: "2026-09-20T00:00:00.000Z",
    published_at_confidence: "exact",
    metrics: { reaction_count: 1, comment_count: 1, share_count: 1 },
    verification: { identity_verified: true, caption_verified: true, metrics_verified: true, media_verified: false }
  }]);
  const complete = await api(store, writeRequest(`/api/intelligence/collections/${collectionId}/complete`, { status: "COMPLETED" }));
  assert.equal(complete.body.collection.status, "PARTIAL");
  assert.equal(complete.body.collection.quality.total_posts, 1);
  assert.equal(complete.body.collection.quality.identity_completeness, 100);
  const quality = await api(store, new Request("https://local.test/api/intelligence/collection-quality?source_id=source_my_page"));
  assert.equal(quality.status, 200);
  assert.equal(quality.body.quality.total_posts, 1);
});

test("observed collection enforces resumable 25-record batches and target 200 boundary", async () => {
  const store = new MemoryIntelligenceStore();
  const collectionId = (await startCollection(store, { target_posts: 200 })).body.collection.collection_batch_id;
  const tooMany = Array.from({ length: 26 }, (_, index) => ({ external_post_id: `TOO-MANY-${index}` }));
  assert.equal((await addCollectionRecords(store, collectionId, tooMany)).status, 400);
  for (let batchIndex = 0; batchIndex < 8; batchIndex += 1) {
    const candidates = Array.from({ length: 25 }, (_, index) => ({ external_post_id: `OBS-200-${batchIndex * 25 + index + 1}`, caption: `Post ${batchIndex}-${index}`, caption_expanded: true }));
    assert.equal((await addCollectionRecords(store, collectionId, candidates)).status, 200);
  }
  const finished = await api(store, writeRequest(`/api/intelligence/collections/${collectionId}/complete`, { status: "COMPLETED" }));
  assert.equal(finished.body.collection.status, "COMPLETED");
  assert.equal(finished.body.collection.quality.total_posts, 200);
});

test("observed quality separates completeness from direct verification", () => {
  const quality = observedQuality([{
    canonical_identity: "facebook:1",
    caption_capture_status: "missing",
    content_format: "reel",
    published_at_confidence: "unknown",
    identity_verified: 0,
    caption_verified: 0,
    metrics_verified: 0,
    media_verified: 0,
    latest_metrics: { reaction_count: null, comment_count: null, share_count: null, view_count: 1200 },
    media_references: [{ media_type: "reel" }]
  }]);
  assert.equal(quality.identity_completeness, 100);
  assert.equal(quality.metric_completeness, 100);
  assert.equal(quality.media_completeness, 100);
  assert.equal(quality.caption_completeness, 0);
  assert.equal(quality.verification.identity, 0);
  assert.equal(quality.metric_coverage.view_count, 100);
  assert.equal(quality.metric_coverage.reaction_count, 0);
});

test("snapshot replay validates the observed sample and builds eight auditable batches", () => {
  const validation = validateObservedSnapshot(observedSnapshot);
  assert.equal(validation.valid, true);
  assert.equal(validation.reel_count, 200);
  assert.equal(validation.unique_identities, 200);
  const candidates = buildReplayCandidates(observedSnapshot);
  const batches = replayBatches(candidates);
  assert.equal(candidates.length, 200);
  assert.equal(batches.length, 8);
  assert.equal(batches.every((batch) => batch.length === 25), true);
  assert.equal(new Set(candidates.map((candidate) => candidate.external_post_id)).size, 200);
  assert.equal(candidates.every((candidate) => candidate.content_format === "reel"), true);
  assert.equal(candidates.every((candidate) => candidate.metrics.view_count !== null), true);
  assert.equal(candidates.every((candidate) => candidate.metrics.reach_count === null && candidate.metrics.click_count === null), true);
});

test("snapshot replay preserves grid observations and creates separate direct verification candidates", () => {
  assert.equal(parseFacebookCount("1.4K"), 1400);
  assert.equal(parseFacebookCount("12.1K"), 12100);
  assert.equal(parseFacebookCount("bad"), null);
  const gridCandidates = buildReplayCandidates(observedSnapshot);
  const verified = buildDirectVerificationCandidates(observedSnapshot);
  const pending = gridCandidates.filter((candidate) => !candidate.verification.identity_verified);
  assert.equal(verified.length, 3);
  assert.equal(pending.length, 200);
  assert.equal(gridCandidates[0].metrics.reaction_count, null);
  assert.equal(gridCandidates[0].metrics.view_count, 176000);
  assert.equal(verified[0].metrics.reaction_count, 1400);
  assert.equal(verified[0].metrics.comment_count, 2);
  assert.equal(verified[0].metrics.share_count, 296);
  assert.equal(verified[0].metrics.view_count, 176000);
  assert.equal(verified[0].caption_capture_status, "full");
  assert.equal(verified[2].caption_capture_status, "collapsed");
  assert.equal(pending.every((candidate) => candidate.caption_capture_status === "missing"), true);
});

test("Gate A3 persists the A2 checkpoint into the D1 path with reconciliation and provenance", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "content-ai-gate-a3-"));
  const dbPath = join(tempDir, "gate-a3.sqlite");
  const db = new LocalD1Database(dbPath);
  try {
    await applyMigrations(db, migrationsDir);
    const store = new D1IntelligenceStore(db);
    const first = await persistGateA3Checkpoint(store, { checkpointPath: gateA2CheckpointUrl.pathname });
    const second = await persistGateA3Checkpoint(store, { checkpointPath: gateA2CheckpointUrl.pathname });

    assert.equal(first.canonical_posts.persisted, 200);
    assert.equal(first.canonical_posts.unique, 200);
    assert.equal(first.canonical_posts.duplicate_count, 0);
    assert.equal(first.metric_snapshots.persisted, 403);
    assert.equal(first.raw_observations.persisted, 403);
    assert.equal(first.quality.caption_completeness, 99.5);
    assert.equal(first.quality.media.reel_video, 200);
    assert.equal(first.quality.exact_date_completeness, 0);
    assert.equal(first.missing_caption_record.external_post_id, "1377429970434769");
    assert.equal(first.missing_caption_record.caption, null);
    assert.equal(first.missing_caption_record.caption_capture_status, "missing");
    assert.equal(first.missing_caption_record.caption_missing, true);
    assert.equal(first.null_preservation.published_at_all_null, true);
    assert.equal(first.null_preservation.reach_all_null, true);
    assert.equal(first.null_preservation.click_all_null, true);
    assert.equal(first.provenance.sample_type, "observed_sample");
    assert.equal(first.provenance.media_scope, "reel_only");
    assert.equal(first.provenance.chronology_status, "unverified");
    assert.equal(first.provenance.direct_verification_files.length, 8);

    assert.equal(second.replayed, false);
    assert.equal(second.canonical_posts.persisted, 200);
    assert.equal(second.metric_snapshots.persisted, 403);
    assert.equal(second.raw_observations.persisted, 403);
  } finally {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
