# 🐛 Ad Insertion Debug Report

## ✅ Deployment Status

All workers successfully deployed with latest code:
- ✅ cf-ssai (manifest worker)
- ✅ cf-ssai-decision
- ✅ cf-ssai-admin-api  
- ✅ cf-ssai-transcode
- ✅ cf-ssai-beacon-consumer
- ✅ cf-ssai-vast-parser

---

## 🔍 Root Cause Identified

### **SCHEMA MISMATCH: Decision Worker vs Database**

The decision worker code expects a schema that doesn't match the actual database!

### Expected Schema (in decision worker code):
```typescript
// decision-worker.ts expects:
ad_pods table:
  - ads: TEXT (JSON) // Array of ad IDs: ["ad_123", "ad_456"]
  - channel_id: TEXT  
  
Then fetches from:
ads table:
  - id, name, status, duration
  - variants: JSON // Transcoded HLS variants
```

### Actual Database Schema:
```sql
ad_pods table:
  - assets: JSON  // Direct URLs: [{"bitrate": 1000000, "url": "..."}]
  - NO channel_id column
  - NO ads column
```

---

## 📊 Current Database State

### Channels:
```json
{
  "id": "ch_demo_sports",
  "name": "Demo Channel",
  "scte35_auto_insert": 1,  // ✅ ENABLED
  "time_based_auto_insert": 0,  // ❌ DISABLED
  "status": "active"
}
```

**KEY FINDING:** SCTE-35 auto-insert is enabled, but time-based is disabled. 
**This means ads will ONLY insert when an SCTE-35 marker is detected in the origin stream!**

### Ads:
```json
[
  {
    "id": "ad_1761998003876_ivpo1bjlb",
    "name": "BBC_KIDS_CHANNEL_REEL_REFRESH_VC",
    "status": "active",
    "duration": 30
  },
  {
    "id": "ad_1761998592294_khk143gu4",
    "name": "BBC_KIDS_CHANNEL_REEL_REFRESH_VC",
    "status": "active",
    "duration": 30
  }
]
```

✅ 2 ads available

### Ad Pods:
```json
{
  "id": "pod_demo_slate",
  "name": "Default Slate",
  "pod_id": "slate",
  "assets": [
    {"bitrate": 1000000, "url": "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads/ad_1761998592294_khk143gu4/1000k/playlist.m3u8"},
    {"bitrate": 2000000, "url": "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads/ad_1761998592294_khk143gu4/2000k/playlist.m3u8"},
    {"bitrate": 3000000, "url": "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads/ad_1761998592294_khk143gu4/3000k/playlist.m3u8"}
  ]
}
```

✅ Slate pod exists with transcoded ad variants

---

## 🚨 Why Ads Aren't Inserting

### Issue #1: **Time-Based Insertion is DISABLED**
- `time_based_auto_insert = 0`
- The demo stream (`https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8`) MAY have SCTE-35 markers
- But if there are no markers at the moment you access the stream, no ads will insert

### Issue #2: **Decision Worker Schema Mismatch**
The decision worker code won't work even if it's called because:
1. It queries for `ad_pods` with an `ads` column (doesn't exist)
2. It expects `channel_id` in `ad_pods` (doesn't exist)
3. It tries to fetch from `ads` table and build URLs (wrong approach - URLs are already in `assets`)

---

## 🔧 The Fix

We have **2 options**:

### Option A: **Quick Fix - Enable Time-Based Insertion**

Enable time-based insertion so you can test immediately (ads every 5 minutes):

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET time_based_auto_insert = 1 WHERE id = 'ch_demo_sports'"
```

Then access stream:
```bash
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8
```

### Option B: **Proper Fix - Update Decision Worker to Match Schema**

The decision worker needs to be rewritten to:
1. Query `ad_pods` using the `assets` field (not `ads`)
2. Not require `channel_id` in `ad_pods`
3. Work with the existing schema

---

## 🎯 Recommendation

**DO BOTH:**

1. **Immediate:** Enable time-based insertion to test
2. **Next:** Fix decision worker to properly use the existing schema

---

## 📝 Testing Steps

### 1. Enable time-based insertion:
```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET time_based_auto_insert = 1 WHERE id = 'ch_demo_sports'"
```

### 2. Test stream access:
```bash
# Should return manifest with ads inserted at 5-minute marks
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8
```

### 3. Monitor logs:
```bash
# Terminal 1: Manifest worker
npx wrangler tail cf-ssai --format=pretty

# Terminal 2: Decision worker  
npx wrangler tail cf-ssai-decision --format=pretty
```

### 4. Look for these log messages:
```
✅ "Time-based ad break (auto-insert enabled)"
✅ "Decision service called for channel: demo"
✅ "Database ad pods retrieved: X pods"
```

---

## 🛠️ Next Actions

1. Enable time-based insertion (quick test)
2. Fix decision worker schema mismatch (proper fix)
3. Consider: Do we want the new schema (ads table + ad IDs) or keep the current one (assets in ad_pods)?

---

## 💡 Architecture Decision Needed

**Current System:** Ad pods directly contain asset URLs
```
ad_pods.assets = [{"bitrate": 1M, "url": "..."}]
```

**New System (in decision worker code):** Ad pods reference ads
```
ad_pods.ads = ["ad_123", "ad_456"]  
→ fetch from ads table
→ build URLs from variants
```

**Which do you want to use going forward?**

