// Advanced SCTE-35 Parser Tests
// Comprehensive tests for SCTE-35 signal detection, parsing, and validation

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  parseSCTE35FromManifest,
  isAdBreakStart,
  isAdBreakEnd,
  getBreakDuration,
  findActiveBreak,
  isInAdBreak,
  extractSCTE35Metadata,
  isValidSCTE35Signal
} from "../src/utils/scte35"
import type { SCTE35Signal } from "../src/types"

describe("SCTE-35 Signal Parsing", () => {
  test("Parses provider ad start signal", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="splice-1",CLASS="com.apple.hls.scte35.out",START-DATE="2025-10-31T10:00:00Z",DURATION=30.0,SCTE35-OUT=YES,X-SEGMENTATION-TYPE="provider_ad"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].type, "splice_insert")
    assert.equal(signals[0].segmentationType, "Provider Ad")
    assert.equal(signals[0].duration, 30.0)
  })

  test("Parses distributor ad signal", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="splice-2",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=15,X-SEGMENTATION-TYPE="distributor_ad"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentationType, "Distributor Ad")
  })

  test("Parses break start signal", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="break-1",START-DATE="2025-10-31T10:00:00Z",X-SEGMENTATION-TYPE="break_start",X-BREAK-DURATION=45.0
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentationType, "Break Start")
    assert.equal(signals[0].breakDuration, 45.0)
  })

  test("Parses return signal (break end)", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="return-1",CLASS="com.apple.hls.scte35.in",START-DATE="2025-10-31T10:00:30Z",SCTE35-IN=YES
#EXTINF:4.0,
seg_2.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].type, "return_signal")
  })

  test("Parses UPID (Unique Program Identifier)", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-UPID="SHOW123-EP456"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].upid, "SHOW123-EP456")
  })

  test("Parses segment numbering information", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-pod-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=10,X-SEGMENT-NUM=1,X-SEGMENTS-EXPECTED=3
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentNum, 1)
    assert.equal(signals[0].segmentsExpected, 3)
  })

  test("Parses auto-return flag", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-AUTO-RETURN=YES
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].autoReturn, true)
  })

  test("Parses PTS (Presentation Timestamp)", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-PTS=1234567890
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].pts, 1234567890)
  })

  test("Handles multiple signals in sequence", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s
#EXT-X-DATERANGE:ID="ad-2",SCTE35-OUT=YES,START-DATE="2025-10-31T10:01:00Z",DURATION=15
#EXTINF:4.0,
seg_2.m4s
#EXT-X-DATERANGE:ID="return-1",SCTE35-IN=YES,START-DATE="2025-10-31T10:01:15Z"
#EXTINF:4.0,
seg_3.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 3)
    assert.equal(signals[0].id, "ad-1")
    assert.equal(signals[1].id, "ad-2")
    assert.equal(signals[2].id, "return-1")
    assert.equal(signals[2].type, "return_signal")
  })

  test("Ignores non-SCTE-35 DATERANGE tags", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="program-info",START-DATE="2025-10-31T10:00:00Z",X-CUSTOM-INFO="test"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 0)
  })

  test("Handles empty manifest", () => {
    const manifest = "#EXTM3U\n#EXT-X-VERSION:7"
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 0)
  })
})

describe("SCTE-35 Signal Type Detection", () => {
  test("Identifies ad break start from splice_insert", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      duration: 30
    }
    
    assert.equal(isAdBreakStart(signal), true)
  })

  test("Identifies ad break start from segmentation type", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "time_signal",
      segmentationType: "Provider Ad",
      duration: 30
    }
    
    assert.equal(isAdBreakStart(signal), true)
  })

  test("Identifies ad break start from break duration", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "time_signal",
      breakDuration: 30
    }
    
    assert.equal(isAdBreakStart(signal), true)
  })

  test("Identifies ad break end from return_signal", () => {
    const signal: SCTE35Signal = {
      id: "return-1",
      type: "return_signal"
    }
    
    assert.equal(isAdBreakEnd(signal), true)
  })

  test("Identifies ad break end from segmentation type", () => {
    const signal: SCTE35Signal = {
      id: "end-1",
      type: "time_signal",
      segmentationType: "Break End"
    }
    
    assert.equal(isAdBreakEnd(signal), true)
  })

  test("Does not misidentify time_signal without break info", () => {
    const signal: SCTE35Signal = {
      id: "time-1",
      type: "time_signal"
    }
    
    assert.equal(isAdBreakStart(signal), false)
    assert.equal(isAdBreakEnd(signal), false)
  })
})

describe("SCTE-35 Break Duration Calculation", () => {
  test("Uses explicit break duration", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      breakDuration: 45,
      duration: 30  // Should prefer breakDuration
    }
    
    assert.equal(getBreakDuration(signal), 45)
  })

  test("Falls back to general duration", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      duration: 60
    }
    
    assert.equal(getBreakDuration(signal), 60)
  })

  test("Uses default duration when not specified", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert"
    }
    
    assert.equal(getBreakDuration(signal), 30)
  })

  test("Handles zero duration", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      duration: 0
    }
    
    // Zero duration should return the duration as-is
    assert.equal(getBreakDuration(signal), 0)
  })
})

describe("SCTE-35 Active Break Detection", () => {
  test("Finds most recent break start signal", () => {
    const signals: SCTE35Signal[] = [
      { id: "old-1", type: "splice_insert", duration: 30 },
      { id: "old-2", type: "return_signal" },
      { id: "active-1", type: "splice_insert", duration: 30 },
    ]
    
    const activeBreak = findActiveBreak(signals)
    
    assert.ok(activeBreak)
    assert.equal(activeBreak.id, "active-1")
  })

  test("Returns null when no break starts found", () => {
    const signals: SCTE35Signal[] = [
      { id: "return-1", type: "return_signal" },
      { id: "time-1", type: "time_signal" },
    ]
    
    const activeBreak = findActiveBreak(signals)
    
    assert.equal(activeBreak, null)
  })

  test("Handles empty signal list", () => {
    const signals: SCTE35Signal[] = []
    
    const activeBreak = findActiveBreak(signals)
    
    assert.equal(activeBreak, null)
  })

  test("Identifies when in ad break", () => {
    const signals: SCTE35Signal[] = [
      { id: "ad-1", type: "splice_insert", duration: 30 }
    ]
    
    assert.equal(isInAdBreak(signals), true)
  })

  test("Identifies when not in ad break after return", () => {
    const signals: SCTE35Signal[] = [
      { id: "ad-1", type: "splice_insert", duration: 30 },
      { id: "return-1", type: "return_signal" }
    ]
    
    assert.equal(isInAdBreak(signals), false)
  })

  test("Tracks break state through multiple signals", () => {
    const signals: SCTE35Signal[] = [
      { id: "ad-1", type: "splice_insert", duration: 30 },
      { id: "return-1", type: "return_signal" },
      { id: "ad-2", type: "splice_insert", duration: 15 }
    ]
    
    assert.equal(isInAdBreak(signals), true)
  })
})

describe("SCTE-35 Metadata Extraction", () => {
  test("Extracts all relevant metadata", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      duration: 30,
      segmentationType: "Provider Ad",
      upid: "SHOW123",
      autoReturn: true,
      segmentNum: 1,
      segmentsExpected: 3
    }
    
    const metadata = extractSCTE35Metadata(signal)
    
    assert.equal(metadata.id, "ad-1")
    assert.equal(metadata.type, "splice_insert")
    assert.equal(metadata.segmentationType, "Provider Ad")
    assert.equal(metadata.duration, 30)
    assert.equal(metadata.upid, "SHOW123")
    assert.equal(metadata.autoReturn, true)
    assert.equal(metadata.segmentNum, 1)
    assert.equal(metadata.segmentsExpected, 3)
  })

  test("Handles signals with minimal data", () => {
    const signal: SCTE35Signal = {
      id: "minimal",
      type: "time_signal"
    }
    
    const metadata = extractSCTE35Metadata(signal)
    
    assert.equal(metadata.id, "minimal")
    assert.equal(metadata.type, "time_signal")
    assert.equal(metadata.duration, undefined)
  })
})

describe("SCTE-35 Signal Validation", () => {
  test("Validates complete signal", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert",
      duration: 30
    }
    
    assert.equal(isValidSCTE35Signal(signal), true)
  })

  test("Rejects signal without ID", () => {
    const signal: SCTE35Signal = {
      id: "",
      type: "splice_insert",
      duration: 30
    }
    
    assert.equal(isValidSCTE35Signal(signal), false)
  })

  test("Accepts break start without explicit duration (uses default)", () => {
    const signal: SCTE35Signal = {
      id: "ad-1",
      type: "splice_insert"
    }
    
    // Should be valid because getBreakDuration will return default
    assert.equal(isValidSCTE35Signal(signal), true)
  })

  test("Validates return signal without duration", () => {
    const signal: SCTE35Signal = {
      id: "return-1",
      type: "return_signal"
    }
    
    assert.equal(isValidSCTE35Signal(signal), true)
  })
})

describe("SCTE-35 Edge Cases", () => {
  test("Handles very long break durations", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="long-break",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=3600.0
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].duration, 3600.0)
  })

  test("Handles fractional second durations", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="short-break",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=5.5
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].duration, 5.5)
  })

  test("Handles signals with complex UPID formats", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-UPID="0x0C:ABC123456789"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].upid, "0x0C:ABC123456789")
  })

  test("Handles segmentation type codes (hex values)", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-SEGMENTATION-TYPE="0x30"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].segmentationType, "Provider Ad")
  })

  test("Handles manifest with Windows line endings", () => {
    const manifest = "#EXTM3U\r\n#EXT-X-DATERANGE:ID=\"ad-1\",SCTE35-OUT=YES,START-DATE=\"2025-10-31T10:00:00Z\",DURATION=30\r\n#EXTINF:4.0,\r\nseg_1.m4s"
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
  })

  test("Handles malformed DATERANGE attributes gracefully", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,INVALID_ATTR,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    // Should still parse valid attributes
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].id, "ad-1")
  })

  test("Handles quoted values with special characters", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-special",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-UPID="TEST:123,ABC=456"
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].upid, "TEST:123,ABC=456")
  })
})

describe("SCTE-35 Real-World Scenarios", () => {
  test("Handles multi-pod ad break sequence", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-pod-1-seg-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=10,X-SEGMENT-NUM=1,X-SEGMENTS-EXPECTED=3
#EXTINF:4.0,
seg_1.m4s
#EXT-X-DATERANGE:ID="ad-pod-1-seg-2",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:10Z",DURATION=10,X-SEGMENT-NUM=2,X-SEGMENTS-EXPECTED=3
#EXTINF:4.0,
seg_2.m4s
#EXT-X-DATERANGE:ID="ad-pod-1-seg-3",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:20Z",DURATION=10,X-SEGMENT-NUM=3,X-SEGMENTS-EXPECTED=3
#EXTINF:4.0,
seg_3.m4s
#EXT-X-DATERANGE:ID="return-1",SCTE35-IN=YES,START-DATE="2025-10-31T10:00:30Z"
#EXTINF:4.0,
seg_4.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 4)
    assert.equal(signals[0].segmentNum, 1)
    assert.equal(signals[1].segmentNum, 2)
    assert.equal(signals[2].segmentNum, 3)
    assert.equal(signals[3].type, "return_signal")
  })

  test("Handles program boundary signals", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="program-end",START-DATE="2025-10-31T10:00:00Z",X-SEGMENTATION-TYPE="program_end"
#EXTINF:4.0,
seg_1.m4s
#EXT-X-DATERANGE:ID="ad-break",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:04Z",DURATION=30
#EXTINF:4.0,
seg_2.m4s
#EXT-X-DATERANGE:ID="program-start",START-DATE="2025-10-31T10:00:34Z",X-SEGMENTATION-TYPE="program_start"
#EXTINF:4.0,
seg_3.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 3)
    assert.equal(signals[0].segmentationType, "Program End")
    assert.equal(signals[1].type, "splice_insert")
    assert.equal(signals[2].segmentationType, "Program Start")
  })

  test("Handles chapter markers with ads", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="chapter-1",START-DATE="2025-10-31T10:00:00Z",X-SEGMENTATION-TYPE="chapter_start"
#EXTINF:4.0,
seg_1.m4s
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:05:00Z",DURATION=30
#EXTINF:4.0,
seg_2.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    // Chapter markers might not have SCTE35-OUT, but ads do
    const adSignals = signals.filter(s => isAdBreakStart(s))
    assert.equal(adSignals.length, 1)
  })
})

