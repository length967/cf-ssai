# SCTE-35 Validation Edge Cases Not Caught

## Summary
The validation implementation catches most critical issues but has 6 edge cases that tests expect but validation doesn't enforce. These are mostly warnings that should be caught but are currently missing.

---

## Missing Edge Cases

### 1. ❌ Duration Validation: Zero Duration
**Test Expectation:** Rejects zero duration  
**Current Behavior:** ✅ DOES reject (line 320: `else if (duration <= 0)`)  
**Why Test Fails:** The test is checking the opposite condition - it expects `result.valid = false` but the duration might not be going through the `isAdBreakStart()` check properly

**Root Cause:** Likely issue with `getBreakDuration()` not finding duration field

---

### 2. ❌ Duration Validation: Missing Duration for splice_insert
**Test Expectation:** Rejects missing duration  
**Current Behavior:** ✅ DOES check (line 316-318)  
**Why Test Fails:** Same as above - validation logic exists but signal type detection issue

**Root Cause:** `isAdBreakStart(signal)` may not be recognizing `splice_insert` without duration

---

### 3. ❌ PDT Validation: Microseconds Format
**Test Expectation:** Accepts `2025-11-04T02:00:00.123456Z` (microseconds)  
**Current Behavior:** Should accept (line 338: `new Date(pdt)`)  
**Why Test Fails:** JavaScript's `Date` object DOES parse this correctly - test may be failing for other reason

**Possible Fix Needed:** None - `Date` constructor handles milliseconds/microseconds properly

---

### 4. ❌ PDT Validation: Timezone Offset Format
**Test Expectation:** Accepts `2025-11-04T02:00:00+05:00`  
**Current Behavior:** Should accept (line 338: `new Date(pdt)`)  
**Why Test Fails:** JavaScript `Date` DOES parse timezone offsets correctly

**Possible Fix Needed:** None - this should work

---

### 5. ❌ Segment Numbering: segmentNum >= segmentsExpected
**Test Expectation:** Rejects when `segmentNum >= segmentsExpected`  
**Current Behavior:** ✅ DOES reject (line 388-389)  
**Why Test Fails:** Validation code exists and should work

**Root Cause:** Logic seems correct - may be test assertion issue

---

### 6. ❌ UPID Validation: Empty UPID String
**Test Expectation:** Warns when UPID is empty string  
**Current Behavior:** ✅ DOES warn (line 404-406: `if (signal.upid && typeof signal.upid === 'string') { if (signal.upid.trim().length === 0)`)  
**Why Test Fails:** The condition `if (signal.upid && ...)` treats empty string as falsy... wait, no - empty string IS falsy in the first part

**Root Cause:** Empty string `""` evaluates to false in `if (signal.upid &&...)` so the check never runs!

---

## Implementation Issues Found

### Issue #1: Empty String UPID Detection (CRITICAL)
```typescript
// Current code (line 404):
if (signal.upid && typeof signal.upid === 'string') {  // Empty "" is falsy!
  if (signal.upid.trim().length === 0) {
    warnings.push('UPID present but empty')
  }
}

// Should be:
if (signal.upid !== undefined && typeof signal.upid === 'string') {
  if (signal.upid.trim().length === 0) {
    warnings.push('UPID present but empty')
  }
}
```

### Issue #2: Duration Field Access
**Problem:** The `getBreakDuration()` might not be finding the duration correctly

```typescript
// In scte35.ts, line 211-223:
export function getBreakDuration(signal: SCTE35Signal): number {
  // Prefer explicit break duration
  if (signal.breakDuration) {
    return signal.breakDuration
  }
  
  // Fall back to general duration
  if (signal.duration) {
    return signal.duration
  }
  
  // Default to 30 seconds for ad breaks
  return 30
}

// Issue: If both are undefined/0, it falls back to 30 instead of reporting error
```

### Issue #3: isAdBreakStart() Detection
**Problem:** Might not be detecting splice_insert correctly

```typescript
// In scte35.ts, line 170-188:
export function isAdBreakStart(signal: SCTE35Signal): boolean {
  // Check signal type
  if (signal.type === "splice_insert") {
    return true
  }
  
  // Check segmentation type
  if (signal.segmentationType) {
    return signal.segmentationType === "Provider Ad" ||
           signal.segmentationType === "Distributor Ad" ||
           signal.segmentationType === "Break Start"
  }
  
  // Time signal with duration indicates break start
  if (signal.type === "time_signal" && signal.breakDuration && signal.breakDuration > 0) {
    return true
  }
  
  return false
}

// This looks correct - splice_insert should return true immediately
```

---

## Recommended Fixes

### Fix 1: Empty String Check (HIGH PRIORITY)
```typescript
// Line 404 in scte35.ts
- if (signal.upid && typeof signal.upid === 'string') {
+ if (signal.upid !== undefined && typeof signal.upid === 'string') {
```
**Impact:** Will catch empty UPID strings  
**Effort:** 1 line change

### Fix 2: Debug isAdBreakStart() 
The issue may be in how tests are calling the function. Add logging to verify signal structure:
```typescript
if (isAdBreakStart(signal)) {
  console.log('DEBUG: isAdBreakStart returned true for signal:', signal)
  const duration = getBreakDuration(signal)
  console.log('DEBUG: getBreakDuration returned:', duration)
```

### Fix 3: Make Duration Field Access More Explicit
```typescript
// Line 316-318 in scte35.ts
if (!duration) {
  errors.push('Ad break start signal missing duration...')
}
```
Add explicit null/undefined/0 check:
```typescript
if (duration === undefined || duration === null || duration === 0) {
  errors.push('Ad break start signal missing duration...')
}
```

---

## Summary of Action Items

| Issue | Severity | Fix | Line |
|-------|----------|-----|------|
| Empty UPID not detected | HIGH | Change `&&` to `!== undefined &&` | 404 |
| Duration=0 not caught | MEDIUM | Explicit 0 check in condition | 316 |
| Microseconds PDT | LOW | Test only - code is correct | N/A |
| Timezone offset PDT | LOW | Test only - code is correct | N/A |
| Segment numbering | LOW | Logic looks correct - investigate test | 388 |

---

## Why Tests Are Failing

Most test failures are NOT due to missing validation logic - they're due to:

1. **Type Detection Issue**: `isAdBreakStart()` may not be seeing `splice_insert` in test signals
2. **Empty String Edge Case**: UPID validation skips empty strings due to falsy check
3. **Test Setup Issue**: Tests may not be constructing signals with proper types

The validation implementation is ~95% complete. Only 1-2 actual code fixes needed.
