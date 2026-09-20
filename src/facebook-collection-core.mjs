import { sha256 } from "./intelligence-core.mjs";

export const OBSERVED_DATASET_LABEL = "My Facebook Page — 200-Post Observed Sample";
export const CAPTION_CAPTURE_STATUSES = Object.freeze(["full", "collapsed", "missing", "failed"]);
export const DATE_CONFIDENCE = Object.freeze(["exact", "derived", "relative_only", "unknown"]);
export const COLLECTION_BATCH_STATUSES = Object.freeze(["RUNNING", "COMPLETED", "PARTIAL", "FAILED"]);
const METRIC_FIELDS = Object.freeze(["reaction_count", "like_count", "comment_count", "share_count", "view_count", "reach_count", "click_count"]);

function text(value, max = 50000) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/\u00a0/g, " ").trim();
  return result ? result.slice(0, max) : null;
}

function nonNegative(value, field, warnings) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    warnings.push(`${field} must be a non-negative number when present.`);
    return null;
  }
  return Math.round(number);
}

export function canonicalFacebookUrl(value) {
  const raw = text(value, 4000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return raw;
    ["__cft__", "__tn__", "ref", "mibextid", "paipv", "eav", "rdid"].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.toString();
  } catch (_) {
    return raw;
  }
}

export function facebookPostIdFromUrl(value) {
  const url = canonicalFacebookUrl(value);
  if (!url) return null;
  const pfbid = url.match(/[?&](?:story_fbid|fbid)=([^&#]+)/i)?.[1] || url.match(/\/posts\/([^/?#]+)/i)?.[1] || url.match(/\/permalink\/([^/?#]+)/i)?.[1] || url.match(/\/reel\/([^/?#]+)/i)?.[1];
  if (pfbid) return decodeURIComponent(pfbid);
  const albumPost = url.match(/[?&]set=(?:pcb|a)\.([0-9_]+)/i)?.[1];
  if (albumPost) return albumPost;
  return null;
}

export function deriveCanonicalIdentity(candidate) {
  const externalPostId = text(candidate.external_post_id || candidate.post_id, 512) || facebookPostIdFromUrl(candidate.direct_post_url || candidate.post_url);
  const directPostUrl = canonicalFacebookUrl(candidate.direct_post_url || candidate.post_url);
  if (externalPostId) return { external_post_id: externalPostId, canonical_identity: `facebook:${externalPostId}`, post_url: directPostUrl };
  if (directPostUrl) return { external_post_id: null, canonical_identity: `facebook-url:${directPostUrl}`, post_url: directPostUrl };
  return { external_post_id: null, canonical_identity: null, post_url: null };
}

function normalizeMedia(items, warnings) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const mediaUrl = canonicalFacebookUrl(item?.media_url || item?.url || item?.thumbnail_url);
    const mediaType = text(item?.media_type || item?.type, 64)?.toLowerCase() || "unknown";
    if (!mediaUrl && !text(item?.provider_media_id, 512)) warnings.push(`media[${index}] has no stable reference.`);
    return {
      provider_media_id: text(item?.provider_media_id || item?.id, 512), media_url: mediaUrl,
      media_type: mediaType, ordinal: Number.isInteger(item?.ordinal) ? item.ordinal : index + 1,
      alt_description: text(item?.alt_description || item?.alt, 10000),
      thumbnail_url: canonicalFacebookUrl(item?.thumbnail_url),
      duration_seconds: item?.duration_seconds === null || item?.duration_seconds === undefined || item?.duration_seconds === "" ? null : nonNegative(item.duration_seconds, `media[${index}].duration_seconds`, warnings)
    };
  });
}

function inferFormat(candidate, media) {
  const supplied = text(candidate.content_format || candidate.post_type, 64)?.toLowerCase();
  if (supplied === "reel" || supplied === "video") return supplied;
  if (media.some((item) => item.media_type === "reel")) return "reel";
  if (media.some((item) => item.media_type === "video")) return "video";
  if (media.length > 1) return "multi_image";
  if (media.length === 1) return "single_image";
  return supplied || "other";
}

export async function normalizeObservedCandidate(candidate, options = {}) {
  const warnings = [];
  const identity = deriveCanonicalIdentity(candidate);
  if (!identity.canonical_identity) warnings.push("A Facebook post ID or canonical direct-post URL is required.");
  const caption = text(candidate.caption);
  const requestedStatus = text(candidate.caption_capture_status, 32)?.toLowerCase();
  const captionCaptureStatus = CAPTION_CAPTURE_STATUSES.includes(requestedStatus) ? requestedStatus : (caption ? (candidate.caption_expanded ? "full" : "collapsed") : "missing");
  const media = normalizeMedia(candidate.media, warnings);
  const dateConfidence = DATE_CONFIDENCE.includes(candidate.published_at_confidence) ? candidate.published_at_confidence : (text(candidate.visible_relative_age, 256) ? "relative_only" : "unknown");
  const publishedAt = dateConfidence === "exact" || dateConfidence === "derived" ? text(candidate.published_at, 64) : null;
  if (candidate.published_at && !publishedAt) warnings.push("Rejected a non-original publication timestamp because its confidence is not exact or derived.");
  const metricWarnings = [];
  const metrics = {
    reaction_count: nonNegative(candidate.metrics?.reaction_count, "reaction_count", metricWarnings),
    like_count: nonNegative(candidate.metrics?.like_count, "like_count", metricWarnings),
    comment_count: nonNegative(candidate.metrics?.comment_count, "comment_count", metricWarnings),
    share_count: nonNegative(candidate.metrics?.share_count, "share_count", metricWarnings),
    view_count: nonNegative(candidate.metrics?.view_count, "view_count", metricWarnings),
    reach_count: null, click_count: null
  };
  warnings.push(...metricWarnings);
  const verification = candidate.verification || {};
  const normalized = {
    ...identity,
    discovery_order: Number.isInteger(candidate.discovery_order) && candidate.discovery_order > 0 ? candidate.discovery_order : null,
    discovered_at: text(candidate.discovered_at, 64) || new Date().toISOString(),
    visible_relative_age: text(candidate.visible_relative_age, 256),
    published_at: publishedAt,
    published_at_confidence: dateConfidence,
    post_type: text(candidate.post_type, 64),
    caption,
    caption_expanded: captionCaptureStatus === "full" ? 1 : 0,
    caption_capture_status: captionCaptureStatus,
    caption_missing: captionCaptureStatus === "missing" ? 1 : 0,
    caption_fingerprint: caption ? await sha256(caption) : null,
    title_or_hook: text(candidate.title_or_hook, 1000),
    language: text(candidate.language, 64),
    content_format: inferFormat(candidate, media),
    image_count: media.filter((item) => ["image", "photo", "single_image", "carousel"].includes(item.media_type)).length || null,
    video_duration: media.find((item) => item.duration_seconds !== null)?.duration_seconds || null,
    media_reference: media[0]?.media_url || null,
    identity_verified: verification.identity_verified ? 1 : 0,
    caption_verified: verification.caption_verified ? 1 : 0,
    metrics_verified: verification.metrics_verified ? 1 : 0,
    media_verified: verification.media_verified ? 1 : 0,
    verification_status: text(verification.status, 32) || (verification.identity_verified ? "verified" : "unverified"),
    metrics,
    metrics_captured_at: text(candidate.metrics_captured_at || candidate.metric_snapshot?.captured_at, 64),
    metric_scope: text(candidate.metric_scope || candidate.metric_snapshot?.metric_scope, 64) || "public",
    metric_source_method: text(candidate.metric_source_method || candidate.metric_snapshot?.source_method, 128) || "authenticated_browser",
    media,
    raw: candidate
  };
  return { valid: !warnings.some((warning) => warning.includes("required")), warnings, candidate: normalized };
}

export async function normalizeObservedBatch(candidates, options = {}) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("Observed collection batch must contain at least one candidate.");
  if (candidates.length > 25) throw new Error("Observed collection batches are limited to 25 candidates.");
  const seen = new Set(options.seen_post_ids || []);
  const records = [];
  const duplicate_records = [];
  let duplicates = 0;
  for (const item of candidates) {
    const result = await normalizeObservedCandidate(item, options);
    const key = result.candidate.canonical_identity;
    if (key && seen.has(key)) {
      duplicates += 1;
      duplicate_records.push(result);
      continue;
    }
    if (key) seen.add(key);
    records.push(result);
  }
  return { records, duplicate_records, duplicates, seen_post_ids: [...seen] };
}

export function observedQuality(records) {
  const total = records.length;
  const percentage = (count) => total ? Math.round(count / total * 1000) / 10 : 0;
  const coverage = (predicate) => percentage(records.filter(predicate).length);
  const metricsFor = (record) => record.latest_metrics || record.metrics || {};
  const mediaFor = (record) => record.media_references || record.media || [];
  return {
    total_posts: total,
    identity_completeness: coverage((record) => Boolean(record.canonical_identity || record.external_post_id || record.post_url)),
    caption_completeness: coverage((record) => record.caption_capture_status === "full"),
    metric_completeness: coverage((record) => METRIC_FIELDS.some((field) => metricsFor(record)[field] !== null && metricsFor(record)[field] !== undefined)),
    media_completeness: coverage((record) => mediaFor(record).length > 0 || Boolean(record.media_reference)),
    exact_date_completeness: coverage((record) => record.published_at_confidence === "exact"),
    verification: {
      identity: coverage((record) => Boolean(record.identity_verified)),
      caption: coverage((record) => Boolean(record.caption_verified)),
      metrics: coverage((record) => Boolean(record.metrics_verified)),
      media: coverage((record) => Boolean(record.media_verified))
    },
    metric_coverage: Object.fromEntries(METRIC_FIELDS.map((field) => [field, coverage((record) => metricsFor(record)[field] !== null && metricsFor(record)[field] !== undefined)])),
    captions: Object.fromEntries(CAPTION_CAPTURE_STATUSES.map((status) => [status, records.filter((record) => record.caption_capture_status === status).length])),
    media: {
      image: records.filter((record) => record.content_format === "single_image").length,
      carousel: records.filter((record) => record.content_format === "multi_image").length,
      reel_video: records.filter((record) => ["reel", "video"].includes(record.content_format)).length,
      text: records.filter((record) => !mediaFor(record).length && !record.media_reference && record.content_format === "text").length,
      unknown: records.filter((record) => record.content_format === "other").length
    },
    dates: Object.fromEntries(DATE_CONFIDENCE.map((status) => [status, records.filter((record) => record.published_at_confidence === status).length]))
  };
}
