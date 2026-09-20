PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS facebook_sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  facebook_id TEXT NOT NULL UNIQUE,
  source_role TEXT NOT NULL CHECK (source_role IN ('audience', 'benchmark')),
  profile_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  import_batch_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  source_type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  parser_version TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  metric_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREVIEW', 'VALIDATED', 'IMPORTED', 'PARTIAL', 'FAILED')),
  posts_imported INTEGER NOT NULL DEFAULT 0,
  posts_updated INTEGER NOT NULL DEFAULT 0,
  metric_snapshots_created INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_batches_source_time
  ON import_batches(source_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_source_hash
  ON import_batches(source_id, source_hash);

CREATE TABLE IF NOT EXISTS posts (
  post_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  canonical_identity TEXT NOT NULL,
  external_post_id TEXT,
  post_url TEXT,
  published_at TEXT,
  post_type TEXT,
  caption TEXT,
  title_or_hook TEXT,
  language TEXT,
  content_format TEXT,
  image_count INTEGER CHECK (image_count IS NULL OR image_count >= 0),
  video_duration REAL CHECK (video_duration IS NULL OR video_duration >= 0),
  media_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, canonical_identity)
);

CREATE INDEX IF NOT EXISTS idx_posts_source_published
  ON posts(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_external_id
  ON posts(source_id, external_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_format
  ON posts(content_format);

CREATE TABLE IF NOT EXISTS raw_post_records (
  raw_record_id TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(import_batch_id),
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  canonical_post_id TEXT REFERENCES posts(post_id),
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  original_json TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('VALID', 'WARNING', 'INVALID')),
  validation_warnings_json TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(import_batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_raw_records_batch
  ON raw_post_records(import_batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_raw_records_post
  ON raw_post_records(canonical_post_id);

CREATE TABLE IF NOT EXISTS post_metric_snapshots (
  metric_snapshot_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  import_batch_id TEXT REFERENCES import_batches(import_batch_id),
  captured_at TEXT NOT NULL,
  reaction_count INTEGER CHECK (reaction_count IS NULL OR reaction_count >= 0),
  like_count INTEGER CHECK (like_count IS NULL OR like_count >= 0),
  comment_count INTEGER CHECK (comment_count IS NULL OR comment_count >= 0),
  share_count INTEGER CHECK (share_count IS NULL OR share_count >= 0),
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  reach_count INTEGER CHECK (reach_count IS NULL OR reach_count >= 0),
  click_count INTEGER CHECK (click_count IS NULL OR click_count >= 0),
  metric_scope TEXT NOT NULL,
  source_method TEXT NOT NULL,
  metric_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, captured_at, metric_hash)
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_post_time
  ON post_metric_snapshots(post_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS post_classifications (
  classification_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  topic TEXT,
  secondary_topic TEXT,
  hook TEXT,
  emotion TEXT,
  content_format TEXT,
  visual TEXT,
  intent TEXT,
  classification_source TEXT NOT NULL CHECK (classification_source IN ('manual', 'rule_based', 'ai')),
  model TEXT,
  prompt_version TEXT,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classifications_post_time
  ON post_classifications(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifications_topic
  ON post_classifications(topic);

CREATE TABLE IF NOT EXISTS classification_overrides (
  post_id TEXT PRIMARY KEY REFERENCES posts(post_id),
  topic TEXT,
  secondary_topic TEXT,
  hook TEXT,
  emotion TEXT,
  content_format TEXT,
  visual TEXT,
  intent TEXT,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  analysis_run_id TEXT PRIMARY KEY,
  dataset_hash TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS post_scores (
  post_score_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id),
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  score REAL,
  components_json TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(analysis_run_id, post_id)
);

CREATE TABLE IF NOT EXISTS topic_statistics (
  topic_statistic_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id),
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  topic TEXT NOT NULL,
  statistics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(analysis_run_id, source_id, topic)
);

CREATE TABLE IF NOT EXISTS pattern_statistics (
  pattern_statistic_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id),
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  dimension_a TEXT NOT NULL,
  value_a TEXT NOT NULL,
  dimension_b TEXT NOT NULL,
  value_b TEXT NOT NULL,
  statistics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_patterns (
  benchmark_pattern_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES facebook_sources(source_id),
  pattern_type TEXT NOT NULL,
  pattern_value TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_ideas (
  content_idea_id TEXT PRIMARY KEY,
  source_analysis_run_id TEXT REFERENCES analysis_runs(analysis_run_id),
  idea_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_plans (
  content_plan_id TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_links (
  production_link_id TEXT PRIMARY KEY,
  content_idea_id TEXT REFERENCES content_ideas(content_idea_id),
  generated_content_id TEXT NOT NULL,
  post_id TEXT REFERENCES posts(post_id),
  created_at TEXT NOT NULL,
  UNIQUE(generated_content_id)
);

CREATE TABLE IF NOT EXISTS performance_updates (
  performance_update_id TEXT PRIMARY KEY,
  production_link_id TEXT NOT NULL REFERENCES production_links(production_link_id),
  metric_snapshot_id TEXT REFERENCES post_metric_snapshots(metric_snapshot_id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO facebook_sources (
  source_id, name, facebook_id, source_role, profile_url, created_at, updated_at
) VALUES
  ('source_my_page', 'My Facebook Page', '100044347487511', 'audience',
   'https://www.facebook.com/profile.php?id=100044347487511', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('source_eunice_benchmark', 'Eunice Benchmark Page', '100033687097155', 'benchmark',
   'https://www.facebook.com/profile.php?id=100033687097155', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO settings (setting_key, setting_value_json, updated_at) VALUES
  ('content_intelligence.taxonomy_version', '"phase1-v1"', CURRENT_TIMESTAMP),
  ('content_intelligence.import_limits', '{"max_file_bytes":5242880,"max_rows":5000}', CURRENT_TIMESTAMP);
