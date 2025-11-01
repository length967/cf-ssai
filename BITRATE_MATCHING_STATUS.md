# Bitrate Matching Implementation Status

## 🎯 Current Status

### ✅ What's Working:

1. **Transcode Logic** (`ffmpeg-container/transcode.js`):
   - ✅ Accepts custom bitrates array: `[1000, 2000, 3000]`
   - ✅ FFmpeg transcodes to exact bitrates specified
   - ✅ Creates HLS variants for each bitrate
   - ✅ Uploads to R2 with bitrate-specific paths

2. **Admin API Upload** (`admin-api-worker.ts` lines 1052-1114):
   - ✅ Attempts to query `channel.bitrate_ladder` from database
   - ✅ Falls back to `[1000, 2000, 3000]` if not found
   - ✅ Passes bitrates to transcode queue
   - ✅ Logs: "Queueing transcode job for ad {adId} with bitrates: [...]"

3. **Decision Service** (`decision-worker.ts`):
   - ✅ Queries transcoded ad variants from database
   - ✅ Parses `variants` JSON with actual bitrate + URL
   - ✅ Returns exact bitrate variants to manifest worker

### ⚠️ **Critical Missing Piece:**

**The `bitrate_ladder` column doesn't exist in the `channels` table!**

```sql
-- Current database schema is missing:
ALTER TABLE channels ADD COLUMN bitrate_ladder TEXT; -- JSON array of bitrates
```

**Impact:**
- Ads are always transcoded to default `[1000, 2000, 3000]` kbps
- No way to match specific stream profiles like `[500, 1500, 4000]` kbps
- Code is trying to query a column that doesn't exist (fails silently)

---

## 🔧 How Bitrate Matching **Should** Work

### Full Flow (Design):

```
1. User creates/edits channel in GUI
   ↓
2. Stream playback starts - manifest worker detects available bitrates
   ↓
3. Channel config stores bitrate ladder: [500, 1500, 4000]
   ↓
4. User uploads ad via GUI, selects channel
   ↓
5. Admin API reads channel.bitrate_ladder: [500, 1500, 4000]
   ↓
6. Transcode queue job includes: bitrates: [500, 1500, 4000]
   ↓
7. FFmpeg transcodes ad to exactly [500, 1500, 4000] kbps
   ↓
8. Ad variants saved to database:
   {
     bitrate: 500000, url: ".../500k/playlist.m3u8",
     bitrate: 1500000, url: ".../1500k/playlist.m3u8",
     bitrate: 4000000, url: ".../4000k/playlist.m3u8"
   }
   ↓
9. During ad break, manifest worker picks matching bitrate
   ↓
10. Seamless playback - bitrate switch not noticeable
```

### Current Reality:

```
1. User uploads ad via GUI ✅
   ↓
2. Admin API tries to query bitrate_ladder ❌ (column doesn't exist)
   ↓
3. Falls back to default: [1000, 2000, 3000] ⚠️
   ↓
4. FFmpeg transcodes to [1000, 2000, 3000] ✅
   ↓
5. If stream has different bitrates (e.g., [500, 1500, 4000]) ❌
   → Bitrate mismatch
   → Potential buffering or quality issues
```

---

## 🏗️ What Needs to be Built

### 1. Database Migration

**Create migration:** `migrations/005_add_bitrate_ladder.sql`

```sql
-- Add bitrate_ladder column to channels table
-- Stores JSON array of bitrates in kbps, e.g., [1000, 2000, 3000]
ALTER TABLE channels ADD COLUMN bitrate_ladder TEXT;

-- Set default for existing channels
UPDATE channels SET bitrate_ladder = '[1000, 2000, 3000]' WHERE bitrate_ladder IS NULL;
```

### 2. Channel Config GUI (Admin Frontend)

**Update:** `admin-frontend/src/app/channels/page.tsx`

Add to channel edit form:

```typescript
<div>
  <label>Bitrate Ladder (kbps)</label>
  <p className="text-sm text-gray-500">
    Comma-separated list of bitrates for ad transcoding
    (e.g., 1000, 2000, 3000)
  </p>
  <input
    type="text"
    value={formData.bitrate_ladder || "1000, 2000, 3000"}
    onChange={(e) => {
      // Parse comma-separated values
      const bitrates = e.target.value
        .split(',')
        .map(b => parseInt(b.trim()))
        .filter(b => !isNaN(b) && b > 0)
      setFormData({ 
        ...formData, 
        bitrate_ladder: JSON.stringify(bitrates) 
      })
    }}
  />
</div>
```

### 3. Bitrate Detection (Advanced - Optional)

**Manifest Worker** could auto-detect stream bitrates:

```typescript
// In channel-do.ts - when parsing origin manifest
const detectedBitrates = parseM3U8Bitrates(originManifest)

// Update channel config in database
await env.DB.prepare(`
  UPDATE channels 
  SET bitrate_ladder = ? 
  WHERE id = ? AND bitrate_ladder IS NULL
`).bind(JSON.stringify(detectedBitrates), channelId).run()
```

---

## 🎓 The "Why" - Technical Explanation

### Why Exact Bitrate Matching Matters:

1. **ABR (Adaptive Bitrate) Switching**: 
   - HLS players switch between bitrates based on network conditions
   - Player expects consistent bitrate options across content and ads

2. **Seamless Transitions**:
   ```
   Content:  [1000k, 2000k, 3000k] ✅
   Ad:       [1000k, 2000k, 3000k] ✅
   → Player continues at current bitrate, no buffer
   
   Content:  [500k, 1500k, 4000k] ⚠️
   Ad:       [1000k, 2000k, 3000k] ❌
   → Player must find "closest" bitrate, may rebuffer
   ```

3. **Quality Consistency**:
   - Viewer watching at 4000k stream
   - Ad only has 3000k max
   - Visible quality drop during ad

### Current Workaround:

The default `[1000, 2000, 3000]` works for most standard streams, but:
- ❌ Doesn't match low-bandwidth streams (mobile)
- ❌ Doesn't match high-quality streams (4K, 8K)
- ❌ Not optimal for every content type

---

## 📊 Next Steps (Priority Order)

### Priority 1: Database Migration ⚡ (5 minutes)
```bash
# Create and run migration
echo "ALTER TABLE channels ADD COLUMN bitrate_ladder TEXT;" > migrations/005_add_bitrate_ladder.sql
echo "UPDATE channels SET bitrate_ladder = '[1000, 2000, 3000]';" >> migrations/005_add_bitrate_ladder.sql
npx wrangler d1 execute ssai-admin --remote --file=./migrations/005_add_bitrate_ladder.sql
```

### Priority 2: GUI - Bitrate Ladder Input 🎨 (15 minutes)
- Add bitrate ladder field to channel edit form
- Display current ladder when editing
- Validate input (positive integers only)

### Priority 3: Auto-Detection (Future Enhancement) 🔮
- Parse origin manifest to detect bitrates
- Auto-populate bitrate_ladder on first stream load
- Allow manual override

---

## ✅ Testing the Current System

Even without the database column, the system **works with defaults**:

1. Upload an ad (transcodes to 1000k, 2000k, 3000k)
2. Create an ad pod with that ad
3. Stream with matching bitrates should work perfectly
4. Stream with different bitrates will have "closest match" behavior

**To verify it's working:**
```bash
# Check transcode logs
npx wrangler tail cf-ssai-transcode --format=pretty
# Look for: "Queueing transcode job for ad {id} with bitrates: [1000, 2000, 3000]"

# Check decision logs
npx wrangler tail cf-ssai-decision --format=pretty  
# Look for: "Using database pod: {id} with X ads (3 variants)"
```

---

## 🎯 Summary

| Component | Status | Notes |
|-----------|--------|-------|
| FFmpeg Transcoding | ✅ Working | Accepts any bitrate array |
| Admin API Logic | ✅ Working | Code ready, column missing |
| Database Schema | ❌ **Missing** | Need `bitrate_ladder` column |
| Decision Service | ✅ Working | Uses actual variants |
| GUI Configuration | ❌ **Missing** | Need form field |
| Auto-Detection | ⚪ Not Built | Future enhancement |

**Bottom Line:**
- Core transcoding to exact bitrates: **✅ WORKS**
- Database-driven bitrate config: **⚠️ NEEDS `bitrate_ladder` COLUMN**
- Current default `[1000, 2000, 3000]`: **✅ GOOD FOR MOST STREAMS**

**Action Required:**
Run the database migration to add `bitrate_ladder` column, then update the GUI to let users configure it!

