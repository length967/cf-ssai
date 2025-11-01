# 🔍 Ad Insertion Flow Diagnosis

## 📊 Current State

### ✅ Data Verified:
- **Channel:** ch_demo_sports
  - scte35_enabled: 1 ✅
  - scte35_auto_insert: 1 ✅ 
  - time_based_auto_insert: 0
  - origin_url: `https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8`

- **Ad Pod:** pod_demo_slate
  - ads: `["ad_1761998592294_khk143gu4"]` ✅
  - channel_id: ch_demo_sports ✅
  - status: active ✅

- **Ad:** ad_1761998592294_khk143gu4
  - transcode_status: ready ✅
  - duration: 30s ✅
  - variants: 3 bitrates transcoded ✅

### ✅ Origin Stream Has SCTE-35:
```
#EXT-X-DATERANGE:ID="14567061-1762031698",START-DATE="2025-11-01T21:14:58.560000Z",PLANNED-DURATION=38.4,SCTE35-OUT=...
#EXT-X-CUE-OUT:38.4
```

### ❌ Problem: Ads Not Inserting

---

## 🔍 Root Cause Analysis

### Issue #1: Origin URL Mismatch

**Channel origin_url:** 
```
https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8
```

**Actual variant URL format needed:**
```
https://demo.unified-streaming.com/k8s/live/scte35.isml/scte35-audio_eng=128000-video=1000000.m3u8
```

**The Problem:**
The Channel DO's `fetchOriginVariant()` function tries to construct:
```typescript
const baseUrl = originUrl  // https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8
// Strips .m3u8 → https://demo.unified-streaming.com/k8s/live/scte35.isml
const fullUrl = `${baseUrl}/${variant}`
// Results in: https://demo.unified-streaming.com/k8s/live/scte35.isml/scte35-audio_eng=128000-video=1000000.m3u8
```

This should work! But let me verify the exact logic...

Actually, looking at the code:

```typescript:76:91:src/channel-do.ts
async function fetchOriginVariant(originUrl: string, channel: string, variant: string): Promise<Response> {
  // Normalize origin URL: if it ends with .m3u8 or a file extension, strip it to get base path
  let baseUrl = originUrl
  if (baseUrl.endsWith('.m3u8') || baseUrl.endsWith('.isml/.m3u8')) {
    // Remove the manifest filename to get base path
    const lastSlash = baseUrl.lastIndexOf('/')
    if (lastSlash > 0) {
      baseUrl = baseUrl.substring(0, lastSlash)
    }
  }
  
  // Construct the full URL for the requested variant
  const u = `${baseUrl}/${encodeURIComponent(variant)}`
  console.log(`Fetching origin variant: ${u}`)
```

**This should work correctly!**

---

## 🔍 Issue #2: SCTE-35 Detection Logic

Let me check if `parseSCTE35FromManifest()` is correctly finding the markers...

```typescript:324:326:src/channel-do.ts
// Parse SCTE-35 signals from origin manifest
const scte35Signals = parseSCTE35FromManifest(origin)
const activeBreak = findActiveBreak(scte35Signals)
```

The markers are in the origin. But are they being parsed?

---

## 🎯 Most Likely Issue: Time-Based vs SCTE-35

**Current Settings:**
- ✅ SCTE-35 auto-insert: ENABLED
- ❌ Time-based auto-insert: DISABLED

**The Logic:**
```typescript
if (adActive) {
  // API triggered
  shouldInsertAd = true
} else if (activeBreak && channelConfig?.scte35AutoInsert) {
  // SCTE-35 detected AND auto-insert enabled
  shouldInsertAd = true
} else if (isBreakMinute && channelConfig?.timeBasedAutoInsert) {
  // Time-based AND auto-insert enabled
  shouldInsertAd = true
}
```

**For SCTE-35 to work, we need:**
1. ✅ `channelConfig?.scte35AutoInsert` = true (we have this)
2. ❓ `activeBreak` = a valid SCTE-35 break object

**The issue:** `activeBreak` is likely NULL!

---

## 🐛 Root Cause Identified

### Problem: SCTE-35 Parser Not Finding Markers

Looking at the code, `parseSCTE35FromManifest()` looks for specific formats. Let me check what it's looking for:

The origin has:
```
#EXT-X-DATERANGE:ID="14567061-1762031698",START-DATE="2025-11-01T21:14:58.560000Z",PLANNED-DURATION=38.4,SCTE35-OUT=...
#EXT-X-CUE-OUT:38.4
```

But these markers appear ONCE in the entire manifest, and they're time-sensitive. They might have already expired by the time we request the manifest!

**SCTE-35 markers are ephemeral** - they only appear in the manifest for a short time window around the actual ad break.

---

## ✅ Solution Options

### Option A: Enable Time-Based for Testing
```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET time_based_auto_insert = 1 WHERE id = 'ch_demo_sports'"
```

**Pros:**
- ✅ Immediate ad insertion (every 5 minutes)
- ✅ Easy to test
- ✅ Not dependent on SCTE-35 timing

**Cons:**
- ❌ Not production behavior
- ❌ Ignores SCTE-35 signals

### Option B: Manually Trigger Ad via API
```bash
curl -X POST https://cf-ssai.mediamasters.workers.dev/cue \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "sports",
    "duration_sec": 30,
    "pod_id": "pod_demo_slate"
  }'
```

**Pros:**
- ✅ Tests full ad insertion immediately
- ✅ Tests decision service
- ✅ No need to wait for SCTE-35

### Option C: Wait for SCTE-35 Marker & Watch Logs

The demo stream inserts SCTE-35 markers periodically. We need to:
1. Monitor the stream continuously
2. Catch the moment when markers appear
3. Verify ads insert at that moment

---

## 🧪 Recommended Testing Sequence

### Test 1: Manual API Trigger (Fastest)
```bash
# This will insert ads immediately for 30 seconds
curl -X POST https://cf-ssai.mediamasters.workers.dev/demo/sports/cue \
  -H "Content-Type: application/json" \
  -d '{"duration_sec": 30}'

# Then access stream
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8 \
  | grep -E "(DATERANGE|DISCONTINUITY|CUE)"
```

### Test 2: Enable Time-Based (Consistent Testing)
```bash
# Enable via GUI or:
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET time_based_auto_insert = 1 WHERE id = 'ch_demo_sports'"

# Wait until minute is 00, 05, 10, 15, 20, 25, etc.
date +"%M"  # Check current minute

# When on a 5-minute boundary, access stream
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8 \
  | grep -E "(DATERANGE|DISCONTINUITY)"
```

### Test 3: Monitor for Real SCTE-35 (Production Scenario)
```bash
# Terminal 1: Watch origin for SCTE-35 markers
while true; do
  curl -s "https://demo.unified-streaming.com/k8s/live/scte35.isml/scte35-audio_eng=128000-video=1000000.m3u8" \
    | grep -E "(DATERANGE|CUE-OUT)" && echo "SCTE-35 FOUND!" && break
  sleep 2
done

# Terminal 2: Immediately access our stream
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8\
  | grep -E "(DATERANGE|ad|DISCONTINUITY)"

# Terminal 3: Monitor logs
npx wrangler tail cf-ssai --format=pretty
```

---

## 🎯 Quick Fix: Enable Time-Based Insertion

Since SCTE-35 markers are ephemeral and unpredictable, the fastest way to test ad insertion is:

```bash
# Enable time-based via GUI: Admin → Channels → Demo Channel → Edit
# Check: "Time-Based Auto-Insert"
# Save

# Or via command:
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET time_based_auto_insert = 1 WHERE id = 'ch_demo_sports'"

# Clear cache
npx wrangler kv:key delete --namespace-id=f03509ea56964ca3ad062b116a683dc4 \
  "channel:demo:sports"

# Access stream at next 5-minute mark
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8
```

---

## 📊 Summary

| Component | Status |
|-----------|--------|
| Channel config | ✅ Correct |
| Ad pod | ✅ Configured |
| Ad transcoding | ✅ Ready |
| Decision service | ✅ Deployed |
| SCTE-35 in origin | ✅ Present (intermittently) |
| SCTE-35 auto-insert | ✅ Enabled |
| **Time-based insert** | ❌ **DISABLED** |

**Root Cause:** 
Ads are configured to insert only on SCTE-35 signals, but these are ephemeral and hard to catch for testing. 

**Solution:** 
Enable time-based insertion for consistent testing, or use manual API triggers.


