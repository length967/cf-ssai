// SCTE-35 Parser Tests
import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import { 
  parseSCTE35FromManifest,
  isAdBreakStart,
  isAdBreakEnd,
  getBreakDuration,
  findActiveBreak,
  isInAdBreak
} from "../src/utils/scte35"

describe("SCTE-35 Parser", () => {
  test("Parse SCTE-35 from DATERANGE tag (break start)", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-DATERANGE:ID="splice-1",CLASS="com.apple.hls.scte35.out",START-DATE="2025-10-31T10:00:00Z",DURATION=30.0,SCTE35-OUT=YES
#EXTINF:4.0,
seg_1.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1, "Should parse one signal")
    assert.equal(signals[0].id, "splice-1")
    assert.equal(signals[0].type, "splice_insert")
    assert.equal(signals[0].duration, 30.0)
  })

  test("Parse SCTE-35 from DATERANGE tag (break end)", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="splice-2",CLASS="com.apple.hls.scte35.in",START-DATE="2025-10-31T10:00:30Z",SCTE35-IN=YES
#EXTINF:4.0,
seg_2.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].type, "return_signal")
  })

  test("Parse SCTE-35 with segmentation type", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-SEGMENTATION-TYPE="provider_ad",X-BREAK-DURATION=30.0
#EXTINF:4.0,
seg_1.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentationType, "Provider Ad")
    assert.equal(signals[0].breakDuration, 30.0)
  })

  test("Parse SCTE-35 with UPID", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-2",START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-UPID="ABC123",SCTE35-OUT=YES
#EXTINF:4.0,
seg_1.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].upid, "ABC123")
  })

  test("Detect ad break start", () => {
    const signal = {
      id: "ad-1",
      type: "splice_insert" as const,
      duration: 30,
      segmentationType: "Provider Ad" as const
    }
    
    assert.equal(isAdBreakStart(signal), true)
  })

  test("Detect ad break end", () => {
    const signal = {
      id: "ad-2",
      type: "return_signal" as const,
      segmentationType: "Break End" as const
    }
    
    assert.equal(isAdBreakEnd(signal), true)
  })

  test("Get break duration", () => {
    const signal1 = {
      id: "ad-1",
      type: "splice_insert" as const,
      breakDuration: 45
    }
    
    const signal2 = {
      id: "ad-2",
      type: "splice_insert" as const,
      duration: 60
    }
    
    const signal3 = {
      id: "ad-3",
      type: "splice_insert" as const
    }
    
    assert.equal(getBreakDuration(signal1), 45)
    assert.equal(getBreakDuration(signal2), 60)
    assert.equal(getBreakDuration(signal3), 30) // Default
  })

  test("Find active break in signals list", () => {
    const signals = [
      {
        id: "old-1",
        type: "splice_insert" as const,
        duration: 30
      },
      {
        id: "active-1",
        type: "splice_insert" as const,
        duration: 30
      }
    ]
    
    const activeBreak = findActiveBreak(signals)
    assert.ok(activeBreak)
    assert.equal(activeBreak.id, "active-1")
  })

  test("Determine if in ad break", () => {
    const signals1 = [
      {
        id: "ad-1",
        type: "splice_insert" as const,
        duration: 30
      }
    ]
    
    const signals2 = [
      {
        id: "ad-1",
        type: "splice_insert" as const,
        duration: 30
      },
      {
        id: "ad-2",
        type: "return_signal" as const
      }
    ]
    
    assert.equal(isInAdBreak(signals1), true)
    assert.equal(isInAdBreak(signals2), false)
  })

  test("Parse multiple SCTE-35 signals", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s
#EXT-X-DATERANGE:ID="ad-2",SCTE35-OUT=YES,START-DATE="2025-10-31T10:01:00Z",DURATION=15
#EXTINF:4.0,
seg_2.m4s
#EXT-X-DATERANGE:ID="return-1",SCTE35-IN=YES,START-DATE="2025-10-31T10:01:15Z"
#EXTINF:4.0,
seg_3.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 3)
    assert.equal(signals[0].id, "ad-1")
    assert.equal(signals[1].id, "ad-2")
    assert.equal(signals[2].id, "return-1")
    assert.equal(signals[2].type, "return_signal")
  })

  test("Handle manifest with no SCTE-35 signals", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:7
#EXTINF:4.0,
seg_1.m4s
#EXTINF:4.0,
seg_2.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 0)
  })

  test("Parse SCTE-35 with segment numbering", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-pod-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-SEGMENT-NUM=1,X-SEGMENTS-EXPECTED=3
#EXTINF:4.0,
seg_1.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentNum, 1)
    assert.equal(signals[0].segmentsExpected, 3)
  })

  test("Parse SCTE-35 with auto-return flag", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-AUTO-RETURN=YES
#EXTINF:4.0,
seg_1.m4s
`
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].autoReturn, true)
  })
})

