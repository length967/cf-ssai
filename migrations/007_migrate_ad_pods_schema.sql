-- Migration: Update ad_pods schema to reference ads table
-- This migrates from direct URL storage to ad ID references

-- Step 1: Add new columns to ad_pods table
ALTER TABLE ad_pods ADD COLUMN ads TEXT; -- JSON array of ad IDs: ["ad_123", "ad_456"]
ALTER TABLE ad_pods ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE;

-- Step 2: Create index for performance
CREATE INDEX idx_ad_pods_channel ON ad_pods(channel_id);

-- Step 3: Migrate existing data
-- The slate pod currently has assets with direct URLs
-- We need to extract the ad ID from those URLs and populate the ads column
-- 
-- Current format:
--   assets: [{"bitrate": 1000000, "url": "https://.../ad_1761998592294_khk143gu4/1000k/playlist.m3u8"}]
-- 
-- We'll extract "ad_1761998592294_khk143gu4" and store it in ads column:
--   ads: ["ad_1761998592294_khk143gu4"]

-- For the existing slate pod, we'll set it to reference the demo channel
-- and extract the ad ID from the first asset URL
UPDATE ad_pods 
SET channel_id = 'ch_demo_sports',
    ads = (
        SELECT json_array(
            -- Extract ad ID from the first asset URL
            -- URL format: https://.../transcoded-ads/{ad_id}/{bitrate}k/playlist.m3u8
            substr(
                json_extract(assets, '$[0].url'),
                -- Find position after '/transcoded-ads/'
                instr(json_extract(assets, '$[0].url'), '/transcoded-ads/') + 17,
                -- Extract until next '/'
                instr(
                    substr(
                        json_extract(assets, '$[0].url'),
                        instr(json_extract(assets, '$[0].url'), '/transcoded-ads/') + 17
                    ),
                    '/'
                ) - 1
            )
        )
    )
WHERE pod_id = 'slate';

-- Step 4: Make ads column NOT NULL for new records (existing data already migrated)
-- Note: SQLite doesn't support ALTER COLUMN, so we'll enforce this in application code

-- Step 5: Keep assets column for backward compatibility during transition
-- We'll remove it in a future migration once confirmed everything works

-- Notes:
-- - The 'assets' column is kept for now as a backup
-- - The decision worker will now use the 'ads' column to fetch ad details
-- - Ad URLs will be dynamically built from the ads table 'variants' field
-- - This allows for:
--   * Better ad management (update transcoding without changing pods)
--   * Dynamic bitrate selection
--   * Easier multi-channel ad sharing

