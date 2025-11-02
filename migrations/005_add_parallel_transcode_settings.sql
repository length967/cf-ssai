-- Add parallel transcoding settings to organizations
-- This allows enabling/disabling parallel transcoding per organization

-- Add column to organizations table
ALTER TABLE organizations ADD COLUMN parallel_transcode_enabled INTEGER NOT NULL DEFAULT 1;
-- 1 = enabled (default), 0 = disabled (use traditional single-container transcode)

-- Add column for minimum video duration threshold (in seconds)
-- Only videos longer than this will use parallel transcoding
ALTER TABLE organizations ADD COLUMN parallel_transcode_threshold INTEGER NOT NULL DEFAULT 30;
-- Default: 30 seconds

-- Add column for segment duration (in seconds)
ALTER TABLE organizations ADD COLUMN parallel_segment_duration INTEGER NOT NULL DEFAULT 10;
-- Default: 10 seconds per segment

-- Add index for quick lookup
CREATE INDEX idx_organizations_parallel ON organizations(parallel_transcode_enabled);

-- Update existing organizations to use parallel transcoding by default
UPDATE organizations SET parallel_transcode_enabled = 1, parallel_transcode_threshold = 30, parallel_segment_duration = 10;
