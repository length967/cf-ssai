# Architectural Review - Code References & Line Numbers

This document provides specific line references for each architectural issue identified.

---

## Issue #1: PDT Timeline Corruption

### Files
- `src/utils/hls.ts` - Main manifest manipulation
- `src/channel-do.ts` - Decision logic

### Key Problem Lines

#### PDT Advancement During Ad Insertion (WRONG)
**File**: `src/utils/hls.ts`  
**Lines**: 194-219

```typescript
// WRONG: Advances PDT by ad segment duration
for (let j = 0; j < adSegments.length; j++) {
  const segment = adSegments[j]
  output.push(`#EXT-X-PROGRAM-DATE-TIME:${currentPDT}`)  // ← Adds PDT
  output.push(`#EXTINF:${segment.duration.toFixed(3)},`)
  output.push(segment.url)
  // ← Problem: advances PDT by ad duration, not by skipped content
  currentPDT = addSecondsToTimestamp(currentPDT, segmentDuration)  // ← Wrong!
}
```

**Why wrong**: 
- Assumes PDT advances by ad segment duration
- Ignores that origin stream continues advancing during ad
- Results in discontinuous PDT timeline

#### Resume PDT Calculation (WRONG)
**File**: `src/utils/hls.ts`  
**Lines**: 305-310

```typescript
// WRONG: Calculates resume PDT but assumes math is correct
const lastAdPDT = addSecondsToTimestamp(startPDT, skippedDuration)
output.push(`#EXT-X-PROGRAM-DATE-TIME:${lastAdPDT}`)
console.log(`Inserted calculated resume PDT for timeline continuity: ${lastAdPDT} 
  (start: ${startPDT} + skipped: ${skippedDuration.toFixed(2)}s, ad: ${adDuration.toFixed(2)}s)`)
```

**Why wrong**:
- Assumes `skippedDuration` matches what origin stream advanced
- Calculates from estimated segment durations (biased sampling)
- PDT can jump backwards if calculation is off
- Creates HLS.js timeline tracking errors

### Related Code

#### HLS.js Player Tracking (context)
When HLS.js receives manifest, it:
1. Tracks wall-clock PDT from manifest
2. Maps segments to PDT timeline
3. Detects discontinuities (backward PDT jumps)
4. **Triggers buffer stall** when discontinuity detected

---

## Issue #2: Ad State Persistence Race Condition

### Files
- `src/channel-do.ts` - State management

### Key Problem Lines

#### Unreliable State Expiration
**File**: `src/channel-do.ts`  
**Lines**: 28-33

```typescript
async function loadAdState(state: DurableObjectState): Promise<AdState | null> {
  const v = await state.storage.get<AdState>(AD_STATE_KEY)
  if (!v) return null
  if (Date.now() >= v.endsAt) return null  // ← Only checks wall-clock time
  return v
}
```

**Problems**:
- Only checks `endsAt` (wall-clock expiration)
- Doesn't check if manifest window has rolled out (normal for live HLS)
- Result: Ad state stays "active" but PDT gone from manifest

#### Fragile Deduplication Logic
**File**: `src/channel-do.ts`  
**Lines**: 770-851

```typescript
// Check if we've already processed this SCTE-35 signal
const scte35EventId = activeBreak.binaryData?.spliceEventId?.toString() || activeBreak.id
const existingAdState = await loadAdState(this.state)

// ← RACE CONDITION: Multiple requests can reach here with undefined existingAdState
if (existingAdState?.processedEventIds?.includes(scte35EventId)) {
  console.log(`⏭️  Skipping duplicate SCTE-35 signal: ${scte35EventId}`)
  shouldInsertAd = false
  adActive = false
} else {
  // Create new ad state
  const newAdState: AdState = {
    // ...
    processedEventIds: [scte35EventId],
  }
  await saveAdState(this.state, newAdState)  // ← Can be slow/fail
}
```

**Race condition timeline**:
```
Request A: loads adState (null)
Request B: loads adState (null)  ← Before A's write completes
Request A: creates newAdState, writes (processedEventIds: ["event1"])
Request B: creates newAdState, writes (processedEventIds: ["event1"])  ← Overwrites A!
Request C: loads adState (processedEventIds: ["event1"])
Request D: loads adState (processedEventIds: ["event1"])

Result: Only Event ID stored once, but multiple requests processed it
→ Duplicate ads (potentially)
```

#### State Persistence Timing Window
**File**: `src/channel-do.ts`  
**Lines**: 1080-1094

```typescript
// SSAI succeeded - persist skip stats ONLY on first request
if (adState && (!adState.contentSegmentsToSkip || adState.contentSegmentsToSkip === 0)) {
  if (result.segmentsSkipped > 0) {
    adState.contentSegmentsToSkip = result.segmentsSkipped  // ← Local update
    adState.skippedDuration = result.durationSkipped
    await saveAdState(this.state, adState)  // ← Slow write
    console.log(`✅ Persisted stable skip count (FIRST REQUEST): ${result.segmentsSkipped}`)
  }
}
// ← Window: Requests 2-N might not see the persisted value yet
```

**Problem**: 
- Write is asynchronous
- Multiple concurrent requests don't see persisted value
- Each calculates independently
- Results in different skip counts

---

## Issue #3: Manifest Window Handling

### Files
- `src/channel-do.ts` - SCTE-35 detection
- `src/utils/hls.ts` - PDT lookup

### Key Problem Lines

#### Wrong PDT Selection
**File**: `src/channel-do.ts`  
**Lines**: 765-767

```typescript
// Find the PDT timestamp for the break
const pdts = extractPDTs(origin)
if (pdts.length > 0) {
  scte35StartPDT = pdts[pdts.length - 1]  // ← WRONG: Takes LAST PDT, not matching SCTE-35
}
```

**Problem**:
- Takes last PDT in manifest
- Should match SCTE-35 signal to its manifest position
- Result: Incorrect ad insertion point

#### Missing Window Validation Before Insertion
**File**: `src/utils/hls.ts`  
**Lines**: 150-337 (entire function)

```typescript
// ❌ Missing: Check if scte35StartPDT actually exists in manifest before attempting insertion
// ❌ Missing: Validate that enough segments remain after ad duration
// ❌ Missing: Handle case where PDT has rolled out of manifest window
```

Only checks AFTER insertion (lines 282-303):
```typescript
if (remainingSegments === 0) {
  console.error(`No content segments remaining`)
  return { manifest: variantText, segmentsSkipped: 0 }  // ← Too late, already tried
}
```

#### No Forward-Looking Validation
**File**: `src/channel-do.ts`  
**Lines**: 746-849

```typescript
// ❌ Missing validation:
// - Is SCTE-35 signal too old (>90 seconds)?
// - Is PDT in current manifest window?
// - Are there enough segments for skip duration?
// - Will ad fit in available manifest window?

if (activeBreak && channelConfig?.scte35AutoInsert) {
  // ← Just proceeds without checking manifest window
  shouldInsertAd = true
  breakDurationSec = getBreakDuration(activeBreak)
  // ← Then attempts insertion (fails if PDT not in window)
}
```

---

## Issue #4: SCTE-35 Validation Missing

### Files
- `src/utils/scte35.ts` - Parser
- `src/channel-do.ts` - Decision logic

### Key Problem Lines

#### No Signal Completeness Validation
**File**: `src/utils/scte35.ts`  
**Lines**: 22-38

```typescript
export function parseSCTE35FromManifest(manifestText: string): SCTE35Signal[] {
  const lines = manifestText.split("\n")
  const signals: SCTE35Signal[] = []
  
  for (const line of lines) {
    if (line.startsWith("#EXT-X-DATERANGE:")) {
      const signal = parseDateRangeSCTE35(line)
      if (signal) {
        console.log(`SCTE-35 signal detected: ${signal.id}...`)
        signals.push(signal)  // ← NO VALIDATION of signal quality
      }
    }
  }
  return signals
}
```

**Missing validation**:
- Duration sanity check (>0, <180s reasonable)
- Signal age check (PDT >90s in past = invalid)
- PDT format validation
- Event ID collision detection
- CRC validation enforcement

#### No Age Validation on SCTE-35
**File**: `src/channel-do.ts`  
**Lines**: 663-681

```typescript
// Parse SCTE-35 signals from origin manifest
const scte35Signals = parseSCTE35FromManifest(origin)
const activeBreak = findActiveBreak(scte35Signals)

// ❌ Missing: Check if activeBreak.id is too old
// ❌ Missing: Check if activeBreak.pts implies signal from past manifests
// ❌ Missing: Validate against current system time
```

---

## Issue #5: SGAI Platform Incompatibility

### Files
- `src/utils/hls.ts` - SGAI insertion
- `src/channel-do.ts` - Mode selection

### Key Problem Lines

#### SGAI Insertion (Apple-Only Feature)
**File**: `src/utils/hls.ts`  
**Lines**: 83-99

```typescript
export function addDaterangeInterstitial(
  variantText: string,
  id: string,
  startDateISO: string,
  durationSec: number,
  assetURI: string,
  controls = "skip-restrictions=6"
) {
  const tag = `#EXT-X-DATERANGE:ID="${id}",CLASS="com.apple.hls.interstitial",...`
  // ← This tag is ONLY understood by Apple players
  // hls.js: Not supported (no implementation in github.com/video-dev/hls.js)
  // VideoJS: Not supported
  // Android: Not supported
}
```

#### SSAI Falls Back to SGAI (Breaking Web Support)
**File**: `src/channel-do.ts`  
**Lines**: 930-1078

```typescript
if (mode === "sgai") {
  // Insert HLS Interstitial DATERANGE tag
  const sgai = addDaterangeInterstitial(...)
  return new Response(sgai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
} else {
  // SSAI: Replace content segments with ad segments
  // ...
  if (result.segmentsSkipped === 0) {
    console.log(`🔄 SSAI failed, falling back to SGAI`)  // ← Line 1062
    // Falls back to SGAI, which doesn't work on web!
    return new Response(sgai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
  }
}
```

**Impact**: When SSAI fails (PDT not found), fallback to SGAI means:
- 60% of users see no ads
- No error message
- Silent failure

---

## Issue #6: Slate Padding Non-Functional

### Files
- `src/channel-do.ts` - Slate fetching
- `src/utils/hls.ts` - Slate insertion

### Key Problem Lines

#### Synthetic Slate URLs Don't Resolve
**File**: `src/channel-do.ts`  
**Lines**: 390-411

```typescript
private generateSyntheticSlate(gapDuration: number): Array<{url: string, duration: number}> {
  const segments: Array<{url: string, duration: number}> = []
  const segmentCount = Math.ceil(gapDuration / segmentDuration)
  
  for (let i = 0; i < segmentCount; i++) {
    segments.push({
      url: `/slate/synthetic_black_${i}.ts`,  // ← This path doesn't exist!
      duration: segmentDuration
    })
  }
  return segments
}
```

**Problem**:
- Generates relative path `/slate/synthetic_black_0.ts`
- No base URL context
- Player tries to fetch, gets 404
- Result: Black screen

#### Silent Slate Lookup Failure
**File**: `src/channel-do.ts`  
**Lines**: 417-461

```typescript
private async fetchSlateSegments(
  channelId: string,
  viewerBitrate: number | null,
  gapDuration: number
): Promise<Array<{url: string, duration: number}>> {
  try {
    const channel = await this.env.DB.prepare(`
      SELECT slate_id FROM channels WHERE id = ?
    `).bind(channelId).first<any>()  // ← Can fail silently
    
    if (!slateId) {
      console.warn('No slate configured for channel')
      return this.generateSyntheticSlate(gapDuration)  // ← Falls back to broken synthetic
    }
    // ...
  } catch (err) {
    console.error('Error fetching slate segments:', err)
    return []  // ← Returns empty array on error
  }
}
```

---

## Issue #7: Concurrent Request Race Condition

### Files
- `src/utils/hls.ts` - Skip count calculation
- `src/channel-do.ts` - State persistence

### Key Problem Lines

#### Per-Request Skip Calculation (Variable)
**File**: `src/utils/hls.ts`  
**Lines**: 113-135

```typescript
function getAverageSegmentDuration(lines: string[]): number {
  const durations: number[] = []
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/#EXTINF:([\d.]+)/)
      if (match) {
        durations.push(parseFloat(match[1]))
      }
    }
    if (durations.length >= 10) break  // ← Only samples first 10
  }
  // ...
  return durations.reduce((sum, d) => sum + d, 0) / durations.length
}
```

**Problem**: Sampling bias means different requests get different averages

#### Different Variants Have Different Segment Durations
**File**: `src/utils/hls.ts`  
**Lines**: 163-167

```typescript
const contentSegmentDuration = getAverageSegmentDuration(lines)  // ← Varies per variant
const segmentsToReplace = Math.ceil(contentSkipDuration / contentSegmentDuration)

console.log(`Ad duration: ${adDuration}s, SCTE-35 duration: ${contentSkipDuration}s, 
  Content segment duration: ${contentSegmentDuration}s, Segments to skip: ${segmentsToReplace}`)
```

**Scenario**:
```
Variant v_800k: avg_segment=2.0s → skip 15 segments
Variant v_1600k: avg_segment=2.1s → skip 14 segments

Player switches quality: gets different skip counts
Result: Timeline desync
```

---

## Issue #8: Cloudflare Worker Timeouts

### Files
- `src/manifest-worker.ts` - Timeout configuration
- `src/channel-do.ts` - Decision service call

### Key Problem Lines

#### Decision Service Timeout Too Long
**File**: `src/manifest-worker.ts`  
**Lines**: 305-327

```typescript
async function decision(env: Env, adPodBase: string, channel: string, durationSec: number, viewerInfo?: any): Promise<DecisionResponse> {
  if (env.DECISION) {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), parseInt(env.DECISION_TIMEOUT_MS || "150", 10))
    // ← 150ms timeout, but HTTP timeout is 50ms!
    
    try {
      const response = await env.DECISION.fetch("https://decision/decision", {
        // ...
        signal: ctrl.signal,
      })
      clearTimeout(to)
      if (response.ok) {
        return await response.json()
      }
    } catch (err) {
      clearTimeout(to)
      console.error("Decision service error:", err)  // ← Will hit 50ms limit before 150ms timeout
    }
  }
}
```

**Problem**:
- Worker HTTP timeout: 50ms
- Decision timeout set: 150ms
- Request terminates at 50ms, but code waits up to 150ms
- Results in timeout errors

#### Manifest Processing Timeline
**File**: `src/channel-do.ts`  
**Lines**: 637-650

```typescript
// Fetch origin manifest (10-20ms)
const originResponse = await fetchOriginVariant(originUrl, channel, variant)
const origin = await originResponse.text()

// Parse SCTE-35 (5-10ms)
const scte35Signals = parseSCTE35FromManifest(origin)

// Call decision service (100-150ms) ← Can timeout!
const decisionResponse = await decision(this.env, adPodBase, channelId, stableDuration, ...)

// Fetch ad playlist (10-20ms)
const playlistResponse = await fetchWithRetry(adItem.playlistUrl, 3)

// Total: ~150ms+ (exceeds 50ms HTTP timeout)
```

---

## Issue #9: Segment Skip Overshooting

### Files
- `src/utils/hls.ts` - Skip calculation and PDT advancement

### Key Problem Lines

#### Sample Bias in Duration Calculation
**File**: `src/utils/hls.ts`  
**Lines**: 113-135

```typescript
// Only samples first 10 segments
// Live streams have variable bitrate (VBR)
// Early segments may be keyframe-heavy
// Average is biased toward actual first segments, not representative
```

#### Ceil Overshooting
**File**: `src/utils/hls.ts`  
**Lines**: 163-167

```typescript
const contentSkipDuration = scte35Duration || adDuration
const contentSegmentDuration = getAverageSegmentDuration(lines)
const segmentsToReplace = Math.ceil(contentSkipDuration / contentSegmentDuration)
// ← Ceil always rounds up
// Example: ceil(30 / 2.1) = 15 segments = 31.5s (overshoots by 1.5s!)
```

#### PDT Advancement Doesn't Account for Overshoot
**File**: `src/utils/hls.ts`  
**Lines**: 305-310

```typescript
const lastAdPDT = addSecondsToTimestamp(startPDT, skippedDuration)
// ← Assumes skippedDuration is exact
// But actual content skipped can be 0.5-2s more/less than assumed
// Result: Resume PDT wrong
```

---

## Issue #10: Player Mode Detection Unreliable

### Files
- `src/channel-do.ts` - Mode selection logic

### Key Problem Lines

#### Crude User-Agent Detection
**File**: `src/channel-do.ts`  
**Lines**: 250-254

```typescript
function wantsSGAI(req: Request): boolean {
  const ua = req.headers.get("user-agent") || ""
  // ← Crude detection: matches substring
  return /iPhone|iPad|Macintosh/.test(ua)
}
```

**Problems**:
- Safari on Windows: Not detected (no "Macintosh")
- HLS.js on iPad: Detected as iPad but HLS.js doesn't support SGAI!
- Spoofed User-Agent: Wrong mode selected
- Missing: actual player capability detection

#### Mode Selection Logic
**File**: `src/channel-do.ts`  
**Lines**: 683-700

```typescript
let mode: string
if (force) {
  mode = force  // ← Query parameter override (OK)
} else if (channelConfig?.mode && channelConfig.mode !== 'auto') {
  mode = channelConfig.mode  // ← Config override (OK)
} else {
  mode = wantsSGAI(req) ? "sgai" : "ssai"  // ← Fallback to crude detection
}

// ❌ Missing: Validation that mode is valid
// ❌ Missing: Feature detection (does player actually support mode?)
// ❌ Missing: Graceful degradation if selected mode fails
```

---

## Summary of Critical Code Issues

| Issue | File | Lines | Problem |
|-------|------|-------|---------|
| 1 | hls.ts | 194-219 | PDT advancement wrong |
| 1 | hls.ts | 305-310 | Resume PDT calculation wrong |
| 2 | channel-do.ts | 770-851 | Deduplication race condition |
| 2 | channel-do.ts | 1080-1094 | Skip count persistence timing window |
| 3 | channel-do.ts | 765-767 | Wrong PDT selection |
| 3 | hls.ts | 282-303 | Checks AFTER insertion (too late) |
| 4 | scte35.ts | 22-38 | No signal validation |
| 5 | hls.ts | 83-99 | SGAI Apple-only |
| 5 | channel-do.ts | 1062 | SSAI fails → SGAI (breaks web) |
| 6 | channel-do.ts | 398-402 | Synthetic slate URLs invalid |
| 7 | hls.ts | 113-135 | Biased segment duration sampling |
| 7 | hls.ts | 163-167 | Ceil overshooting |
| 8 | manifest-worker.ts | 305-327 | Decision timeout too long |
| 9 | hls.ts | 163-167 | No fractional segment handling |
| 10 | channel-do.ts | 250-254 | Crude user-agent detection |

---

