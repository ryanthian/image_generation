export const PARSER_VERSION = "content-intelligence-import-v1";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export const TAXONOMY = Object.freeze({
  topic: ["food", "recipe", "family", "daily_life", "sarawak_local", "nostalgia", "humor", "relationship", "parenting", "home", "health_wellness", "money", "motivation", "festival", "travel", "product", "story", "question", "useful_tips", "other"],
  hook: ["question", "curiosity", "statement", "warning", "surprise", "relatable", "emotional", "nostalgia", "useful_tip", "controversy_discussion", "story_opening", "problem_solution", "list", "other"],
  emotion: ["warm", "funny", "nostalgic", "surprising", "curious", "appetizing", "helpful", "emotional", "inspirational", "relatable", "neutral"],
  content_format: ["single_image", "multi_image", "video", "reel", "text", "link", "mixed", "other"],
  visual: ["realistic_food", "realistic_lifestyle", "people", "family", "product", "landscape", "graphic", "screenshot", "ai_realistic", "illustration", "other"],
  intent: ["engagement", "entertainment", "education", "information", "storytelling", "monetization", "affiliate", "community_discussion", "other"]
});

export const CLASSIFICATION_FIELDS = Object.freeze([
  "topic", "secondary_topic", "hook", "emotion", "content_format", "visual", "intent"
]);

export const IMPORT_FIELDS = Object.freeze([
  "external_post_id", "post_url", "published_at", "post_type", "caption", "title_or_hook",
  "language", "content_format", "image_count", "video_duration", "media_reference",
  "reaction_count", "like_count", "comment_count", "share_count", "view_count",
  "reach_count", "click_count"
]);

const FIELD_ALIASES = Object.freeze({
  external_post_id: ["post_id", "post id", "id", "facebook post id", "facebook_post_id", "postid"],
  post_url: ["post_url", "post url", "permalink", "permalink_url", "url", "facebook url"],
  published_at: ["published_at", "published", "created time", "created_time", "publish time", "publish_time", "date", "timestamp"],
  post_type: ["post_type", "post type", "type", "media type"],
  caption: ["caption", "message", "post message", "post_message", "description", "text", "content", "body"],
  title_or_hook: ["title_or_hook", "title", "hook", "post title"],
  language: ["language", "locale"],
  content_format: ["content_format", "content format", "format"],
  image_count: ["image_count", "image count", "images", "photo count"],
  video_duration: ["video_duration", "video duration", "duration", "duration seconds"],
  media_reference: ["media_reference", "media reference", "media url", "image url", "thumbnail", "full_picture"],
  reaction_count: ["reaction_count", "reaction count", "reactions", "total reactions", "likes"],
  like_count: ["like_count", "like count", "likes", "total likes"],
  comment_count: ["comment_count", "comment count", "comments", "total comments"],
  share_count: ["share_count", "share count", "shares", "total shares"],
  view_count: ["view_count", "view count", "views", "video views", "video_views"],
  reach_count: ["reach_count", "reach count", "reach", "people reached"],
  click_count: ["click_count", "click count", "clicks", "post clicks", "post_clicks"]
});

const METRIC_FIELDS = Object.freeze([
  "reaction_count", "like_count", "comment_count", "share_count", "view_count", "reach_count", "click_count"
]);

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\u00a0/g, " ").trim();
  return cleaned || null;
}

function boundedText(value, field, maxLength, warnings) {
  const text = cleanText(value);
  if (text === null) return null;
  if (text.length <= maxLength) return text;
  warnings.push({ code: "FIELD_TOO_LONG", field, message: `${field} exceeds the ${maxLength}-character limit.` });
  return null;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const text = String(content || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"' && value === "") quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("Malformed CSV: an opening quote was not closed.");
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  const nonEmpty = rows.filter((values) => values.some((item) => String(item).trim()));
  if (nonEmpty.length < 2) throw new Error("CSV must contain a header row and at least one data row.");
  const headers = nonEmpty[0].map((header) => String(header).trim());
  if (headers.some((header) => !header)) throw new Error("CSV contains an empty header.");
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`CSV contains duplicate headers: ${[...new Set(duplicateHeaders)].join(", ")}.`);
  const records = nonEmpty.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { headers, records };
}

export function parseJson(content) {
  let parsed;
  try {
    parsed = JSON.parse(String(content || ""));
  } catch (error) {
    throw new Error(`Malformed JSON: ${error.message}`);
  }
  const records = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.data) ? parsed.data
      : Array.isArray(parsed?.posts) ? parsed.posts
        : null;
  if (!records) throw new Error("JSON must be an array, or an object containing a data or posts array.");
  if (!records.length) throw new Error("JSON does not contain any rows.");
  if (records.some((record) => !record || Array.isArray(record) || typeof record !== "object")) {
    throw new Error("Every JSON row must be an object.");
  }
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return { headers, records };
}

export function parseImportFile(fileName, content) {
  const normalizedName = String(fileName || "").toLowerCase();
  if (normalizedName.endsWith(".csv")) return { fileType: "csv", ...parseCsv(content) };
  if (normalizedName.endsWith(".json")) return { fileType: "json", ...parseJson(content) };
  throw new Error("Only .csv and .json files are supported.");
}

export function detectFieldMappings(headers) {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const mapping = {};
  const ambiguous = {};
  for (const field of IMPORT_FIELDS) {
    const canonical = normalizeHeader(field);
    const exact = normalizedHeaders.filter((item) => item.normalized === canonical);
    if (exact.length === 1) { mapping[field] = exact[0].header; continue; }
    if (exact.length > 1) { ambiguous[field] = exact.map((item) => item.header); mapping[field] = null; continue; }
    const aliases = new Set((FIELD_ALIASES[field] || []).map(normalizeHeader));
    const candidates = normalizedHeaders.filter((item) => aliases.has(item.normalized));
    if (candidates.length === 1) mapping[field] = candidates[0].header;
    else if (candidates.length > 1) { ambiguous[field] = candidates.map((item) => item.header); mapping[field] = null; }
    else mapping[field] = null;
  }
  const headerClaims = new Map();
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    const claims = headerClaims.get(header) || [];
    claims.push(field);
    headerClaims.set(header, claims);
  }
  for (const [header, fields] of headerClaims) {
    if (fields.length < 2) continue;
    for (const field of fields) {
      ambiguous[field] = [...new Set([...(ambiguous[field] || []), header])];
      mapping[field] = null;
    }
  }
  return { mapping, ambiguous };
}

export function validateMapping(headers, proposedMapping = {}) {
  const errors = [];
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, proposedMapping[field] || null]));
  const used = new Map();
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    if (!headers.includes(header)) errors.push(`Mapping for ${field} refers to an unknown column: ${header}.`);
    const claims = used.get(header) || [];
    claims.push(field);
    used.set(header, claims);
  }
  for (const [header, fields] of used) {
    if (fields.length > 1) errors.push(`Column ${header} is mapped to multiple fields: ${fields.join(", ")}.`);
  }
  if (!mapping.external_post_id && !mapping.post_url) {
    errors.push("Map either an external post ID or a post URL so posts can be deduplicated safely.");
  }
  return { mapping, errors };
}

function mappedValue(record, mapping, field) {
  const header = mapping[field];
  return header ? record[header] : null;
}

function parseNonNegativeNumber(value, field, warnings, integer = true) {
  const text = cleanText(value);
  if (text === null) return null;
  const compact = text.replace(/,/g, "").replace(/\s+/g, "");
  const match = compact.match(/^([0-9]+(?:\.[0-9]+)?)([kKmM万])?$/);
  if (!match) { warnings.push({ code: "INVALID_METRIC", field, message: `${field} is not a non-negative number.` }); return null; }
  const multiplier = /k/i.test(match[2] || "") ? 1000 : /m/i.test(match[2] || "") ? 1000000 : match[2] === "万" ? 10000 : 1;
  const result = Number(match[1]) * multiplier;
  if (!Number.isFinite(result) || result < 0) { warnings.push({ code: "INVALID_METRIC", field, message: `${field} is outside the supported range.` }); return null; }
  return integer ? Math.round(result) : result;
}

function parseDate(value, warnings) {
  const text = cleanText(value);
  if (text === null) return null;
  const supported = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!supported.test(text)) {
    warnings.push({ code: "INVALID_DATE", field: "published_at", message: "Publish date is not an ISO or YYYY-MM-DD value." });
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    warnings.push({ code: "INVALID_DATE", field: "published_at", message: "Publish date is invalid." });
    return null;
  }
  return date.toISOString();
}

function normalizeFormat(value) {
  const text = cleanText(value)?.toLowerCase().replace(/[\s/-]+/g, "_");
  if (!text) return null;
  const aliases = {
    photo: "single_image", image: "single_image", single_photo: "single_image",
    album: "multi_image", carousel: "multi_image", multiple_photos: "multi_image",
    videos: "video", reels: "reel", status: "text", shared_link: "link"
  };
  const normalized = aliases[text] || text;
  return TAXONOMY.content_format.includes(normalized) ? normalized : "other";
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("__") || ["ref", "refsrc", "mibextid"].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch (_) {
    return text;
  }
}

export async function normalizePostRow(record, mapping, rowNumber) {
  const warnings = [];
  const externalPostId = boundedText(mappedValue(record, mapping, "external_post_id"), "external_post_id", 512, warnings);
  const postUrlInput = boundedText(mappedValue(record, mapping, "post_url"), "post_url", 4096, warnings);
  const postUrl = normalizeUrl(postUrlInput);
  let canonicalIdentity = externalPostId ? `external:${externalPostId}` : null;
  if (!canonicalIdentity && postUrl) canonicalIdentity = `url:${await sha256(postUrl)}`;
  if (!canonicalIdentity) warnings.push({ code: "MISSING_IDENTITY", field: "external_post_id", message: "Post has neither an external post ID nor a post URL." });
  const metrics = {};
  for (const field of METRIC_FIELDS) metrics[field] = parseNonNegativeNumber(mappedValue(record, mapping, field), field, warnings);
  const imageCount = parseNonNegativeNumber(mappedValue(record, mapping, "image_count"), "image_count", warnings);
  const videoDuration = parseNonNegativeNumber(mappedValue(record, mapping, "video_duration"), "video_duration", warnings, false);
  const caption = boundedText(mappedValue(record, mapping, "caption"), "caption", 100000, warnings);
  const publishedAt = parseDate(mappedValue(record, mapping, "published_at"), warnings);
  if (!publishedAt) warnings.push({ code: "MISSING_DATE", field: "published_at", message: "No usable publish date is available." });
  if (!caption) warnings.push({ code: "MISSING_CAPTION", field: "caption", message: "Caption is empty." });
  if (METRIC_FIELDS.every((field) => metrics[field] === null)) warnings.push({ code: "MISSING_METRICS", field: "metrics", message: "No interaction or reach metrics are available." });
  return {
    rowNumber,
    raw: record,
    valid: Boolean(canonicalIdentity),
    warnings,
    post: {
      canonical_identity: canonicalIdentity,
      external_post_id: externalPostId,
      post_url: postUrl,
      published_at: publishedAt,
      post_type: boundedText(mappedValue(record, mapping, "post_type"), "post_type", 128, warnings),
      caption,
      title_or_hook: boundedText(mappedValue(record, mapping, "title_or_hook"), "title_or_hook", 2000, warnings),
      language: boundedText(mappedValue(record, mapping, "language"), "language", 64, warnings),
      content_format: normalizeFormat(mappedValue(record, mapping, "content_format") || mappedValue(record, mapping, "post_type")),
      image_count: imageCount,
      video_duration: videoDuration,
      media_reference: boundedText(mappedValue(record, mapping, "media_reference"), "media_reference", 4096, warnings)
    },
    metrics
  };
}

export function summarizeQuality(normalizedRows) {
  const count = (predicate) => normalizedRows.filter(predicate).length;
  const total = normalizedRows.length;
  const identities = normalizedRows.map((row) => row.post.canonical_identity).filter(Boolean);
  const duplicateIdentities = identities.length - new Set(identities).size;
  const coverage = Object.fromEntries(METRIC_FIELDS.map((field) => [field, total ? Math.round((count((row) => row.metrics[field] !== null) / total) * 1000) / 10 : 0]));
  const warningCount = normalizedRows.reduce((sum, row) => sum + row.warnings.length, 0);
  return {
    total_rows: total,
    valid_posts: count((row) => row.valid),
    duplicates: duplicateIdentities,
    missing_post_id: count((row) => !row.post.external_post_id),
    missing_date: count((row) => !row.post.published_at),
    missing_caption: count((row) => !row.post.caption),
    missing_metrics: count((row) => METRIC_FIELDS.every((field) => row.metrics[field] === null)),
    warnings: warningCount,
    metric_coverage: {
      reactions: coverage.reaction_count,
      likes: coverage.like_count,
      comments: coverage.comment_count,
      shares: coverage.share_count,
      views: coverage.view_count,
      reach: coverage.reach_count,
      clicks: coverage.click_count
    }
  };
}

export async function buildImportPreview(input, duplicateImport = null) {
  const fileName = cleanText(input.file_name);
  const content = String(input.content || "");
  if (!fileName) throw new Error("A source filename is required.");
  if (!input.source_id) throw new Error("Choose a Facebook source before previewing the file.");
  if (!content) throw new Error("The import file is empty.");
  if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error("Import file exceeds the 5 MB limit.");
  const parsed = parseImportFile(fileName, content);
  if (parsed.records.length > MAX_IMPORT_ROWS) throw new Error(`Import contains more than ${MAX_IMPORT_ROWS} rows.`);
  const detected = detectFieldMappings(parsed.headers);
  const proposed = input.mapping ? { ...detected.mapping, ...input.mapping } : detected.mapping;
  const mappingValidation = validateMapping(parsed.headers, proposed);
  const normalizedRows = [];
  if (!mappingValidation.errors.length) {
    for (let index = 0; index < parsed.records.length; index += 1) {
      normalizedRows.push(await normalizePostRow(parsed.records[index], mappingValidation.mapping, index + 1));
    }
  }
  const sourceHash = await sha256(content);
  const previewHash = await sha256(JSON.stringify(stableObject({
    source_id: input.source_id,
    source_hash: sourceHash,
    file_name: fileName,
    captured_at: input.captured_at || null,
    metric_scope: input.metric_scope || "public",
    mapping: mappingValidation.mapping
  })));
  const quality = summarizeQuality(normalizedRows);
  const fatalErrors = [...mappingValidation.errors];
  const unresolvedAmbiguity = Object.keys(detected.ambiguous).filter((field) => {
    if (mappingValidation.mapping[field]) return false;
    return !input.mapping || !Object.prototype.hasOwnProperty.call(input.mapping, field);
  });
  if (unresolvedAmbiguity.length) {
    fatalErrors.push("Ambiguous columns require manual field mapping before import.");
  }
  return {
    parser_version: PARSER_VERSION,
    file_type: parsed.fileType,
    source_hash: sourceHash,
    preview_hash: previewHash,
    headers: parsed.headers,
    detected_mapping: detected.mapping,
    mapping: mappingValidation.mapping,
    ambiguous_fields: detected.ambiguous,
    duplicate_import: duplicateImport,
    fatal_errors: fatalErrors,
    warnings: normalizedRows.flatMap((row) => row.warnings.map((warning) => ({ row: row.rowNumber, ...warning }))).slice(0, 200),
    quality,
    sample_rows: normalizedRows.slice(0, 8).map((row) => ({ row_number: row.rowNumber, valid: row.valid, post: row.post, metrics: row.metrics, warnings: row.warnings })),
    normalized_rows: normalizedRows
  };
}

export function validateClassificationPatch(input) {
  const output = {};
  const errors = [];
  for (const field of CLASSIFICATION_FIELDS) {
    const value = cleanText(input[field]);
    if (value === null) { output[field] = null; continue; }
    const taxonomyKey = field === "secondary_topic" ? "topic" : field;
    if (!TAXONOMY[taxonomyKey]?.includes(value)) errors.push(`${field} is not in the controlled taxonomy.`);
    else output[field] = value;
  }
  const confidence = input.confidence === null || input.confidence === undefined || input.confidence === "" ? null : Number(input.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) errors.push("confidence must be between 0 and 1.");
  output.confidence = confidence;
  output.notes = cleanText(input.notes);
  if (output.notes && output.notes.length > 2000) errors.push("notes exceeds the 2000-character limit.");
  return { value: output, errors };
}

export function metricFields() {
  return [...METRIC_FIELDS];
}
