import { OBSERVED_DATASET_LABEL } from "./facebook-collection-core.mjs";

const EXPECTED_PAGE_ID = "100044347487511";
const EXPECTED_SOURCE_ID = "source_my_page";

export function parseFacebookCount(value) {
  if (value === null || value === undefined) return null;
  const compact = String(value).trim().replace(/,/g, "");
  const match = compact.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$/i);
  if (!match) return null;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase()] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function directCaption(record) {
  if (record?.caption) {
    const supplied = String(record.caption).replace(/\s*See less\s*$/i, "").trim();
    const status = record.caption_capture_status || (/(?:\.\.\.|…|See more|查看更多|更多)\s*$/i.test(supplied) ? "collapsed" : "full");
    return { caption: supplied || null, status };
  }
  const values = Array.isArray(record?.caption_window) ? record.caption_window : [];
  const candidate = values.find((value, index) => index >= 3 && !/^\d+(?:\.\d+)?[KMB]?$/i.test(String(value).trim()));
  if (!candidate) return { caption: null, status: "missing" };
  const collapsed = /(?:\.\.\.|…|See more|查看更多|更多)\s*$/i.test(candidate);
  return { caption: String(candidate).replace(/\s*See less\s*$/i, "").trim(), status: collapsed ? "collapsed" : "full" };
}

export function validateObservedSnapshot(snapshot, options = {}) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) errors.push("Snapshot must be a JSON object.");
  const reels = Array.isArray(snapshot?.observed_reels) ? snapshot.observed_reels : [];
  if (!reels.length) errors.push("Snapshot must contain observed_reels.");
  const expectedPageId = options.page_id || EXPECTED_PAGE_ID;
  if (String(snapshot?.page_id || "") !== String(expectedPageId)) errors.push(`Snapshot page_id must be ${expectedPageId}.`);
  if (snapshot?.dataset_label !== OBSERVED_DATASET_LABEL) warnings.push(`Dataset label differs from ${OBSERVED_DATASET_LABEL}.`);
  const identities = reels.map((record) => String(record?.external_post_id || "").trim()).filter(Boolean);
  if (identities.length !== reels.length) errors.push("Every observed reel must contain an external_post_id.");
  const duplicateCount = identities.length - new Set(identities).size;
  if (duplicateCount) errors.push(`Snapshot contains ${duplicateCount} duplicate post identities.`);
  if (reels.length > 200) errors.push("Snapshot exceeds the 200-post collection boundary.");
  if (reels.length < 200) warnings.push(`Snapshot contains ${reels.length} observed identities, below the target of 200.`);
  if (!/not verified as latest/i.test(String(snapshot?.chronology_statement || ""))) warnings.push("Chronology limitation is not explicitly recorded.");
  return { valid: errors.length === 0, errors, warnings, reel_count: reels.length, unique_identities: new Set(identities).size };
}

export function buildReplayCandidates(snapshot, options = {}) {
  const validation = validateObservedSnapshot(snapshot, options);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return snapshot.observed_reels.map((record) => {
    const externalPostId = String(record.external_post_id);
    const gridMetric = record.metric_snapshot || {};
    const postUrl = record.post_url || `https://www.facebook.com/reel/${encodeURIComponent(externalPostId)}`;
    return {
      external_post_id: externalPostId,
      direct_post_url: postUrl,
      discovery_order: record.discovery_order,
      discovered_at: record.discovered_at || gridMetric.captured_at || snapshot.created_at,
      published_at: null,
      published_at_confidence: record.published_at_confidence || "unknown",
      visible_relative_age: record.visible_relative_age || null,
      post_type: "reel",
      content_format: "reel",
      caption: record.caption,
      caption_capture_status: record.caption_capture_status || "missing",
      caption_expanded: Boolean(record.caption_expanded),
      metrics: {
        reaction_count: gridMetric.reaction_count,
        like_count: gridMetric.like_count ?? null,
        comment_count: gridMetric.comment_count,
        share_count: gridMetric.share_count,
        view_count: gridMetric.view_count,
        reach_count: null,
        click_count: null
      },
      metrics_captured_at: gridMetric.captured_at || record.discovered_at || snapshot.created_at,
      metric_scope: "public",
      metric_source_method: "authenticated_browser_reel_grid",
      media: [{
        provider_media_id: externalPostId,
        media_url: postUrl,
        media_type: "reel",
        ordinal: 1,
        alt_description: null,
        thumbnail_url: null,
        duration_seconds: null
      }],
      verification: record.verification || {
        identity_verified: false,
        caption_verified: false,
        metrics_verified: false,
        media_verified: false,
        status: "grid_identity_observed_direct_verification_pending"
      },
      raw_observation: record.raw_observation || record
    };
  });
}

export function buildDirectVerificationCandidates(snapshot, directRecords = snapshot?.reel_subcanary || [], options = {}) {
  const validation = validateObservedSnapshot(snapshot, options);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const observedById = new Map(snapshot.observed_reels.map((record) => [String(record.external_post_id), record]));
  const unique = new Map();
  for (const direct of directRecords || []) if (direct?.external_post_id) unique.set(String(direct.external_post_id), direct);
  return [...unique].map(([externalPostId, direct]) => {
    const observed = observedById.get(externalPostId);
    if (!observed) throw new Error(`Direct verification post ${externalPostId} is not part of the observed snapshot.`);
    const caption = directCaption(direct);
    const legacyMetrics = direct.metric_like_lines || [];
    const reaction = parseFacebookCount(direct.reaction_text ?? legacyMetrics[0]);
    const comments = parseFacebookCount(direct.comment_text ?? legacyMetrics[1]);
    const shares = parseFacebookCount(direct.share_text ?? legacyMetrics[2]);
    const gridMetric = observed.metric_snapshot || {};
    const postUrl = direct.post_url || direct.canonical || direct.url || observed.post_url;
    return {
      external_post_id: externalPostId,
      direct_post_url: postUrl,
      discovery_order: observed.discovery_order,
      discovered_at: direct.captured_at || snapshot.created_at,
      published_at: null,
      published_at_confidence: observed.published_at_confidence || "unknown",
      visible_relative_age: observed.visible_relative_age || null,
      post_type: "reel",
      content_format: "reel",
      caption: caption.caption,
      caption_capture_status: caption.status,
      caption_expanded: caption.status === "full",
      metrics: {
        reaction_count: reaction,
        like_count: null,
        comment_count: comments,
        share_count: shares,
        view_count: direct.view_count ?? gridMetric.view_count ?? parseFacebookCount(direct.tile_views_text),
        reach_count: null,
        click_count: null
      },
      metrics_captured_at: direct.captured_at || snapshot.created_at,
      metric_scope: "public",
      metric_source_method: "authenticated_browser_direct_reel_and_grid",
      media: [{
        provider_media_id: externalPostId,
        media_url: postUrl,
        media_type: "reel",
        ordinal: 1,
        alt_description: null,
        thumbnail_url: direct.thumbnail_url || null,
        duration_seconds: direct.duration_seconds ?? null
      }],
      verification: {
        identity_verified: direct.identity_verified !== false,
        caption_verified: direct.caption_verified ?? Boolean(caption.caption),
        metrics_verified: direct.metrics_verified ?? [reaction, comments, shares].some((value) => value !== null),
        media_verified: direct.media_verified !== false,
        status: caption.status === "full" ? "direct_verified" : "direct_verified_partial_caption"
      },
      raw_observation: direct
    };
  });
}

export function replayBatches(candidates, size = 25) {
  if (!Array.isArray(candidates)) throw new Error("Candidates must be an array.");
  if (!Number.isInteger(size) || size < 1 || size > 25) throw new Error("Replay batch size must be between 1 and 25.");
  const batches = [];
  for (let index = 0; index < candidates.length; index += size) batches.push(candidates.slice(index, index + size));
  return batches;
}

export const SNAPSHOT_REPLAY_DEFAULTS = Object.freeze({ page_id: EXPECTED_PAGE_ID, source_id: EXPECTED_SOURCE_ID });
