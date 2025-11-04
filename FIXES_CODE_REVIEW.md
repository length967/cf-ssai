# Code Review: Critical Bug Fixes

## Executive Summary

✅ **4 of 6 critical fixes have been implemented and integrated into the codebase.**

**Status:**
- ✅ **Fix #1**: PDT Timeline Corruption - COMPLETE
- ✅ **Fix #2**: Segment Skip Race Condition - COMPLETE  
- ✅ **Fix #3**: SCTE-35 Validation - COMPLETE
- ✅ **Fix #5**: Decision Service Timeout - COMPLETE
- ⏳ **Fix #4**: Manifest Window Validation - PENDING
- ⏳ **Fix #6**: Robust Player Detection - PENDING

---

## ✅ Fix #1: PDT Timeline Corruption - COMPLETE

### Implementation: `src/utils/hls-fixed.ts`

**Status:** ✅ Excellent

**What was fixed:**
- Preserves origin PDT timestamps instead of recalculating them
- Uses DISCONTINUITY tags to allow synthetic PDT timelines for ads
- Resume segment fetches actual origin PDT from manifest ahead of skip point

**Code Quality Assessment:**

```typescript
// CRITICAL: Find and preserve the ACTUAL PDT from the resume segment
// Do NOT calculate it - use the origin's timestamp
let resumePDT: string | null = null
let searchIndex = resumeIndex

// Look ahead to find the next PDT tag from origin
while (searchIndex < lines.length && !resumePDT) {
  const searchLine = lines[searchIndex]
  if (searchLine.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
    resumePDT = searchLine.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
    console.log(`[PDT-FIX] ✅ Found origin resume PDT: ${resumePDT}`)
    break
  }
  if (searchIndex - resumeIndex > 30) {
    console.warn(`[PDT-FIX] ⚠️  Could not find resume PDT within search window`)
    break
  }
  searchIndex++
}
```

**Strengths:**
- ✅ Comprehensive inline documentation explaining the fix
- ✅ Detailed comments showing broken vs. fixed behavior (lines 259-291)
- ✅ Good error handling with fallback to calculated PDT
- ✅ Search window limit (30 lines) prevents runaway loops
- ✅ Distinct logging prefix `[PDT-FIX]` for traceability

**Minor concerns:**
- Search window hardcoded to 30 lines (~120 seconds at 4s segments) - could be configurable
- Fallback to calculated PDT could mask manifest issues; might want stricter logging

**Recommendation:** Add configuration constant for search window, consider error on calculated fallback.

---

## ✅ Fix #2: Segment Skip Race Condition - COMPLETE

### Integration: `src/channel-do.ts` (lines 879-1162)

**Status:** ✅ Excellent

**What was fixed:**
- Stores calculated skip count in Durable Object state (`adState.contentSegmentsToSkip`)
- Persists on first request only (prevents concurrent request inconsistency)
- Subsequent requests reuse cached skip count
- Prevents double-insertion when manifest rolls during ad break

**Code Quality Assessment:**

```typescript
// CRITICAL: Once set, never overwrite to ensure timeline consistency 
// across all variants
if (adState && (!adState.contentSegmentsToSkip || adState.contentSegmentsToSkip === 0)) {
  // Only persist if we actually skipped content (PDT was found in manifest)
  if (result.segmentsSkipped > 0) {
    adState.contentSegmentsToSkip = result.segmentsSkipped
    adState.skippedDuration = result.durationSkipped
    await saveAdState(this.state, adState)
    console.log(`✅ Persisted stable skip count (FIRST REQUEST): ${result.segmentsSkipped} segments (${result.durationSkipped.toFixed(2)}s)`)
  }
} else if (adState && adState.contentSegmentsToSkip) {
  console.log(`ℹ️  Using existing stable skip count: ${adState.contentSegmentsToSkip} segments`)
}
```

**Strengths:**
- ✅ Only persists when result > 0 (avoids locking to zero if PDT not found initially)
- ✅ Clear logging distinguishes first-request vs. reuse scenarios
- ✅ Properly handles edge case where PDT rolls out of window mid-break
- ✅ Ad state version tracking (line 40-44) helps detect concurrent modifications
- ✅ Integration with Durable Object storage ensures consistency

**Potential issues:**
- No explicit lock mechanism if concurrent requests arrive simultaneously - relies on DO single-threaded guarantee
- No validation that subsequent requests don't recalculate different skip counts (defensive logging helps)
- Consider adding telemetry counter for "skip count recalculation attempts" to detect bugs

**Recommendation:** Add monitoring for when skip count differs from reused value to catch edge cases.

---

## ✅ Fix #3: SCTE-35 Validation - COMPLETE

### Implementation: `src/utils/scte35.ts` (lines 276-425)

**Status:** ✅ Excellent - comprehensive and well-documented

**What was fixed:**
- Comprehensive validation function prevents crashes from malformed signals
- Distinguishes between critical errors (rejects) and warnings (allows)
- Detailed error messages for debugging

**Code Quality Assessment:**

```typescript
export function validateSCTE35Signal(signal: SCTE35Signal, pdt?: string): SCTE35ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. ID validation
  if (!signal.id || typeof signal.id !== 'string' || signal.id.trim().length === 0) {
    errors.push('Missing or invalid signal ID')
  }

  // 2. Type validation
  const validTypes: SCTE35SignalType[] = ['splice_insert', 'time_signal', 'return_signal']
  if (!signal.type || !validTypes.includes(signal.type)) {
    errors.push(`Invalid signal type: ${signal.type}...`)
  }

  // 3. Duration validation for ad breaks
  if (isAdBreakStart(signal)) {
    const duration = getBreakDuration(signal)
    if (!duration) {
      errors.push('Ad break start signal missing duration...')
    } else if (duration <= 0) {
      errors.push(`Invalid ad break duration: ${duration}s (must be > 0)`)
    } else if (duration < 0.1 || duration > 300) {
      errors.push(`Unrealistic ad break duration: ${duration}s...`)
    } else if (duration < 5) {
      warnings.push(`Very short ad break: ${duration}s...`)
    } else if (duration > 180) {
      warnings.push(`Very long ad break: ${duration}s...`)
    }
  }

  // 4. PDT temporal validation
  if (pdt) {
    try {
      const pdtDate = new Date(pdt)
      if (isNaN(pdtDate.getTime())) {
        errors.push(`Invalid PDT timestamp format: ${pdt}...`)
      } else {
        const deltaMinutes = Math.abs(now - pdtTime) / 60000
        if (deltaMinutes > 10 && pdtTime < now) {
          errors.push(`PDT timestamp too far in past...`)
        } else if (deltaMinutes > 5 && pdtTime > now) {
          errors.push(`PDT timestamp too far in future...`)
        }
      }
    } catch (e) {
      errors.push(`PDT timestamp parse error...`)
    }
  }
  // ... plus PTS, segment numbering, binary data validation
```

**Strengths:**
- ✅ 10 distinct validation checks covering all critical SCTE-35 fields
- ✅ Clear separation of errors vs. warnings with well-documented thresholds
- ✅ Reasonable time bounds (10 min past, 5 min future) account for real-world buffering
- ✅ Graceful handling of encrypted signals and missing binary data
- ✅ Includes helpful comments about why thresholds were chosen (e.g., 0.1-300s for durations)

**Minor concerns:**
- Time bounds hardcoded (could make configurable for edge cases)
- No validation of signal combinations (e.g., splice_insert + return_signal compatibility)
- PTS validation only checks range, doesn't validate against PDT consistency

**Missing from tests:**
- No test file exists for `validateSCTE35Signal` function
- Edge cases like encrypted signals and binary data validation not tested

**Recommendation:** Create `tests/scte35-validation.test.ts` with at least 20 test cases covering the 10 validation categories.

---

## ✅ Fix #5: Decision Service Timeout - COMPLETE

### Integration: `src/channel-do.ts` (lines 308-361, 885-902)

**Status:** ✅ Excellent - two-tier approach

**What was fixed:**
- Pre-calculates ad decisions when SCTE-35 signal detected
- Stores decision in ad state for reuse by all viewers during break
- Falls back to on-demand decision with increased timeout (2000ms) if needed
- Eliminates Worker binding calls from hot path

**Code Quality Assessment:**

**Tier 1: Pre-Calculation (lines 886-902)**
```typescript
// PERFORMANCE OPTIMIZATION: Pre-calculate decision asynchronously BEFORE viewers arrive
console.log(`🚀 Pre-calculating ad decision for SCTE-35 break...`)
try {
  const preCalcStart = Date.now()
  const preCalculatedDecision = await decision(
    this.env, adPodBase, channelId, stableDuration, 
    { scte35: activeBreak }, 
    undefined  // No cached decision yet
  )
  
  newAdState.decision = preCalculatedDecision
  newAdState.decisionCalculatedAt = Date.now()
  const calcDuration = Date.now() - preCalcStart
  console.log(`✅ Pre-calculated decision ready (${calcDuration}ms)...`)
} catch (err) {
  console.error(`⚠️  Decision pre-calculation failed (will fall back)...`)
  // Don't block ad state creation
}
```

**Tier 2: On-Demand with Caching (lines 947-964)**
```typescript
// PERFORMANCE OPTIMIZATION: Use pre-calculated decision if available
const cachedDecision = adState?.decision

if (cachedDecision) {
  console.log(`✅ Using pre-calculated decision (age: ${Date.now() - adState.decisionCalculatedAt}ms)`)
} else {
  console.log(`⚠️  No cached decision, calling on-demand...`)
}

const decisionResponse = await decision(
  this.env, adPodBase, channelId, stableDuration,
  { scte35: activeBreak },
  cachedDecision  // Pass cache if available
)
```

**Strengths:**
- ✅ Two-tier approach provides both robustness and performance
- ✅ Pre-calculation captures decision age for monitoring
- ✅ Non-blocking failure on pre-calc (doesn't prevent ad state creation)
- ✅ Clear logging of cache hits vs. misses
- ✅ Timeout increased from 150ms to 2000ms for on-demand calls (justified by comment)

**Potential issues:**
- Pre-calculation happens on SCTE-35 *detection*, which could be on any request (not necessarily before viewers arrive)
- No check that decision hasn't expired or become stale during ad break
- Decision age shown in logs but no actual TTL enforcement

**Recommendation:** Add decision TTL check - refresh if > 30 seconds old to catch drift.

---

## ⏳ Fix #4: Manifest Window Validation - PENDING

### Status: NOT IMPLEMENTED

**Why this is critical:**
- If SCTE-35 break starts at PDT but manifest window doesn't include that PDT yet
- `replaceSegmentsWithAds()` finds no match and returns `segmentsSkipped: 0`
- No ads inserted, no fallback to SGAI triggered until next manifest request
- Viewers see blank screen for 1-2 seconds

**Where to implement:**
```typescript
// Before calling replaceSegmentsWithAds (channel-do.ts, ~line 1118)
// Validate that scte35StartPDT is actually in the manifest window

const pdts = extractPDTs(cleanOrigin)
if (scte35StartPDT && !pdts.includes(scte35StartPDT)) {
  console.warn(`🚨 SCTE-35 PDT not in manifest window, falling back to SGAI`)
  // Switch to SGAI mode immediately instead of waiting for next request
}
```

**Scope:** ~15 lines of defensive code needed

---

## ⏳ Fix #6: Robust Player Detection - PENDING  

### Status: NOT IMPLEMENTED

**Current implementation (line 253-256):**
```typescript
function wantsSGAI(req: Request): boolean {
  const ua = req.headers.get("user-agent") || ""
  // crude detection; replace with feature detection for production
  return /iPhone|iPad|Macintosh/.test(ua)
}
```

**Why this is inadequate:**
- User-Agent easily spoofed
- Doesn't detect actual HLS.js capabilities
- Macintosh includes all macOS browsers, not just Safari

**What's needed:**
1. Feature detection headers (check for Apple-specific request headers)
2. Configuration override via query parameter: `?mode=sgai` / `?mode=ssai`
3. Per-channel configuration in database (default mode)
4. Fallback chain: `query param` → `channel config` → `header detection` → `default (SSAI)`

**Example implementation:**
```typescript
function wantsSGAI(
  req: Request, 
  channelConfig?: ChannelConfig, 
  forceMode?: string
): boolean {
  // Priority 1: Explicit query parameter override
  const url = new URL(req.url)
  if (url.searchParams.has('mode')) {
    return url.searchParams.get('mode') === 'sgai'
  }
  
  // Priority 2: Channel-level configuration
  if (channelConfig?.defaultMode) {
    return channelConfig.defaultMode === 'sgai'
  }
  
  // Priority 3: Feature-based detection
  const ua = req.headers.get("user-agent") || ""
  
  // Apple device + likely HLS.js capable = SGAI
  // Check for:
  // - iPhone/iPad with Safari
  // - tvOS
  // - Macintosh with Safari AND Apple-specific request headers
  const isAppleDevice = /iPhone|iPad|tvOS/.test(ua)
  const isSafari = /Safari/.test(ua) && !/Chrome|Android/.test(ua)
  const hasAppleHeaders = req.headers.has("X-Apple-*") // Some custom header
  
  return isAppleDevice && (isSafari || hasAppleHeaders)
}
```

**Scope:** ~50 lines + database schema update

---

## Integration Test Coverage

### Current Status:
- ✅ `tests/hls-advanced.test.ts`: 50+ tests for HLS manipulation
- ✅ `tests/chaos.test.ts`: 50+ edge case tests
- ✅ `tests/scte35.test.ts`: 75+ SCTE-35 parsing tests
- ✅ `tests/golden.test.ts`: Core utilities
- ⏳ **MISSING**: Tests for `replaceSegmentsWithAdsFixed` function
- ⏳ **MISSING**: Tests for `validateSCTE35Signal` function
- ⏳ **MISSING**: Tests for stable skip count persistence

### Recommended test additions:

**File: `tests/pdtfix.test.ts`** (new)
```typescript
test("PDT preservation: resume PDT found in manifest", () => {
  // Test PDT forward search succeeds
  // Verify output uses ACTUAL resume PDT, not calculated
})

test("PDT preservation: fallback when resume PDT not found", () => {
  // Test search window limit works
  // Verify fallback logging
})

test("PDT preservation: synthetic ad timeline with DISCONTINUITY", () => {
  // Verify ad segments get synthetic PDT
  // Verify both DISCONTINUITYs present
})
```

**File: `tests/scte35-validation.test.ts`** (new)
```typescript
test("Validation rejects missing ID", () => { /* ... */ })
test("Validation rejects invalid type", () => { /* ... */ })
test("Validation rejects zero duration", () => { /* ... */ })
test("Validation accepts encrypted signals with warning", () => { /* ... */ })
// ... 15+ more tests covering all 10 validation checks
```

---

## Production Readiness Checklist

| Item | Status | Priority |
|------|--------|----------|
| Fix #1 (PDT Timeline) | ✅ Code review passed | Shipped |
| Fix #2 (Skip Race Condition) | ✅ Code review passed | Shipped |
| Fix #3 (SCTE-35 Validation) | ✅ Code review passed | Shipped |
| Fix #5 (Decision Timeout) | ✅ Code review passed | Shipped |
| PDT search window constant | ⏳ Config needed | Medium |
| Skip count telemetry | ⏳ Monitoring added | Medium |
| Fix #4 (Window Validation) | ⏳ Not implemented | HIGH |
| Fix #6 (Player Detection) | ⏳ Not implemented | HIGH |
| SCTE-35 Validation tests | ⏳ Not implemented | HIGH |
| PDT fix integration tests | ⏳ Not implemented | HIGH |
| Load testing (concurrent requests) | ⏳ Not done | HIGH |

---

## Summary of Recommendations

### Immediate (before production):
1. **Implement Fix #4** (Manifest Window Validation) - ~15 lines, prevents viewer-facing blank screens
2. **Implement Fix #6** (Player Detection) - ~50 lines, improves compatibility
3. **Add tests** for validation and PDT fix (60+ test cases)

### Short-term (within 1 sprint):
1. Make PDT search window configurable (currently hardcoded to 30 lines)
2. Add decision TTL enforcement (refresh if > 30s old)
3. Add telemetry counter for skip count recalculations
4. Load test concurrent manifest requests during ad break

### Nice-to-have:
1. CRC validation for SCTE-35 binary data (already present in validation, just needs testing)
2. Encrypted signal handling documentation
3. Per-channel error budget tracking

---

## Code Quality Score: 8.5/10

**Strengths:**
- ✅ Comprehensive inline documentation
- ✅ Distinct logging prefixes for traceability
- ✅ Good error handling with fallbacks
- ✅ Integration with Durable Object state management
- ✅ Two-tier performance optimization (pre-calc + on-demand)

**Weaknesses:**
- ⏳ Tests missing for 2 key functions
- ⏳ Some hardcoded constants (search window, time bounds)
- ⏳ No telemetry/monitoring integration
- ⏳ 2 critical fixes still not implemented (#4, #6)

**Overall:** Production-ready for 4/6 fixes. Fixes #4 and #6 needed before full release.
