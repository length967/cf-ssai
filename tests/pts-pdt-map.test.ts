import { strict as assert } from "node:assert"
import { describe, test } from "node:test"

import { addPtsPdtSample, predictPtsToMs, predictPtsToIso } from "../src/utils/pts-pdt-map"

describe("PTS↔PDT mapper", () => {
  test("fits affine transform from samples", () => {
    const baseMs = Date.parse("2024-01-01T00:00:00Z")
    let mapping = addPtsPdtSample(undefined, { pts90k: 90000, pdtMs: baseMs })
    mapping = addPtsPdtSample(mapping, { pts90k: 180000, pdtMs: baseMs + 1000 })

    const predictedMs = predictPtsToMs(mapping, 180000)
    if (predictedMs === undefined) {
      throw new Error("prediction should be available")
    }
    assert.ok(Math.abs(predictedMs - (baseMs + 1000)) < 0.5)
    assert.ok(Math.abs(mapping.slopeMsPerTick - (1000 / 90000)) < 1e-6)

    const iso = predictPtsToIso(mapping, 180000)
    assert.equal(iso, new Date(baseMs + 1000).toISOString())
  })

  test("tracks drift when observed PDT deviates", () => {
    const baseMs = Date.parse("2024-01-01T00:00:00Z")
    let mapping = addPtsPdtSample(undefined, { pts90k: 90000, pdtMs: baseMs })
    mapping = addPtsPdtSample(mapping, { pts90k: 180000, pdtMs: baseMs + 1200 })

    assert.ok(mapping.lastDriftMs !== undefined, "drift should be recorded")
    assert.ok(Math.abs((mapping.lastDriftMs ?? 0) - 200) < 0.5)
  })
})
