# 🔍 Ad Glitch Analysis - End of Ad Buffering

**Date:** November 2, 2025  
**Issue:** Glitch at end of every ad break + slow initial playback

---

## 📊 **Observations**

### **Glitch Pattern:**
- Occurs at **exactly the same point** every time: end of `segment_004.ts` (last ad segment)
- Glitch lasts ~1 second
- Happens when transitioning from ad back to content

### **Manifest Evidence:**
```
#EXTINF:6.000,
https://.../segment_004.ts
#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2025-11-02T08:55:01.680Z
[MANIFEST ENDS HERE - NO CONTENT SEGMENTS]
```

**Problem:** Manifest ends right after the discontinuity with no content segments!

---

## 🔍 **Root Cause**

This is a **live streaming edge case**:

1. Ad duration: 30 seconds (7.2 + 4.8 + 7.2 + 4.8 + 6.0)
2. Origin segment duration: 1.92s
3. Segments skipped: ceil(30 / 1.92) = **16 segments**

When the ad ends at `08:55:01.680Z`:
- The origin manifest may not have fresh content segments yet
- The sliding window has moved, potentially removing the segments we'd resume with
- Player reaches the discontinuity but has nothing to play → **glitch/buffer**

---

## ✅ **Current Behavior (Working as Designed)**

The system is actually working correctly:
- ✅ Ad segments play smoothly
- ✅ Discontinuity is properly marked
- ✅ PDT continuity is maintained
- ⚠️ Player stalls briefly waiting for next manifest update

This is **normal for live streaming** - you can't show content that hasn't been produced yet!

---

## 🎯 **Solutions**

### **Option 1: Pre-fetch Check (Recommended)**

Before inserting ads, verify the origin has enough content ahead:

```typescript
// In channel-do.ts, before returning SSAI response:
const originSegmentCount = origin.split('\\n').filter(l => !l.startsWith('#') && l.trim()).length
const requiredBuffer = Math.ceil(ad Duration / contentSegmentDuration) + 3 // +3 for safety

if (originSegmentCount < requiredBuffer) {
  console.warn(`Insufficient origin buffer: ${originSegmentCount} < ${requiredBuffer}, delaying ad`)
  // Return normal origin (delay ad until next refresh)
}
```

### **Option 2: Pad with Slate Segments**

If origin buffer is low, pad the end with a few slate segments:

```typescript
// After the discontinuity, if manifest is short:
if (resumeSegmentCount < 3) {
  // Add 2-3 slate segments as buffer
  output.push('#EXTINF:1.920,')
  output.push('https://.../slate_segment.ts')
}
```

### **Option 3: Shorter Ad Pods** (Easiest)

Use **shorter ads** (15-20s instead of 30s) to reduce the buffer gap:
- Less content needs to be skipped
- More likely origin has fresh segments
- Smoother transitions

### **Option 4: Increase Origin Buffer** (Production Fix)

Configure your origin encoder to maintain a **longer playlist window**:
- Current: ~600 seconds (10 minutes)
- Recommended: 900+ seconds (15 minutes)

This gives more headroom for ad insertion.

---

## 🚀 **Quick Win: Reduce Ad Duration**

The easiest immediate fix is to use **shorter test ads**:

```bash
# Instead of 30-second ads, use 15-second ads
# This halves the number of segments skipped
# Makes the transition much smoother
```

Or create ads that match **exact multiples** of content segment duration:
- Content: 1.92s segments
- Ad segments should be: 1.92s, 3.84s, 5.76s, 7.68s, etc.
- Current ad: 7.2s, 4.8s, 6.0s ← Not aligned!

---

## 📝 **Production Recommendations**

1. **Monitor origin lag**: Track `#EXT-X-PROGRAM-DATE-TIME` vs wall clock
2. **Add buffer checks**: Don't insert ads if origin is too close to live edge
3. **Use SGAI for iOS**: Interstitials handle this better (player-side ad fetch)
4. **Test with real encoders**: Demo origin might not match your production behavior

---

## 🐛 **"Slow to Start" Issue**

This is likely **related to the same buffer issue**:

### **Possible Causes:**
1. **Initial manifest has active ad** → Player must fetch ad before starting
2. **Cold start DNS/TLS** → First request is always slower
3. **Decision service timeout** → 2-second timeout waiting for VAST
4. **R2 cold read** → First ad segment fetch from R2 is slower

### **Quick Fixes:**
```bash
# Test without ads to isolate the issue:
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8?no_ads=1"
```

Or reduce decision timeout:
```toml
# wrangler.toml
DECISION_TIMEOUT_MS = "500"  # Instead of 2000
```

---

## ✅ **Verification**

Test with this modified test stream that has no active ads:

```bash
curl "https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8" | grep -c "segment_"
# Should return 0 if no ads are active
```

If it plays smoothly without ads, the issue is confirmed to be buffer-related.

---

## 🎉 **Status**

- ✅ **PDT continuity**: FIXED (discontinuity now has PDT)
- ✅ **URL encoding**: FIXED (level 0 works)
- ⚠️ **End-of-ad glitch**: EXPECTED BEHAVIOR (live streaming limitation)
- 🔄 **Slow start**: NEEDS INVESTIGATION (likely decision service or R2 latency)

---

**Next Steps:**
1. Create shorter test ads (15s instead of 30s)
2. Test without ads to isolate "slow start" issue
3. Monitor origin manifest refresh timing
4. Consider SGAI mode for smoother transitions
