# 🔍 Frontend-Backend Integration Audit

**Date**: November 1, 2025  
**Status**: Audit Complete - Issues Found & Fixes Required

---

## 📋 Executive Summary

### ✅ What's Working
- API client properly configured with environment variables
- All API endpoints are **real** (no mock endpoints found)
- Backend properly uses per-channel configuration with fallbacks
- Database schema supports all configuration parameters
- R2 public URL correctly configured in production secrets

### ⚠️ Issues Found
1. **Placeholder URLs in wrangler.toml** (global fallbacks - not critical but should be updated)
2. **Missing frontend environment variable** for production deployment
3. **R2_PUBLIC_URL has placeholder** in wrangler configs (needs update)
4. **Missing configuration settings** that should be added

---

## 🔧 Issues & Fixes

### **Issue 1: Placeholder URLs in wrangler.toml**

**Location**: `wrangler.toml` lines 56-60, 66

**Current (PROBLEMATIC)**:
```toml
[vars]
ORIGIN_VARIANT_BASE = "https://origin.example.com/hls"
AD_POD_BASE = "https://ads.example.com/pods"
SIGN_HOST = "media.example.com"
R2_PUBLIC_URL = "https://pub-XXXXX.r2.dev"
```

**Why it matters**: These are **global fallback defaults** used when:
- Channel-specific config is not set
- Database lookup fails
- Initial channel creation (before per-channel URLs are configured)

**Impact**: LOW (per-channel config overrides these, but good practice to set real values)

**Fix Required**:
```toml
[vars]
# Global fallbacks - use real R2 URLs or your CDN
ORIGIN_VARIANT_BASE = "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/origin"
AD_POD_BASE = "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads"
SIGN_HOST = "pub-24423d0273094578a7f498bd462c2e20.r2.dev"
R2_PUBLIC_URL = "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev"
```

---

### **Issue 2: wrangler-transcode.toml R2_PUBLIC_URL**

**Location**: `wrangler-transcode.toml` line 44

**Current**:
```toml
R2_PUBLIC_URL = "https://pub-XXXXX.r2.dev"
```

**Fix Required**:
```toml
R2_PUBLIC_URL = "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev"
```

---

### **Issue 3: Frontend Environment Variable Not Set for Production**

**Location**: Frontend needs `NEXT_PUBLIC_API_URL` during build

**Current**: Uses `deploy-prod.sh` script which expects URL as argument

**Issue**: No persistent `.env.production` file for Pages deployment

**Fix Required**: Create `.env.production` in admin-frontend:
```bash
# admin-frontend/.env.production
NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.mediamasters.workers.dev
```

---

### **Issue 4: Missing Secrets in Production**

**Required Production Secrets** (not yet verified):

#### Admin API Worker (`cf-ssai-admin-api`)
- ✅ `R2_ACCOUNT_ID` (set)
- ✅ `R2_ACCESS_KEY_ID` (set)
- ✅ `R2_SECRET_ACCESS_KEY` (set)
- ⚠️ `JWT_SECRET` (needs verification)

#### Manifest Worker (`cf-ssai`)
- ⚠️ `JWT_PUBLIC_KEY` (needs verification)
- ⚠️ `SEGMENT_SECRET` (needs verification)
- ⚠️ `R2_ACCOUNT_ID` (needs to be set)
- ⚠️ `R2_ACCESS_KEY_ID` (needs to be set)
- ⚠️ `R2_SECRET_ACCESS_KEY` (needs to be set)

#### Transcode Worker (`cf-ssai-transcode`)
- ✅ `R2_ACCOUNT_ID` (set)
- ✅ `R2_ACCESS_KEY_ID` (set)
- ✅ `R2_SECRET_ACCESS_KEY` (set)

---

## 📊 Configuration Review

### **Per-Channel Settings (Database Driven)**

All these are properly stored in the `channels` table and override global defaults:

| Setting | Field | Configured Via GUI | Backend Support |
|---------|-------|-------------------|-----------------|
| Origin URL | `origin_url` | ✅ Yes | ✅ Yes |
| Ad Pod Base URL | `ad_pod_base_url` | ✅ Yes | ✅ Yes |
| Sign Host | `sign_host` | ✅ Yes | ✅ Yes |
| SCTE-35 Detection | `scte35_enabled` | ✅ Yes | ✅ Yes |
| SCTE-35 Auto Insert | `scte35_auto_insert` | ✅ Yes | ✅ Yes |
| VAST URL | `vast_url` | ✅ Yes | ✅ Yes |
| VAST Timeout | `vast_timeout_ms` | ✅ Yes | ✅ Yes |
| Default Ad Duration | `default_ad_duration` | ✅ Yes | ✅ Yes |
| Slate Pod ID | `slate_pod_id` | ✅ Yes | ✅ Yes |
| Time-based Auto Insert | `time_based_auto_insert` | ✅ Yes | ✅ Yes |
| Segment Cache Max Age | `segment_cache_max_age` | ✅ Yes | ✅ Yes |
| Manifest Cache Max Age | `manifest_cache_max_age` | ✅ Yes | ✅ Yes |

---

## 🎯 Recommended Additional Settings

### **Settings Currently Missing from GUI**

These are in the database schema but not exposed in the GUI:

#### 1. **Bitrate Limits** (in `settings` JSON field)
- `max_bitrate`: Maximum bitrate for ABR selection
- `min_bitrate`: Minimum bitrate for ABR selection
- **Use Case**: Limit bandwidth consumption or ensure minimum quality
- **Default**: null (no limits)

#### 2. **HLS Preference** (in `settings` JSON field)
- `prefer_hls`: Boolean flag
- **Use Case**: Prefer HLS over DASH when both available
- **Default**: true

#### 3. **Ad Insertion Mode**
- **Current**: Only `mode: 'auto'` (always enabled)
- **Recommended**: Add `mode` options:
  - `auto`: Always insert ads
  - `scte35_only`: Only insert on SCTE-35 markers
  - `manual`: Only insert via API calls
  - `disabled`: No ad insertion

#### 4. **Geographic/Targeting Settings**
- Currently missing from schema
- **Recommended**: Add `geo_restrictions`, `allowed_countries`, `blocked_countries`
- **Use Case**: Regional ad targeting and content restrictions

#### 5. **Rate Limiting**
- Currently missing from schema
- **Recommended**: Add `max_requests_per_minute`, `max_concurrent_viewers`
- **Use Case**: Prevent abuse and manage costs

#### 6. **Monitoring & Alerting**
- Currently missing from schema
- **Recommended**: Add `alert_email`, `alert_on_error`, `alert_on_spike`
- **Use Case**: Proactive monitoring

---

## 🔍 Data Structure Review

### **Current Schema (ads table)**

```sql
CREATE TABLE ads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  duration INTEGER DEFAULT 0,
  source_key TEXT,                    -- R2 path to source
  transcode_status TEXT DEFAULT 'pending',
  master_playlist_url TEXT,           -- HLS master playlist
  variants TEXT,                      -- JSON array of bitrate variants
  error_message TEXT,
  transcoded_at INTEGER,
  channel_id TEXT,                    -- For bitrate matching
  file_size INTEGER DEFAULT 0,
  mime_type TEXT,
  original_filename TEXT,
  tracking_urls TEXT,                 -- JSON array
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);
```

### **Recommended Additions**

#### 1. **Ad Scheduling Fields**
```sql
-- Add to ads table
ALTER TABLE ads ADD COLUMN valid_from INTEGER;  -- Unix timestamp
ALTER TABLE ads ADD COLUMN valid_until INTEGER; -- Unix timestamp
ALTER TABLE ads ADD COLUMN timezone TEXT DEFAULT 'UTC';
```

**Use Case**: Schedule ads for specific time periods (holiday campaigns, etc.)

#### 2. **Ad Targeting Fields**
```sql
-- Add to ads table
ALTER TABLE ads ADD COLUMN target_countries TEXT;  -- JSON array ["US", "CA"]
ALTER TABLE ads ADD COLUMN target_devices TEXT;    -- JSON array ["mobile", "desktop"]
ALTER TABLE ads ADD COLUMN target_tags TEXT;       -- JSON array ["sports", "news"]
```

**Use Case**: Target ads to specific audiences

#### 3. **Ad Performance Tracking**
```sql
-- Add to ads table
ALTER TABLE ads ADD COLUMN impression_count INTEGER DEFAULT 0;
ALTER TABLE ads ADD COLUMN click_count INTEGER DEFAULT 0;
ALTER TABLE ads ADD COLUMN error_count INTEGER DEFAULT 0;
ALTER TABLE ads ADD COLUMN last_served_at INTEGER;
```

**Use Case**: Track ad performance and optimize delivery

#### 4. **Ad Pacing/Budget**
```sql
-- Add to ads table
ALTER TABLE ads ADD COLUMN max_impressions INTEGER;     -- Max times to serve
ALTER TABLE ads ADD COLUMN max_impressions_per_day INTEGER;
ALTER TABLE ads ADD COLUMN remaining_budget REAL;       -- For CPM campaigns
```

**Use Case**: Control ad frequency and budget

#### 5. **Ad Priority/Weight**
```sql
-- Add to ads table
ALTER TABLE ads ADD COLUMN priority INTEGER DEFAULT 0;  -- Higher = more priority
ALTER TABLE ads ADD COLUMN weight INTEGER DEFAULT 100;  -- For weighted random selection
```

**Use Case**: Prioritize certain ads or implement weighted rotation

---

## 🏗️ Architecture Notes

### **How Configuration Flows**

```
┌─────────────────────────────────────────────────────────┐
│  1. Admin GUI (Next.js)                                 │
│     → Sets per-channel configuration                    │
│     → NEXT_PUBLIC_API_URL → Admin API Worker            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  2. Admin API Worker (cf-ssai-admin-api)                │
│     → Stores config in D1 database                      │
│     → Handles uploads to R2                             │
│     → Queues transcode jobs                             │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  3. Manifest Worker (cf-ssai)                           │
│     → Reads channel config from D1 (cached in KV)       │
│     → Uses per-channel settings (origin_url, etc.)      │
│     → Fallback to wrangler.toml vars if not set         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  4. Channel Durable Object (ChannelDO)                  │
│     → Receives per-channel config via headers           │
│     → Uses X-Origin-Url, X-Ad-Pod-Base, X-Sign-Host     │
│     → Inserts ads from ad_pod_base_url                  │
└─────────────────────────────────────────────────────────┘
```

**Key Insight**: The `wrangler.toml` URLs (`ORIGIN_VARIANT_BASE`, `AD_POD_BASE`, etc.) are **only fallbacks**. Once a channel is created via the GUI with specific URLs, those take precedence.

---

## ✅ Action Items

### **Critical (Must Fix Before Production)**
1. ✅ Update `R2_PUBLIC_URL` in `wrangler.toml`
2. ✅ Update `R2_PUBLIC_URL` in `wrangler-transcode.toml`
3. ⚠️ Set production secrets for JWT and segment signing
4. ⚠️ Create `admin-frontend/.env.production` with API URL
5. ⚠️ Deploy frontend with production API URL

### **Recommended (Should Fix Soon)**
1. Update global fallback URLs in `wrangler.toml` to use real R2 URLs
2. Add `mode` field to channels for ad insertion control
3. Add ad scheduling fields (valid_from, valid_until)
4. Add ad targeting fields (countries, devices, tags)
5. Expose bitrate limits in GUI

### **Nice to Have (Future Enhancements)**
1. Add geographic restrictions
2. Add rate limiting per channel
3. Add ad performance tracking
4. Add ad pacing/budget controls
5. Add monitoring & alerting

---

## 📝 Summary

### **Overall Assessment**: 🟢 **GOOD**

- ✅ No mock endpoints detected
- ✅ All API calls are real
- ✅ Per-channel configuration properly implemented
- ✅ Database schema supports all current features
- ⚠️ Minor cleanup needed (placeholder URLs)
- ⚠️ Missing some production secrets verification

### **Configuration Model**: 🟢 **EXCELLENT**

The system uses a **3-tier configuration model**:
1. **Global Defaults** (wrangler.toml) - fallback only
2. **Channel-Specific** (D1 database) - primary source
3. **Request-Level** (headers) - runtime overrides

This is a **best practice** for multi-tenant systems!

---

**Next Steps**: Apply fixes and deploy to production ✅

