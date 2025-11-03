# Critical Bitrate Matching Analysis & Fixes

## Current State (BROKEN)

### Origin Stream (Demo SCTE35)
```
#EXT-X-STREAM-INF:BANDWIDTH=1316000,AVERAGE-BANDWIDTH=1196000 (video+audio)
scte35-audio_eng=128000-video=1000000.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=150000,AVERAGE-BANDWIDTH=136000 (audio-only)
scte35-audio_eng=128000.m3u8

#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=146000 (iframe - DO NOT USE for regular playback)
```

**Actual playable variants:** `[150k, 1316k]` (2 variants)

### Channel Database (WRONG)
```
bitrate_ladder: [136, 146, 1196]  ❌ WRONG - uses AVERAGE-BANDWIDTH + iframe
detected_bitrates: [150, 1316]     ✅ CORRECT
bitrate_ladder_source: manual      ❌ BAD - locked to wrong values
```

### Current Ad (WRONG)
```
variants: [800k, 1600k, 2400k]  ❌ NO OVERLAP with stream
```

## Why This Causes Stuttering

**When player requests 1316k variant during ad break:**
1. Player: "Give me 1316k variant"
2. System: "Closest ad variant is 800k" (picks lowest)
3. **Bitrate mismatch: 1316k → 800k = 40% of expected bitrate**
4. Player buffers/stutters due to sudden quality drop

**When player requests 150k variant during ad break:**
1. Player: "Give me 150k variant (audio-only)"
2. System: "Closest ad variant is 800k"
3. **Bitrate mismatch: 150k → 800k = 533% of expected bitrate**
4. Player may fail to load or stutter due to oversized segments

## The Fix

### Step 1: Fix Channel Configuration

```bash
# Reset to use detected bitrates (correct values)
wrangler d1 execute ssai-admin --remote --command "
  UPDATE channels 
  SET bitrate_ladder = '[150, 1316]',
      bitrate_ladder_source = 'auto'
  WHERE id = 'ch_demo_sports'
"
```

### Step 2: Re-Transcode Ad with Correct Bitrates

```bash
curl -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads/ad_1762091472274_yaqfua2ch/retranscode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bitrates": [150, 1316]}'
```

### Step 3: Verify Detection Logic

The detection logic needs to:
1. ✅ Extract BANDWIDTH (not AVERAGE-BANDWIDTH) 
2. ✅ Ignore iframe streams
3. ✅ Convert bps to kbps correctly

Let me check if we're accidentally including iframe streams...

## Detection Logic Review

Looking at the HLS utils:

```typescript
export function extractBitrates(masterManifest: string): number[] {
  const lines = masterManifest.split('\n')
  const variants = parseVariant(lines)  // ← This only gets #EXT-X-STREAM-INF
  
  const bitrates = variants
    .map(v => v.bandwidth)
    .filter((bw): bw is number => bw !== undefined)
    .map(bw => Math.round(bw / 1000)) // bps → kbps
    .sort((a, b) => a - b)
  
  return Array.from(new Set(bitrates))
}

function parseVariant(lines: string[]): VariantInfo[] {
  // Only parses #EXT-X-STREAM-INF (NOT iframes)
  // ...
}
```

✅ **This is correct** - it only extracts regular stream variants, not iframes.

## Why Detection Shows [150, 1316]

The auto-detection IS working correctly:
- Detects BANDWIDTH values: `[1316000, 150000]` bps
- Converts to kbps: `[1316, 150]`  
- Sorts: `[150, 1316]`
- Stores in `detected_bitrates`: `[150, 1316]` ✅

## Why Manual Override is Wrong

Someone (or earlier code) set:
```sql
UPDATE channels SET 
  bitrate_ladder = '[136, 146, 1196]',
  bitrate_ladder_source = 'manual'
```

This used:
- `136` = AVERAGE-BANDWIDTH of audio-only (wrong)
- `146` = iframe BANDWIDTH (wrong - not a playable variant)
- `1196` = AVERAGE-BANDWIDTH of video (wrong)

Should have been:
- `150` = BANDWIDTH of audio-only variant ✅
- `1316` = BANDWIDTH of video+audio variant ✅

## Additional Issues to Check

### Issue 1: Audio-Only Variant Handling

The 150k variant is **audio-only** (no video). When inserting ads:
- Can we serve an audio-only ad variant?
- Or should we skip ad insertion for audio-only playback?

**Current behavior:** System tries to match 150k with closest ad variant (800k video), which fails because:
- Client expects audio-only
- Gets video+audio at much higher bitrate
- **Result: Playback failure**

**Fix Options:**

**Option A: Skip ads for audio-only variants**
```typescript
// In channel-do.ts
if (viewerBitrate < 200000) {
  console.log('Audio-only variant detected, skipping ad insertion')
  return cleanOriginManifest // No ads for audio-only
}
```

**Option B: Create audio-only ad variants**
Transcode ads with audio-only variants at low bitrates

### Issue 2: Closest Match Algorithm

Current logic in channel-do.ts:
```typescript
let adItem = pod.items.find(item => item.bitrate === viewerBitrate)

if (!adItem && pod.items.length > 0) {
  const sorted = [...pod.items].sort((a, b) => {
    const diffA = Math.abs(a.bitrate - viewerBitrate)
    const diffB = Math.abs(b.bitrate - viewerBitrate)
    if (diffA === diffB) return a.bitrate - b.bitrate
    return diffA - diffB
  })
  adItem = sorted[0]
}
```

This **should work** but needs exact bitrate values in bps, not kbps.

**Check:** Are we comparing bps to bps, or kbps to bps?

### Issue 3: Bitrate Unit Consistency

- Channel `bitrate_ladder`: stored as **kbps** (e.g., `[150, 1316]`)
- Ad `variants.bitrate`: stored as **bps** (e.g., `150000, 1316000`)
- Channel DO `viewerBitrate`: extracted as **bps** (e.g., `1000000`)

**Need to ensure:** Comparison happens in same units (bps).

## Comprehensive Test Plan

### Test 1: Verify Detection
```bash
# Fetch master manifest and check detection
curl -s "https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8"

# Should show only 2 variants (not 3)
# Check logs for "Detected bitrates: [150, 1316]"
```

### Test 2: Verify Ad Variants Match
```bash
# After re-transcode, check ad variants
wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, variants FROM ads WHERE id = 'ad_1762091472274_yaqfua2ch'"

# Should show: [{"bitrate":150000,...}, {"bitrate":1316000,...}]
```

### Test 3: Test Each Variant During Ad Break
```bash
# Test 1316k variant (video)
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8"

# Test 150k variant (audio-only)
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000.m3u8"

# Both should return valid manifests with matching ad variants
```

### Test 4: Monitor Logs During Playback
```bash
wrangler tail cf-ssai --format pretty | grep -E "(bitrate|match|closest)"

# Should see:
# "Extracted X ad segments from playlist: .../150k/playlist.m3u8" (for audio-only)
# "Extracted X ad segments from playlist: .../1316k/playlist.m3u8" (for video)
# NOT: "using closest" or "No exact match"
```

## Immediate Actions Required

### 1. Fix Channel Config (NOW)
```bash
wrangler d1 execute ssai-admin --remote --command "
  UPDATE channels 
  SET bitrate_ladder = '[150, 1316]',
      bitrate_ladder_source = 'auto'
  WHERE id = 'ch_demo_sports'
"
```

### 2. Re-Transcode Ad (NOW)
```bash
curl -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads/ad_1762091472274_yaqfua2ch/retranscode \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"bitrates": [150, 1316]}'
```

### 3. Wait for Transcode (2-5 minutes)
```bash
# Monitor progress
wrangler tail cf-ssai-transcode
```

### 4. Clear Caches (AFTER transcode completes)
```bash
# Clear decision cache
wrangler kv key delete "decision:ch_demo_sports:38.4:US:default" \
  --namespace-id=4beba810f4d141e7be9e3298c7b07944

# Clear channel config cache
wrangler kv key delete "channel:demo:sports" \
  --namespace-id=f03509ea56964ca3ad062b116a683dc4
```

### 5. Test Playback
Load stream in HLS.js player and trigger ad break (SCTE-35 signal should occur every ~2 minutes).

Monitor for:
- ✅ No buffering during ad transitions
- ✅ Smooth quality switches
- ✅ No "levelEmptyError" messages
- ✅ No stuttering

## Long-Term Improvements

### 1. Add Bitrate Validation
Warn if ad bitrates don't match channel:
```typescript
const channelBitrates = JSON.parse(channel.bitrate_ladder)
const adBitrates = variants.map(v => Math.round(v.bitrate / 1000))

const missing = channelBitrates.filter(cb => 
  !adBitrates.some(ab => Math.abs(ab - cb) < 50) // 50kbps tolerance
)

if (missing.length > 0) {
  console.warn(`Ad missing bitrates: ${missing} - may cause playback issues`)
}
```

### 2. Add Audio-Only Detection
```typescript
function isAudioOnly(variant: string): boolean {
  // Check if variant name contains only audio codec
  return variant.includes('audio') && !variant.includes('video')
}

if (isAudioOnly(variant)) {
  console.log('Audio-only variant, skipping SSAI (or serving audio-only ad)')
  return cleanOriginManifest
}
```

### 3. Add Bitrate Matching Report
In admin GUI, show warning if ad doesn't match channel:
```tsx
{ad.channel_id && (
  <BitrateMatchIndicator 
    adBitrates={ad.variant_bitrates}
    channelBitrates={channel.bitrate_ladder}
  />
)}
```

## Success Criteria

After fixes, you should see:
1. ✅ Channel bitrate ladder: `[150, 1316]`
2. ✅ Ad variants: `[150k, 1316k]`
3. ✅ Logs show "exact match" for both variants
4. ✅ No stuttering during ad playback
5. ✅ Smooth transitions between content and ads

## Why This Matters

**Perfect bitrate matching ensures:**
- No rebuffering during ad breaks
- Seamless quality transitions
- Player doesn't have to switch quality mid-ad
- Consistent viewer experience
- No decoder issues from mismatched profiles
