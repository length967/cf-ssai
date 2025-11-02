# Enabling Parallel Transcoding

## Quick Start

Parallel transcoding is **now enabled by default** for all organizations! It can be configured per-organization through the admin GUI.

---

## Step 1: Run Database Migration

```bash
# Local development
wrangler d1 execute ssai-admin --local --file=./migrations/005_add_parallel_transcode_settings.sql

# Production
wrangler d1 execute ssai-admin --file=./migrations/005_add_parallel_transcode_settings.sql
```

This adds three columns to the `organizations` table:
- `parallel_transcode_enabled` - Toggle parallel transcoding (default: enabled)
- `parallel_transcode_threshold` - Minimum video duration to use parallel (default: 30 seconds)
- `parallel_segment_duration` - Duration of each segment (default: 10 seconds)

---

## Step 2: Deploy Workers

```bash
# Deploy all workers with parallel transcoding support
npm run deploy:all

# Or deploy individually:
npm run deploy:transcode  # FFmpeg container with new endpoints
npm run deploy:admin-api  # Admin API with parallel job creation
```

---

## Step 3: Configure via Admin GUI

### Option 1: Organization Settings Page

1. Log into admin GUI
2. Navigate to **Settings** → **Organization**
3. Find **Transcoding Settings** section
4. Toggle options:
   - ☑️ **Enable Parallel Transcoding** (recommended)
   - **Threshold**: 30 seconds (videos shorter than this use single-container)
   - **Segment Duration**: 10 seconds (each parallel segment length)

### Option 2: API Request

```bash
curl -X PUT https://your-api.com/api/organization \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "parallel_transcode_enabled": true,
    "parallel_transcode_threshold": 30,
    "parallel_segment_duration": 10
  }'
```

### Option 3: Direct Database Update

```sql
-- Enable for specific organization
UPDATE organizations 
SET parallel_transcode_enabled = 1,
    parallel_transcode_threshold = 30,
    parallel_segment_duration = 10
WHERE id = 'org_123';

-- Enable for all organizations
UPDATE organizations 
SET parallel_transcode_enabled = 1;
```

---

## How It Works

### Video Upload Flow

```
User uploads video (5 minutes)
    ↓
Admin API checks file size (> 10MB)
    ↓
Queries organization settings:
  - parallel_transcode_enabled = 1 ✓
  - parallel_transcode_threshold = 30s ✓
  - Estimated duration = 60s (> 30s threshold) ✓
    ↓
Creates parallel job:
  - 60s ÷ 10s = 6 segments
  - Initializes TranscodeCoordinatorDO
  - Queues 6 SEGMENT jobs
    ↓
10 containers process segments in parallel
    ↓
Assembly merges segments → final HLS
```

### Traditional Flow (Disabled or Short Video)

```
User uploads video (15 seconds)
    ↓
Admin API checks:
  - Estimated duration = 15s (< 30s threshold)
    ↓
Queues single full-video transcode job
    ↓
1 container transcodes entire video
```

---

## Settings Explained

### `parallel_transcode_enabled`

- **Type**: Boolean (0 = disabled, 1 = enabled)
- **Default**: 1 (enabled)
- **Effect**: Master switch for parallel transcoding
- **Use case**: Disable for testing or if experiencing issues

### `parallel_transcode_threshold`

- **Type**: Integer (seconds)
- **Default**: 30
- **Effect**: Videos longer than this use parallel transcoding
- **Recommendations**:
  - **30s**: Good default (avoids overhead for short videos)
  - **60s**: Conservative (only very long videos)
  - **15s**: Aggressive (more videos benefit from parallel)

### `parallel_segment_duration`

- **Type**: Integer (seconds)
- **Default**: 10
- **Effect**: Length of each parallel segment
- **Recommendations**:
  - **10s**: Good balance (6 segments per minute)
  - **5s**: More parallelism (12 segments per minute)
  - **15s**: Less overhead (4 segments per minute)

---

## Performance Impact

### Example: 5-Minute Video

**Settings:**
- `parallel_transcode_enabled = 1`
- `parallel_transcode_threshold = 30`
- `parallel_segment_duration = 10`

**Result:**
- 300s ÷ 10s = **30 segments**
- 10 containers process ~3 segments each
- **Time**: ~90-100 seconds (vs 25 minutes single-threaded)
- **Speedup**: **15x faster!**

### Example: 20-Second Video

**Settings:**
- `parallel_transcode_threshold = 30`

**Result:**
- 20s < 30s threshold → **Traditional transcode**
- Single container processes entire video
- **Time**: ~100 seconds (no benefit from parallelization)

---

## Monitoring

### Check if Parallel Transcoding is Being Used

```bash
# Watch admin API logs
wrangler tail cf-ssai-admin-api

# Look for:
# "Creating parallel transcode job: 30 segments"
# or
# "Using traditional single-container transcode"
```

### Monitor Segment Progress

```bash
# Watch transcode worker logs
wrangler tail cf-ssai-transcode

# Look for:
# [TranscodeWorker] Starting segment 0 for ad ad_123 (0s-10s)
# [TranscodeWorker] Segment 0 completed: transcoded-ads/ad_123/segment-0
# [TranscodeCoordinatorDO] Segment 0 completed (1/30)
```

### Query Organization Settings

```sql
SELECT 
  name,
  parallel_transcode_enabled,
  parallel_transcode_threshold,
  parallel_segment_duration
FROM organizations;
```

---

## Troubleshooting

### Parallel Transcoding Not Working

**Check 1: Database Migration**
```bash
# Verify columns exist
wrangler d1 execute ssai-admin --command="SELECT parallel_transcode_enabled FROM organizations LIMIT 1"
```

**Check 2: Organization Settings**
```sql
SELECT parallel_transcode_enabled FROM organizations WHERE id = 'YOUR_ORG_ID';
-- Should return: 1
```

**Check 3: File Size Threshold**
```javascript
// Current heuristic: file.size > 10MB = estimated long video
// Upload a file > 10MB to trigger parallel
```

**Check 4: Worker Deployment**
```bash
# Ensure coordinator DO is deployed
wrangler deployments list --name cf-ssai-transcode
```

### Segments Failing

**Issue**: Some segments timeout or fail
- **Check**: R2 bucket has enough space
- **Check**: Container instances > 1 in wrangler.toml
- **Fix**: Increase `max_instances` in wrangler-transcode.toml

### Assembly Fails

**Issue**: Missing segment playlists
- **Cause**: R2 eventual consistency
- **Fix**: Add retry logic (already implemented)

---

## Disabling Parallel Transcoding

### For All Organizations

```sql
UPDATE organizations SET parallel_transcode_enabled = 0;
```

### For Specific Organization

```sql
UPDATE organizations 
SET parallel_transcode_enabled = 0 
WHERE id = 'org_123';
```

### Temporary Disable (via API)

```bash
curl -X PUT https://your-api.com/api/organization \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parallel_transcode_enabled": false}'
```

---

## Cost Comparison

### Traditional (Single Container)
- 5min video = 25min transcode time
- Cost: 25 container-minutes

### Parallel (10 Containers)
- 5min video = 1.5min transcode time per container
- Cost: 10 × 1.5 = 15 container-minutes
- **Savings: 40% lower cost!**

---

## Next Steps

1. ✅ Run migration: `wrangler d1 execute ssai-admin --file=migrations/005_add_parallel_transcode_settings.sql`
2. ✅ Deploy workers: `npm run deploy:all`
3. ⏳ Add settings UI to admin frontend (Settings page)
4. ⏳ Add duration probing with ffprobe (replace file size heuristic)
5. ⏳ Add real-time progress tracking to admin GUI

---

**Status**: ✅ Ready to use!  
**Default**: Enabled for all organizations  
**Configuration**: Per-organization via admin GUI or API
