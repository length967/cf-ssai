-- Migration: Remove Cloudflare Stream references, add R2 fields
-- Replace Stream-based video storage with R2-based HLS storage

-- SQLite doesn't support DROP COLUMN, so we need to recreate the table

-- Step 1: Create new table with updated schema
CREATE TABLE IF NOT EXISTS ads_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  duration INTEGER DEFAULT 0,
  source_key TEXT,
  transcode_status TEXT DEFAULT 'pending',
  master_playlist_url TEXT,
  error_message TEXT,
  transcoded_at INTEGER,
  channel_id TEXT,
  file_size INTEGER DEFAULT 0,
  mime_type TEXT,
  original_filename TEXT,
  variants TEXT,
  tracking_urls TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

-- Step 2: Copy data from old table to new table (excluding stream columns)
INSERT INTO ads_new (
  id, organization_id, name, description, duration,
  file_size, mime_type, original_filename, variants, tracking_urls,
  status, created_at, updated_at, created_by,
  transcode_status
)
SELECT 
  id, organization_id, name, description, duration,
  file_size, mime_type, original_filename, variants, tracking_urls,
  status, created_at, updated_at, created_by,
  'pending' as transcode_status
FROM ads;

-- Step 3: Drop old table
DROP TABLE ads;

-- Step 4: Rename new table to original name
ALTER TABLE ads_new RENAME TO ads;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_ads_organization_id ON ads (organization_id);
CREATE INDEX IF NOT EXISTS idx_ads_transcode_status ON ads (transcode_status);
CREATE INDEX IF NOT EXISTS idx_ads_channel_id ON ads (channel_id);
