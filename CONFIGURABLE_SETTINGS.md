# Configurable Channel Settings

All ad insertion and caching behavior is now configurable per-channel via the Admin GUI.

## New Settings (Available in Admin GUI → Channels → Edit Channel)

### 1. **SCTE-35 Auto-Insert** (Default: OFF)
- **Location:** SCTE-35 Configuration section
- **Purpose:** Automatically trigger ad insertion when SCTE-35 markers are detected in the origin stream
- **When to enable:** When you have valid ad assets configured and want automatic ad insertion
- **When to disable:** During testing, or when you only want manual API-triggered ads

### 2. **Time-Based Auto-Insert** (Default: OFF)
- **Location:** Auto-Insertion section
- **Purpose:** Insert ads at scheduled intervals (every 5 minutes) for testing
- **When to enable:** For testing ad insertion without SCTE-35 markers
- **When to disable:** In production (use SCTE-35 or manual API triggers instead)

### 3. **Segment Cache Max-Age** (Default: 60 seconds)
- **Location:** Cache Configuration section
- **Purpose:** How long browsers cache video segments
- **Recommended values:**
  - Safari: 60-120 seconds (Safari needs longer buffering)
  - Chrome/Firefox: 30-60 seconds
  - Low latency: 10-30 seconds

### 4. **Manifest Cache Max-Age** (Default: 4 seconds)
- **Location:** Cache Configuration section
- **Purpose:** How long browsers cache the manifest playlist
- **Recommended values:**
  - Live streams: 3-6 seconds
  - VOD: 10-30 seconds
  - Ultra-low latency: 1-2 seconds

## Migration

If you have an existing database, run the migration:

```bash
npx wrangler d1 execute ssai-admin --local --file=migrations/002_add_auto_insert_and_cache_settings.sql
```

For production:
```bash
npx wrangler d1 execute ssai-admin --remote --file=migrations/002_add_auto_insert_and_cache_settings.sql
```

## API Usage

These settings can also be managed via the Admin API:

### Create Channel
```bash
curl -X POST https://admin-api.example.com/api/channels \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Channel",
    "slug": "my-channel",
    "origin_url": "https://origin.example.com/stream",
    "scte35_auto_insert": 0,
    "time_based_auto_insert": 0,
    "segment_cache_max_age": 60,
    "manifest_cache_max_age": 4
  }'
```

### Update Channel
```bash
curl -X PUT https://admin-api.example.com/api/channels/CHANNEL_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scte35_auto_insert": 1,
    "segment_cache_max_age": 120
  }'
```

## Safari Compatibility

**Problem:** Safari was stopping playback after 6-8 seconds on streams with SCTE-35 markers.

**Solution:** 
1. Set `scte35_auto_insert` to `0` (disabled) to prevent automatic ad insertion with placeholder/invalid ad URLs
2. Increase `segment_cache_max_age` to 60-120 seconds for better Safari buffering
3. Origin SCTE-35 markers are automatically stripped from manifests (but still logged internally)

**Result:** Stream plays smoothly in Safari, ads only trigger when explicitly called via API with valid ad assets.

## Testing Flow

1. **Initial Setup:**
   - Create channel with auto-insert OFF
   - Test stream plays smoothly
   - Verify no automatic ad breaks

2. **Manual Ad Testing:**
   - Trigger ad via API: `curl -X POST http://localhost:8787/cue -d '{"channel":"sports","duration":30}'`
   - Verify ad marker appears in manifest
   - Confirm playback behavior

3. **Enable Auto-Insert:**
   - Once you have valid ad assets configured
   - Enable `scte35_auto_insert` in Admin GUI
   - Test automatic ad insertion on SCTE-35 signals

## Cache Invalidation

When updating channel settings, the config cache is automatically invalidated. For manual cache clearing:

```bash
# Local
npx wrangler kv key delete "channel:ORGSLUG:CHANNELSLUG" --binding=CHANNEL_CONFIG_CACHE --local

# Remote
npx wrangler kv key delete "channel:ORGSLUG:CHANNELSLUG" --binding=CHANNEL_CONFIG_CACHE
```

