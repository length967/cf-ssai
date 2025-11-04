# Playback Issues: Root Cause Analysis

## Executive Summary

After reviewing the codebase, I've identified **7 fundamental architectural issues** that are causing playback failures. The system has accumulated layers of "fixes" that mask deeper problems. This document outlines the root causes and required solutions.

## Critical Findings

### 1. **SSAI Mode is Fundamentally Broken Due to Timeline Discontinuities**

**Location**: `src/utils/hls.ts` line 150-337 (`replaceSegmentsWithAds`)

**The Problem**:
- SSAI attempts to splice ads into the content timeline by replacing segments
- **Timeline discontinuity**: Ad segments have different PDT timestamps than the content they replace
- The function calculates a "resume PDT" by adding skipped duration to start PDT (line 308)
- **This creates a PDT gap** that confuses HLS players, causing buffering/stalls

**Example**:
```
Content timeline: PDT 12:00:00 → [30s ad] → PDT 12:00:30
But content actually moved to: PDT 12:00:45 (15s gap!)
Player thinks stream is 15s ahead → buffering hell
```

**Why This Happens**:
1. Live HLS windows move forward continuously
2. By the time you skip N segments, the manifest window has already moved
3. The "resume PDT" calculation assumes static content, but live streams are dynamic
4. Lines 164-173 try to detect this with "manifest window awareness" but it's **DISABLED** with a comment saying it causes "inconsistent skip counts"

**Real Issue**: The fundamental approach of trying to do true segment replacement in a live stream is wrong. You can't rewind live time.

---

### 2. **Race Conditions in Durable Object State Management**

**Location**: `src/channel-do.ts` lines 546-662

**The Problem**:
- `blockConcurrencyWhile` is supposed to serialize requests
- BUT: Ad state version checking (lines 548, 654-661) happens OUTSIDE the critical section
- Multiple concurrent requests can see stale ad state before blocking begins
- Result: **Double ad insertion** or **ads that never clear**

**Code Flow**:
```typescript
// Line 548: Load version BEFORE blocking
const initialAdStateVersion = await this.state.storage.get<number>('ad_state_version') || 0

// Line 550: Now block (but decisions already made based on stale state!)
return await this.state.blockConcurrencyWhile(async () => {
  // Lines 654-661: Check if version changed (too late!)
  const currentAdStateVersion = await this.state.storage.get<number>('ad_state_version') || 0
  if (currentAdStateVersion !== initialAdStateVersion) {
    console.log(`Ad state version changed...`) // What do we do now? State is already loaded!
  }
```

**Why This Fails**:
- The version check is informational only - no retry logic
- Ad state decisions are made before entering critical section
- By the time you detect version mismatch, you've already committed to an action

---

### 3. **SCTE-35 PDT Matching is Unreliable in Live Windows**

**Location**: `src/utils/hls.ts` line 183, `src/channel-do.ts` line 726-737

**The Problem**:
- SCTE-35 signals have PDT timestamps (e.g., "2025-01-03T12:00:00Z")
- Code searches manifest for exact PDT match: `line.includes(scte35StartPDT)` (hls.ts:183)
- **Live HLS windows are only 2-3 minutes**
- If ad decision takes >30s, the PDT has rolled out of the window
- Result: **SSAI falls back to SGAI** or **no ad insertion** (line 295-303)

**Expiration Logic Problems**:
```typescript
// Line 731: 90-second expiration for SCTE-35 PDT
if (ageSeconds > 90) {
  console.log(`SCTE-35 ad break expired (manifest window)...`)
  // Clear state and try again
}
```

**But**:
- Decision service can take 150ms-2000ms (DECISION_TIMEOUT_MS)
- Database lookups for channel config add latency
- By 2nd variant request (1600k after 800k), PDT may be expired
- Different variants see different manifest windows → **timeline desync**

---

### 4. **Decision Service Has No Actual Ads (Returns Empty Pods)**

**Location**: `src/decision-worker.ts` lines 382-499 (`runAdWaterfall`)

**The Problem**:
- Waterfall priority: VAST → DB Pods → Slate → Empty
- **VAST is disabled by default** (`vastEnabled: false` in DB)
- **DB ad pods are empty** (no ads uploaded/transcoded)
- **No slate configured** (line 535-551: channel slate → org slate → nothing)
- Result: `pod.items = []` (line 580)

**What Happens Next**:
```typescript
// channel-do.ts line 899: decisionResponse returns empty pod
const pod = decisionResponse.pod

// Line 982-983: Try to find ad item
let adItem = pod.items.find(item => item.bitrate === viewerBitrate)

// adItem is undefined because items = []

// Lines 1106-1110: Fallback to legacy DISCONTINUITY insertion
const ssai = insertDiscontinuity(cleanOrigin)
```

**This is why SSAI "doesn't work"** - you're inserting DISCONTINUITY tags with no actual ad content!

---

### 5. **Hybrid SSAI/SGAI Fallback Creates Inconsistent Behavior**

**Location**: `src/channel-do.ts` lines 1059-1078

**The Problem**:
- If SSAI fails (PDT not found), code falls back to SGAI
- **This happens silently mid-request**
- Different variants can get different modes:
  - Variant 1 (800k): SSAI succeeds → segment replacement
  - Variant 2 (1600k): SSAI fails → SGAI interstitial
- HLS players expect **consistent behavior across variants**
- Result: **Desynchronization, stuttering, or crash**

**Why It's Dangerous**:
```typescript
// Line 1061: "segmentsSkipped === 0" means SSAI failed
if (result.segmentsSkipped === 0) {
  console.log(`SSAI failed, falling back to SGAI...`)
  // Now insert SGAI interstitial INSTEAD
  const sgai = addDaterangeInterstitial(...)
  return new Response(sgai, ...)
}
```

- SGAI uses `#EXT-X-DATERANGE` with `CLASS="com.apple.hls.interstitial"`
- SSAI uses `#EXT-X-DISCONTINUITY` with segment URLs
- **These are incompatible delivery mechanisms**
- Switching between them mid-stream breaks playback

---

### 6. **SGAI Mode Only Works on Safari/iOS (By Design, But Not Documented Clearly)**

**Location**: `src/channel-do.ts` lines 248-254

**The Problem**:
- SGAI uses HLS Interstitials (Apple spec: RFC 8216 extensions)
- **Only supported by AVPlayer** (Safari, iOS, tvOS, macOS)
- hls.js, Shaka Player, ExoPlayer, video.js **DO NOT SUPPORT** HLS Interstitials
- Detection logic: `wantsSGAI()` checks User-Agent for "iPhone|iPad|Macintosh"

**What Happens on Other Platforms**:
```typescript
// Line 930-958: SGAI insertion
const sgai = addDaterangeInterstitial(
  cleanOrigin,
  pod.podId,
  startISO,
  stableDuration,
  interstitialURI
)
```

- Chrome/Firefox/Android receive manifest with `#EXT-X-DATERANGE:CLASS="com.apple.hls.interstitial"`
- Players ignore this tag (not in spec they implement)
- **No ad plays**, stream continues as normal
- Tracking pixels never fire

**SGAI is not a fallback - it's Apple-only**

---

### 7. **Excessive Complexity from Layered Fixes**

**Locations**: Throughout `channel-do.ts`

**The Problem**: The code has accumulated fixes for symptoms rather than addressing root causes:

1. **"Stable skip count" persistence** (lines 1082-1094)
   - Added to fix variant desync
   - Shouldn't be needed if SSAI worked correctly

2. **"Manifest window awareness" (DISABLED)** (lines 169-173)
   - Tried to fix timeline issues
   - Disabled because it caused "inconsistent skip counts"

3. **"Ad state version checking"** (lines 548, 654-661)
   - Added to detect concurrent modifications
   - No retry logic, just logging

4. **"SCTE-35 event deduplication"** (lines 770-812)
   - Prevents duplicate ads from rolling signals
   - Works around lack of proper state management

5. **"Synthetic slate generation"** (lines 389-411)
   - Fallback when no slate configured
   - Generates fake URLs that 404

6. **"PDT timeline continuity calculation"** (line 308)
   - Tries to maintain PDT timeline
   - Math is wrong for live streams

**Result**: 1100+ line Durable Object that's hard to reason about, debug, or modify.

---

## Why Tests Pass But Production Fails

Your test suite has **335+ tests** that all pass. Why don't they catch these issues?

### 1. **Tests Use Static Manifests**
```typescript
// tests/hls-advanced.test.ts
const manifest = `#EXTM3U\n#EXT-X-VERSION:7\n...`
const result = replaceSegmentsWithAds(manifest, pdt, ads, 30)
```

- Static manifests don't exhibit live window movement
- PDT always remains in the window
- Timeline discontinuities don't manifest

### 2. **Tests Don't Simulate Multi-Variant Requests**
- Tests call functions individually
- Don't test concurrent requests across multiple variants
- Don't test Durable Object coordination

### 3. **Tests Don't Validate Player Behavior**
- Tests check manifest structure
- Don't verify that players can actually decode the output
- Don't test ABR switching during ads

### 4. **Integration Tests Use Mock Services**
- Decision service returns hardcoded ads
- No database dependencies
- No real R2 assets

---

## Recommended Solutions

### **Short-term: Make SGAI Work Reliably**

SGAI (HLS Interstitials) is the correct approach for live streaming. Focus on this:

1. **Remove all SSAI code paths** for live streams
   - Keep only for VOD if needed
   - Eliminate hybrid fallback logic

2. **Fix User-Agent detection**
   ```typescript
   function supportsInterstitials(req: Request): boolean {
     const ua = req.headers.get("user-agent") || ""
     // Only Apple platforms support this
     return /iPhone|iPad|iPod|Macintosh|AppleTV/.test(ua)
   }
   ```

3. **Return 400 error for non-Apple clients**
   - Don't silently fall back to SSAI
   - Force clients to use Apple devices or disable ads

4. **Simplify Durable Object**
   - Remove timeline calculation code
   - Remove segment skipping logic
   - Just insert DATERANGE tags

### **Medium-term: Implement SSAI Correctly (If Required)**

If you need SSAI for non-Apple platforms:

1. **Pre-render ad breaks server-side**
   - Don't do it in real-time during request
   - Background worker stitches ads into content
   - Generate fixed-timeline VOD playlists

2. **Use separate manifest per ad break**
   - `/channel/live.m3u8` → no ads (base stream)
   - `/channel/ad-break-12345.m3u8` → pre-stitched with ads
   - Redirect clients during ad breaks

3. **OR: Use external SSAI solution**
   - AWS MediaTailor
   - Google DAI
   - These are battle-tested for live SSAI

### **Long-term: Proper Architecture**

1. **Separate concerns**:
   - Manifest Worker: Routing only
   - Ad Decision Worker: Business logic
   - Stitching Worker: Manifest manipulation (new)
   - Tracking Worker: Beacons

2. **Use event-driven architecture**:
   - SCTE-35 triggers → Queue
   - Decision service → Queue
   - Stitching → Queue
   - Don't do everything in DO blocking section

3. **Stateless manifest generation**:
   - Store ad state in KV/R2, not DO
   - DOs are for coordination, not computation
   - Regenerate manifests on-demand from state

---

## Immediate Action Items

### 1. **Validate Current Mode**
```bash
# Check what mode is actually being used
wrangler tail cf-ssai | grep -E "mode=|shouldInsertAd|SSAI|SGAI"
```

### 2. **Confirm Ad Availability**
```sql
-- Check if you have any ads ready
SELECT COUNT(*) FROM ads WHERE transcode_status = 'ready';
SELECT COUNT(*) FROM ad_pods WHERE ads != '[]';
SELECT COUNT(*) FROM slates WHERE status = 'ready';
```

### 3. **Test with Real Player**
```bash
# Generate test URL
curl "https://your-worker.workers.dev/org/channel/v_1600k.m3u8?force=sgai" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

# Test in Safari (supports SGAI)
# Test in Chrome (does not support SGAI)
```

### 4. **Enable Debug Logging**
Already enabled in `wrangler.toml` (lines 70-79), but verify output:
```bash
wrangler tail cf-ssai --format json | jq '.logs[] | select(.message | contains("Ad"))'
```

---

## Conclusion

**The system doesn't have "bugs" - it has fundamental architectural issues:**

1. **SSAI for live streams is the wrong approach** (timeline math doesn't work)
2. **Race conditions in state management** (version checking is insufficient)
3. **Decision service returns no ads** (empty database)
4. **SGAI only works on Apple devices** (by design, but not handled properly)
5. **Hybrid fallback creates inconsistent behavior** (variants get different modes)
6. **Accumulated technical debt** (layers of fixes masking root causes)

**Recommendation**: 
- **Short-term**: Disable SSAI, focus on SGAI for Apple devices only
- **Medium-term**: Implement proper server-side stitching if SSAI is required
- **Long-term**: Redesign architecture with proper separation of concerns

The good news: Your test suite is comprehensive and your SCTE-35/VAST parsing is solid. The issues are in the **playback delivery layer**, not the signal processing layer.
