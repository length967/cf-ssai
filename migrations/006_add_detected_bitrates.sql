-- Migration: Add detected bitrates tracking
-- Automatically detect and store stream bitrates for display in GUI

-- Add detected_bitrates column to store auto-detected bitrates from origin stream
-- Stores JSON array of bitrates in kbps, e.g., '[500, 1500, 4000]'
ALTER TABLE channels ADD COLUMN detected_bitrates TEXT;

-- Add source indicator for bitrate_ladder
-- Values: 'auto' (detected), 'manual' (user-configured), NULL (not set)
ALTER TABLE channels ADD COLUMN bitrate_ladder_source TEXT DEFAULT 'auto';

-- Add last_bitrate_detection timestamp
-- Tracks when bitrates were last detected from origin stream
ALTER TABLE channels ADD COLUMN last_bitrate_detection INTEGER;

-- Set initial source as 'manual' for existing channels with configured ladders
UPDATE channels SET bitrate_ladder_source = 'manual' WHERE bitrate_ladder IS NOT NULL;

-- Notes:
-- - detected_bitrates: Automatically populated when stream is accessed
-- - bitrate_ladder: Used for actual transcoding (can be auto or manual)
-- - bitrate_ladder_source: Indicates if ladder is auto-detected or manually configured
--   * 'auto': bitrate_ladder matches detected_bitrates
--   * 'manual': user has overridden the auto-detected values
-- - last_bitrate_detection: Unix timestamp (ms) of last detection

