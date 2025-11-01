-- Migration: Create ads table with R2 fields (for fresh installations)
-- This version doesn't require an existing ads table

-- Create ads table with R2-based schema
CREATE TABLE IF NOT EXISTS ads (
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ads_organization_id ON ads (organization_id);
CREATE INDEX IF NOT EXISTS idx_ads_transcode_status ON ads (transcode_status);
CREATE INDEX IF NOT EXISTS idx_ads_channel_id ON ads (channel_id);

