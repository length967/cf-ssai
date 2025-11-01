-- Cloudflare SSAI Admin Platform Database Schema
-- Multi-tenant architecture with organizations, users, channels, and analytics

-- Organizations (Tenants/Customers)
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free', -- free, pro, enterprise
    status TEXT NOT NULL DEFAULT 'active', -- active, suspended, trial
    settings JSON,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status);

-- Users (Admin users per organization)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer', -- admin, editor, viewer
    password_hash TEXT, -- bcrypt hash
    last_login INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    UNIQUE(organization_id, email)
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);

-- API Keys (For programmatic access)
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the key
    permissions JSON, -- {"channels": ["read", "write"], "analytics": ["read"]}
    last_used INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Channels (Live streams configuration)
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    origin_url TEXT NOT NULL, -- Origin manifest base URL
    status TEXT NOT NULL DEFAULT 'active', -- active, paused, archived
    mode TEXT NOT NULL DEFAULT 'auto', -- auto, sgai, ssai
    
    -- SCTE-35 Configuration
    scte35_enabled INTEGER NOT NULL DEFAULT 1, -- boolean (1 = true, 0 = false)
    scte35_fallback_schedule TEXT, -- JSON: {"interval_minutes": 5, "duration_sec": 30}
    scte35_auto_insert INTEGER NOT NULL DEFAULT 0, -- Auto-insert ads on SCTE-35 signals (0 = disabled, 1 = enabled)
    
    -- VAST Configuration
    vast_enabled INTEGER NOT NULL DEFAULT 1,
    vast_url TEXT, -- VAST ad server URL
    vast_timeout_ms INTEGER DEFAULT 2000,
    
    -- Ad Configuration
    default_ad_duration INTEGER DEFAULT 30,
    ad_pod_base_url TEXT, -- Base URL for ad assets
    slate_pod_id TEXT DEFAULT 'slate',
    time_based_auto_insert INTEGER NOT NULL DEFAULT 0, -- Auto-insert ads on time schedule (0 = disabled, 1 = enabled)
    
    -- URL Signing Configuration
    sign_host TEXT, -- Host used for URL signing (e.g., "media.example.com")
    
    -- Cache Configuration
    segment_cache_max_age INTEGER DEFAULT 60, -- Segment cache TTL in seconds
    manifest_cache_max_age INTEGER DEFAULT 4, -- Manifest cache TTL in seconds
    
    -- Settings
    settings JSON, -- Additional channel-specific settings
    
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(organization_id, slug)
);

CREATE INDEX idx_channels_org ON channels(organization_id);
CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_slug ON channels(organization_id, slug);

-- Ad Pods (Pre-transcoded ad assets)
CREATE TABLE ad_pods (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pod_id TEXT NOT NULL, -- Used in AdPod structure
    duration_sec INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active, archived
    
    -- Asset URLs (JSON array of bitrate variants)
    assets JSON NOT NULL, -- [{"bitrate": 800000, "url": "..."}]
    
    -- Tracking
    tracking_impressions JSON, -- Array of impression URLs
    tracking_quartiles JSON, -- Object with start, q1, mid, q3, complete arrays
    tracking_clicks JSON, -- Array of click URLs
    tracking_errors JSON, -- Array of error URLs
    
    -- VAST metadata (if created from VAST)
    vast_ad_id TEXT,
    vast_creative_id TEXT,
    vast_source_url TEXT,
    
    -- Targeting
    tags JSON, -- Array of tags for targeting
    
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(organization_id, pod_id)
);

CREATE INDEX idx_ad_pods_org ON ad_pods(organization_id);
CREATE INDEX idx_ad_pods_status ON ad_pods(status);
CREATE INDEX idx_ad_pods_pod_id ON ad_pods(organization_id, pod_id);

-- Beacon Events (Analytics/Tracking)
CREATE TABLE beacon_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    channel_id TEXT,
    
    -- Event details
    event_type TEXT NOT NULL, -- imp, start, firstQuartile, midpoint, thirdQuartile, complete, error
    ad_id TEXT NOT NULL,
    pod_id TEXT,
    
    -- Viewer context
    viewer_id TEXT,
    session_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    
    -- Playback context
    variant TEXT, -- e.g., "v_1600k.m3u8"
    bitrate INTEGER,
    
    -- VAST metadata
    vast_ad_id TEXT,
    vast_creative_id TEXT,
    
    -- SCTE-35 metadata
    scte35_id TEXT,
    scte35_type TEXT,
    
    -- Tracking status
    trackers_fired INTEGER NOT NULL DEFAULT 0, -- Count of successfully fired trackers
    trackers_failed INTEGER NOT NULL DEFAULT 0,
    
    -- Timing
    timestamp INTEGER NOT NULL,
    processed_at INTEGER,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
);

CREATE INDEX idx_beacon_events_org ON beacon_events(organization_id);
CREATE INDEX idx_beacon_events_channel ON beacon_events(channel_id);
CREATE INDEX idx_beacon_events_timestamp ON beacon_events(timestamp);
CREATE INDEX idx_beacon_events_type ON beacon_events(event_type);
CREATE INDEX idx_beacon_events_ad ON beacon_events(ad_id);

-- Analytics Aggregates (Pre-computed for dashboard)
CREATE TABLE analytics_hourly (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    channel_id TEXT,
    
    -- Time bucket
    hour INTEGER NOT NULL, -- Unix timestamp truncated to hour
    
    -- Metrics
    impressions INTEGER NOT NULL DEFAULT 0,
    starts INTEGER NOT NULL DEFAULT 0,
    completes INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    
    -- Completion rate
    completion_rate REAL, -- completes / starts
    
    -- Fill rate
    requests INTEGER NOT NULL DEFAULT 0,
    fills INTEGER NOT NULL DEFAULT 0,
    fill_rate REAL, -- fills / requests
    
    -- VAST metrics
    vast_requests INTEGER NOT NULL DEFAULT 0,
    vast_successes INTEGER NOT NULL DEFAULT 0,
    vast_timeouts INTEGER NOT NULL DEFAULT 0,
    vast_errors INTEGER NOT NULL DEFAULT 0,
    
    -- SCTE-35 metrics
    scte35_detected INTEGER NOT NULL DEFAULT 0,
    scte35_breaks INTEGER NOT NULL DEFAULT 0,
    
    updated_at INTEGER NOT NULL,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
    UNIQUE(organization_id, channel_id, hour)
);

CREATE INDEX idx_analytics_hourly_org ON analytics_hourly(organization_id);
CREATE INDEX idx_analytics_hourly_channel ON analytics_hourly(channel_id);
CREATE INDEX idx_analytics_hourly_hour ON analytics_hourly(hour);

-- System Events (Audit log)
CREATE TABLE system_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    user_id TEXT,
    
    -- Event details
    event_type TEXT NOT NULL, -- channel.created, channel.updated, user.login, etc.
    entity_type TEXT, -- channel, user, ad_pod, etc.
    entity_id TEXT,
    
    -- Changes (for audit)
    changes JSON, -- {"field": {"old": "value", "new": "value"}}
    
    -- Context
    ip_address TEXT,
    user_agent TEXT,
    
    timestamp INTEGER NOT NULL,
    
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_system_events_org ON system_events(organization_id);
CREATE INDEX idx_system_events_user ON system_events(user_id);
CREATE INDEX idx_system_events_timestamp ON system_events(timestamp);
CREATE INDEX idx_system_events_type ON system_events(event_type);

-- Session Store (for authentication)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Seed data for development
INSERT INTO organizations (id, name, slug, plan, status, settings, created_at, updated_at)
VALUES (
    'org_demo',
    'Demo Organization',
    'demo',
    'enterprise',
    'active',
    '{"features": ["scte35", "vast", "analytics"]}',
    strftime('%s', 'now'),
    strftime('%s', 'now')
);

INSERT INTO users (id, organization_id, email, name, role, password_hash, created_at, updated_at)
VALUES (
    'user_admin',
    'org_demo',
    'admin@demo.com',
    'Demo Admin',
    'admin',
    'd3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791', -- Password: "demo123" (SHA-256)
    strftime('%s', 'now'),
    strftime('%s', 'now')
);

INSERT INTO channels (id, organization_id, name, slug, origin_url, status, mode, scte35_enabled, vast_enabled, default_ad_duration, ad_pod_base_url, sign_host, created_at, updated_at, created_by)
VALUES (
    'ch_demo_sports',
    'org_demo',
    'Demo Sports Channel',
    'sports',
    'https://origin.example.com/hls/sports',
    'active',
    'auto',
    1,
    1,
    30,
    'https://ads.example.com/pods',
    'media.example.com',
    strftime('%s', 'now'),
    strftime('%s', 'now'),
    'user_admin'
);

INSERT INTO ad_pods (id, organization_id, name, pod_id, duration_sec, status, assets, tracking_impressions, created_at, updated_at, created_by)
VALUES (
    'pod_demo_slate',
    'org_demo',
    'Default Slate',
    'slate',
    30,
    'active',
    '[{"bitrate": 800000, "url": "https://ads.example.com/slate/v_800k/playlist.m3u8"}, {"bitrate": 1600000, "url": "https://ads.example.com/slate/v_1600k/playlist.m3u8"}]',
    '["https://tracking.example.com/imp?pod=slate"]',
    strftime('%s', 'now'),
    strftime('%s', 'now'),
    'user_admin'
);

