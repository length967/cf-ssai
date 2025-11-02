-- Migration: Add slate video management
-- Purpose: Allow channels to have custom "We'll be right back" slate videos

-- Create slates table
CREATE TABLE IF NOT EXISTS slates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration REAL NOT NULL, -- Duration in seconds
  status TEXT NOT NULL DEFAULT 'pending', -- pending, transcoding, ready, error
  
  -- Slate type: 'video' (uploaded) or 'generated' (FFmpeg-created)
  slate_type TEXT NOT NULL DEFAULT 'video', -- video, generated
  
  -- Source video (for uploaded slates)
  source_video_url TEXT,
  source_file_size INTEGER,
  
  -- Generated slate configuration (for text-based slates)
  text_content TEXT, -- Message to display
  background_color TEXT, -- Hex color (e.g., '#000000')
  text_color TEXT, -- Hex color (e.g., '#FFFFFF')
  font_size INTEGER, -- Font size in pixels
  
  -- Transcoded HLS
  master_playlist_url TEXT,
  variants TEXT, -- JSON array of bitrate variants
  
  -- Metadata
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Add slate_id to channels table (safe if already exists)
ALTER TABLE channels ADD COLUMN slate_id TEXT;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_slates_org ON slates(organization_id);
CREATE INDEX IF NOT EXISTS idx_slates_status ON slates(status);
CREATE INDEX IF NOT EXISTS idx_channels_slate ON channels(slate_id);
