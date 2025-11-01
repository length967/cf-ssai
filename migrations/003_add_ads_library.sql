-- Migration: Add ads library table for managing uploaded commercials
-- This tracks all uploaded video ads, their Stream processing status, and metadata

CREATE TABLE ads (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    
    -- Basic Information
    name TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL, -- Duration in seconds
    
    -- Cloudflare Stream Integration
    stream_id TEXT UNIQUE, -- Cloudflare Stream video ID
    stream_status TEXT DEFAULT 'pending', -- pending, processing, ready, error
    stream_thumbnail_url TEXT,
    
    -- R2 Storage (if copying from Stream to R2)
    r2_base_path TEXT, -- e.g., "ads/ad_abc123"
    
    -- HLS Variants (auto-populated from Stream)
    variants JSON, -- [{"bitrate": 400000, "width": 640, "height": 360, "playlist_url": "..."}]
    
    -- Metadata
    file_size INTEGER, -- Original upload size in bytes
    mime_type TEXT,
    original_filename TEXT,
    
    -- Tracking URLs (optional)
    tracking_urls JSON, -- {"impression": [...], "quartiles": {...}, "complete": [...]}
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active', -- active, archived
    
    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_ads_org ON ads(organization_id);
CREATE INDEX idx_ads_stream ON ads(stream_id);
CREATE INDEX idx_ads_status ON ads(status);

-- Update ad_pods table to reference ads library
ALTER TABLE ad_pods ADD COLUMN ad_id TEXT REFERENCES ads(id) ON DELETE SET NULL;
CREATE INDEX idx_ad_pods_ad ON ad_pods(ad_id);

