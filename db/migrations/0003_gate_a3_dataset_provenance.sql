PRAGMA foreign_keys = ON;

ALTER TABLE posts ADD COLUMN caption_missing INTEGER CHECK (caption_missing IN (0, 1));

ALTER TABLE collection_batches ADD COLUMN sample_type TEXT;
ALTER TABLE collection_batches ADD COLUMN media_scope TEXT;
ALTER TABLE collection_batches ADD COLUMN chronology_status TEXT;
ALTER TABLE collection_batches ADD COLUMN source_checkpoint TEXT;
ALTER TABLE collection_batches ADD COLUMN direct_verification_files_json TEXT;
ALTER TABLE collection_batches ADD COLUMN limitations_json TEXT;

ALTER TABLE collection_raw_observations ADD COLUMN observation_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_observations_hash
  ON collection_raw_observations(collection_batch_id, observation_hash)
  WHERE observation_hash IS NOT NULL;

INSERT OR IGNORE INTO settings (setting_key, setting_value_json, updated_at) VALUES
  ('content_intelligence.gate_a3_provenance_version', '"gate-a3-v1"', CURRENT_TIMESTAMP);
