-- Migration: Add sign_host field to channels table
-- This allows per-channel URL signing configuration for multi-tenant setup

ALTER TABLE channels ADD COLUMN sign_host TEXT;

-- Update existing demo channel with example sign host
UPDATE channels 
SET sign_host = 'media.example.com' 
WHERE id = 'ch_demo_sports';

-- Add index for faster lookups by organization and slug (already exists, but documenting)
-- CREATE INDEX IF NOT EXISTS idx_channels_slug ON channels(organization_id, slug);

