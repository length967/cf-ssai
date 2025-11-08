import { strict as assert } from "node:assert"
import { describe, test } from "node:test"

import {
  BoundaryDecisionRecorder,
  collectIdrTimestamps,
  MPEG_CLOCK_HZ,
  snapCueToIdr,
  validateBoundaryError
} from "../src/utils/idr"
import { replaceSegmentsWithAds } from "../src/utils/hls"

const SAMPLE_MANIFEST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:00.000Z
#EXTINF:4.000,
seg_1000.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:04.000Z
#EXTINF:4.000,
seg_1001.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:08.000Z
#EXTINF:4.000,
seg_1002.m4s
`

describe("IDR utilities", () => {
  test("collectIdrTimestamps merges encoder and segmenter data", () => {
    const timeline = collectIdrTimestamps({
      encoder: {
        variant: "v_1600k.m3u8",
        cues: [{ pts: 90_000 }, { seconds: 2.5 }]
      },
      segmenter: [
        { pts: 95_000 },
        { timeSeconds: 4.0 }
      ]
    })

    assert.equal(timeline.values.length, 4)
    assert.equal(timeline.sourceCounts.encoder, 2)
    assert.equal(timeline.sourceCounts.segmenter, 2)
    assert.equal(timeline.values[0].pts, 90_000)
    assert.ok(timeline.values[3].timeSeconds > 0)
  })

  test("snapCueToIdr picks nearest IDR within lookahead window", () => {
    const timeline = collectIdrTimestamps({
      encoder: { idrPts: [90_000, 180_000, 270_000] }
    })

    const decision = snapCueToIdr(timeline, 95_000, { lookAheadPts: 120_000 })
    assert.equal(decision.snappedPts, 180_000)
    assert.equal(decision.reason, "future")

    const fallback = snapCueToIdr(timeline, 50_000, { lookAheadPts: 30_000 })
    assert.equal(fallback.snappedPts, 50_000)
    assert.equal(fallback.reason, "none")
  })

  test("validateBoundaryError reports tolerance results", () => {
    const timeline = collectIdrTimestamps({ encoder: { idrPts: [90_000, 180_000] } })
    const decision = snapCueToIdr(timeline, 100_000, { lookAheadPts: 120_000 })
    const validation = validateBoundaryError(decision, { tolerancePts: MPEG_CLOCK_HZ })

    assert.ok(validation.withinTolerance)
    assert.equal(validation.tolerancePts, MPEG_CLOCK_HZ)
    assert.equal(validation.errorPts, 80_000)
  })

  test("replaceSegmentsWithAds returns boundary metadata when IDRs are provided", () => {
    const timeline = collectIdrTimestamps({ encoder: { idrPts: [90_000, 150_000, 210_000] } })
    const recorder = new BoundaryDecisionRecorder()

    const result = replaceSegmentsWithAds(
      SAMPLE_MANIFEST,
      "2025-10-31T12:00:04.000Z",
      ["https://ads.example.com/ad_seg.m4s"],
      4,
      undefined,
      undefined,
      {
        cuePts90k: 95_000,
        idrTimeline: timeline,
        recordBoundaryDecision: (decision, validation) => recorder.record(decision, validation)
      }
    )

    assert.ok(result.boundary)
    assert.ok(result.requestedCut)
    assert.equal(result.boundary?.decision.snappedPts, 150_000)
    assert.ok(recorder.list().length >= 1)
  })
})
