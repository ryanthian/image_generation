PRAGMA foreign_keys = ON;

ALTER TABLE posts ADD COLUMN discovery_order INTEGER;
ALTER TABLE posts ADD COLUMN discovered_at TEXT;
ALTER TABLE posts ADD COLUMN visible_relative_age TEXT;
ALTER TABLE posts ADD COLUMN published_at_confidence TEXT CHECK (published_at_confidence IN ('exact', 'derived', 'relative_only', 'unknown'));
ALTER TABLE posts ADD COLUMN caption_expanded INTEGER CHECK (caption_expanded IN (0, 1));
ALTER TABLE posts ADD COLUMN caption_capture_status TEXT CHECK (caption_capture_status IN ('full', 'collapsed', 'missing', 'failed'));
ALTER TABLE posts ADD COLUMN caption_fingerprint TEXT;
ALTER TABLE posts ADD COLUMN identity_verified INTEGER CHECK (identity_verified IN (0, 1));
ALTER TABLE posts ADD COLUMN caption_verified INTEGER CHECK (caption_verified IN (0, 1));
ALTER TABLE posts ADD COLUMN metrics_verified INTEGER CHECK (metrics_verified IN (0, 1));
ALTER TABLE posts ADD COLUMN media_verified INTEGER CHECK (media_verified IN (0, 1));
ALTER TABLE posts ADD COLUMN verification_status TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_source_discovery ON posts(source_id, discovery_order);
CREATE INDEX IF NOT EXISTS idx_posts_caption_fingerprint ON posts(source_id, caption_fingerprint);

CREATE TABLE IF NOT EXISTS collection_batches (
  collection_batch_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  dataset_label TEXT NOT NULL,
  target_posts INTEGER NOT NULL CHECK (target_posts > 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  new_posts INTEGER NOT NULL DEFAULT 0,
  duplicate_posts INTEGER NOT NULL DEFAULT 0,
  failed_posts INTEGER NOT NULL DEFAULT 0,
  verification_failures INTEGER NOT NULL DEFAULT 0,
  caption_failures INTEGER NOT NULL DEFAULT 0,
  media_failures INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_batches_source_time ON collection_batches(source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS collection_raw_observations (
  observation_id TEXT PRIMARY KEY,
  collection_batch_id TEXT NOT NULL REFERENCES collection_batches(collection_batch_id),
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  canonical_post_id TEXT REFERENCES posts(post_id),
  discovery_order INTEGER,
  observed_at TEXT NOT NULL,
  original_json TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('VALID', 'WARNING', 'INVALID', 'DUPLICATE')),
  validation_warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_observations_batch ON collection_raw_observations(collection_batch_id, discovery_order);
CREATE INDEX IF NOT EXISTS idx_collection_observations_post ON collection_raw_observations(canonical_post_id);

CREATE TABLE IF NOT EXISTS post_media_references (
  post_media_reference_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  provider_media_id TEXT,
  media_url TEXT,
  media_type TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  alt_description TEXT,
  thumbnail_url TEXT,
  duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(post_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media_references(post_id, ordinal);
