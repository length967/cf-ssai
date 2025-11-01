-- Migration: Add bitrate ladder configuration to channels
-- This allows each channel to specify exact bitrates for ad transcoding

-- Add bitrate_ladder column
-- Stores JSON array of bitrates in kbps, e.g., '[1000, 2000, 3000]'
ALTER TABLE channels ADD COLUMN bitrate_ladder TEXT;

-- Set sensible default for existing channels (common HLS ladder)
UPDATE channels SET bitrate_ladder = '[1000, 2000, 3000]' WHERE bitrate_ladder IS NULL;

-- Notes:
-- - Bitrates are in kbps (kilobits per second)
-- - When uploading an ad with a channel_id, these bitrates will be used for transcoding
-- - Ads will be transcoded to exactly match these bitrates for seamless playback
-- - Example ladders:
--   Mobile-optimized: '[500, 1000, 1500]'
--   Standard HD:      '[1000, 2000, 3000]'
--   High quality:     '[1500, 3000, 6000]'
--   4K/Premium:       '[3000, 6000, 12000]'

