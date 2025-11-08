# Audio/Video Variant Mismatch Fix - November 8, 2025

## Problem: Bitmovin Player Decode Errors

**Error:** `MEDIA_ERR_DECODE` (Error code 1301)
**Root Cause:** Codec mismatch between content stream and ad segments

### Technical Details

**Audio-Only Stream:**
- Variant: `scte35-audio_eng=128000.m3u8`
- Bitrate: 128 kbps
- Codecs: `mp4a.40.2` (audio only, no video)

**Ad Selected:**
- Variant: `slate_1762143082368_ptvl6b8t7/1316k/playlist.m3u8`
- Bitrate: 1316 kbps
- Codecs: `mp4a.40.2,avc1.42C01F` (audio + video)

**Result:** Player cannot decode video in an audio-only stream → `MEDIA_ERR_DECODE`

---

## Fix #1: Type-Aware Variant Matching ✅ DEPLOYED

**Version:** `be24c2a2-594e-4afe-b8b1-93cdce5fafdc`
**File:** `/Users/markjohns/cf-ssai/src/channel-do.ts`

### Changes Made

#### Audio-Only Detection
```typescript
const isAudioOnly = viewerBitrate < 300000 && variant.toLowerCase().includes('audio')
```

Detects audio-only streams using:
- Bitrate < 300 kbps (audio-only threshold)
- Variant name contains "audio"

#### Variant Filtering (SGAI Path - Line 1851-1859)
```typescript
let eligibleItems = pod.items
if (isAudioOnly) {
  const audioOnlyItems = pod.items.filter(item => item.bitrate < 300000)
  if (audioOnlyItems.length > 0) {
    eligibleItems = audioOnlyItems
    console.log(`[SGAI] Audio-only stream detected, filtered to ${eligibleItems.length} audio-only variants`)
  } else {
    console.warn(`⚠️  [SGAI] Audio-only stream but no audio-only ad variants available`)
  }
}
```

#### Variant Filtering (SSAI Path - Line 1881-1890)
Same filtering logic applied to SSAI mode for consistency.

### What This Fixes

- ✅ Detects audio-only vs video+audio streams
- ✅ Filters ad variants by stream type before bitrate matching
- ✅ Logs warnings when no compatible variants exist
- ⚠️ **Still needs audio-only ad variants to fully work** (see Fix #2)

---

## Fix #2: Create Audio-Only Ad Variants 🔄 IN PROGRESS

### Current Problem

The slate `slate_1762143082368_ptvl6b8t7` only has **video+audio variants**:
- `658k/playlist.m3u8` (658 kbps video+audio)
- `1316k/playlist.m3u8` (1316 kbps video+audio)

**Missing:** Audio-only variants (64k, 128k, 256k audio-only)

### Solution Options

#### Option A: Add Audio-Only Bitrates to Transcode Worker

**File to Modify:** `/Users/markjohns/cf-ssai/src/transcode-worker.ts`

**Current Bitrate Ladder:** `[658000, 1316000]` (video+audio)

**Add Audio-Only Ladder:** `[64000, 128000, 256000]` (audio-only)

**Implementation:**
1. Detect if source has video track
2. If video exists: transcode video+audio variants (current behavior)
3. ALSO transcode audio-only variants for audio-only stream support
4. Store both types in R2 with proper naming (e.g., `64k-audio/`, `128k-audio/`)

#### Option B: Upload Separate Audio-Only Ad Creative

1. Create audio-only version of slate (just audio track)
2. Upload via admin API as new ad creative
3. Transcode with audio-only bitrates only
4. Update ad pods to include both video and audio-only creatives

#### Option C: Hybrid Approach (RECOMMENDED)

1. **For slates (generated content):** Auto-generate both video and audio-only versions
2. **For regular ads:** Transcode BOTH video+audio AND audio-only renditions automatically
3. **Bitrate ladder example:**
   - Video+audio: 658k, 1316k
   - Audio-only: 64k, 128k, 256k

### FFmpeg Commands for Audio-Only Transcoding

**Extract audio-only at 128kbps:**
```bash
ffmpeg -i input.mp4 \
  -vn \
  -acodec aac \
  -b:a 128k \
  -ar 48000 \
  -ac 2 \
  -f hls \
  -hls_time 6 \
  -hls_list_size 0 \
  -hls_segment_filename "segment_%03d.ts" \
  playlist.m3u8
```

**Flags explained:**
- `-vn`: No video
- `-acodec aac`: AAC audio codec
- `-b:a 128k`: Audio bitrate 128 kbps
- `-ar 48000`: 48kHz sample rate
- `-ac 2`: Stereo (2 channels)

---

## Next Steps

### Immediate Fix (Temporary)

**Disable ad insertion for audio-only streams until audio-only variants exist:**

```typescript
if (isAudioOnly && audioOnlyItems.length === 0) {
  console.warn(`⚠️  Skipping ad insertion for audio-only stream - no compatible variants`)
  return new Response(origin, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
}
```

This prevents decode errors by skipping ad insertion when incompatible.

### Long-Term Fix (Recommended)

1. **Update transcode worker** to generate both video+audio AND audio-only renditions
2. **Modify database schema** to track variant type (video+audio vs audio-only)
3. **Update decision service** to filter by variant type when selecting ads
4. **Re-transcode existing ads** with audio-only variants

---

## Testing

### Test Audio-Only Stream
```bash
# This will trigger the warning
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000.m3u8"
```

**Expected logs:**
```
[SGAI] Audio-only stream detected (128000bps), filtered to X audio-only ad variants
⚠️  [SGAI] Audio-only stream but no audio-only ad variants available
```

### Test Video+Audio Stream
```bash
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-video=500000.m3u8"
```

**Expected:** No audio-only warnings, normal ad insertion

---

## Deployment Status

- ✅ **Fix #1 Deployed:** Version `be24c2a2-594e-4afe-b8b1-93cdce5fafdc`
- 🔄 **Fix #2 Pending:** Audio-only variants need to be created

---

## Related Files

### Modified
- `/Users/markjohns/cf-ssai/src/channel-do.ts` (Lines 1846-1865, 1875-1906)

### To Modify (for Fix #2)
- `/Users/markjohns/cf-ssai/src/transcode-worker.ts` - Add audio-only transcoding
- `/Users/markjohns/cf-ssai/src/admin-worker.ts` - Update variant metadata
- Database schema - Add `variant_type` column

---

## Summary

**Current State:**
- ✅ Audio-only detection working
- ✅ Variant type filtering implemented
- ⚠️ Still causing decode errors because no audio-only variants exist

**To Fully Resolve:**
- Create audio-only ad variants (64k, 128k, 256k)
- OR disable ad insertion for audio-only streams until variants exist
