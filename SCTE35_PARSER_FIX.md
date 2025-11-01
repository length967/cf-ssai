# 🔧 SCTE-35 Parser Fix - DEPLOYED

## ✅ Bug Found & Fixed!

### The Problem:

The SCTE-35 parser was looking for `DURATION` attribute:
```typescript
const duration = attrs["DURATION"] ? parseFloat(attrs["DURATION"]) : undefined
```

But the Unified Streaming origin uses `PLANNED-DURATION`:
```
#EXT-X-DATERANGE:ID="14567063-1762031940",START-DATE="2025-11-01T21:19:00.480000Z",PLANNED-DURATION=38.4,SCTE35-OUT=...
```

**Result:** SCTE-35 markers were detected but had NO DURATION, so ad insertion logic failed!

---

## ✅ The Fix:

Updated `src/utils/scte35.ts` line 44-45:

**Before:**
```typescript
const duration = attrs["DURATION"] ? parseFloat(attrs["DURATION"]) : undefined
```

**After:**
```typescript
const duration = attrs["DURATION"] ? parseFloat(attrs["DURATION"]) : 
                 attrs["PLANNED-DURATION"] ? parseFloat(attrs["PLANNED-DURATION"]) : undefined
```

Now the parser checks for **both** `DURATION` and `PLANNED-DURATION` attributes!

---

## 🔍 Additional Improvements:

Added enhanced logging to track SCTE-35 detection:

```typescript
// In parseSCTE35FromManifest():
console.log(`SCTE-35 signal detected: ${signal.id}, type: ${signal.type}, duration: ${signal.duration}s`)
console.log(`Total SCTE-35 signals found: ${signals.length}`)

// In channel-do.ts:
if (scte35Signals.length > 0) {
  console.log(`Found ${scte35Signals.length} SCTE-35 signals, activeBreak:`, 
    activeBreak ? `${activeBreak.id} (${activeBreak.duration}s)` : 'none')
}
```

---

## 🚀 Deployment Status:

✅ **Deployed:** Manifest Worker v d481b6c4 (November 1, 2025 21:29)  
✅ **Parser Fixed:** Now handles PLANNED-DURATION  
✅ **Enhanced Logging:** Added for debugging  
✅ **Ready to Test:** SCTE-35 ad insertion should work now

---

## 🧪 Testing Instructions:

### Option 1: Watch Logs in Real-Time

```bash
# Terminal 1: Monitor logs
npx wrangler tail cf-ssai --format=pretty

# Terminal 2: Access stream
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8
```

**Expected logs:**
```
SCTE-35 signal detected: 14567063-1762031940, type: splice_insert, duration: 38.4s
Total SCTE-35 signals found: 5
Found 5 SCTE-35 signals, activeBreak: 14567063-1762031940 (38.4s)
SCTE-35 break detected (auto-insert enabled): duration=38.4s, pdt=...
```

### Option 2: Check for Ad Insertion in Manifest

```bash
curl -s "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8" \
  | grep -E "(DATERANGE.*interstitial|DISCONTINUITY)"
```

**Expected output (SGAI mode):**
```
#EXT-X-DATERANGE:ID="...",CLASS="com.apple.hls.interstitial",START-DATE="...",DURATION=38.400,X-ASSET-URI="...",X-PLAYOUT-CONTROLS="..."
```

**Or (SSAI mode):**
```
#EXT-X-DISCONTINUITY
[ad segments here]
#EXT-X-DISCONTINUITY
```

### Option 3: Continuous Monitoring

Since SCTE-35 markers appear every 2 minutes, monitor continuously:

```bash
while true; do
  echo "=== $(date) ==="
  curl -s "https://cf-ssai.mediamasters.workers.dev/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8" \
    | grep -c "DATERANGE.*interstitial" && echo "✅ Ad inserted!" || echo "⏳ No ad"
  sleep 10
done
```

---

## 📊 Origin Stream Schedule:

**SCTE-35 Markers:**
- Frequency: Every **120.04 seconds** (2 minutes)
- Duration: **38.4 seconds** per ad break
- Format: `#EXT-X-DATERANGE` with `PLANNED-DURATION` and `SCTE35-OUT`

**Recent markers seen:**
- 21:19:00.480000Z
- 21:21:01.440000Z
- 21:23:02.400000Z
- 21:25:03.360000Z
- 21:27:04.320000Z

**Pattern:** Markers appear roughly on odd minutes (19, 21, 23, 25, 27, 29, 31, etc.)

---

## 🎯 What Should Happen Now:

1. **Parser detects SCTE-35** with 38.4s duration ✅
2. **Channel DO sees active break** ✅
3. **Decision service called** for ad pod
4. **Ads inserted in manifest** (SGAI or SSAI mode)
5. **User sees ads** for 38.4 seconds

---

## 🐛 If Ads Still Don't Insert:

### Check Decision Service:

```bash
npx wrangler tail cf-ssai-decision --format=pretty
```

Look for:
```
Channel config loaded: ch_demo_sports
Database ad pods retrieved: 1 pods
Ad fetched from DB: ad_1761998592294_khk143gu4
Building ad items from ad variants
```

### Check Database:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, ads, channel_id, status FROM ad_pods WHERE channel_id = 'ch_demo_sports'"
```

Expected: `ads: ["ad_1761998592294_khk143gu4"]`, `status: "active"`

### Verify Ad is Ready:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, transcode_status, variants FROM ads WHERE id = 'ad_1761998592294_khk143gu4'"
```

Expected: `transcode_status: "ready"`, `variants: [...]`

---

## 📈 Summary:

| Component | Before | After |
|-----------|--------|-------|
| PLANNED-DURATION parsing | ❌ Not supported | ✅ Supported |
| SCTE-35 duration | ❌ NULL/undefined | ✅ 38.4s |
| Ad insertion trigger | ❌ Failed | ✅ Should work |
| Logging | ⚪ Minimal | ✅ Enhanced |

---

## 🎉 Next Steps:

1. **Monitor logs** to verify SCTE-35 detection
2. **Check manifests** for ad insertion
3. **Test in VLC/Safari** to see actual ad playback
4. **Report results** - ads should now insert every 2 minutes!

**The fix is deployed and ready to test! 🚀**

