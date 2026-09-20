import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { observedQuality } from "./facebook-collection-core.mjs";
import { buildDirectVerificationCandidates, buildReplayCandidates, replayBatches, SNAPSHOT_REPLAY_DEFAULTS, validateObservedSnapshot } from "./facebook-snapshot-replay.mjs";
import { handleIntelligenceApi } from "./intelligence-server.mjs";

export const GATE_A3_COLLECTION_ID = "gate_a3_my_page_200_observed_reels_2026_09_20";
export const GATE_A3_DATASET_PROVENANCE = Object.freeze({
  sample_type: "observed_sample",
  media_scope: "reel_only",
  chronology_status: "unverified",
  limitations: [
    "200 observed Facebook posts from authenticated browser-visible reels evidence.",
    "Reel/video-only observed sample, not a complete mixed-format page export.",
    "Not verified as the latest 200 posts.",
    "Exact publication date completeness is 0%; discovery order is not publish chronology.",
    "Reach, clicks, impressions, and demographics are unavailable and remain NULL.",
    "No recommendation scoring or future-content generation is performed in Gate A3."
  ]
});

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_GATE_A3_PATHS = Object.freeze({
  checkpoint: resolve(projectRoot, "research/facebook-collections/2026-09-20-my-page-200-observed-canonical-checkpoint.json"),
  report: resolve(projectRoot, "research/facebook-collections/2026-09-20-my-page-gate-a3-analysis-readiness-report.md"),
  reconciliation: resolve(projectRoot, "research/facebook-collections/2026-09-20-my-page-gate-a3-reconciliation.json")
});

async function request(store, path, body) {
  const webRequest = new Request(`https://local.gate-a3${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-content-intelligence-request": "1" },
    body: JSON.stringify(body)
  });
  const response = await handleIntelligenceApi(webRequest, {}, new URL(webRequest.url), store);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${payload.error || `HTTP ${response.status}`}`);
  return payload;
}

async function discoverDirectBatchPaths(checkpoint, collectionDir) {
  if (Array.isArray(checkpoint.direct_verification_files) && checkpoint.direct_verification_files.length) return checkpoint.direct_verification_files;
  const files = (await readdir(collectionDir)).filter((file) => /^2026-09-20-my-page-direct-verification-batch-\d{3}\.json$/.test(file)).sort();
  return files.map((file) => resolve(collectionDir, file));
}

async function loadGateA2Evidence(checkpointPath) {
  const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
  const snapshot = JSON.parse(await readFile(checkpoint.source_snapshot, "utf8"));
  const validation = validateObservedSnapshot(snapshot);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const directPaths = await discoverDirectBatchPaths(checkpoint, dirname(checkpointPath));
  const directGroups = [];
  if (Array.isArray(snapshot.reel_subcanary) && snapshot.reel_subcanary.length) {
    directGroups.push(buildDirectVerificationCandidates(snapshot, snapshot.reel_subcanary));
  }
  for (const path of directPaths) {
    const payload = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(payload.records)) throw new Error(`${path} does not contain a records array.`);
    directGroups.push(buildDirectVerificationCandidates(snapshot, payload.records.filter((record) => record?.success !== false)));
  }
  return {
    checkpoint,
    snapshot,
    validation,
    checkpointPath,
    directPaths,
    gridCandidates: buildReplayCandidates(snapshot),
    directGroups
  };
}

async function getRows(store, sql, ...values) {
  if (typeof store.all === "function") return store.all(sql, ...values);
  throw new Error("Gate A3 persistence requires a D1-compatible store with query access.");
}

async function getOne(store, sql, ...values) {
  if (typeof store.one === "function") return store.one(sql, ...values);
  throw new Error("Gate A3 persistence requires a D1-compatible store with query access.");
}

export async function persistGateA3Checkpoint(store, options = {}) {
  const checkpointPath = resolve(options.checkpointPath || DEFAULT_GATE_A3_PATHS.checkpoint);
  const evidence = await loadGateA2Evidence(checkpointPath);
  const expected = evidence.checkpoint.canonical_counts;
  const existing = await store.getCollection(GATE_A3_COLLECTION_ID);
  const existingRows = existing ? await buildReconciliation(store, evidence, { replayed: false }) : null;
  const alreadyPersisted = existingRows
    && existingRows.canonical_posts.persisted === expected.posts
    && existingRows.metric_snapshots.persisted === expected.metric_snapshots
    && existingRows.raw_observations.persisted === expected.raw_observations
    && existingRows.canonical_posts.duplicate_count === 0;

  const replayed = !alreadyPersisted;
  if (replayed) {
    const started = await request(store, "/api/intelligence/collections", {
      collection_batch_id: GATE_A3_COLLECTION_ID,
      source_id: SNAPSHOT_REPLAY_DEFAULTS.source_id,
      dataset_label: evidence.snapshot.dataset_label,
      target_posts: evidence.gridCandidates.length,
      sample_type: GATE_A3_DATASET_PROVENANCE.sample_type,
      media_scope: GATE_A3_DATASET_PROVENANCE.media_scope,
      chronology_status: GATE_A3_DATASET_PROVENANCE.chronology_status,
      source_checkpoint: checkpointPath,
      direct_verification_files_json: evidence.directPaths,
      limitations_json: GATE_A3_DATASET_PROVENANCE.limitations
    });
    if (started.collection.status !== "RUNNING") {
      throw new Error(`Gate A3 collection ${GATE_A3_COLLECTION_ID} is not accepting records and does not reconcile to the expected checkpoint.`);
    }
    for (const batch of replayBatches(evidence.gridCandidates)) {
      await request(store, `/api/intelligence/collections/${GATE_A3_COLLECTION_ID}/records`, { candidates: batch });
    }
    for (const group of evidence.directGroups) {
      for (const batch of replayBatches(group)) {
        await request(store, `/api/intelligence/collections/${GATE_A3_COLLECTION_ID}/records`, { candidates: batch });
      }
    }
    await request(store, `/api/intelligence/collections/${GATE_A3_COLLECTION_ID}/complete`, { status: evidence.gridCandidates.length === 200 ? "COMPLETED" : "PARTIAL" });
  }

  return buildReconciliation(store, evidence, { replayed });
}

export async function buildReconciliation(store, evidence, options = {}) {
  const expected = evidence.checkpoint.canonical_counts;
  const collection = await store.getCollection(GATE_A3_COLLECTION_ID);
  const posts = await getRows(store, "SELECT * FROM posts WHERE source_id = ? ORDER BY discovery_order", SNAPSHOT_REPLAY_DEFAULTS.source_id);
  const postIds = posts.map((post) => post.post_id);
  const metrics = postIds.length ? await getRows(store, `SELECT * FROM post_metric_snapshots WHERE post_id IN (${postIds.map(() => "?").join(",")})`, ...postIds) : [];
  const observations = await getRows(store, "SELECT * FROM collection_raw_observations WHERE collection_batch_id = ?", GATE_A3_COLLECTION_ID);
  const media = postIds.length ? await getRows(store, `SELECT * FROM post_media_references WHERE post_id IN (${postIds.map(() => "?").join(",")})`, ...postIds) : [];
  const uniqueExternalIds = new Set(posts.map((post) => post.external_post_id).filter(Boolean));
  const quality = observedQuality(posts.map((post) => ({ ...post, latest_metrics: metrics.find((metric) => metric.post_id === post.post_id) || {}, media_references: media.filter((item) => item.post_id === post.post_id) })));
  const missingCaption = posts.find((post) => post.external_post_id === "1377429970434769") || null;
  const nullCounts = {
    published_at_null: posts.filter((post) => post.published_at === null).length,
    reach_count_null: metrics.filter((metric) => metric.reach_count === null).length,
    click_count_null: metrics.filter((metric) => metric.click_count === null).length,
    like_count_null: metrics.filter((metric) => metric.like_count === null).length
  };
  const provenance = {
    sample_type: collection?.sample_type || null,
    media_scope: collection?.media_scope || null,
    chronology_status: collection?.chronology_status || null,
    source_checkpoint: collection?.source_checkpoint || null,
    limitations: collection?.limitations_json ? JSON.parse(collection.limitations_json) : [],
    direct_verification_files: collection?.direct_verification_files_json ? JSON.parse(collection.direct_verification_files_json) : []
  };
  return {
    generated_at: new Date().toISOString(),
    replayed: Boolean(options.replayed),
    gate: "A3",
    status: "PASS",
    expected,
    canonical_posts: {
      expected: expected.posts,
      persisted: posts.length,
      unique: uniqueExternalIds.size,
      duplicate_count: posts.length - uniqueExternalIds.size
    },
    metric_snapshots: { expected: expected.metric_snapshots, persisted: metrics.length },
    raw_observations: { expected: expected.raw_observations, persisted: observations.length },
    media_references: { expected: expected.media_references, persisted: media.length },
    quality,
    missing_caption_record: missingCaption ? {
      external_post_id: missingCaption.external_post_id,
      discovery_order: missingCaption.discovery_order,
      caption: missingCaption.caption,
      caption_capture_status: missingCaption.caption_capture_status,
      caption_missing: missingCaption.caption_missing === 1
    } : null,
    null_preservation: {
      ...nullCounts,
      published_at_all_null: nullCounts.published_at_null === posts.length,
      reach_all_null: nullCounts.reach_count_null === metrics.length,
      click_all_null: nullCounts.click_count_null === metrics.length
    },
    provenance,
    production_d1_touched: false,
    deployment_performed: false
  };
}

function passLine(ok) {
  return ok ? "PASS" : "FAIL";
}

export function renderAnalysisReadinessReport(reconciliation) {
  const q = reconciliation.quality;
  const missing = reconciliation.missing_caption_record;
  return `# Gate A3 Analysis Readiness Report

Generated: ${reconciliation.generated_at}

Dataset: My Facebook Page - 200-Post Observed Sample

## Gate Status

- Gate A3 status: ${reconciliation.status}
- Dataset type: 200 observed Facebook posts
- Media scope: reel/video-only observed sample
- Latest-200 status: NOT verified as latest 200
- Chronology status: unverified
- Exact publish-date completeness: ${q.exact_date_completeness}%
- Production D1 touched: no
- Deployment performed: no

## Reconciliation

| Check | Expected | Persisted | Result |
|---|---:|---:|---|
| Canonical posts | ${reconciliation.canonical_posts.expected} | ${reconciliation.canonical_posts.persisted} | ${passLine(reconciliation.canonical_posts.expected === reconciliation.canonical_posts.persisted)} |
| Unique canonical IDs | ${reconciliation.canonical_posts.expected} | ${reconciliation.canonical_posts.unique} | ${passLine(reconciliation.canonical_posts.unique === reconciliation.canonical_posts.expected)} |
| Duplicate canonical IDs | 0 | ${reconciliation.canonical_posts.duplicate_count} | ${passLine(reconciliation.canonical_posts.duplicate_count === 0)} |
| Metric snapshots | ${reconciliation.metric_snapshots.expected} | ${reconciliation.metric_snapshots.persisted} | ${passLine(reconciliation.metric_snapshots.expected === reconciliation.metric_snapshots.persisted)} |
| Raw observations | ${reconciliation.raw_observations.expected} | ${reconciliation.raw_observations.persisted} | ${passLine(reconciliation.raw_observations.expected === reconciliation.raw_observations.persisted)} |
| Media references | ${reconciliation.media_references.expected} | ${reconciliation.media_references.persisted} | ${passLine(reconciliation.media_references.expected === reconciliation.media_references.persisted)} |

## Completeness

- Identity completeness: ${q.identity_completeness}%
- Caption completeness: ${q.caption_completeness}%
- Metric completeness: ${q.metric_completeness}%
- Media completeness: ${q.media_completeness}%
- Exact-date completeness: ${q.exact_date_completeness}%
- Captions: full ${q.captions.full}, collapsed ${q.captions.collapsed}, missing ${q.captions.missing}, failed ${q.captions.failed}
- Media: reel/video ${q.media.reel_video}, image ${q.media.image}, carousel ${q.media.carousel}, text ${q.media.text}, unknown ${q.media.unknown}

## Missing Caption Verification

- External post ID: ${missing?.external_post_id || "none"}
- Discovery order: ${missing?.discovery_order ?? "none"}
- Caption capture status: ${missing?.caption_capture_status || "none"}
- caption_missing flag: ${missing?.caption_missing === true ? "true" : "false"}
- Caption text: ${missing?.caption === null ? "NULL" : "unexpected non-null value"}

## NULL Preservation

- published_at NULL count: ${reconciliation.null_preservation.published_at_null}/${reconciliation.canonical_posts.persisted}
- reach_count NULL count: ${reconciliation.null_preservation.reach_count_null}/${reconciliation.metric_snapshots.persisted}
- click_count NULL count: ${reconciliation.null_preservation.click_count_null}/${reconciliation.metric_snapshots.persisted}
- No reach/click/impression/demographic values were inferred.

## Provenance

- sample_type: ${reconciliation.provenance.sample_type}
- media_scope: ${reconciliation.provenance.media_scope}
- chronology_status: ${reconciliation.provenance.chronology_status}
- source_checkpoint: ${reconciliation.provenance.source_checkpoint}
- direct verification files: ${reconciliation.provenance.direct_verification_files.length}

## Supported Analyses

- Caption structure
- Hook/opening patterns
- CTA patterns
- Caption length and distribution
- Topic/content clusters from stored captions
- Repeated content formulas
- Creative concepts
- Observed views
- Observed reactions
- Observed comments
- Observed shares
- Distribution and outlier analysis on available public metrics
- High/low observed performers using available public metrics
- Relationships between available public metrics
- Reel content pattern extraction where supported by stored captions and media references

## Not Currently Supported

- Latest-200 claims
- Recency trends
- Posting-frequency effects
- Engagement-per-day
- Performance velocity based on publish age
- Reach efficiency
- CTR
- Impression-based rates
- Demographic performance
- Image-vs-reel performance comparison
- Carousel-vs-reel comparison
- Chronological trend conclusions

## Gate A3 Safety Boundary

This gate does not score content ideas, rank future post ideas, generate the next 20 posts, declare a winning content formula, change recommendation-engine behavior, perform automated optimization, or deploy recommendation logic.
`;
}

export async function writeGateA3Reports(reconciliation, options = {}) {
  const reportPath = resolve(options.reportPath || DEFAULT_GATE_A3_PATHS.report);
  const reconciliationPath = resolve(options.reconciliationPath || DEFAULT_GATE_A3_PATHS.reconciliation);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderAnalysisReadinessReport(reconciliation), "utf8");
  await writeFile(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`, "utf8");
  return { reportPath, reconciliationPath };
}
