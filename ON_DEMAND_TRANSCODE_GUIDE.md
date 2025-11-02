# On-Demand Transcoding Guide

## Overview

The on-demand transcoding system automatically generates missing ad variants when an ad is requested for a channel with a different bitrate ladder than the one it was originally uploaded for.

This enables **true cross-channel ad reuse** without requiring duplicate uploads.

## How It Works

### 1. **Ad Upload** (Initial)
- User uploads ad via Admin GUI
- Selects target channel (e.g., Channel A with bitrates `[800, 1600]`)
- Ad is transcoded to match Channel A's bitrate ladder
- Result: Ad has variants at 800kbps and 1600kbps

### 2. **Ad Request** (Cross-Channel)
- Ad is requested for Channel B with bitrates `[1000, 2000, 3000]`
- Decision service detects missing variants: `[1000, 2000, 3000]`
- **Automatically triggers on-demand transcode** for missing bitrates
- Returns closest available variants immediately (800k → 1000k, 1600k → 2000k)
- Transcoding happens in background

### 3. **Future Requests**
- Next time the ad is requested for Channel B, all variants are ready
- No fallback needed - exact bitrate matches available

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Decision Service                         │
│                                                             │
│  1. Load channel config (bitrate ladder)                   │
│  2. Check ad variants                                       │
│  3. If missing → queue on-demand transcode                 │
│  4. Return closest available variants (immediate)           │
└─────────────────────────────────────────────────────────────┘
                           ↓
         ┌─────────────────┴─────────────────┐
         ↓                                    ↓
┌──────────────────┐              ┌──────────────────────┐
│   KV Lock        │              │  Transcode Queue     │
│  (Dedup)         │              │                      │
│                  │              │  Job: {              │
│  Key: ad_123     │              │    adId              │
│  +bitrates       │              │    bitrates: ALL     │
│                  │              │    isOnDemand: true  │
└──────────────────┘              │  }                   │
                                  └──────────────────────┘
                                             ↓
                                  ┌──────────────────────┐
                                  │  Transcode Worker    │
                                  │                      │
                                  │  1. Download source  │
                                  │  2. FFmpeg transcode │
                                  │  3. Upload HLS to R2 │
                                  │  4. Update DB        │
                                  │  5. Release lock     │
                                  └──────────────────────┘
```

## Key Features

### ✅ **Automatic Variant Detection**
```typescript
// Decision service checks missing variants
const missingBitrates = await getMissingVariants(env, adId, channelBitrates)

if (missingBitrates.length > 0) {
  // Queue on-demand transcode (non-blocking)
  await queueOnDemandTranscode(env, adId, channelId, missingBitrates)
}
```

### ✅ **Concurrent Request Deduplication**
- Uses KV locks to prevent duplicate transcode jobs
- Multiple concurrent requests for same ad+bitrates → single transcode job
- Lock key: `transcode_lock:${adId}:${bitrates.join(',')}`
- Auto-expires after 10 minutes

### ✅ **Incremental Transcoding**
- Preserves existing variants
- Only transcodes missing bitrates
- Example: Ad has `[800, 1600]`, channel needs `[800, 1600, 3000]` → Only transcodes 3000k

### ✅ **Closest Bitrate Fallback**
- Returns immediately with closest available variant
- No playback interruption while transcoding completes
- Example: Need 2000k, have 1600k → Use 1600k now, queue 2000k for future

### ✅ **Smart Merging**
```typescript
// Merges new bitrates with existing
const allBitrates = [
  ...existingVariants.map(v => v.bitrate),  // [800, 1600]
  ...missingBitrates                         // [2000, 3000]
] // Result: [800, 1600, 2000, 3000]
```

## Database Schema

### Relevant Fields

**`channels` table:**
```sql
bitrate_ladder TEXT -- JSON array: [800, 1600, 2000, 3000]
```

**`ads` table:**
```sql
variants TEXT         -- JSON array: [{"bitrate": 800000, "url": "..."}, ...]
transcode_status TEXT -- 'ready', 'processing', 'queued', 'error'
```

## API Functions

### `getMissingVariants(env, adId, requiredBitrates)`
Returns bitrates that need to be transcoded.

**Returns:**
```typescript
[1000, 2000, 3000] // Missing bitrates in kbps
```

### `queueOnDemandTranscode(env, adId, channelId, missingBitrates)`
Queues transcode job with lock acquisition.

**Returns:**
```typescript
{
  queued: boolean,    // true if job queued, false if lock exists
  lockKey?: string    // Lock key for tracking
}
```

### `getVariantsForChannel(env, adId, channelId, channelBitrates, waitForCompletion)`
Main function - checks variants and queues transcode if needed.

**Parameters:**
- `waitForCompletion`: If true, blocks until transcode completes (60s timeout)

**Returns:**
```typescript
{
  variants: VariantInfo[],        // Current available variants
  missingBitrates: number[],       // Bitrates being transcoded
  transcodeQueued: boolean         // Whether transcode was queued
}
```

### `releaseTranscodeLock(env, adId, bitrates)`
Called by transcode worker on completion to release KV lock.

## Usage Example

### Scenario: Multi-Channel Deployment

**Setup:**
- Channel A (Sports): `[800, 1600]` kbps
- Channel B (News): `[1000, 2000, 3000]` kbps
- Channel C (Entertainment): `[500, 1000, 2000]` kbps

**Upload Ad:**
1. Upload "Beer Commercial" for Channel A
2. Transcoded to 800k + 1600k variants
3. Stored in R2 with 2 variants

**First Request on Channel B:**
```
t=0: Request ad for Channel B [1000, 2000, 3000]
     Missing: [1000, 2000, 3000]
     Returns: Closest available [800k→1000k, 1600k→2000k]
     Queues: Transcode job for [1000, 2000, 3000]
     
t=30s: Transcode completes
       Ad now has [800, 1000, 1600, 2000, 3000] variants

t=60s: Next request on Channel B
       Returns: Exact matches [1000k, 2000k, 3000k] ✅
```

**First Request on Channel C:**
```
t=0: Request ad for Channel C [500, 1000, 2000]
     Missing: [500] (1000, 2000 already exist from Channel B)
     Returns: Closest [800k→500k, 1000k✅, 2000k✅]
     Queues: Transcode job for [500] only
     
t=15s: Transcode completes
       Ad now has [500, 800, 1000, 1600, 2000, 3000] variants
```

**Result:** Single ad uploaded once, automatically adapts to all channel bitrate ladders!

## Configuration

### Environment Variables

**Required:**
- `KV` namespace binding (for transcode locks)
- `TRANSCODE_QUEUE` binding
- `DB` D1 database

**Optional:**
- Lock TTL: Hardcoded to 600 seconds (10 minutes)
- Poll interval (for `waitForCompletion`): 2 seconds
- Timeout: 60 seconds

### Wrangler Config

```toml
# Add KV namespace for transcode locks
[[kv_namespaces]]
binding = "KV"
id = "your-kv-id"  # Create via: wrangler kv:namespace create "TRANSCODE_LOCKS"

# Existing queue binding (already configured)
[[queues.producers]]
binding = "TRANSCODE_QUEUE"
queue = "transcode-queue"
```

## Monitoring & Debugging

### Log Messages

**Decision Service:**
```
Ad ad_123 missing variants [1000, 2000, 3000], queued=true
Queueing on-demand transcode for ad ad_123: adding [2000, 3000] to existing [800, 1600]
No exact match for 1600000bps, using closest: 2000000bps
```

**Transcode Worker:**
```
[TranscodeWorker] Starting job for ad ad_123
On-demand transcode: isOnDemand=true
Released transcode lock: transcode_lock:ad_123:1000,2000,3000
```

### KV Lock Inspection

```bash
# Check active locks
wrangler kv:key list --namespace-id=your-kv-id --prefix="transcode_lock:"

# Get lock details
wrangler kv:key get --namespace-id=your-kv-id "transcode_lock:ad_123:1000,2000"
```

### Database Queries

```sql
-- Check ad variants
SELECT id, name, variants, transcode_status 
FROM ads 
WHERE id = 'ad_123';

-- Parse variants JSON
SELECT 
  id,
  name,
  json_extract(variants, '$[*].bitrate') as bitrates
FROM ads 
WHERE transcode_status = 'ready';
```

## Performance Considerations

### Transcode Time
- 30-second ad: ~30-60 seconds per variant
- 3 new variants: ~1.5-3 minutes total
- Uses existing source file (no re-upload)

### Cost Optimization
- Only transcodes missing variants (incremental)
- Deduplication prevents redundant jobs
- Non-blocking: viewers never wait for transcoding

### Edge Cases

**What if transcode fails?**
- Ad remains in 'processing' state
- Retry logic (3 attempts with backoff)
- Falls back to closest available variants
- Lock auto-expires after 10 minutes

**What if lock expires during long transcode?**
- New request can queue duplicate job
- FFmpeg is idempotent - R2 overwrites with same result
- DB update is atomic - last write wins

**What if channel bitrate ladder changes?**
- Next ad request detects new missing bitrates
- Queues on-demand transcode for new bitrates
- Existing variants preserved

## Best Practices

### 1. **Initial Upload Strategy**
- Upload ads with most common bitrate ladder
- Example: `[800, 1600, 2400]` covers most channels
- On-demand transcoding fills gaps automatically

### 2. **Channel Configuration**
- Enable bitrate auto-detection: `bitrate_ladder_source = 'auto'`
- System detects live stream bitrates
- Updates channel config automatically

### 3. **Monitoring**
- Watch transcode queue depth
- Monitor KV lock expirations
- Alert on repeated transcode failures

### 4. **Testing**
```bash
# Test on-demand transcode
curl -X POST https://decision-worker/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"ch_test","durationSec":30}'

# Check worker logs
wrangler tail cf-ssai-decision --format=pretty
```

## Migration Notes

### From Old System
If you have existing ads without on-demand transcoding:
1. Ads work immediately with closest bitrate fallback
2. Missing variants queued automatically on first request
3. No manual intervention needed
4. Verify KV namespace is bound in wrangler.toml

### Rollback Plan
If on-demand transcoding causes issues:
1. Keep existing closest-bitrate fallback (already deployed)
2. Comment out `getVariantsForChannel()` call in decision-worker.ts
3. Redeploy: `npm run deploy:decision`
4. System falls back to closest-bitrate matching only

## Future Enhancements

### Possible Improvements
- [ ] Predictive transcoding (pre-transcode popular ads for all channels)
- [ ] Priority queue (urgent requests jump queue)
- [ ] Progressive quality (transcode lowest bitrate first for faster availability)
- [ ] Webhook notifications when on-demand transcode completes
- [ ] Admin GUI status page showing transcode progress

## Summary

**Before On-Demand Transcoding:**
- Upload ad for each channel separately
- Wastes storage and transcoding costs
- Admin burden to manage duplicates

**After On-Demand Transcoding:**
- Upload ad once
- Automatically adapts to all channels
- Zero admin overhead
- Optimal storage efficiency
- Seamless cross-channel reuse

🎉 **Result: True cross-channel ad library with automatic bitrate adaptation!**
