# Admin Architecture Audit & Fix Plan

## Issues Identified

### Issue 1: Hardcoded Resolution Mapping ❌

**Problem:**
```javascript
// ffmpeg-container/transcode.js lines 12-18
function getResolution(bitrateKbps) {
  if (bitrateKbps < 600) return { width: 640, height: 360 };
  if (bitrateKbps < 1200) return { width: 854, height: 480 };
  if (bitrateKbps < 2500) return { width: 1280, height: 720 };
  return { width: 1920, height: 1080 };
}
```

**Why this is wrong:**
- Ignores source video resolution
- Creates mismatched aspect ratios
- Doesn't respect channel-specific requirements
- Results in **black bars / stretched video**

**Example:**
- Upload 720p (1280x720) source
- Request 3000k bitrate → Gets transcoded to 1920x1080 ❌
- Result: Upscaled/stretched from 720p to 1080p (looks terrible)

---

### Issue 2: Channel-Agnostic Upload Flow ❌

**Current Flow:**
```
User uploads ad → Admin GUI
  ↓
No channel selected ❌
  ↓
Uses default bitrates [1000, 2000, 3000]
  ↓
Transcodes with hardcoded resolutions
  ↓
Ad stored independent of channels
```

**Problems:**
1. **Default bitrates** may not match any actual channel
2. **First transcode wastes time** on wrong bitrates
3. **On-demand re-transcode required** for every channel
4. **Storage waste** - unused variants

---

### Issue 3: Admin GUI Missing Critical Info ❌

**Missing from upload flow:**
- ❌ Channel selection
- ❌ Target bitrate ladder preview
- ❌ Source video analysis
- ❌ Resolution detection
- ❌ Aspect ratio validation

**Missing from ads library:**
- ❌ Which channels use this ad?
- ❌ Which channels need transcoding?
- ❌ Variant coverage per channel
- ❌ Quality preview

---

## Solutions

### Solution 1: Smart Resolution Detection ✅

**Replace hardcoded mapping with source detection:**

```javascript
// NEW: Detect source resolution using ffprobe
async function detectSourceResolution(filePath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams v:0 \
     -show_entries stream=width,height \
     -of csv=s=x:p=0 "${filePath}"`
  );
  const [width, height] = stdout.trim().split('x').map(Number);
  return { width, height };
}

// NEW: Scale intelligently (never upscale)
function calculateOutputResolution(sourceRes, targetBitrateKbps) {
  const aspectRatio = sourceRes.width / sourceRes.height;
  
  // Bitrate → target resolution (max, never upscale)
  let targetHeight;
  if (targetBitrateKbps < 600) targetHeight = 360;
  else if (targetBitrateKbps < 1200) targetHeight = 480;
  else if (targetBitrateKbps < 2500) targetHeight = 720;
  else targetHeight = 1080;
  
  // Never upscale beyond source
  targetHeight = Math.min(targetHeight, sourceRes.height);
  
  const targetWidth = Math.round(targetHeight * aspectRatio);
  
  // Ensure even dimensions (required by x264)
  return {
    width: targetWidth - (targetWidth % 2),
    height: targetHeight - (targetHeight % 2)
  };
}
```

---

### Solution 2: Channel-Aware Upload Flow ✅

**NEW Upload Flow:**

```
User uploads ad → Admin GUI
  ↓
1. Analyze video (resolution, aspect ratio, duration)
  ↓
2. SELECT TARGET CHANNEL (required)
  ↓
3. Load channel's bitrate ladder from DB
  ↓
4. Preview: "Will create X variants at Y bitrates"
  ↓
5. Transcode with channel-specific bitrates
  ↓
6. Store ad with channel association
  ↓
7. Show variant coverage in library
```

**Benefits:**
- ✅ First transcode is always correct
- ✅ No wasted transcoding
- ✅ No on-demand delays
- ✅ Perfect resolution matching

---

### Solution 3: Enhanced Admin GUI ✅

#### **Upload Modal Improvements:**

```typescript
interface UploadState {
  file: File | null;
  name: string;
  description: string;
  
  // NEW: Video analysis
  sourceResolution?: { width: number; height: number };
  sourceAspectRatio?: string;  // "16:9", "4:3", etc.
  sourceDuration?: number;
  
  // NEW: Channel selection (required)
  selectedChannelId?: string;
  channelBitrates?: number[];
  
  // NEW: Preview
  plannedVariants?: Array<{
    bitrate: number;
    resolution: { width: number; height: number };
    willUpscale: boolean;  // Warn if upscaling
  }>;
}
```

#### **Library View Improvements:**

```typescript
interface AdCardData {
  // Existing fields...
  
  // NEW: Channel usage
  usedByChannels: Array<{
    channelId: string;
    channelName: string;
    hasAllVariants: boolean;  // ✅ Ready or ⚠️ Needs transcode
  }>;
  
  // NEW: Variant quality
  variantQuality: {
    nativeResolutions: number;   // Transcoded from source
    upscaledResolutions: number;  // Upscaled (lower quality)
  };
}
```

---

## Implementation Plan

### Phase 1: Fix Transcode Resolution Logic ⚡ URGENT

**File:** `ffmpeg-container/transcode.js`

**Changes:**
1. Add `detectSourceResolution()` function
2. Replace `getResolution()` with `calculateOutputResolution()`
3. Update `transcodeVariant()` to use detected resolution
4. Add `resolution` field to variants array in DB

**Impact:**
- Fixes stretched/upscaled video issue
- No API changes needed
- Backward compatible

**Estimated Time:** 30 minutes

---

### Phase 2: Add Channel Selection to Upload ⚡ HIGH PRIORITY

**Files:**
- `admin-frontend/src/app/ads/page.tsx`
- `src/admin-api-worker.ts`

**Changes:**

#### Frontend:
```tsx
// Add to upload modal
<div>
  <label>Target Channel *</label>
  <select 
    value={selectedChannelId}
    onChange={(e) => {
      setSelectedChannelId(e.target.value);
      // Fetch channel bitrates
      loadChannelBitrates(e.target.value);
    }}
  >
    <option value="">Select a channel...</option>
    {channels.map(ch => (
      <option key={ch.id} value={ch.id}>{ch.name}</option>
    ))}
  </select>
</div>

{/* Preview planned variants */}
{plannedVariants && (
  <div className="preview">
    <h4>Will create {plannedVariants.length} variants:</h4>
    {plannedVariants.map(v => (
      <div key={v.bitrate}>
        {v.bitrate}k → {v.resolution.width}x{v.resolution.height}
        {v.willUpscale && <span className="warning">⚠️ Upscaling</span>}
      </div>
    ))}
  </div>
)}
```

#### Backend:
```typescript
// Update uploadAd() to require channelId
async uploadAd(auth: AuthContext, request: Request): Promise<Response> {
  const channelId = formData.get('channel_id') as string;
  
  if (!channelId) {
    return new Response(JSON.stringify({ 
      error: 'Channel selection is required' 
    }), { status: 400 });
  }
  
  // Rest of upload logic...
}
```

**Impact:**
- Better UX - no wasted transcodes
- Immediate variant readiness
- Clear channel association

**Estimated Time:** 2 hours

---

### Phase 3: Add Variant Coverage Dashboard 📊 MEDIUM PRIORITY

**File:** `admin-frontend/src/app/ads/page.tsx`

**New View:**

```tsx
// Add tab/toggle for "Coverage View"
<div className="coverage-matrix">
  <table>
    <thead>
      <tr>
        <th>Ad Name</th>
        {channels.map(ch => (
          <th key={ch.id}>{ch.name}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {ads.map(ad => (
        <tr key={ad.id}>
          <td>{ad.name}</td>
          {channels.map(ch => (
            <td key={ch.id}>
              {adHasVariantsForChannel(ad, ch) ? (
                <span className="ready">✅</span>
              ) : (
                <button onClick={() => triggerTranscode(ad.id, ch.id)}>
                  ⚠️ Transcode
                </button>
              )}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

**Impact:**
- At-a-glance coverage visibility
- Easy bulk transcoding
- Proactive variant management

**Estimated Time:** 3 hours

---

### Phase 4: Source Video Analysis API 🔍 LOW PRIORITY

**File:** `src/admin-api-worker.ts`

**New Endpoint:**

```typescript
// POST /api/v1/ads/analyze
async analyzeVideo(auth: AuthContext, request: Request): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  
  // Upload to R2 temp location
  const tempKey = `temp-analyze/${Date.now()}-${file.name}`;
  await this.env.R2.put(tempKey, file.stream());
  
  // Call FFmpeg container for analysis
  const analysis = await this.env.FFMPEG_CONTAINER.fetch('/analyze', {
    method: 'POST',
    body: JSON.stringify({ sourceKey: tempKey })
  }).then(r => r.json());
  
  // Cleanup temp file
  await this.env.R2.delete(tempKey);
  
  return new Response(JSON.stringify({
    resolution: analysis.resolution,
    aspectRatio: analysis.aspectRatio,
    duration: analysis.duration,
    bitrate: analysis.bitrate,
    codec: analysis.codec
  }));
}
```

**Impact:**
- Real-time video analysis before upload
- Smart variant suggestions
- Quality warnings

**Estimated Time:** 4 hours

---

## Immediate Action Items

### 🔥 Fix Now (30 minutes):

1. **Update `transcode.js` resolution logic**
   - Replace hardcoded resolutions with source detection
   - Prevent upscaling
   - Preserve aspect ratio

### ⚡ Fix Today (2 hours):

2. **Add channel selection to upload flow**
   - Make channelId required in admin-api upload
   - Add channel dropdown to admin GUI upload modal
   - Load and display channel bitrate ladder

### 📅 Fix This Week:

3. **Add variant coverage view**
4. **Add video analysis API**

---

## Database Schema Updates

**Add to `ads` table:**
```sql
ALTER TABLE ads ADD COLUMN source_resolution TEXT; -- JSON: {"width": 1280, "height": 720}
ALTER TABLE ads ADD COLUMN source_aspect_ratio TEXT; -- "16:9"
```

**Add `ad_channel_usage` junction table:**
```sql
CREATE TABLE IF NOT EXISTS ad_channel_usage (
  ad_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  has_all_variants BOOLEAN DEFAULT FALSE,
  last_checked BIGINT,
  PRIMARY KEY (ad_id, channel_id),
  FOREIGN KEY (ad_id) REFERENCES ads(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);
```

---

## Testing Plan

### Test 1: Resolution Matching
```
1. Upload 720p video (1280x720)
2. Select channel with bitrates [800, 1600, 3000]
3. Verify output:
   - 800k: 854x480 (scaled down) ✅
   - 1600k: 1280x720 (native) ✅
   - 3000k: 1280x720 (NOT upscaled to 1080p) ✅
```

### Test 2: Aspect Ratio Preservation
```
1. Upload 4:3 video (640x480)
2. Verify all variants maintain 4:3 ratio
3. No black bars added
```

### Test 3: Channel Association
```
1. Upload ad for Channel A
2. Verify variants match Channel A bitrate ladder
3. Request ad for Channel B
4. Verify on-demand transcode triggers for missing bitrates
```

---

## Migration Strategy

### For Existing Ads:

1. **Backfill source resolution:**
   ```sql
   -- Mark for re-analysis
   UPDATE ads SET source_resolution = NULL WHERE transcoded_at IS NOT NULL;
   ```

2. **Re-transcode with correct resolutions:**
   - Create migration script
   - Queue re-transcode jobs
   - Update variants with correct resolutions

3. **Associate with channels:**
   - Infer from ad_pods usage
   - Populate `ad_channel_usage` table

---

## Long-Term Vision

### Ideal Admin Flow:

```
Upload → [Analyze] → [Select Channels] → [Preview Variants] → [Confirm]
  ↓
Transcode queue with progress tracking
  ↓
Coverage dashboard shows readiness per channel
  ↓
One-click "Transcode for all channels"
```

### Quality Assurance Features:

- **Video preview** in admin GUI
- **Side-by-side variant comparison**
- **Bitrate efficiency analysis**
- **Quality score** (VMAF/SSIM)
- **Automated quality reports**

---

## Summary

| Issue | Impact | Fix Complexity | Priority |
|-------|--------|----------------|----------|
| Hardcoded resolutions | High (bad quality) | Low | 🔥 Urgent |
| Missing channel selection | Medium (wasted work) | Medium | ⚡ High |
| No coverage visibility | Low (manual checking) | Medium | 📅 Medium |
| No source analysis | Low (nice-to-have) | High | 📅 Low |

**Recommendation:** Fix issues 1 & 2 immediately (2.5 hours total), then plan issues 3 & 4 for next sprint.
