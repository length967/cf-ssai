# 🔍 Codebase Audit Report - Hardcoded Values & TODOs

**Date:** November 1, 2025  
**Status:** Review Complete

---

## 📊 Summary

| Category | Count | Priority |
|----------|-------|----------|
| Hardcoded Placeholders | 8 | 🔴 HIGH |
| Fallback/Dev Code | 12 | 🟡 MEDIUM |
| "Crude Detection" Comments | 1 | 🟡 MEDIUM |
| Hardcoded Domains | 5 | 🟢 LOW |
| TODO/FIXME Comments | 0 | ✅ CLEAN |

---

## 🔴 HIGH PRIORITY - Hardcoded Placeholders

### 1. ❌ "example-pod" Hardcoded Fallback
**File:** `src/channel-do.ts:343`
```typescript
body?.pod_url || `${adPodBase}/${podId ?? "example-pod"}/v_1600k/playlist.m3u8`
```
**Issue:** Falls back to non-existent "example-pod"  
**Impact:** 404 errors if `pod_url` not provided in /cue API  
**Fix:** Use channel's `slatePodId` from database

---

### 2. ❌ Hardcoded "slate" Fallback Pods
**Files:** Multiple locations
- `src/channel-do.ts:280-285` - Fallback slate pod (3 bitrates)
- `src/decision-worker.ts:317` - `env.SLATE_POD_ID || "slate"`
- `src/vast-parser-worker.ts:422-423, 572-573` - Hardcoded slate bitrates

**Current Code (channel-do.ts:280-285):**
```typescript
pod: {
  podId: "slate",
  durationSec,
  items: [
    { adId: "slate", bitrate: 800000, playlistUrl: `${adPodBase}/slate/v_800k/playlist.m3u8` },
    { adId: "slate", bitrate: 1600000, playlistUrl: `${adPodBase}/slate/v_1600k/playlist.m3u8` },
    { adId: "slate", bitrate: 2500000, playlistUrl: `${adPodBase}/slate/v_2500k/playlist.m3u8` }
  ]
}
```

**Issue:** Assumes "slate" pod exists at these exact URLs  
**Impact:** 404 errors if slate pod not configured  
**Fix:** Query database for slate pod, use actual transcoded ad variants

---

### 3. ❌ Hardcoded Bitrate Arrays (selectAdVariant)
**File:** `src/channel-do.ts:226-227`
```typescript
const available = [
  { bitrate: 1600000, path: "v_1600k" },
  { bitrate: 800000, path: "v_800k" },
  { bitrate: 2500000, path: "v_2500k" }
]
```

**Issue:** Bitrates don't match actual transcoded ads (1000k, 2000k, 3000k)  
**Impact:** May select wrong ad variant  
**Fix:** Remove this function, use bitrates from database ad variants

---

### 4. ❌ DEV FALLBACK Playlist Generator
**File:** `src/channel-do.ts:171-187`
```typescript
// DEV FALLBACK: simple 3-segment live-like variant (only for playlists)
const base = new Date(Date.now() - 8_000)
const pdt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z")
const segs = Array.from({ length: 3 }, (_, i) =>
  `#EXT-X-PROGRAM-DATE-TIME:${pdt(new Date(base.getTime() + i * 4000))}\n#EXTINF:4.000,\nseg_${1000 + i}.m4s`
const fallback = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  // ...
  segs.join("\n"),
  "#EXT-X-ENDLIST"
].join("\n")
```

**Issue:** Generates fake segments (`seg_1000.m4s`, etc.) if origin fetch fails  
**Impact:** 404 errors on segment fetch  
**Fix:** Return proper error response instead of fake playlist

---

### 5. ❌ Hardcoded Tracking URL
**File:** `src/decision-worker.ts:446`
```typescript
impressions: [`https://tracking.example.com/imp?pod=${selectedPod.id}`]
```

**Issue:** Non-existent tracking domain  
**Impact:** Beacon fires will fail  
**Fix:** Remove or use configurable tracking URL from database

---

### 6. ❌ Hardcoded Domain in segment-guard
**File:** `src/segment-guard.ts:19`
```typescript
const origin = `https://r2-public.example.com${u.pathname}${u.search}`
```

**Issue:** Non-existent R2 domain  
**Impact:** Segment guard won't work  
**Fix:** Use actual R2 public URL from environment

---

### 7. ❌ Localhost Hardcoded in Transcode Worker
**File:** `src/transcode-worker.ts:81`
```typescript
const response = await containerInstance.fetch('http://localhost:8080/transcode', {
```

**Issue:** Hardcoded localhost URL  
**Impact:** Should work (container internal), but not configurable  
**Fix:** Use environment variable for container URL

---

### 8. ❌ Localhost CORS Origins
**File:** `src/admin-api-worker.ts:163-164`
```typescript
'http://localhost:3000',
'http://localhost:3001',
```

**Issue:** Hardcoded dev URLs  
**Impact:** Works for dev, but not flexible  
**Fix:** Use environment variable for allowed origins

---

## 🟡 MEDIUM PRIORITY - Code Quality Issues

### 1. ⚠️ "Crude Detection" Comment
**File:** `src/channel-do.ts:197`
```typescript
// crude detection; replace with feature detection for production
return /iPhone|iPad|Macintosh/.test(ua)
```

**Issue:** User-Agent based SGAI detection is crude  
**Impact:** May incorrectly identify client capabilities  
**Fix Options:**
1. Add proper HLS feature detection
2. Use `X-Playback-Session-Id` header presence
3. Check for `EXT-X-DATERANGE` support in client

---

### 2. ⚠️ Production Comment in CORS
**File:** `src/admin-api-worker.ts:156`
```typescript
// Allow localhost origins in development, production domain in production
```

**Issue:** Comment suggests this needs updating for production  
**Impact:** None currently, but reminder to configure properly  
**Action:** Verify production origin is correct when deploying

---

### 3. ⚠️ Hardcoded Bitrate Defaults in VAST Parser
**File:** `src/vast-parser-worker.ts:389, 401`
```typescript
const bitrate = mediaFile.bitrate || 1600000  // Default bitrate
```

**Issue:** Assumes 1600k if VAST doesn't specify  
**Impact:** May mismatch viewer bitrate  
**Fix:** Use viewer's actual bitrate or channel's bitrate ladder

---

## 🟢 LOW PRIORITY - Acceptable Fallbacks

These are **legitimate fallback mechanisms** and don't need immediate fixing:

1. **Decision Service Fallback to Slate**
   - `src/decision-worker.ts:491` - Returns slate when no ads available
   - **Status:** ✅ Acceptable - proper fallback logic

2. **VAST Parser Fallback**
   - `src/vast-parser-worker.ts:566-583` - Returns slate on VAST failure
   - **Status:** ✅ Acceptable - proper error handling

3. **Fallback Ad Variant Selection**
   - `src/channel-do.ts:520` - Falls back to first item if bitrate not found
   - **Status:** ✅ Acceptable - reasonable fallback

4. **DISCONTINUITY-only Fallback**
   - `src/channel-do.ts:591` - Inserts DISCONTINUITY if SSAI fails
   - **Status:** ✅ Acceptable - graceful degradation

---

## 📋 Recommended Fixes (Priority Order)

### Phase 1: Critical Fixes (Immediate)

1. **Fix Slate Pod to Use Database**
   - Replace all hardcoded "slate" references
   - Query actual slate pod from database
   - Use real transcoded ad variants

2. **Remove DEV FALLBACK Playlist Generator**
   - Return proper 502/503 error instead of fake segments
   - Let client handle origin failure gracefully

3. **Fix "example-pod" Fallback**
   - Use channel's `slatePodId` from config

### Phase 2: Quality Improvements (Next Sprint)

4. **Make Tracking URLs Configurable**
   - Add `tracking_base_url` to channels table
   - Remove hardcoded tracking.example.com

5. **Improve SGAI Detection**
   - Implement proper feature detection
   - Use HLS Interstitial specification headers

6. **Make CORS Origins Configurable**
   - Use environment variable array
   - Remove hardcoded localhost URLs

### Phase 3: Cleanup (Future)

7. **Remove Hardcoded Bitrate Arrays**
   - Always use database ad variants
   - Remove `selectAdVariant` function

8. **Make Container URL Configurable**
   - Add `CONTAINER_URL` environment variable
   - Default to `http://localhost:8080`

---

## 🛠️ Implementation Plan

### Fix 1: Database-Driven Slate Pod

**Current Issue:**
```typescript
// Hardcoded in channel-do.ts:280-285
podId: "slate",
items: [
  { adId: "slate", bitrate: 800000, playlistUrl: `${adPodBase}/slate/v_800k/playlist.m3u8` },
  // ...
]
```

**Proposed Fix:**
```typescript
// Query database for slate pod
async function getSlatePod(env: Env, channelConfig: ChannelConfig, adPodBase: string): Promise<AdPod> {
  const slatePodId = channelConfig?.slatePodId || 'slate'
  
  // Fetch slate pod from database
  const pod = await env.DB.prepare(`
    SELECT id, name, ads FROM ad_pods 
    WHERE id = ? AND status = 'active'
  `).bind(slatePodId).first<any>()
  
  if (!pod) {
    console.error(`Slate pod not found: ${slatePodId}`)
    // Return empty pod as last resort
    return {
      podId: slatePodId,
      durationSec: 30,
      items: []
    }
  }
  
  // Parse ad IDs and fetch actual ads
  const adIds = JSON.parse(pod.ads || '[]')
  const ads = await getAdsById(env, adIds)
  
  // Build pod items from real ad variants
  const items = ads.flatMap(ad => buildAdItemsFromAd(ad, adPodBase))
  
  return {
    podId: pod.id,
    durationSec: items[0]?.duration || 30,
    items
  }
}
```

---

### Fix 2: Remove DEV FALLBACK

**Current Issue:**
```typescript
// src/channel-do.ts:171-187
// DEV FALLBACK: simple 3-segment live-like variant (only for playlists)
const fallback = [...] // Generates fake segments
return new Response(fallback, { ... })
```

**Proposed Fix:**
```typescript
// Return proper error instead of fake segments
if (!originResponse.ok) {
  console.error(`Origin fetch failed: ${originResponse.status} ${url}`)
  return new Response("Origin unavailable", { 
    status: 502,
    statusText: "Bad Gateway"
  })
}
```

---

### Fix 3: Fix "example-pod" Fallback

**Current Issue:**
```typescript
// src/channel-do.ts:343
body?.pod_url || `${adPodBase}/${podId ?? "example-pod"}/v_1600k/playlist.m3u8`
```

**Proposed Fix:**
```typescript
// Use channel's slate pod as fallback
const fallbackPodUrl = channelConfig?.slatePodId 
  ? `${adPodBase}/${channelConfig.slatePodId}/1000k/playlist.m3u8`
  : null

const podUrl = body?.pod_url || fallbackPodUrl

if (!podUrl) {
  return new Response("No pod URL provided and no slate configured", { status: 400 })
}
```

---

## 📈 Testing Checklist

After implementing fixes, test:

- [ ] Slate pod fetched from database (not hardcoded)
- [ ] Origin failure returns 502 (not fake segments)
- [ ] /cue API with no pod_url uses channel's slate
- [ ] All bitrate variants from database (not hardcoded)
- [ ] No 404 errors on ad segments
- [ ] CORS works with configured origins
- [ ] Tracking URLs use configured domain

---

## 🎯 Success Metrics

**Before:**
- 8 hardcoded placeholders
- Fake segments generating 404s
- Non-flexible configuration

**After:**
- 0 hardcoded placeholders
- All values from database or environment
- Fully configurable system
- Proper error handling
- No fake/placeholder content

---

## 📝 Notes

1. **Slate Pod Setup Required:**
   - Ensure `pod_demo_slate` (or configured slate) exists in database
   - Must have valid transcoded ads
   - Should cover all common bitrates

2. **Environment Variables to Add:**
   - `CONTAINER_URL` (default: `http://localhost:8080`)
   - `TRACKING_BASE_URL` (optional)
   - `ALLOWED_ORIGINS` (comma-separated list)

3. **Database Schema OK:**
   - No migrations needed
   - All required columns exist
   - Slate pod already configured in demo data

---

**Status:** Ready for implementation  
**Estimated Time:** 4-6 hours  
**Risk:** Low (mostly configuration improvements)

