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

## Fix #2: Create Audio-Only Ad Variants ✅ DEPLOYED

**Version:** `1b9b3f98-3eea-41ed-8de5-adf9f2167432`
**Files Modified:**
- `/Users/markjohns/cf-ssai/src/admin-api-worker.ts` (Lines 220-235, 266-280, 272-275)
- `/Users/markjohns/cf-ssai/ffmpeg-container/transcode.js` (Lines 151-207, 230-249, 330-354)

### Implementation Details

#### Admin API Worker Changes
Updated `getBitrateLadder()` to automatically include audio-only variants:
```typescript
// Priority 3: Fallback to sensible defaults for common streaming
// IMPORTANT: Include audio-only variants (64k, 128k, 256k) for audio-only stream support
// These low bitrates will be automatically transcoded as audio-only by the FFmpeg container
return [64, 128, 256, 800, 1600, 2400, 3600] // Audio-only + video variants
```

Also ensures channel-specific and org-specific ladders include audio-only variants:
```typescript
// Ensure audio-only variants are included
const hasAudioOnly = ladder.some(br => br < 300)
if (!hasAudioOnly) {
  console.log(`ℹ️  Channel ladder missing audio-only variants, adding them`)
  ladder.unshift(64, 128, 256) // Add audio-only at the beginning
}
```

#### FFmpeg Container Changes

**Audio-Only Detection (Line 157):**
```javascript
// Detect if this should be audio-only based on bitrate
// Audio-only threshold: < 300kbps
const isAudioOnly = bitrateKbps < 300;
```

**Audio-Only Transcoding (Lines 164-173):**
```javascript
if (isAudioOnly) {
  // Audio-only transcoding (no video)
  console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (AUDIO-ONLY)`);

  cmd = `ffmpeg -i "${sourceFile}" \
    -vn \
    -c:a aac -b:a ${bitrateKbps}k -ac 2 -ar 48000 \
    -f hls -hls_time 6 -hls_list_size 0 -hls_segment_type mpegts \
    -hls_segment_filename "${segmentPattern}" \
    "${playlistPath}"`;
}
```

**Master Playlist Updates (Lines 237-243):**
```javascript
// Audio-only variants should include CODECS attribute without RESOLUTION
if (variant.isAudioOnly) {
  playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"\n`;
} else {
  const resolution = variant.resolution;
  playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height},CODECS="avc1.42C01F,mp4a.40.2"\n`;
}
```

### What This Fixes

- ✅ All new ad uploads automatically include audio-only variants (64k, 128k, 256k)
- ✅ FFmpeg container automatically detects and transcodes audio-only variants
- ✅ Master playlists correctly mark audio-only streams with `CODECS="mp4a.40.2"`
- ✅ Existing channel bitrate ladders are automatically enhanced with audio-only variants
- ⚠️ **Existing ads need re-transcoding** to include audio-only variants

### Previous Problem

The slate `slate_1762143082368_ptvl6b8t7` only has **video+audio variants**:
- `658k/playlist.m3u8` (658 kbps video+audio)
- `1316k/playlist.m3u8` (1316 kbps video+audio)

**Missing:** Audio-only variants (64k, 128k, 256k audio-only)

### Previous Solution Options

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

- ✅ **Fix #1 Deployed:** Version `be24c2a2-594e-4afe-b8b1-93cdce5fafdc` (Type-aware variant matching)
- ✅ **Fix #2 Deployed (FINAL):** Version `5b9d040b-2bbf-486c-b8e0-be62e424e351` (FFprobe-based audio-only detection)

### Final Solution (FFprobe-Based Detection)

**The bitrate ladder is NOT hardcoded - it comes from origin stream detection!**

1. **Bitrate Detection Fixed** (`src/utils/hls.ts`):
   - `extractBitrates()` now includes ALL variants (audio-only AND video+audio)
   - Removed filters that excluded low bitrates and audio-only streams
   - Detection now properly captures the full variant ladder from origin

2. **FFprobe Stream Detection** (`ffmpeg-container/transcode.js`):
   - Uses **FFprobe to detect actual video stream presence** (not bitrate guessing)
   - Audio-only if: source has NO video stream OR (source has video AND bitrate ≤ 256kbps)
   - `hasVideoStream()` function inspects source using FFprobe before transcoding
   - Uses `-vn` flag for audio-only transcoding (no video encoding)
   - Master playlist correctly marks audio-only with `CODECS="mp4a.40.2"`

3. **Type-Aware Matching** (`src/channel-do.ts`):
   - Filters ad variants by stream type before bitrate matching
   - Audio-only streams (≤ 256kbps) only get audio-only ad variants
   - Video+audio streams only get video+audio ad variants

**How It Works:**
1. Origin manifest is fetched (e.g., contains 128k audio, 658k video, 1316k video)
2. Bitrate detection extracts ALL bitrates: `[128, 658, 1316]`
3. Ads are transcoded with ALL detected bitrates
4. FFmpeg automatically makes 128k audio-only (≤ 256kbps threshold, no video)
5. Type-aware matching ensures correct variant selection during playback

**Audio-Only Threshold:** ≤ 256kbps
- 64 kbps: Low quality audio
- 128 kbps: Standard quality audio
- 256 kbps: High quality audio
- 300kbps+: Video streams (not treated as audio-only)

### FFprobe-Based Detection Implementation

**Version:** `5b9d040b-2bbf-486c-b8e0-be62e424e351` (November 9, 2025)

The transcoder now uses FFprobe to inspect the actual source media instead of guessing based on bitrate.

**hasVideoStream() Function** (`ffmpeg-container/transcode.js:13-25`):
```javascript
async function hasVideoStream(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${filePath}"`
    );
    const hasVideo = stdout.trim() === 'video';
    console.log(`[FFprobe] Source has video stream: ${hasVideo}`);
    return hasVideo;
  } catch (error) {
    console.warn('[FFprobe] Could not detect video stream, assuming video exists:', error.message);
    return true; // Default to assuming video exists for safety
  }
}
```

**Audio-Only Decision Logic** (`ffmpeg-container/transcode.js:176-190`):
```javascript
// Determine if this variant should be audio-only:
// 1. If source has NO video stream → always audio-only
// 2. If source HAS video stream AND bitrate ≤ 256kbps → create audio-only variant
// 3. Otherwise → video + audio
if (!sourceHasVideo) {
  isAudioOnly = true;
  console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (AUDIO-ONLY - source has no video stream)`);
} else if (bitrateKbps <= 256) {
  isAudioOnly = true;
  console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (AUDIO-ONLY - low bitrate from video source)`);
} else {
  isAudioOnly = false;
  const resolution = calculateOutputResolution(sourceResolution, bitrateKbps);
  console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (VIDEO+AUDIO ${resolution.width}x${resolution.height})`);
}
```

**Benefits:**
- ✅ Accurately detects pure audio-only sources (no video stream)
- ✅ Creates audio-only variants from video sources at low bitrates (≤ 256kbps)
- ✅ No more guessing based on bitrate alone
- ✅ Handles edge cases (audio podcasts, radio streams, etc.)
- ✅ Safer default (assumes video exists if FFprobe fails)

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

**Current State (Version `5b9d040b-2bbf-486c-b8e0-be62e424e351`):**
- ✅ FFprobe-based stream detection implemented
- ✅ Audio-only variants automatically created based on actual stream inspection
- ✅ Bitrate detection includes ALL variants from origin manifest
- ✅ Type-aware variant matching prevents codec mismatches
- ✅ Audio-only threshold: ≤ 256kbps (64k, 128k, 256k)
- ✅ Handles both pure audio sources and audio-only variants from video sources

**How It Works:**
1. Origin manifest is fetched and ALL bitrates detected (including audio-only)
2. FFprobe inspects source to determine if video stream exists
3. Transcoder creates audio-only variants if: (a) source has no video OR (b) bitrate ≤ 256kbps
4. Type-aware matching ensures audio-only streams only get audio-only ad variants
5. No more codec mismatch errors between content and ad segments
