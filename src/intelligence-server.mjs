import {
  buildImportPreview,
  metricFields,
  sha256,
  TAXONOMY,
  validateClassificationPatch
} from "./intelligence-core.mjs";
import {
  COLLECTION_BATCH_STATUSES,
  normalizeObservedBatch,
  OBSERVED_DATASET_LABEL,
  observedQuality
} from "./facebook-collection-core.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SOURCE_SEEDS = Object.freeze([
  { source_id: "source_my_page", name: "My Facebook Page", facebook_id: "100044347487511", source_role: "audience", profile_url: "https://www.facebook.com/profile.php?id=100044347487511" },
  { source_id: "source_eunice_benchmark", name: "Eunice Benchmark Page", facebook_id: "100033687097155", source_role: "benchmark", profile_url: "https://www.facebook.com/profile.php?id=100033687097155" }
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function nullable(value) { return value === undefined ? null : value; }
function parseJsonValue(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

async function readJson(request, limit = 6 * 1024 * 1024) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw Object.assign(new Error("Request exceeds the allowed size."), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw Object.assign(new Error("Request exceeds the allowed size."), { status: 413 });
  try { return JSON.parse(text); } catch (_) { throw Object.assign(new Error("Request body is not valid JSON."), { status: 400 }); }
}

function assertWriteRequest(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) throw Object.assign(new Error("Cross-site writes are not allowed."), { status: 403 });
  if (request.headers.get("x-content-intelligence-request") !== "1") throw Object.assign(new Error("Missing same-origin request marker."), { status: 403 });
}

function effectiveClassification(latest, override, post) {
  const base = latest || {};
  const manual = override || {};
  const resolved = (field, fallback = null) => override ? nullable(manual[field]) : nullable(base[field] ?? fallback);
  return {
    topic: resolved("topic"),
    secondary_topic: resolved("secondary_topic"),
    hook: resolved("hook"),
    emotion: resolved("emotion"),
    content_format: resolved("content_format", post.content_format),
    visual: resolved("visual"),
    intent: resolved("intent"),
    classification_source: override ? "manual" : nullable(base.classification_source),
    confidence: nullable(manual.confidence ?? base.confidence),
    notes: nullable(manual.notes),
    updated_at: nullable(manual.updated_at ?? base.created_at)
  };
}

function matchesFilters(record, query) {
  const search = (query.search || "").trim().toLowerCase();
  if (search && ![record.caption, record.title_or_hook, record.external_post_id, record.post_url].some((value) => String(value || "").toLowerCase().includes(search))) return false;
  if (query.source_id && record.source_id !== query.source_id) return false;
  if (query.role && record.source_role !== query.role) return false;
  if (query.topic && record.classification.topic !== query.topic) return false;
  if (query.format && record.classification.content_format !== query.format) return false;
  if (query.classification_status === "classified" && !record.classification.classification_source) return false;
  if (query.classification_status === "unclassified" && record.classification.classification_source) return false;
  const published = record.published_at ? record.published_at.slice(0, 10) : null;
  if (query.date_from && (!published || published < query.date_from)) return false;
  if (query.date_to && (!published || published > query.date_to)) return false;
  return true;
}

function sortPosts(records, sort) {
  const metricKey = { reactions: "reaction_count", comments: "comment_count", shares: "share_count", views: "view_count" }[sort];
  return [...records].sort((a, b) => {
    if (metricKey) return (b.latest_metrics?.[metricKey] ?? -1) - (a.latest_metrics?.[metricKey] ?? -1) || String(b.published_at || "").localeCompare(String(a.published_at || ""));
    const direction = sort === "oldest" ? 1 : -1;
    return direction * String(a.published_at || "").localeCompare(String(b.published_at || ""));
  });
}

const OBSERVED_POST_FIELDS = Object.freeze([
  "external_post_id", "post_url", "published_at", "post_type", "caption", "title_or_hook", "language", "content_format", "image_count", "video_duration", "media_reference",
  "discovery_order", "discovered_at", "visible_relative_age", "published_at_confidence", "caption_expanded", "caption_capture_status", "caption_missing", "caption_fingerprint",
  "identity_verified", "caption_verified", "metrics_verified", "media_verified", "verification_status"
]);
const COLLECTION_TERMINAL_STATUSES = new Set(COLLECTION_BATCH_STATUSES.filter((status) => status !== "RUNNING"));

function validateObservedInput(input) {
  if (!input || typeof input !== "object") throw Object.assign(new Error("Observed collection input must be an object."), { status: 400 });
  if (!Array.isArray(input.candidates)) throw Object.assign(new Error("Observed collection candidates must be an array."), { status: 400 });
  if (input.candidates.length > 25) throw Object.assign(new Error("Observed collection batches are limited to 25 candidates."), { status: 400 });
  return input;
}

export class MemoryIntelligenceStore {
  constructor() {
    const timestamp = now();
    this.sources = SOURCE_SEEDS.map((source) => ({ ...source, created_at: timestamp, updated_at: timestamp }));
    this.imports = [];
    this.raws = [];
    this.posts = [];
    this.metrics = [];
    this.classifications = [];
    this.overrides = [];
    this.collections = [];
    this.observations = [];
    this.media = [];
  }

  async listSources() { return structuredClone(this.sources); }
  async getSource(sourceId) { return this.sources.find((source) => source.source_id === sourceId) || null; }
  async findDuplicateImport(sourceId, sourceHash) { return this.imports.find((batch) => batch.source_id === sourceId && batch.source_hash === sourceHash && batch.status !== "FAILED") || null; }
  async createBatch(batch) { this.imports.push(structuredClone(batch)); return batch; }
  async updateBatch(batchId, patch) { Object.assign(this.imports.find((item) => item.import_batch_id === batchId), structuredClone(patch), { updated_at: now() }); }
  async insertRaw(raw) { this.raws.push(structuredClone(raw)); }

  async upsertPost(sourceId, incoming, timestamp) {
    let post = this.posts.find((item) => item.source_id === sourceId && item.canonical_identity === incoming.canonical_identity);
    if (!post) {
      post = { post_id: id("post"), source_id: sourceId, ...structuredClone(incoming), created_at: timestamp, updated_at: timestamp };
      this.posts.push(post);
      return { post, created: true, updated: false };
    }
    const fields = OBSERVED_POST_FIELDS;
    const changed = fields.some((field) => incoming[field] !== null && incoming[field] !== undefined && incoming[field] !== post[field]);
    for (const [key, value] of Object.entries(incoming)) if (value !== null && value !== undefined) post[key] = value;
    post.updated_at = timestamp;
    return { post, created: false, updated: changed };
  }

  async insertMetric(metric) {
    const exists = this.metrics.some((item) => item.post_id === metric.post_id && item.captured_at === metric.captured_at && item.metric_hash === metric.metric_hash);
    if (exists) return false;
    this.metrics.push(structuredClone(metric));
    return true;
  }

  async listImports() { return structuredClone([...this.imports].sort((a, b) => b.imported_at.localeCompare(a.imported_at))); }

  records() {
    return this.posts.map((post) => {
      const source = this.sources.find((item) => item.source_id === post.source_id);
      const latestMetrics = this.metrics.filter((item) => item.post_id === post.post_id).sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0] || null;
      const latestClassification = this.classifications.filter((item) => item.post_id === post.post_id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
      const override = this.overrides.find((item) => item.post_id === post.post_id) || null;
      return { ...structuredClone(post), source_name: source?.name, source_role: source?.source_role, latest_metrics: structuredClone(latestMetrics), classification: effectiveClassification(latestClassification, override, post) };
    });
  }

  async listPosts(query = {}) {
    const filtered = sortPosts(this.records().filter((record) => matchesFilters(record, query)), query.sort || "newest");
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return { posts: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
  }

  async getPost(postId) {
    const post = this.records().find((item) => item.post_id === postId);
    if (!post) return null;
    return { ...post, metric_snapshots: structuredClone(this.metrics.filter((item) => item.post_id === postId).sort((a, b) => b.captured_at.localeCompare(a.captured_at))), raw_records: structuredClone(this.raws.filter((item) => item.canonical_post_id === postId).sort((a, b) => b.imported_at.localeCompare(a.imported_at))), collection_raw_records: structuredClone(this.observations.filter((item) => item.canonical_post_id === postId)), media_references: structuredClone(this.media.filter((item) => item.post_id === postId).sort((a, b) => a.ordinal - b.ordinal)) };
  }

  async saveClassification(postId, value) {
    if (!this.posts.some((post) => post.post_id === postId)) return null;
    const timestamp = now();
    const override = { post_id: postId, ...structuredClone(value), updated_at: timestamp };
    this.overrides = this.overrides.filter((item) => item.post_id !== postId);
    this.overrides.push(override);
    this.classifications.push({ classification_id: id("class"), post_id: postId, ...structuredClone(value), classification_source: "manual", model: null, prompt_version: null, created_at: timestamp });
    return this.getPost(postId);
  }

  async dataQuality() {
    const rows = this.records();
    const metricNames = metricFields();
    const coverage = Object.fromEntries(metricNames.map((field) => [field, rows.length ? Math.round(rows.filter((row) => row.latest_metrics?.[field] !== null && row.latest_metrics?.[field] !== undefined).length / rows.length * 1000) / 10 : 0]));
    return { total_posts: rows.length, sources: this.sources.map((source) => ({ source_id: source.source_id, name: source.name, source_role: source.source_role, posts: rows.filter((row) => row.source_id === source.source_id).length })), metric_coverage: coverage, imports: this.imports.length };
  }

  async createCollection(batch) { this.collections.push(structuredClone(batch)); return batch; }
  async getCollection(collectionBatchId) { return this.collections.find((item) => item.collection_batch_id === collectionBatchId) || null; }
  async updateCollection(collectionBatchId, patch) { const batch = await this.getCollection(collectionBatchId); if (batch) Object.assign(batch, structuredClone(patch), { updated_at: now() }); }
  async listCollections(sourceId = null) { return structuredClone(this.collections.filter((item) => !sourceId || item.source_id === sourceId).sort((a, b) => b.started_at.localeCompare(a.started_at))); }
  async insertCollectionRaw(observation) {
    const duplicate = observation.observation_hash && this.observations.some((item) => item.collection_batch_id === observation.collection_batch_id && item.observation_hash === observation.observation_hash);
    if (duplicate) return false;
    this.observations.push(structuredClone(observation));
    return true;
  }
  async upsertMedia(postId, sourceId, media, timestamp) {
    for (const item of media) {
      const existing = this.media.find((row) => row.post_id === postId && row.ordinal === item.ordinal);
      const record = { post_media_reference_id: existing?.post_media_reference_id || id("media"), post_id: postId, source_id: sourceId, ...structuredClone(item), created_at: existing?.created_at || timestamp, updated_at: timestamp };
      if (existing) Object.assign(existing, record); else this.media.push(record);
    }
  }
  async collectionRecords(sourceId) {
    return this.records()
      .filter((record) => record.source_id === sourceId && record.discovered_at)
      .map((record) => ({ ...record, media_references: structuredClone(this.media.filter((item) => item.post_id === record.post_id).sort((a, b) => a.ordinal - b.ordinal)) }));
  }
}

export class D1IntelligenceStore {
  constructor(db) { this.db = db; }
  async all(sql, ...values) { return (await this.db.prepare(sql).bind(...values).all()).results || []; }
  async one(sql, ...values) { return await this.db.prepare(sql).bind(...values).first(); }
  async run(sql, ...values) { return await this.db.prepare(sql).bind(...values).run(); }
  async listSources() { return this.all("SELECT * FROM facebook_sources ORDER BY source_role, name"); }
  async getSource(sourceId) { return this.one("SELECT * FROM facebook_sources WHERE source_id = ?", sourceId); }
  async findDuplicateImport(sourceId, sourceHash) { return this.one("SELECT * FROM import_batches WHERE source_id = ? AND source_hash = ? AND status <> 'FAILED' ORDER BY imported_at DESC LIMIT 1", sourceId, sourceHash); }
  async createBatch(batch) {
    await this.run(`INSERT INTO import_batches (import_batch_id,source_id,source_type,source_file,source_hash,imported_at,captured_at,row_count,parser_version,warnings_json,metric_scope,status,posts_imported,posts_updated,metric_snapshots_created,duplicates_skipped,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, batch.import_batch_id, batch.source_id, batch.source_type, batch.source_file, batch.source_hash, batch.imported_at, batch.captured_at, batch.row_count, batch.parser_version, batch.warnings_json, batch.metric_scope, batch.status, 0, 0, 0, 0, batch.created_at, batch.updated_at);
    return batch;
  }
  async updateBatch(batchId, patch) {
    const allowed = ["status", "warnings_json", "posts_imported", "posts_updated", "metric_snapshots_created", "duplicates_skipped", "error_message"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!entries.length) return;
    await this.run(`UPDATE import_batches SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE import_batch_id = ?`, ...entries.map(([, value]) => value), now(), batchId);
  }
  async insertRaw(raw) {
    await this.run(`INSERT INTO raw_post_records (raw_record_id,import_batch_id,source_id,canonical_post_id,row_number,original_json,validation_status,validation_warnings_json,imported_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, raw.raw_record_id, raw.import_batch_id, raw.source_id, raw.canonical_post_id, raw.row_number, raw.original_json, raw.validation_status, raw.validation_warnings_json, raw.imported_at, raw.created_at);
  }
  async upsertPost(sourceId, incoming, timestamp) {
    let post = await this.one("SELECT * FROM posts WHERE source_id = ? AND canonical_identity = ?", sourceId, incoming.canonical_identity);
    if (!post) {
      const postId = id("post");
      const columns = ["post_id", "source_id", "canonical_identity", ...OBSERVED_POST_FIELDS, "created_at", "updated_at"];
      await this.run(
        `INSERT INTO posts (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        postId, sourceId, incoming.canonical_identity, ...OBSERVED_POST_FIELDS.map((field) => incoming[field]), timestamp, timestamp
      );
      post = await this.one("SELECT * FROM posts WHERE post_id = ?", postId);
      return { post, created: true, updated: false };
    }
    const fields = OBSERVED_POST_FIELDS;
    const changed = fields.some((field) => incoming[field] !== null && incoming[field] !== undefined && incoming[field] !== post[field]);
    await this.run(`UPDATE posts SET ${fields.map((field) => `${field} = COALESCE(?, ${field})`).join(", ")}, updated_at = ? WHERE post_id = ?`, ...fields.map((field) => incoming[field]), timestamp, post.post_id);
    post = await this.one("SELECT * FROM posts WHERE post_id = ?", post.post_id);
    return { post, created: false, updated: changed };
  }
  async insertMetric(metric) {
    const duplicate = await this.one("SELECT metric_snapshot_id FROM post_metric_snapshots WHERE post_id = ? AND captured_at = ? AND metric_hash = ?", metric.post_id, metric.captured_at, metric.metric_hash);
    if (duplicate) return false;
    await this.run(`INSERT INTO post_metric_snapshots (metric_snapshot_id,post_id,import_batch_id,captured_at,reaction_count,like_count,comment_count,share_count,view_count,reach_count,click_count,metric_scope,source_method,metric_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, metric.metric_snapshot_id, metric.post_id, metric.import_batch_id, metric.captured_at, metric.reaction_count, metric.like_count, metric.comment_count, metric.share_count, metric.view_count, metric.reach_count, metric.click_count, metric.metric_scope, metric.source_method, metric.metric_hash, metric.created_at);
    return true;
  }
  async listImports() { return this.all("SELECT * FROM import_batches ORDER BY imported_at DESC LIMIT 100"); }
  async records() {
    const [posts, sources, metrics, classes, overrides] = await Promise.all([
      this.all("SELECT * FROM posts"), this.listSources(), this.all("SELECT * FROM post_metric_snapshots ORDER BY captured_at DESC"), this.all("SELECT * FROM post_classifications ORDER BY created_at DESC"), this.all("SELECT * FROM classification_overrides")
    ]);
    return posts.map((post) => {
      const source = sources.find((item) => item.source_id === post.source_id);
      const latest = metrics.find((item) => item.post_id === post.post_id) || null;
      const classification = classes.find((item) => item.post_id === post.post_id) || null;
      const override = overrides.find((item) => item.post_id === post.post_id) || null;
      return { ...post, source_name: source?.name, source_role: source?.source_role, latest_metrics: latest, classification: effectiveClassification(classification, override, post) };
    });
  }
  async listPosts(query = {}) {
    const filtered = sortPosts((await this.records()).filter((record) => matchesFilters(record, query)), query.sort || "newest");
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return { posts: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
  }
  async getPost(postId) {
    const post = (await this.records()).find((item) => item.post_id === postId);
    if (!post) return null;
    const [snapshots, raws, observations, media] = await Promise.all([this.all("SELECT * FROM post_metric_snapshots WHERE post_id = ? ORDER BY captured_at DESC", postId), this.all("SELECT * FROM raw_post_records WHERE canonical_post_id = ? ORDER BY imported_at DESC", postId), this.all("SELECT * FROM collection_raw_observations WHERE canonical_post_id = ? ORDER BY observed_at DESC", postId), this.all("SELECT * FROM post_media_references WHERE post_id = ? ORDER BY ordinal", postId)]);
    return { ...post, metric_snapshots: snapshots, raw_records: raws, collection_raw_records: observations, media_references: media };
  }
  async saveClassification(postId, value) {
    if (!await this.one("SELECT post_id FROM posts WHERE post_id = ?", postId)) return null;
    const timestamp = now();
    const fields = ["topic", "secondary_topic", "hook", "emotion", "content_format", "visual", "intent", "confidence", "notes"];
    await this.run(`INSERT INTO classification_overrides (post_id,${fields.join(",")},updated_at) VALUES (${["?", ...fields.map(() => "?"), "?"].join(",")}) ON CONFLICT(post_id) DO UPDATE SET ${fields.map((field) => `${field}=excluded.${field}`).join(",")}, updated_at=excluded.updated_at`, postId, ...fields.map((field) => value[field]), timestamp);
    await this.run(`INSERT INTO post_classifications (classification_id,post_id,topic,secondary_topic,hook,emotion,content_format,visual,intent,classification_source,model,prompt_version,confidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,'manual',NULL,NULL,?,?)`, id("class"), postId, value.topic, value.secondary_topic, value.hook, value.emotion, value.content_format, value.visual, value.intent, value.confidence, timestamp);
    return this.getPost(postId);
  }
  async dataQuality() {
    const rows = await this.records();
    const sources = await this.listSources();
    const coverage = Object.fromEntries(metricFields().map((field) => [field, rows.length ? Math.round(rows.filter((row) => row.latest_metrics?.[field] !== null && row.latest_metrics?.[field] !== undefined).length / rows.length * 1000) / 10 : 0]));
    return { total_posts: rows.length, sources: sources.map((source) => ({ source_id: source.source_id, name: source.name, source_role: source.source_role, posts: rows.filter((row) => row.source_id === source.source_id).length })), metric_coverage: coverage, imports: Number((await this.one("SELECT COUNT(*) AS count FROM import_batches"))?.count || 0) };
  }

  async createCollection(batch) {
    const existing = await this.getCollection(batch.collection_batch_id);
    if (existing) return existing;
    await this.run(`INSERT INTO collection_batches (collection_batch_id,source_id,dataset_label,target_posts,started_at,completed_at,status,new_posts,duplicate_posts,failed_posts,verification_failures,caption_failures,media_failures,warnings_json,sample_type,media_scope,chronology_status,source_checkpoint,direct_verification_files_json,limitations_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, batch.collection_batch_id, batch.source_id, batch.dataset_label, batch.target_posts, batch.started_at, null, batch.status, 0, 0, 0, 0, 0, 0, "[]", batch.sample_type, batch.media_scope, batch.chronology_status, batch.source_checkpoint, batch.direct_verification_files_json, batch.limitations_json, batch.created_at, batch.updated_at);
    return batch;
  }
  async getCollection(collectionBatchId) { return this.one("SELECT * FROM collection_batches WHERE collection_batch_id = ?", collectionBatchId); }
  async updateCollection(collectionBatchId, patch) {
    const allowed = ["completed_at", "status", "new_posts", "duplicate_posts", "failed_posts", "verification_failures", "caption_failures", "media_failures", "warnings_json"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (entries.length) await this.run(`UPDATE collection_batches SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE collection_batch_id = ?`, ...entries.map(([, value]) => value), now(), collectionBatchId);
  }
  async listCollections(sourceId = null) { return sourceId ? this.all("SELECT * FROM collection_batches WHERE source_id = ? ORDER BY started_at DESC", sourceId) : this.all("SELECT * FROM collection_batches ORDER BY started_at DESC"); }
  async insertCollectionRaw(observation) {
    if (observation.observation_hash) {
      const duplicate = await this.one("SELECT observation_id FROM collection_raw_observations WHERE collection_batch_id = ? AND observation_hash = ?", observation.collection_batch_id, observation.observation_hash);
      if (duplicate) return false;
    }
    await this.run(`INSERT INTO collection_raw_observations (observation_id,collection_batch_id,source_id,canonical_post_id,discovery_order,observed_at,original_json,validation_status,validation_warnings_json,observation_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, observation.observation_id, observation.collection_batch_id, observation.source_id, observation.canonical_post_id, observation.discovery_order, observation.observed_at, observation.original_json, observation.validation_status, observation.validation_warnings_json, observation.observation_hash, observation.created_at);
    return true;
  }
  async upsertMedia(postId, sourceId, media, timestamp) {
    for (const item of media) await this.run(`INSERT INTO post_media_references (post_media_reference_id,post_id,source_id,provider_media_id,media_url,media_type,ordinal,alt_description,thumbnail_url,duration_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(post_id,ordinal) DO UPDATE SET provider_media_id=excluded.provider_media_id,media_url=excluded.media_url,media_type=excluded.media_type,alt_description=excluded.alt_description,thumbnail_url=excluded.thumbnail_url,duration_seconds=excluded.duration_seconds,updated_at=excluded.updated_at`, id("media"), postId, sourceId, item.provider_media_id, item.media_url, item.media_type, item.ordinal, item.alt_description, item.thumbnail_url, item.duration_seconds, timestamp, timestamp);
  }
  async collectionRecords(sourceId) {
    const [records, media] = await Promise.all([
      this.records(),
      this.all("SELECT * FROM post_media_references ORDER BY ordinal")
    ]);
    return records
      .filter((record) => record.source_id === sourceId && record.discovered_at)
      .map((record) => ({ ...record, media_references: media.filter((item) => item.post_id === record.post_id) }));
  }
}

async function confirmImport(store, input) {
  const source = await store.getSource(input.source_id);
  if (!source) throw Object.assign(new Error("Selected Facebook source does not exist."), { status: 400 });
  const preliminary = await buildImportPreview(input);
  if (input.preview_hash !== preliminary.preview_hash) throw Object.assign(new Error("Import preview is stale. Preview the file again before confirming."), { status: 409 });
  if (preliminary.fatal_errors.length) throw Object.assign(new Error(preliminary.fatal_errors.join(" ")), { status: 400 });
  const duplicate = await store.findDuplicateImport(input.source_id, preliminary.source_hash);
  if (duplicate && !input.allow_reprocess) throw Object.assign(new Error("This source file was imported before. Explicitly allow reprocessing to continue."), { status: 409, duplicate });
  const timestamp = now();
  const capturedAt = input.captured_at ? new Date(input.captured_at) : new Date();
  if (Number.isNaN(capturedAt.getTime())) throw Object.assign(new Error("captured_at is invalid."), { status: 400 });
  const batch = {
    import_batch_id: id("batch"), source_id: source.source_id, source_type: preliminary.file_type,
    source_file: String(input.file_name).slice(0, 255), source_hash: preliminary.source_hash,
    imported_at: timestamp, captured_at: capturedAt.toISOString(), row_count: preliminary.quality.total_rows,
    parser_version: preliminary.parser_version, warnings_json: JSON.stringify(preliminary.warnings),
    metric_scope: String(input.metric_scope || "public").slice(0, 64), status: "VALIDATED", created_at: timestamp, updated_at: timestamp
  };
  await store.createBatch(batch);
  const counts = { posts_imported: 0, posts_updated: 0, metric_snapshots_created: 0, duplicates_skipped: 0, warnings: preliminary.quality.warnings };
  try {
    for (const row of preliminary.normalized_rows) {
      let postId = null;
      if (row.valid) {
        const result = await store.upsertPost(source.source_id, row.post, timestamp);
        postId = result.post.post_id;
        if (result.created) counts.posts_imported += 1;
        else if (result.updated) counts.posts_updated += 1;
        else counts.duplicates_skipped += 1;
        const metricHash = await sha256(JSON.stringify(row.metrics));
        const metric = { metric_snapshot_id: id("metric"), post_id: postId, import_batch_id: batch.import_batch_id, captured_at: batch.captured_at, ...row.metrics, metric_scope: batch.metric_scope, source_method: preliminary.file_type, metric_hash: metricHash, created_at: timestamp };
        if (await store.insertMetric(metric)) counts.metric_snapshots_created += 1;
      }
      await store.insertRaw({ raw_record_id: id("raw"), import_batch_id: batch.import_batch_id, source_id: source.source_id, canonical_post_id: postId, row_number: row.rowNumber, original_json: JSON.stringify(row.raw), validation_status: row.valid ? (row.warnings.length ? "WARNING" : "VALID") : "INVALID", validation_warnings_json: JSON.stringify(row.warnings), imported_at: timestamp, created_at: timestamp });
    }
    const status = preliminary.quality.valid_posts === preliminary.quality.total_rows ? "IMPORTED" : "PARTIAL";
    await store.updateBatch(batch.import_batch_id, { status, warnings_json: JSON.stringify(preliminary.warnings), ...counts });
    return { import_batch_id: batch.import_batch_id, status, ...counts };
  } catch (error) {
    await store.updateBatch(batch.import_batch_id, { status: "FAILED", error_message: String(error.message || error).slice(0, 1000), ...counts });
    throw error;
  }
}

async function startObservedCollection(store, input) {
  const source = await store.getSource(input.source_id);
  if (!source) throw Object.assign(new Error("Selected Facebook source does not exist."), { status: 400 });
  const timestamp = now();
  const targetPosts = Math.min(Math.max(Number(input.target_posts) || 200, 1), 200);
  const batch = {
    collection_batch_id: String(input.collection_batch_id || id("collection")).slice(0, 128), source_id: source.source_id,
    dataset_label: String(input.dataset_label || OBSERVED_DATASET_LABEL).slice(0, 255), target_posts: targetPosts,
    started_at: timestamp, status: "RUNNING",
    sample_type: input.sample_type ? String(input.sample_type).slice(0, 64) : null,
    media_scope: input.media_scope ? String(input.media_scope).slice(0, 64) : null,
    chronology_status: input.chronology_status ? String(input.chronology_status).slice(0, 64) : null,
    source_checkpoint: input.source_checkpoint ? String(input.source_checkpoint).slice(0, 2000) : null,
    direct_verification_files_json: input.direct_verification_files_json ? JSON.stringify(input.direct_verification_files_json) : null,
    limitations_json: input.limitations_json ? JSON.stringify(input.limitations_json) : null,
    created_at: timestamp, updated_at: timestamp
  };
  await store.createCollection(batch);
  return await store.getCollection(batch.collection_batch_id) || batch;
}

async function storeObservedCandidates(store, collectionBatchId, input) {
  validateObservedInput(input);
  const batch = await store.getCollection(collectionBatchId);
  if (!batch) throw Object.assign(new Error("Observed collection batch was not found."), { status: 404 });
  if (batch.status !== "RUNNING") throw Object.assign(new Error("Observed collection batch is not accepting records."), { status: 409 });
  const source = await store.getSource(batch.source_id);
  const normalized = await normalizeObservedBatch(input.candidates);
  const timestamp = now();
  const counts = { new_posts: 0, duplicate_posts: normalized.duplicates, failed_posts: 0, verification_failures: 0, caption_failures: 0, media_failures: 0, metric_snapshots_created: 0 };
  const warnings = [];
  for (const item of normalized.duplicate_records) {
    const candidate = item.candidate;
    await store.insertCollectionRaw({
      observation_id: id("observation"), collection_batch_id: batch.collection_batch_id, source_id: source.source_id,
      canonical_post_id: null, discovery_order: candidate.discovery_order, observed_at: timestamp,
      original_json: JSON.stringify(candidate.raw), validation_status: "DUPLICATE",
      validation_warnings_json: JSON.stringify(["Duplicate canonical Facebook post identity; raw observation preserved and canonical post was not duplicated."]),
      observation_hash: await sha256(JSON.stringify(candidate.raw)),
      created_at: timestamp
    });
  }
  for (const item of normalized.records) {
    const candidate = item.candidate;
    let postId = null;
    let duplicateCanonical = false;
    if (item.valid) {
      const result = await store.upsertPost(source.source_id, candidate, timestamp);
      postId = result.post.post_id;
      if (result.created) counts.new_posts += 1;
      else {
        duplicateCanonical = true;
        counts.duplicate_posts += 1;
      }
      if (!candidate.identity_verified || !candidate.caption_verified || !candidate.metrics_verified || !candidate.media_verified) counts.verification_failures += 1;
      if (["failed", "collapsed"].includes(candidate.caption_capture_status)) counts.caption_failures += 1;
      if (!candidate.media.length) counts.media_failures += 1;
      await store.upsertMedia(postId, source.source_id, candidate.media, timestamp);
      const metricHash = await sha256(JSON.stringify(candidate.metrics));
      const snapshot = { metric_snapshot_id: id("metric"), post_id: postId, import_batch_id: null, captured_at: candidate.metrics_captured_at || candidate.discovered_at || timestamp, ...candidate.metrics, metric_scope: candidate.metric_scope || "public", source_method: candidate.metric_source_method || "authenticated_browser", metric_hash: metricHash, created_at: timestamp };
      if (await store.insertMetric(snapshot)) counts.metric_snapshots_created += 1;
    } else counts.failed_posts += 1;
    warnings.push(...item.warnings);
    await store.insertCollectionRaw({ observation_id: id("observation"), collection_batch_id: batch.collection_batch_id, source_id: source.source_id, canonical_post_id: postId, discovery_order: candidate.discovery_order, observed_at: timestamp, original_json: JSON.stringify(candidate.raw), validation_status: duplicateCanonical ? "DUPLICATE" : (item.valid ? (item.warnings.length ? "WARNING" : "VALID") : "INVALID"), validation_warnings_json: JSON.stringify(item.warnings), observation_hash: await sha256(JSON.stringify(candidate.raw)), created_at: timestamp });
  }
  const combined = {
    new_posts: Number(batch.new_posts || 0) + counts.new_posts,
    duplicate_posts: Number(batch.duplicate_posts || 0) + counts.duplicate_posts,
    failed_posts: Number(batch.failed_posts || 0) + counts.failed_posts,
    verification_failures: Number(batch.verification_failures || 0) + counts.verification_failures,
    caption_failures: Number(batch.caption_failures || 0) + counts.caption_failures,
    media_failures: Number(batch.media_failures || 0) + counts.media_failures,
    warnings_json: JSON.stringify([...(parseJsonValue(batch.warnings_json, [])), ...warnings].slice(-200))
  };
  await store.updateCollection(batch.collection_batch_id, combined);
  return { collection_batch_id: batch.collection_batch_id, ...counts, total_unique_observed: (await store.collectionRecords(batch.source_id)).length, warnings };
}

async function completeObservedCollection(store, collectionBatchId, input) {
  const batch = await store.getCollection(collectionBatchId);
  if (!batch) throw Object.assign(new Error("Observed collection batch was not found."), { status: 404 });
  const records = await store.collectionRecords(batch.source_id);
  const requested = COLLECTION_TERMINAL_STATUSES.has(input.status) ? input.status : "PARTIAL";
  const status = requested === "COMPLETED" && records.length < Number(batch.target_posts || 0) ? "PARTIAL" : requested;
  await store.updateCollection(collectionBatchId, { status, completed_at: now() });
  const quality = observedQuality(records);
  return { ...(await store.getCollection(collectionBatchId)), quality };
}

export async function handleIntelligenceApi(request, env, url, injectedStore = null) {
  const store = injectedStore || (env?.DB ? new D1IntelligenceStore(env.DB) : null);
  if (!store) return json({ ok: false, error: "Content Intelligence database is not configured." }, 503);
  try {
    if (request.method === "GET" && url.pathname === "/api/intelligence/sources") return json({ ok: true, sources: await store.listSources(), taxonomy: TAXONOMY });
    if (request.method === "POST" && url.pathname === "/api/intelligence/import/preview") {
      assertWriteRequest(request);
      const input = await readJson(request);
      if (!await store.getSource(input.source_id)) return json({ ok: false, error: "Selected Facebook source does not exist." }, 400);
      const sourceHash = await sha256(String(input.content || ""));
      const duplicate = await store.findDuplicateImport(input.source_id, sourceHash);
      const preview = await buildImportPreview(input, duplicate);
      const { normalized_rows, ...safePreview } = preview;
      return json({ ok: true, preview: safePreview });
    }
    if (request.method === "POST" && url.pathname === "/api/intelligence/import/confirm") {
      assertWriteRequest(request);
      return json({ ok: true, result: await confirmImport(store, await readJson(request)) });
    }
    if (request.method === "GET" && url.pathname === "/api/intelligence/imports") return json({ ok: true, imports: await store.listImports() });
    if (request.method === "POST" && url.pathname === "/api/intelligence/collections") {
      assertWriteRequest(request);
      return json({ ok: true, collection: await startObservedCollection(store, await readJson(request, 128 * 1024)) }, 201);
    }
    if (request.method === "GET" && url.pathname === "/api/intelligence/collections") return json({ ok: true, collections: await store.listCollections(url.searchParams.get("source_id")) });
    if (request.method === "GET" && url.pathname === "/api/intelligence/collection-quality") {
      const sourceId = url.searchParams.get("source_id");
      if (!sourceId) return json({ ok: false, error: "source_id is required." }, 400);
      return json({ ok: true, quality: observedQuality(await store.collectionRecords(sourceId)) });
    }
    const collectionRecordMatch = url.pathname.match(/^\/api\/intelligence\/collections\/([^/]+)\/records$/);
    if (request.method === "POST" && collectionRecordMatch) {
      assertWriteRequest(request);
      return json({ ok: true, result: await storeObservedCandidates(store, decodeURIComponent(collectionRecordMatch[1]), await readJson(request, 2 * 1024 * 1024)) });
    }
    const collectionCompleteMatch = url.pathname.match(/^\/api\/intelligence\/collections\/([^/]+)\/complete$/);
    if (request.method === "POST" && collectionCompleteMatch) {
      assertWriteRequest(request);
      return json({ ok: true, collection: await completeObservedCollection(store, decodeURIComponent(collectionCompleteMatch[1]), await readJson(request, 64 * 1024)) });
    }
    if (request.method === "GET" && url.pathname === "/api/intelligence/posts") return json({ ok: true, ...(await store.listPosts(Object.fromEntries(url.searchParams))) });
    if (request.method === "GET" && url.pathname === "/api/intelligence/data-quality") return json({ ok: true, quality: await store.dataQuality() });
    const postMatch = url.pathname.match(/^\/api\/intelligence\/posts\/([^/]+)$/);
    if (request.method === "GET" && postMatch) {
      const post = await store.getPost(decodeURIComponent(postMatch[1]));
      return post ? json({ ok: true, post }) : json({ ok: false, error: "Post not found." }, 404);
    }
    const classificationMatch = url.pathname.match(/^\/api\/intelligence\/posts\/([^/]+)\/classification$/);
    if (request.method === "PATCH" && classificationMatch) {
      assertWriteRequest(request);
      const validated = validateClassificationPatch(await readJson(request, 64 * 1024));
      if (validated.errors.length) return json({ ok: false, error: validated.errors.join(" ") }, 400);
      const post = await store.saveClassification(decodeURIComponent(classificationMatch[1]), validated.value);
      return post ? json({ ok: true, post }) : json({ ok: false, error: "Post not found." }, 404);
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message || "Unexpected Content Intelligence error.", duplicate: error.duplicate || undefined }, error.status || 500);
  }
}
