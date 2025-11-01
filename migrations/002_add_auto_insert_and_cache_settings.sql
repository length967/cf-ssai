-- Migration: Add auto-insert and cache configuration fields to channels
-- Run this on existing databases to add the new columns

-- Add SCTE-35 auto-insert flag
ALTER TABLE channels ADD COLUMN scte35_auto_insert INTEGER NOT NULL DEFAULT 0;

-- Add time-based auto-insert flag
ALTER TABLE channels ADD COLUMN time_based_auto_insert INTEGER NOT NULL DEFAULT 0;

-- Add cache configuration
ALTER TABLE channels ADD COLUMN segment_cache_max_age INTEGER DEFAULT 60;
ALTER TABLE channels ADD COLUMN manifest_cache_max_age INTEGER DEFAULT 4;

