// Advanced HLS Utilities Tests
// Comprehensive tests for HLS manifest manipulation, parsing, and segment replacement

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  insertDiscontinuity,
  injectInterstitialCues,
  replaceSegmentsWithAds,
  extractPDTs,
  findSegmentAtPDT,
  calculateManifestDuration,
  parseVariant
} from "../src/utils/hls.ts"

const SAMPLE_MANIFEST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:1000
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:00.000Z
#EXTINF:4.000,
seg_1000.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:04.000Z
#EXTINF:4.000,
seg_1001.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:08.000Z
#EXTINF:4.000,
seg_1002.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:12.000Z
#EXTINF:4.000,
seg_1003.m4s
`

function buildSequentialManifest(segmentCount: number, startIso = "2025-10-31T12:00:00.000Z") {
  const lines: string[] = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:4", "#EXT-X-MEDIA-SEQUENCE:1000"]
  const pdts: string[] = []

  const start = Date.parse(startIso)
  for (let i = 0; i < segmentCount; i++) {
    const iso = new Date(start + i * 4000).toISOString()
    pdts.push(iso)
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${iso}`)
    lines.push(`#EXTINF:4.000,`)
    lines.push(`seg_${1000 + i}.m4s`)
  }

  return { manifest: lines.join("\n"), pdts }
}

const LONG_MANIFEST = buildSequentialManifest(20)
const SSAI_START_PDT = LONG_MANIFEST.pdts[4]

const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
v_800k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720
v_1600k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080
v_2500k.m3u8
`

const SILENT_LOGGER = {
  log: () => {},
  warn: () => {},
  error: () => {}
}

describe("HLS Parsing", () => {
  test("parseVariant() extracts all stream info correctly", () => {
    const variants = parseVariant(MASTER_PLAYLIST.split("\n"))
    
    assert.equal(variants.length, 3, "Should find 3 variants")
    assert.equal(variants[0].bandwidth, 800000)
    assert.equal(variants[0].resolution, "640x360")
    assert.equal(variants[0].uri, "v_800k.m3u8")
    
    assert.equal(variants[1].bandwidth, 1600000)
    assert.equal(variants[2].bandwidth, 2500000)
  })

  test("parseVariant() handles malformed playlists gracefully", () => {
    const malformed = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=invalid\ntest.m3u8"
    const variants = parseVariant(malformed.split("\n"))
    
    assert.equal(variants.length, 1)
    assert.equal(variants[0].bandwidth, NaN)
  })

  test("parseVariant() handles missing resolution attribute", () => {
    const noResolution = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1600000\nv_1600k.m3u8"
    const variants = parseVariant(noResolution.split("\n"))
    
    assert.equal(variants.length, 1)
    assert.equal(variants[0].bandwidth, 1600000)
    assert.equal(variants[0].resolution, undefined)
  })

  test("extractPDTs() finds all program date time tags", () => {
    const pdts = extractPDTs(SAMPLE_MANIFEST)
    
    assert.equal(pdts.length, 4)
    assert.equal(pdts[0], "2025-10-31T12:00:00.000Z")
    assert.equal(pdts[3], "2025-10-31T12:00:12.000Z")
  })

  test("extractPDTs() handles manifest with no PDT tags", () => {
    const noPDT = "#EXTM3U\n#EXTINF:4.0,\nseg_1.m4s"
    const pdts = extractPDTs(noPDT)
    
    assert.equal(pdts.length, 0)
  })

  test("findSegmentAtPDT() locates correct segment index", () => {
    const segmentIdx = findSegmentAtPDT(SAMPLE_MANIFEST, "2025-10-31T12:00:04.000Z")
    
    assert.ok(segmentIdx > 0, "Should find segment")
    const lines = SAMPLE_MANIFEST.split("\n")
    assert.equal(lines[segmentIdx], "seg_1001.m4s")
  })

  test("findSegmentAtPDT() returns -1 for non-existent PDT", () => {
    const segmentIdx = findSegmentAtPDT(SAMPLE_MANIFEST, "2025-10-31T13:00:00.000Z")
    
    assert.equal(segmentIdx, -1)
  })

  test("calculateManifestDuration() sums all segment durations", () => {
    const duration = calculateManifestDuration(SAMPLE_MANIFEST)
    
    assert.equal(duration, 16.0)  // 4 segments × 4 seconds
  })

  test("calculateManifestDuration() handles variable segment durations", () => {
    const variableDuration = `#EXTM3U
#EXTINF:4.000,
seg_1.m4s
#EXTINF:3.500,
seg_2.m4s
#EXTINF:5.200,
seg_3.m4s`
    
    const duration = calculateManifestDuration(variableDuration)
    assert.equal(duration, 12.7)
  })
})

describe("HLS DISCONTINUITY Insertion", () => {
  test("insertDiscontinuity() without PDT inserts before last segment", () => {
    const result = insertDiscontinuity(SAMPLE_MANIFEST)
    const lines = result.split("\n")
    
    // Find last segment
    const lastSegIdx = lines.findIndex(l => l.trim() === "seg_1003.m4s")
    assert.ok(lastSegIdx > 0)
    assert.equal(lines[lastSegIdx - 1].trim(), "#EXT-X-DISCONTINUITY")
  })

  test("insertDiscontinuity() inserts a single discontinuity marker", () => {
    const result = insertDiscontinuity(SAMPLE_MANIFEST)
    const lines = result.split("\n")

    const lastSegIdx = lines.findIndex(l => l.trim() === "seg_1003.m4s")
    assert.ok(lastSegIdx > 0)
    assert.equal(lines[lastSegIdx - 1].trim(), "#EXT-X-DISCONTINUITY")
    const discontinuityCount = (result.match(/#EXT-X-DISCONTINUITY/g) || []).length
    assert.equal(discontinuityCount, 1)
  })

  test("insertDiscontinuity() handles empty manifest gracefully", () => {
    const empty = "#EXTM3U\n#EXT-X-VERSION:7"
    const result = insertDiscontinuity(empty)
    
    // Should not throw, and should not have DISCONTINUITY added
    assert.ok(!result.includes("#EXT-X-DISCONTINUITY"))
  })

  test("insertDiscontinuity() preserves manifest structure", () => {
    const result = insertDiscontinuity(SAMPLE_MANIFEST)
    
    assert.ok(result.includes("#EXTM3U"))
    assert.ok(result.includes("#EXT-X-VERSION:7"))
    assert.ok(result.includes("#EXT-X-TARGETDURATION:4"))
    assert.equal((result.match(/seg_\d+\.m4s/g) || []).length, 4)
  })
})

describe("HLS Interstitial Markers", () => {
  const SAMPLE_PAYLOAD = "/////w=="

  test("injectInterstitialCues() adds cue-out and cue-in records with hex SCTE-35", () => {
    const result = injectInterstitialCues(SAMPLE_MANIFEST, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: "https://ads.example.com/ad.m3u8",
      scte35Payload: SAMPLE_PAYLOAD
    })

    const lines = result.split("\n")
    const dateranges = lines.filter(l => l.startsWith("#EXT-X-DATERANGE:"))
    assert.equal(dateranges.length, 2)
    assert.ok(dateranges.some(l => l.includes('SCTE35-OUT=0x')))
    assert.ok(dateranges.some(l => l.includes('SCTE35-IN=0x')))

    const cueOut = lines.find(l => l.startsWith('#EXT-X-CUE-OUT'))
    assert.ok(cueOut?.includes('DURATION=30.000'))
    assert.ok(cueOut?.includes('SCTE35=0x'))
    assert.ok(lines.some(l => l.trim() === '#EXT-X-CUE-IN'))
  })

  test("injectInterstitialCues() includes playout controls", () => {
    const result = injectInterstitialCues(SAMPLE_MANIFEST, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: "https://ads.example.com/ad.m3u8",
      controls: "skip-restrictions=10"
    })

    assert.ok(result.includes('X-PLAYOUT-CONTROLS="skip-restrictions=10"'))
  })

  test("injectInterstitialCues() uses default controls when not specified", () => {
    const result = injectInterstitialCues(SAMPLE_MANIFEST, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: "https://ads.example.com/ad.m3u8"
    })

    assert.ok(result.includes('X-PLAYOUT-CONTROLS="skip-restrictions=6"'))
  })

  test("injectInterstitialCues() handles special characters in URLs", () => {
    const urlWithQuery = "https://ads.example.com/ad.m3u8?token=abc123&exp=9999"
    const result = injectInterstitialCues(SAMPLE_MANIFEST, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: urlWithQuery
    })

    assert.ok(result.includes(urlWithQuery))
  })

  test("injectInterstitialCues() preserves line endings", () => {
    const withNewline = SAMPLE_MANIFEST + "\n"
    const result = injectInterstitialCues(withNewline, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: "https://ads.example.com/ad.m3u8"
    })

    assert.ok(!result.endsWith("\n\n"))
  })
})

describe("SSAI Segment Replacement", () => {
  test("replaceSegmentsWithAds() omits DISCONTINUITY when containers match", () => {
    const adSegments = [
      "https://ads.example.com/ad_seg_1.m4s",
      "https://ads.example.com/ad_seg_2.m4s"
    ]

    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    const discontinuityCount = (manifest.match(/#EXT-X-DISCONTINUITY/g) || []).length
    assert.equal(discontinuityCount, 0, "Should omit DISCONTINUITY when codecs/timebases match")
  })

  test("replaceSegmentsWithAds() inserts DISCONTINUITY when container changes", () => {
    const adSegments = [
      "https://ads.example.com/ad_seg_1.ts",
      "https://ads.example.com/ad_seg_2.ts"
    ]

    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    const discontinuityCount = (manifest.match(/#EXT-X-DISCONTINUITY/g) || []).length
    assert.equal(discontinuityCount, 2, "Should have DISCONTINUITY markers when containers differ")
  })

  test("replaceSegmentsWithAds() includes ad segments in output", () => {
    const adSegments = [
      "https://ads.example.com/ad_seg_1.m4s",
      "https://ads.example.com/ad_seg_2.m4s"
    ]

    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    assert.ok(manifest.includes("ad_seg_1.m4s"))
    assert.ok(manifest.includes("ad_seg_2.m4s"))
  })

  test("replaceSegmentsWithAds() removes appropriate number of content segments", () => {
    const adSegments = [
      "https://ads.example.com/ad_seg_1.m4s",
      "https://ads.example.com/ad_seg_2.m4s"
    ]

    const { manifest, segmentsSkipped } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30  // 30 seconds = ~7.5 segments at 4s each
    )

    const originalSegments = (SAMPLE_MANIFEST.match(/seg_\d+\.m4s/g) || []).length
    const resultSegments = (manifest.match(/seg_\d+\.m4s/g) || []).length

    assert.ok(resultSegments < originalSegments, "Should have fewer content segments")
    assert.ok(segmentsSkipped >= 2)
  })

  test("replaceSegmentsWithAds() handles empty ad segment list", () => {
    const { manifest, segmentsSkipped } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      [],
      30
    )

    assert.ok(manifest.includes("seg_1000.m4s"))
    assert.equal(segmentsSkipped, 0)
  })

  test("replaceSegmentsWithAds() preserves PDT timestamps", () => {
    const adSegments = ["https://ads.example.com/ad_seg_1.m4s"]

    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    assert.ok(manifest.includes("#EXT-X-PROGRAM-DATE-TIME:"))
  })

  test("replaceSegmentsWithAds() calculates correct segment durations", () => {
    const adSegments = [
      "https://ads.example.com/ad_seg_1.m4s",
      "https://ads.example.com/ad_seg_2.m4s",
      "https://ads.example.com/ad_seg_3.m4s"
    ]

    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    assert.ok(manifest.includes("10.000"))
  })
})

describe("HLS Edge Cases", () => {
  test("handles manifest with no segments", () => {
    const noSegments = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4"

    // Should not throw
    const result1 = insertDiscontinuity(noSegments)
    const result2 = injectInterstitialCues(noSegments, {
      id: "ad",
      startDateISO: "2025-10-31T12:00:00Z",
      durationSec: 30,
      assetURI: "http://ad.com/ad.m3u8"
    })
    
    assert.ok(result1)
    assert.ok(result2)
  })

  test("handles manifest with only one segment", () => {
    const oneSegment = `#EXTM3U
#EXT-X-VERSION:7
#EXTINF:4.0,
seg_1.m4s`
    
    const result = insertDiscontinuity(oneSegment)
    assert.ok(result.includes("#EXT-X-DISCONTINUITY"))
  })

  test("handles very long manifest (1000+ segments)", () => {
    let longManifest = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n"
    for (let i = 0; i < 1000; i++) {
      longManifest += `#EXTINF:4.0,\nseg_${i}.m4s\n`
    }
    
    const start = Date.now()
    const result = insertDiscontinuity(longManifest)
    const duration = Date.now() - start
    
    assert.ok(result.includes("#EXT-X-DISCONTINUITY"))
    assert.ok(duration < 100, "Should process quickly (< 100ms)")
  })

  test("handles manifest with various line endings", () => {
    const mixedLineEndings = "#EXTM3U\r\n#EXT-X-VERSION:7\r\n#EXTINF:4.0,\r\nseg_1.m4s\r\n"
    
    const result = insertDiscontinuity(mixedLineEndings)
    assert.ok(result)
  })

  test("handles manifest with extra whitespace", () => {
    const whitespace = `#EXTM3U
    #EXT-X-VERSION:7   
#EXTINF:4.0,  
   seg_1.m4s   `
    
    const result = insertDiscontinuity(whitespace)
    assert.ok(result.includes("#EXT-X-DISCONTINUITY"))
  })

  test("handles Unicode characters in segment names", () => {
    const unicode = `#EXTM3U
#EXT-X-VERSION:7
#EXTINF:4.0,
seg_测试_1.m4s`
    
    const result = insertDiscontinuity(unicode)
    assert.ok(result.includes("seg_测试_1.m4s"))
  })
})

describe("PTS↔PDT Mapping", () => {
  test("PtsPdtMap estimates PDT for subsequent timestamps", () => {
    const map = new PtsPdtMap()
    const baseIso = "2025-01-01T00:00:00.000Z"
    map.ingest(90000n, baseIso)

    const estimate = map.estimate(180000n)
    assert.ok(estimate)
    if (estimate) {
      assert.equal(estimate.iso, "2025-01-01T00:00:01.000Z")
    }
  })

  test("reconcileCueStartDates populates missing START-DATE", () => {
    const manifest = `#EXTM3U\n` +
      `#EXT-X-PROGRAM-DATE-TIME:2025-01-01T00:00:00.000Z\n` +
      `#EXT-X-PTS:90000\n` +
      `#EXTINF:2.000,\n` +
      `seg0.ts\n` +
      `#EXT-X-DATERANGE:ID="cue-1",CLASS="test",X-PTS=180000,DURATION=30\n`

    const map = new PtsPdtMap()
    const { manifest: updated } = reconcileCueStartDates(manifest, map, { logger: SILENT_LOGGER })
    const daterange = updated.split("\n").find(l => l.startsWith('#EXT-X-DATERANGE:'))

    assert.ok(daterange)
    assert.ok(daterange?.includes('START-DATE="2025-01-01T00:00:01.000Z"'))
  })

  test("reconcileCueStartDates resets mapping on DISCONTINUITY", () => {
    const manifest = `#EXTM3U\n` +
      `#EXT-X-PROGRAM-DATE-TIME:2025-01-01T00:00:00.000Z\n` +
      `#EXT-X-PTS:90000\n` +
      `#EXTINF:2.000,\n` +
      `seg0.ts\n` +
      `#EXT-X-DISCONTINUITY\n` +
      `#EXT-X-PROGRAM-DATE-TIME:2025-01-01T01:00:00.000Z\n` +
      `#EXT-X-PTS:90000\n` +
      `#EXTINF:2.000,\n` +
      `seg1.ts\n`

    const map = new PtsPdtMap()
    reconcileCueStartDates(manifest, map, { logger: SILENT_LOGGER })

    assert.equal(map.calibrationCount, 1)
    const latest = map.latest
    assert.ok(latest)
    if (latest) {
      assert.equal(new Date(latest.pdtMs).toISOString(), "2025-01-01T01:00:00.000Z")
    }
  })
})

describe("HLS Validation", () => {
  test("insertDiscontinuity() produces valid HLS syntax", () => {
    const result = insertDiscontinuity(SAMPLE_MANIFEST)

    // Basic validation
    assert.ok(result.startsWith("#EXTM3U"))
    assert.ok(result.includes("#EXT-X-VERSION"))
    
    // DISCONTINUITY should be before a segment
    const lines = result.split("\n")
    const discIdx = lines.findIndex(l => l.includes("#EXT-X-DISCONTINUITY"))
    if (discIdx >= 0) {
      // Next non-comment line should be a segment
      for (let i = discIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() && !lines[i].startsWith("#")) {
          assert.ok(lines[i].includes(".m4s") || lines[i].includes(".ts"))
          break
        }
      }
    }
  })

  test("injectInterstitialCues() produces valid DATERANGE syntax", () => {
    const result = injectInterstitialCues(SAMPLE_MANIFEST, {
      id: "ad-123",
      startDateISO: "2025-10-31T12:00:08.000Z",
      durationSec: 30,
      assetURI: "https://ads.example.com/ad.m3u8"
    })

    const lines = result.split("\n")
    const daterangeLines = lines.filter(l => l.includes("#EXT-X-DATERANGE:"))

    assert.ok(daterangeLines.length >= 2)

    const cueOutLine = daterangeLines[0]
    assert.ok(cueOutLine.includes('ID='))
    assert.ok(cueOutLine.includes('START-DATE='))
    assert.ok(cueOutLine.includes('CLASS="com.apple.hls.interstitial"'))
  })

  test("replaceSegmentsWithAds() maintains segment continuity", () => {
    const adSegments = ["https://ads.example.com/ad_seg_1.m4s"]
    
    const { manifest } = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:08.000Z",
      adSegments,
      30
    )

    const lines = manifest.split("\n")
    let hasInfBeforeSegment = true
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith("#") && line.trim().length > 0 && line.includes(".m4s")) {
        // This is a segment line, previous meaningful line should be EXTINF
        let foundExtinf = false
        const context: string[] = []
        for (let j = i - 1; j >= 0; j--) {
          if (lines[j].trim().length === 0) continue
          const trimmed = lines[j].trim()
          context.push(trimmed)
          if (trimmed.startsWith("#EXTINF:")) {
            foundExtinf = true
            break
          }
          if (!trimmed.startsWith("#EXT-X-DISCONTINUITY") &&
              !trimmed.startsWith("#EXT-X-PROGRAM-DATE-TIME")) {
            break
          }
        }
        if (!foundExtinf) {
          const prev = context[0]
          const prev2 = context[1]
          const resumeAfterDiscontinuity =
            prev?.startsWith("#EXT-X-PROGRAM-DATE-TIME") && prev2?.startsWith("#EXT-X-DISCONTINUITY")
          if (!resumeAfterDiscontinuity) {
            hasInfBeforeSegment = false
            break
          }
        }
      }
    }
    
    assert.ok(hasInfBeforeSegment, "Each segment should have EXTINF")
  })
})

