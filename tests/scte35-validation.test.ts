import { describe, test } from "node:test"
import * as assert from "node:assert"
import { validateSCTE35Signal } from "../src/utils/scte35"
import type { SCTE35Signal } from "../src/types"

// Helper to create valid base signal
function validSignal(): SCTE35Signal {
  return {
    id: "test-signal-1",
    type: "splice_insert",
    breakDuration: 30,
    pts: 123456789,
  }
}

// ============================================================================
// CATEGORY 1: ID VALIDATION
// ============================================================================

describe("SCTE-35 Validation: ID Field", () => {
  test("Rejects missing ID", () => {
    const signal: any = validSignal()
    delete signal.id

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("ID")),
      "Should report ID error"
    )
  })

  test("Rejects null ID", () => {
    const signal: any = validSignal()
    signal.id = null

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
  })

  test("Rejects empty string ID", () => {
    const signal: any = validSignal()
    signal.id = ""

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
  })

  test("Rejects whitespace-only ID", () => {
    const signal: any = validSignal()
    signal.id = "   "

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
  })

  test("Accepts valid ID", () => {
    const signal = validSignal()

    const result = validateSCTE35Signal(signal)
    assert.ok(result.valid || !result.errors.some((e) => e.includes("ID")))
  })
})

// ============================================================================
// CATEGORY 2: TYPE VALIDATION
// ============================================================================

describe("SCTE-35 Validation: Signal Type", () => {
  test("Rejects invalid signal type", () => {
    const signal: any = validSignal()
    signal.type = "invalid_type"

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("type")),
      "Should report type error"
    )
  })

  test("Rejects missing type", () => {
    const signal: any = validSignal()
    delete signal.type

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
  })

  test("Accepts splice_insert type", () => {
    const signal = validSignal()
    signal.type = "splice_insert"

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("type")))
  })

  test("Accepts time_signal type", () => {
    const signal: any = validSignal()
    signal.type = "time_signal"
    signal.breakDuration = 30

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("type")))
  })

  test("Accepts return_signal type", () => {
    const signal: any = validSignal()
    signal.type = "return_signal"

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("type")))
  })
})

// ============================================================================
// CATEGORY 3: DURATION VALIDATION (Ad Break Starts)
// ============================================================================

describe("SCTE-35 Validation: Ad Break Duration", () => {
  test("Rejects missing duration for splice_insert", () => {
    const signal: any = validSignal()
    delete signal.breakDuration
    delete signal.duration

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("duration")),
      "Should report duration error"
    )
  })

  test("Rejects zero duration", () => {
    const signal: any = validSignal()
    signal.breakDuration = 0

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("duration")),
      "Should reject zero duration"
    )
  })

  test("Rejects negative duration", () => {
    const signal: any = validSignal()
    signal.breakDuration = -30

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("duration")))
  })

  test("Rejects duration < 0.1 seconds (unrealistic)", () => {
    const signal: any = validSignal()
    signal.breakDuration = 0.05

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("duration")))
  })

  test("Rejects duration > 300 seconds (unrealistic)", () => {
    const signal: any = validSignal()
    signal.breakDuration = 301

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("duration")))
  })

  test("Accepts valid duration 30 seconds", () => {
    const signal = validSignal()
    signal.breakDuration = 30

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("duration")))
  })

  test("Warns on very short duration (< 5 seconds)", () => {
    const signal: any = validSignal()
    signal.breakDuration = 2

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("short")),
      "Should warn about short duration"
    )
  })

  test("Warns on very long duration (> 180 seconds)", () => {
    const signal: any = validSignal()
    signal.breakDuration = 240

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("long")),
      "Should warn about long duration"
    )
  })

  test("Accepts fallback duration field when breakDuration missing", () => {
    const signal: any = validSignal()
    delete signal.breakDuration
    signal.duration = 30
    signal.type = "time_signal"

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("duration")))
  })
})

// ============================================================================
// CATEGORY 4: PDT TEMPORAL VALIDATION
// ============================================================================

describe("SCTE-35 Validation: PDT Timestamp", () => {
  test("Rejects invalid PDT format", () => {
    const signal = validSignal()
    const invalidPDT = "not-a-date"

    const result = validateSCTE35Signal(signal, invalidPDT)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("PDT")),
      "Should report PDT error"
    )
  })

  test("Accepts valid ISO 8601 PDT", () => {
    const signal = validSignal()
    const validPDT = new Date().toISOString()

    const result = validateSCTE35Signal(signal, validPDT)
    assert.ok(!result.errors.some((e) => e.includes("PDT")))
  })

  test("Rejects PDT > 10 minutes in past", () => {
    const signal = validSignal()
    const oldPDT = new Date(Date.now() - 11 * 60 * 1000).toISOString()

    const result = validateSCTE35Signal(signal, oldPDT)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("too far in past")),
      "Should reject old PDT"
    )
  })

  test("Rejects PDT > 5 minutes in future", () => {
    const signal = validSignal()
    const futurePDT = new Date(Date.now() + 6 * 60 * 1000).toISOString()

    const result = validateSCTE35Signal(signal, futurePDT)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("too far in future")),
      "Should reject future PDT"
    )
  })

  test("Warns on PDT 2-10 minutes in past (stale)", () => {
    const signal = validSignal()
    const stalePDT = new Date(Date.now() - 3 * 60 * 1000).toISOString()

    const result = validateSCTE35Signal(signal, stalePDT)

    assert.ok(
      result.warnings.some((w) => w.includes("stale")),
      "Should warn about stale signal"
    )
  })

  test("Handles PDT with microseconds", () => {
    const signal = validSignal()
    const pdtWithMicros = "2025-11-04T02:00:00.123456Z"

    const result = validateSCTE35Signal(signal, pdtWithMicros)
    assert.ok(!result.errors.some((e) => e.includes("PDT")))
  })

  test("Handles PDT with timezone offset", () => {
    const signal = validSignal()
    const pdtWithOffset = "2025-11-04T02:00:00+05:00"

    const result = validateSCTE35Signal(signal, pdtWithOffset)
    assert.ok(!result.errors.some((e) => e.includes("PDT")))
  })
})

// ============================================================================
// CATEGORY 5: PTS VALIDATION
// ============================================================================

describe("SCTE-35 Validation: PTS Field", () => {
  test("Rejects negative PTS", () => {
    const signal: any = validSignal()
    signal.pts = -1000

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("PTS")),
      "Should report PTS error"
    )
  })

  test("Rejects non-integer PTS", () => {
    const signal: any = validSignal()
    signal.pts = 123.456

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("PTS")))
  })

  test("Rejects PTS > 2^32 (wrap-around warning)", () => {
    const signal: any = validSignal()
    signal.pts = 4294967296 // 2^32

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("PTS")),
      "Should warn about large PTS"
    )
  })

  test("Accepts valid PTS", () => {
    const signal = validSignal()
    signal.pts = 123456789

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("PTS")))
  })

  test("Allows missing PTS (optional field)", () => {
    const signal: any = validSignal()
    delete signal.pts

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.errors.some((e) => e.includes("PTS")))
  })
})

// ============================================================================
// CATEGORY 6: SEGMENT NUMBERING VALIDATION
// ============================================================================

describe("SCTE-35 Validation: Multi-Segment Numbering", () => {
  test("Warns when segmentNum specified without segmentsExpected", () => {
    const signal: any = validSignal()
    signal.segmentNum = 1

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("segmentsExpected")),
      "Should warn about missing expected count"
    )
  })

  test("Warns when segmentsExpected specified without segmentNum", () => {
    const signal: any = validSignal()
    signal.segmentsExpected = 3

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("segmentNum")),
      "Should warn about missing number"
    )
  })

  test("Rejects segmentNum >= segmentsExpected", () => {
    const signal: any = validSignal()
    signal.segmentNum = 3
    signal.segmentsExpected = 3

    const result = validateSCTE35Signal(signal)

    assert.strictEqual(result.valid, false)
    assert.ok(
      result.errors.some((e) => e.includes("segment number")),
      "Should reject invalid numbering"
    )
  })

  test("Rejects negative segment numbering", () => {
    const signal: any = validSignal()
    signal.segmentNum = -1
    signal.segmentsExpected = 3

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
  })

  test("Accepts valid segment numbering", () => {
    const signal: any = validSignal()
    signal.segmentNum = 1
    signal.segmentsExpected = 3

    const result = validateSCTE35Signal(signal)
    assert.ok(
      !result.errors.some((e) => e.includes("segment")),
      "Should accept valid numbering"
    )
  })
})

// ============================================================================
// CATEGORY 7: AUTO-RETURN VALIDATION
// ============================================================================

describe("SCTE-35 Validation: Auto-Return", () => {
  test("Warns on splice_insert without auto-return", () => {
    const signal: any = validSignal()
    signal.type = "splice_insert"
    signal.autoReturn = false

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("auto-return")),
      "Should warn about missing auto-return"
    )
  })

  test("Accepts splice_insert with auto-return", () => {
    const signal: any = validSignal()
    signal.type = "splice_insert"
    signal.autoReturn = true

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.warnings.some((w) => w.includes("auto-return")))
  })
})

// ============================================================================
// CATEGORY 8: UPID VALIDATION
// ============================================================================

describe("SCTE-35 Validation: UPID Field", () => {
  test("Warns on empty UPID string", () => {
    const signal: any = validSignal()
    signal.upid = ""

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("UPID")),
      "Should warn about empty UPID"
    )
  })

  test("Warns on very long UPID (> 256 chars)", () => {
    const signal: any = validSignal()
    signal.upid = "x".repeat(257)

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("UPID")),
      "Should warn about long UPID"
    )
  })

  test("Accepts valid UPID", () => {
    const signal: any = validSignal()
    signal.upid = "content-id-12345"

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.warnings.some((w) => w.includes("long UPID")))
  })

  test("Allows missing UPID (optional field)", () => {
    const signal = validSignal()

    const result = validateSCTE35Signal(signal)
    assert.ok(!result.warnings.some((w) => w.includes("UPID")))
  })
})

// ============================================================================
// CATEGORY 9: BINARY DATA VALIDATION
// ============================================================================

describe("SCTE-35 Validation: Binary Data", () => {
  test("Warns when binary CRC validation fails", () => {
    const signal: any = validSignal()
    signal.binaryData = {
      spliceEventId: 12345,
      crcValid: false,
      encrypted: false,
    }

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("CRC")),
      "Should warn about CRC failure"
    )
  })

  test("Warns when binary data is encrypted", () => {
    const signal: any = validSignal()
    signal.binaryData = {
      spliceEventId: 12345,
      crcValid: true,
      encrypted: true,
    }

    const result = validateSCTE35Signal(signal)

    assert.ok(
      result.warnings.some((w) => w.includes("encrypted")),
      "Should warn about encrypted data"
    )
  })

  test("Accepts valid binary data", () => {
    const signal: any = validSignal()
    signal.binaryData = {
      spliceEventId: 12345,
      crcValid: true,
      encrypted: false,
    }

    const result = validateSCTE35Signal(signal)
    assert.ok(
      !result.errors.some((e) => e.includes("binary")),
      "Should accept valid binary data"
    )
  })
})

// ============================================================================
// CATEGORY 10: SEGMENTATION TYPE VALIDATION
// ============================================================================

describe("SCTE-35 Validation: Segmentation Type", () => {
  test("Accepts Provider Ad segmentation", () => {
    const signal: any = validSignal()
    signal.segmentationType = "Provider Ad"

    const result = validateSCTE35Signal(signal)
    assert.ok(result.valid || !result.errors.length)
  })

  test("Accepts Distributor Ad segmentation", () => {
    const signal: any = validSignal()
    signal.segmentationType = "Distributor Ad"

    const result = validateSCTE35Signal(signal)
    assert.ok(result.valid || !result.errors.length)
  })

  test("Accepts Break Start segmentation", () => {
    const signal: any = validSignal()
    signal.type = "time_signal"
    signal.segmentationType = "Break Start"

    const result = validateSCTE35Signal(signal)
    assert.ok(result.valid || !result.errors.some((e) => e.includes("segmentation")))
  })
})

// ============================================================================
// INTEGRATION TESTS: Complex scenarios
// ============================================================================

describe("SCTE-35 Validation: Integration Tests", () => {
  test("Accepts fully valid ad break signal", () => {
    const signal: any = {
      id: "splice-1234",
      type: "splice_insert",
      breakDuration: 60,
      pts: 987654321,
      upid: "content-identifier",
      autoReturn: true,
      segmentationType: "Provider Ad",
      segmentNum: 0,
      segmentsExpected: 1,
    }

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, true, "Should be valid")
    assert.strictEqual(result.errors.length, 0, "Should have no errors")
  })

  test("Validates complex signal with multiple warnings", () => {
    const signal: any = {
      id: "test",
      type: "splice_insert",
      breakDuration: 2, // Too short - warning
      pts: 4294967300, // Too large - warning
      autoReturn: false, // No auto return - warning
    }

    const result = validateSCTE35Signal(signal)
    assert.ok(result.warnings.length >= 2, "Should have multiple warnings")
  })

  test("Properly combines errors and warnings", () => {
    const signal: any = {
      // Missing ID - error
      type: "invalid_type", // Invalid type - error
      breakDuration: 500, // Too long - error (not warning)
      pts: -100, // Negative - error
    }

    const result = validateSCTE35Signal(signal)
    assert.strictEqual(result.valid, false)
    assert.ok(result.errors.length > 0, "Should have errors")
  })

  test("Handles edge case: exactly at duration boundaries", () => {
    const signal: any = validSignal()
    signal.breakDuration = 0.1 // Exactly at minimum

    const result = validateSCTE35Signal(signal)
    // Should be valid (not warning, not error)
    assert.ok(
      result.valid || !result.errors.some((e) => e.includes("duration")),
      "Should accept boundary duration"
    )
  })

  test("Handles edge case: 300 second boundary", () => {
    const signal: any = validSignal()
    signal.breakDuration = 300 // Exactly at maximum

    const result = validateSCTE35Signal(signal)
    assert.ok(
      result.valid || !result.errors.some((e) => e.includes("duration")),
      "Should accept boundary duration"
    )
  })
})
