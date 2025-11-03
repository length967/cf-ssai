# Audio-Only Variant Filtering Fix - November 3, 2025

## 🎯 Issue Summary

**Your manifest contained:**
- 1 video variant: 1316 kbps (1280x720)
- 1 audio-only variant: 150 kbps (no video)

**What was detected:** Both variants (150 kbps and 1316 kbps)  
**What should be detected:** Only video variant (1316 kbps)

---

## 📊 The Manifest Analysis

### Your Origin Manifest:

```hls
#EXTM3U
#EXT-X-VERSION:4

# AUDIO groups
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aacl-128",LANGUAGE="en",NAME="English"

# Video variant (1316 kbps)
#EXT-X-STREAM-INF:BANDWIDTH=1316000,AVERAGE-BANDWIDTH=1196000,CODECS="mp4a.40.2,avc1.42C01F",RESOLUTION=1280x720,FRAME-RATE=25,AUDIO="audio-aacl-128"
scte35-audio_eng=128000-video=1000000.m3u8

# Audio-only variant (150 kbps)
#EXT-X-STREAM-INF:BANDWIDTH=150000,AVERAGE-BANDWIDTH=136000,CODECS="mp4a.40.2",AUDIO="audio-aacl-128"
scte35-audio_eng=128000.m3u8

# Keyframes
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=146000,CODECS="avc1.42C01F",RESOLUTION=1280x720,URI="..."
```

### Key Differences:

| Attribute | Video Variant | Audio-Only Variant |
|-----------|--------------|-------------------|
| BANDWIDTH | 1316000 (1316 kbps) | 150000 (150 kbps) |
| CODECS | `mp4a.40.2,avc1.42C01F` | `mp4a.40.2` |
| RESOLUTION | 1280x720 | ❌ None |
| Video Codec | ✅ avc1 (H.264) | ❌ None |

**Detection:** Audio-only variant has:
- ❌ No RESOLUTION attribute
- ❌ No video codec (no "avc1", "hvc1", or "vp")
- ⚠️ Very low bitrate (150 kbps = typical audio-only)

---

## ✅ The Fix

### Updated `src/utils/hls.ts`

**1. Added Video Detection Logic:**

```typescript
// Check if this is video variant (has resolution OR video codec)
const hasResolution = !!attrs["RESOLUTION"]
const codecs = attrs["CODECS"] || ""
const hasVideoCodec = codecs.includes("avc") || codecs.includes("hvc") || codecs.includes("vp")
const isVideoVariant = hasResolution || hasVideoCodec
```

**2. Filter Audio-Only Variants:**

```typescript
// Extract bandwidths and convert from bps to kbps
// Filter out audio-only variants (isVideo=false or very low bitrate)
const bitrates = variants
  .filter(v => v.isVideo !== false) // Keep only video variants
  .map(v => v.bandwidth)
  .filter((bw): bw is number => bw !== undefined)
  .map(bw => Math.round(bw / 1000)) // Convert bps to kbps
  .filter(kbps => kbps >= 200) // Extra safety: filter very low bitrates
  .sort((a, b) => a - b)
```

**3. Updated Type Definition:**

```typescript
export type VariantInfo = { 
  bandwidth?: number; 
  resolution?: string; 
  uri: string; 
  isVideo?: boolean  // NEW: flag to identify video variants
}
```

---

## 🎨 Detection Logic

### Video Variant Identification:

A variant is considered **video** if it has:
1. **RESOLUTION attribute** (e.g., `1280x720`)
   - OR -
2. **Video codec** in CODECS:
   - `avc` (H.264)
   - `hvc` (H.265/HEVC)
   - `vp` (VP8/VP9)

### Audio-Only Variant Identification:

A variant is considered **audio-only** if:
1. No RESOLUTION attribute
   - AND -
2. No video codec in CODECS (only audio codecs like `mp4a`)
   - OR -
3. Bitrate < 200 kbps (extra safety check)

---

## 🚀 Deployment

**Backend Deployed:**
- Worker: cf-ssai-admin-api
- Version: 1cafd408-1017-419b-9e1d-0bf9a7c79647
- Time: November 3, 2025 01:30 UTC
- Status: ✅ Live

**Changes:**
- ✅ Audio-only filtering in `extractBitrates()`
- ✅ Video detection in `parseVariant()`
- ✅ Updated type definitions

---

## 🧪 Testing

### Your Manifest Should Now Detect:

**Before Fix:**
```
Detected bitrates: [150, 1316] kbps
```

**After Fix:**
```
Detected bitrates: [1316] kbps
```

### How to Test:

1. Visit: https://main.ssai-admin.pages.dev/channels
2. Edit your channel
3. Click "🔍 Detect Bitrates"
4. Expected result: **Only 1316 kbps** detected
5. Click "▶ Show Raw Detection Data" to verify

### Raw Data Should Show:

```json
{
  "success": true,
  "bitrates": [1316],
  "variants": [
    {
      "bandwidth": 1316000,
      "bitrate": 1316,
      "resolution": "1280x720",
      "uri": "scte35-audio_eng=128000-video=1000000.m3u8"
    }
  ]
}
```

**Audio-only variant (150 kbps) should NOT appear!**

---

## 📋 Supported Video Codecs

The detection now recognizes these video codecs:

| Codec | Format | Detected By |
|-------|--------|-------------|
| avc1 | H.264 | `codecs.includes("avc")` |
| hvc1 | H.265/HEVC | `codecs.includes("hvc")` |
| vp8 | VP8 | `codecs.includes("vp")` |
| vp9 | VP9 | `codecs.includes("vp")` |

**Audio-only codecs (filtered out):**
- mp4a (AAC)
- mp3
- ac-3 (Dolby Digital)
- ec-3 (Dolby Digital Plus)

---

## 🎯 Why This Matters

### Problem Without Filtering:

If you transcoded ads to 150 kbps:
- ❌ Audio-only output (no video!)
- ❌ Wasted storage and bandwidth
- ❌ Playback issues

### With Filtering:

Ads transcode to actual video bitrates:
- ✅ Only video variants (1316 kbps for your origin)
- ✅ Proper video/audio encoding
- ✅ Smooth playback

---

## 🔍 Edge Cases Handled

### Single Video Bitrate Origin:

**Your case:**
- Origin has only 1 video bitrate (1316 kbps)
- Detection returns: `[1316]`
- Ad transcodes to: 1316 kbps variant
- Result: ✅ Perfect match!

### Multiple Video Bitrates:

**Example:**
```hls
BANDWIDTH=500000 (video)
BANDWIDTH=150000 (audio-only)
BANDWIDTH=1316000 (video)
BANDWIDTH=2500000 (video)
```

**Detection returns:** `[500, 1316, 2500]` (audio-only filtered out)

### All Audio-Only (Edge Case):

If origin has ONLY audio-only variants:
- Detection returns: `[]` (empty array)
- Falls back to default: `[800, 1600, 2400]`
- Prevents zero-bitrate transcoding

---

## 🐛 Troubleshooting

### Still Seeing 150 kbps?

**Check:**
1. Hard refresh browser (Cmd+Shift+R)
2. Clear cached channel data
3. Re-detect bitrates (click button again)
4. Check raw data display

**If still appears:**
```bash
# Check backend logs
wrangler tail cf-ssai-admin-api

# Look for:
# "Detected X bitrates from..."
# Should show only video variants
```

### Detection Returns Empty Array?

**Possible causes:**
1. Origin manifest has no video variants
2. All variants are audio-only
3. Origin manifest is malformed

**Solution:**
- Check origin URL is valid
- Verify manifest contains video variants
- System will fall back to defaults `[800, 1600, 2400]`

---

## 📊 Real-World Example

### Apple Test Stream:

**Manifest:** https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8

**Variants:**
```
236 kbps  - 416x234  (video)
500 kbps  - 480x270  (video)
748 kbps  - 640x360  (video)
1102 kbps - 768x432  (video)
1600 kbps - 960x540  (video)
2500 kbps - 1280x720 (video)
3632 kbps - 1920x1080 (video)
```

**Detected:** `[236, 500, 748, 1102, 1600, 2500, 3632]` kbps ✅

**No audio-only variants** in this manifest, so all are detected.

---

## ✅ Verification Steps

### 1. Test Your Origin

1. Login to admin GUI
2. Go to your channel
3. Click "Detect Bitrates"
4. Expected: `[1316]` kbps only
5. No 150 kbps!

### 2. Verify Raw Data

1. Click "▶ Show Raw Detection Data"
2. Check `bitrates` array: `[1316]`
3. Check `variants` array: Only one entry with resolution
4. No variant with 150 kbps should appear

### 3. Upload Ad

1. Upload ad for this channel
2. Check transcode job
3. Verify it creates only 1316 kbps variant
4. No 150 kbps audio-only variant!

---

## 📝 Summary

**What Changed:**
- ✅ Added video variant detection logic
- ✅ Filter out audio-only variants (< 200 kbps OR no video codec)
- ✅ Updated type definitions for clarity
- ✅ Deployed to production

**Impact:**
- 🎯 Accurate bitrate detection (video-only)
- 🚀 Better ad transcoding (no audio-only mistakes)
- 💾 Reduced storage waste (no 150 kbps audio files)
- ✅ Improved playback quality

**Your Specific Case:**
- Before: Detected [150, 1316] kbps
- After: Detects [1316] kbps only
- Audio-only 150 kbps variant correctly filtered out!

---

**Status:** ✅ Fixed and Deployed  
**Backend:** 1cafd408-1017-419b-9e1d-0bf9a7c79647  
**Last Updated:** November 3, 2025 01:30 UTC  
**Test Now:** Hard refresh and re-detect bitrates!
