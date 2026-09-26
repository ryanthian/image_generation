PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS production_sheet_registry (
  sheet_id INTEGER PRIMARY KEY,
  current_title TEXT NOT NULL,
  schema_family TEXT NOT NULL,
  schema_version INTEGER,
  content_type TEXT,
  template_id TEXT,
  schema_status TEXT NOT NULL CHECK (schema_status IN ('READY', 'NEEDS_SETUP', 'UNAVAILABLE', 'NOT_SCANNED')),
  setup_reasons_json TEXT NOT NULL DEFAULT '[]',
  target_page_profile_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  baseline_state TEXT NOT NULL CHECK (baseline_state IN ('CURRENT_SOURCE', 'EXISTING_UNCONNECTED', 'AUTO_DISCOVERED', 'APP_CREATED')),
  last_discovered_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_production_sheet_registry_active
  ON production_sheet_registry(active, schema_status, current_title);

CREATE TABLE IF NOT EXISTS production_page_profiles (
  profile_id TEXT PRIMARY KEY,
  facebook_page_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT '',
  primary_language TEXT NOT NULL DEFAULT '',
  tone_guidance TEXT NOT NULL DEFAULT '',
  content_pillars_json TEXT NOT NULL DEFAULT '[]',
  suitable_formats_json TEXT NOT NULL DEFAULT '[]',
  avoid_topics_json TEXT NOT NULL DEFAULT '[]',
  monetization_types_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_page_profiles_facebook_id
  ON production_page_profiles(facebook_page_id) WHERE facebook_page_id <> '';

CREATE TABLE IF NOT EXISTS production_editorial_reviews (
  sheet_id INTEGER NOT NULL,
  content_id TEXT NOT NULL,
  review_json TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('NOT_REVIEWED', 'REVIEW', 'PASS', 'BLOCKED')),
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY (sheet_id, content_id)
);

CREATE TABLE IF NOT EXISTS production_workflows (
  sheet_id INTEGER NOT NULL,
  content_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('IDEA', 'COPY_DRAFT', 'EDITORIAL_REVIEW', 'COPY_APPROVED', 'VISUAL_VIDEO_PROMPT', 'ASSET_CREATED', 'QC_PASSED', 'SCHEDULED_PUBLISHED', 'RESULTS_RECORDED')),
  actor TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sheet_id, content_id)
);

CREATE TABLE IF NOT EXISTS production_publications (
  publication_id TEXT PRIMARY KEY,
  sheet_id INTEGER NOT NULL,
  content_id TEXT NOT NULL,
  page_profile_id TEXT NOT NULL REFERENCES production_page_profiles(profile_id),
  content_type TEXT NOT NULL,
  content_format TEXT NOT NULL,
  published_at TEXT NOT NULL,
  post_url TEXT NOT NULL DEFAULT '',
  production_minutes REAL CHECK (production_minutes IS NULL OR production_minutes >= 0),
  direct_cost REAL CHECK (direct_cost IS NULL OR direct_cost >= 0),
  currency TEXT NOT NULL DEFAULT 'MYR',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_production_publications_page_date
  ON production_publications(page_profile_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_publications_content
  ON production_publications(sheet_id, content_id);

CREATE TABLE IF NOT EXISTS production_result_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES production_publications(publication_id),
  captured_at TEXT NOT NULL,
  reach INTEGER CHECK (reach IS NULL OR reach >= 0),
  qualified_views INTEGER CHECK (qualified_views IS NULL OR qualified_views >= 0),
  engagement INTEGER CHECK (engagement IS NULL OR engagement >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  saves INTEGER CHECK (saves IS NULL OR saves >= 0),
  retention_rate REAL CHECK (retention_rate IS NULL OR (retention_rate >= 0 AND retention_rate <= 1)),
  meta_earnings REAL CHECK (meta_earnings IS NULL OR meta_earnings >= 0),
  affiliate_clicks INTEGER CHECK (affiliate_clicks IS NULL OR affiliate_clicks >= 0),
  affiliate_orders INTEGER CHECK (affiliate_orders IS NULL OR affiliate_orders >= 0),
  affiliate_commission REAL CHECK (affiliate_commission IS NULL OR affiliate_commission >= 0),
  entered_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_production_result_snapshots_latest
  ON production_result_snapshots(publication_id, captured_at DESC);
