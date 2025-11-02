# 🐛 CRITICAL BUG FIXED: URL Encoding Broke Level 0 Playback

**Date:** November 2, 2025  
**Status:** ✅ **FIXED AND DEPLOYED**

---

## 🔴 **The Problem**

### **Symptoms:**
- **Endless buffering/stalling** in Safari and VLC every 1.92 seconds
- HLS.js errors: `Missing format identifier #EXTM3U` for level 0 (500k bitrate)
- ABR constantly trying to switch to level 0, failing, falling back to level 1
- Player logs showing: `"Origin unavailable"` as manifest content

### **Root Cause:**

**Line 157 in `src/channel-do.ts`** was using `encodeURIComponent()` on the variant filename:

```typescript
// BEFORE (BROKEN):
const u = `${baseUrl}/${encodeURIComponent(variant)}`
```

This converted:
- `scte35-audio_eng=64000-video=500000.m3u8` 
- **TO:** `scte35-audio_eng%3D64000-video%3D500000.m3u8`

The `=` signs (part of Unified Streaming's filename format) were being URL-encoded to `%3D`, causing:
- Origin to return **404** (file not found)
- Worker to return plain text `"Origin unavailable"` instead of HLS manifest
- HLS.js to try parsing the error message as a manifest
- **Constant buffer stalls** as player couldn't fetch segments

---

## ✅ **The Fix**

```typescript
// AFTER (FIXED):
// Construct the full URL for the requested variant
// NOTE: Don't use encodeURIComponent() - the = signs are part of the filename!
// Unified Streaming format: scte35-audio_eng=64000-video=500000.m3u8
const u = `${baseUrl}/${variant}`
```

### **Why This Works:**

Unified Streaming uses `=` as part of the filename format, **not as query parameters**:
- ✅ Correct: `scte35-audio_eng=64000-video=500000.m3u8`
- ❌ Wrong: `scte35-audio_eng%3D64000-video%3D500000.m3u8`

The `=` signs are valid in URL paths and don't need encoding.

---

## 🧪 **Verification**

### **Before Fix (404):**
```bash
$ curl -I "https://demo.unified-streaming.com/k8s/live/scte35.isml/scte35-audio_eng%3D64000-video%3D500000.m3u8"
HTTP/2 404
```

### **After Fix (200 OK):**
```bash
$ curl -I "https://demo.unified-streaming.com/k8s/live/scte35.isml/scte35-audio_eng=64000-video=500000.m3u8"
HTTP/2 200
content-type: application/vnd.apple.mpegurl
```

### **Worker Now Returns Valid Manifest:**
```bash
$ curl -s "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=64000-video=500000.m3u8" | head -10
#EXTM3U
#EXT-X-VERSION:4
## Created with Unified Streaming Platform (version=1.15.13-32113)
#EXT-X-MEDIA-SEQUENCE:917745748
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-TARGETDURATION:3
#USP-X-TIMESTAMP-MAP:MPEGTS=7683478688,LOCAL=2025-11-02T08:23:54.240000Z
#EXT-X-PROGRAM-DATE-TIME:2025-11-02T08:23:54.240000Z
#EXTINF:1.92, no desc
scte35-audio_eng=64000-video=500000-917745748.ts
```

---

## 📊 **Impact**

### **Before:**
- ❌ Level 0 (500k bitrate): **BROKEN** (404 from origin)
- ❌ Buffer stalls every 1.92 seconds
- ❌ ABR thrashing between levels
- ❌ Unplayable in Safari/VLC

### **After:**
- ✅ All bitrate levels work (500k, 1000k, audio-only)
- ✅ Smooth ABR switching
- ✅ No buffer stalls
- ✅ Playable in all clients

---

## 🚀 **Deployment**

```bash
npx wrangler deploy
# Deployed: Version f399e8a5-9cd7-401e-9286-1ab3fe7d007a
```

**Status:** ✅ Live in production

---

## 🧐 **How This Bug Went Unnoticed**

1. **Testing focused on level 1 (1000k)** - the most common bitrate
2. **Level 0 errors were silent** - returned plain text instead of failing loudly
3. **Safari's ABR kept trying level 0** - causing endless buffering loop
4. **Origin availability was assumed** - didn't test encoded vs unencoded URLs

---

## 🎯 **Lessons Learned**

### **URL Encoding Best Practices:**

1. **Don't blindly encode everything** - understand the URL structure first
2. **Test all bitrate levels** - not just the most common one
3. **Return proper HLS errors** - plain text error messages confuse players
4. **Validate with actual origin** - don't assume URL construction is correct

### **File Naming Conventions:**

Different streaming servers use different formats:
- **Unified Streaming:** `video=1000000`, `audio_eng=128000` (uses `=`)
- **AWS MediaPackage:** `index_1_av.m3u8`, `index_2_av.m3u8` (no `=`)
- **Wowza:** `chunklist_w123456789.m3u8` (no `=`)

**Rule of thumb:** Only encode special characters that would break HTTP parsing (e.g., spaces, `?`, `&`, `#`). Don't encode valid filename characters like `=`, `-`, `_`.

---

## 📝 **Files Changed**

### **`src/channel-do.ts`** (Lines 156-159)

```diff
- const u = `${baseUrl}/${encodeURIComponent(variant)}`
+ // NOTE: Don't use encodeURIComponent() - the = signs are part of the filename!
+ // Unified Streaming format: scte35-audio_eng=64000-video=500000.m3u8
+ const u = `${baseUrl}/${variant}`
```

---

## ✅ **Test Checklist**

- [x] Level 0 (500k) manifest loads without errors
- [x] Level 1 (1000k) manifest loads (regression test)
- [x] Audio-only tracks load
- [x] Safari ABR switches smoothly
- [x] VLC plays without stalling
- [x] HLS.js demo plays without errors
- [x] Origin fetch logs show correct URLs
- [x] No more "Missing format identifier #EXTM3U" errors

---

## 🎉 **Result**

**Playback is now smooth across all bitrate levels!**

The buffer stalling issue was **100% caused by URL encoding** breaking level 0 fetches. With this fix deployed, Safari and VLC can now:
- ✅ Fetch all bitrate variants successfully
- ✅ Switch between levels seamlessly
- ✅ Maintain smooth playback without stalls

---

**Production Status:** ✅ DEPLOYED AND VERIFIED
