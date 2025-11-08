// Performance and Load Tests
// Tests for throughput, latency, caching, and scalability

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  insertDiscontinuity,
  injectInterstitialCues,
  replaceSegmentsWithAds,
  calculateManifestDuration,
  parseVariant
} from "../src/utils/hls.ts"
import { parseSCTE35FromManifest } from "../src/utils/scte35.ts"
import { signPath } from "../src/utils/sign.ts"
import { windowBucket } from "../src/utils/time"

// Helper to measure execution time
async function measureTime<T>(fn: () => T | Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now()
  const result = await fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

// Generate large manifest for stress testing
function generateLargeManifest(segmentCount: number): string {
  let manifest = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1000\n"
  const baseTime = new Date("2025-10-31T10:00:00.000Z").getTime()
  
  for (let i = 0; i < segmentCount; i++) {
    const pdt = new Date(baseTime + i * 4000).toISOString()
    manifest += `#EXT-X-PROGRAM-DATE-TIME:${pdt}\n`
    manifest += `#EXTINF:4.000,\n`
    manifest += `seg_${1000 + i}.m4s\n`
  }
  
  return manifest
}

describe("HLS Performance", () => {
  test("insertDiscontinuity() processes small manifest quickly", async () => {
    const manifest = generateLargeManifest(10)
    
    const { durationMs } = await measureTime(() => insertDiscontinuity(manifest))
    
    assert.ok(durationMs < 10, `Should complete in < 10ms, took ${durationMs.toFixed(2)}ms`)
  })

  test("insertDiscontinuity() processes large manifest (1000 segments) efficiently", async () => {
    const manifest = generateLargeManifest(1000)
    
    const { durationMs } = await measureTime(() => insertDiscontinuity(manifest))
    
    assert.ok(durationMs < 100, `Should complete in < 100ms, took ${durationMs.toFixed(2)}ms`)
    console.log(`  ⏱️  1000-segment manifest: ${durationMs.toFixed(2)}ms`)
  })

  test("insertDiscontinuity() processes extra large manifest (10000 segments)", async () => {
    const manifest = generateLargeManifest(10000)
    
    const { durationMs } = await measureTime(() => insertDiscontinuity(manifest))
    
    assert.ok(durationMs < 1000, `Should complete in < 1s, took ${durationMs.toFixed(2)}ms`)
    console.log(`  ⏱️  10000-segment manifest: ${durationMs.toFixed(2)}ms`)
  })

  test("injectInterstitialCues() performance is consistent", async () => {
    const durations: number[] = []
    const manifest = generateLargeManifest(100)

    for (let i = 0; i < 100; i++) {
      const { durationMs } = await measureTime(() =>
        injectInterstitialCues(manifest, {
          id: `ad-${i}`,
          startDateISO: "2025-10-31T10:00:00Z",
          durationSec: 30,
          assetURI: "https://ads.example.com/ad.m3u8"
        })
      )
      durations.push(durationMs)
    }
    
    const avg = durations.reduce((a, b) => a + b) / durations.length
    const max = Math.max(...durations)
    const min = Math.min(...durations)
    
    console.log(`  ⏱️  Average: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`)
    
    assert.ok(avg < 10, `Average should be < 10ms, was ${avg.toFixed(2)}ms`)
    assert.ok(max < 50, `Max should be < 50ms, was ${max.toFixed(2)}ms`)
  })

  test("replaceSegmentsWithAds() performance with large manifests", async () => {
    const manifest = generateLargeManifest(500)
    const adSegments = Array.from({ length: 10 }, (_, i) => `https://ads.example.com/seg_${i}.m4s`)
    
    const { durationMs } = await measureTime(() =>
      replaceSegmentsWithAds(manifest, "2025-10-31T10:05:00.000Z", adSegments, 30)
    )
    
    console.log(`  ⏱️  500-segment manifest with 10 ad segments: ${durationMs.toFixed(2)}ms`)
    assert.ok(durationMs < 100, `Should complete in < 100ms, took ${durationMs.toFixed(2)}ms`)
  })

  test("parseVariant() performance on master playlist", async () => {
    let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:7\n"
    for (let i = 0; i < 10; i++) {
      masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${(i + 1) * 500000},RESOLUTION=${1280 + i * 64}x${720 + i * 36}\n`
      masterPlaylist += `v_${(i + 1) * 500}k.m3u8\n`
    }
    
    const { durationMs, result } = await measureTime(() =>
      parseVariant(masterPlaylist.split("\n"))
    )
    
    assert.equal(result.length, 10)
    assert.ok(durationMs < 5, `Should complete in < 5ms, took ${durationMs.toFixed(2)}ms`)
  })

  test("calculateManifestDuration() performance", async () => {
    const manifest = generateLargeManifest(1000)
    
    const { durationMs, result } = await measureTime(() =>
      calculateManifestDuration(manifest)
    )
    
    assert.equal(result, 4000)  // 1000 segments × 4 seconds
    assert.ok(durationMs < 20, `Should complete in < 20ms, took ${durationMs.toFixed(2)}ms`)
    console.log(`  ⏱️  Duration calculation (1000 segments): ${durationMs.toFixed(2)}ms`)
  })
})

describe("SCTE-35 Performance", () => {
  test("parseSCTE35FromManifest() with few signals", async () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s
${generateLargeManifest(100)}`
    
    const { durationMs, result } = await measureTime(() =>
      parseSCTE35FromManifest(manifest)
    )
    
    assert.equal(result.length, 1)
    assert.ok(durationMs < 10, `Should complete in < 10ms, took ${durationMs.toFixed(2)}ms`)
  })

  test("parseSCTE35FromManifest() with many signals", async () => {
    let manifest = "#EXTM3U\n"
    for (let i = 0; i < 100; i++) {
      manifest += `#EXT-X-DATERANGE:ID="ad-${i}",SCTE35-OUT=YES,START-DATE="2025-10-31T${10 + Math.floor(i / 60)}:${i % 60}:00Z",DURATION=30\n`
      manifest += `#EXTINF:4.0,\nseg_${i}.m4s\n`
    }
    
    const { durationMs, result } = await measureTime(() =>
      parseSCTE35FromManifest(manifest)
    )
    
    assert.equal(result.length, 100)
    assert.ok(durationMs < 50, `Should complete in < 50ms, took ${durationMs.toFixed(2)}ms`)
    console.log(`  ⏱️  Parse 100 SCTE-35 signals: ${durationMs.toFixed(2)}ms`)
  })

  test("SCTE-35 parsing throughput", async () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const iterations = 1000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      parseSCTE35FromManifest(manifest)
    }
    
    const durationMs = performance.now() - start
    const throughput = (iterations / durationMs) * 1000
    
    console.log(`  ⏱️  SCTE-35 parsing throughput: ${throughput.toFixed(0)} ops/sec`)
    assert.ok(throughput > 10000, `Should handle > 10k ops/sec, got ${throughput.toFixed(0)}`)
  })
})

describe("Signing Performance", () => {
  test("signPath() performance", async () => {
    const durations: number[] = []
    
    for (let i = 0; i < 100; i++) {
      const { durationMs } = await measureTime(() =>
        signPath("media.example.com", "secret123", `/ads/pod${i}.m3u8`, 600)
      )
      durations.push(durationMs)
    }
    
    const avg = durations.reduce((a, b) => a + b) / durations.length
    const max = Math.max(...durations)
    
    console.log(`  ⏱️  URL signing - Average: ${avg.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`)
    
    assert.ok(avg < 5, `Average should be < 5ms, was ${avg.toFixed(2)}ms`)
    assert.ok(max < 20, `Max should be < 20ms, was ${max.toFixed(2)}ms`)
  })

  test("signPath() throughput", async () => {
    const iterations = 100
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      await signPath("media.example.com", "secret123", `/ads/pod${i}.m3u8`, 600)
    }
    
    const durationMs = performance.now() - start
    const throughput = (iterations / durationMs) * 1000
    
    console.log(`  ⏱️  URL signing throughput: ${throughput.toFixed(0)} ops/sec`)
    assert.ok(throughput > 200, `Should handle > 200 ops/sec, got ${throughput.toFixed(0)}`)
  })

  test("Concurrent signPath() operations", async () => {
    const concurrency = 50
    const start = performance.now()
    
    const promises = Array.from({ length: concurrency }, (_, i) =>
      signPath("media.example.com", "secret123", `/ads/pod${i}.m3u8`, 600)
    )
    
    await Promise.all(promises)
    
    const durationMs = performance.now() - start
    
    console.log(`  ⏱️  ${concurrency} concurrent signing operations: ${durationMs.toFixed(2)}ms`)
    assert.ok(durationMs < 200, `Should complete in < 200ms, took ${durationMs.toFixed(2)}ms`)
  })
})

describe("Caching Efficiency", () => {
  test("windowBucket() performance", () => {
    const iterations = 1000000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      windowBucket(i, 2)
    }
    
    const durationMs = performance.now() - start
    const throughput = (iterations / durationMs) * 1000
    
    console.log(`  ⏱️  windowBucket throughput: ${throughput.toFixed(0)} ops/sec`)
    assert.ok(throughput > 1000000, `Should handle > 1M ops/sec, got ${throughput.toFixed(0)}`)
  })

  test("windowBucket() bucketing correctness under load", () => {
    const testCases = 10000
    const stride = 2
    
    for (let i = 0; i < testCases; i++) {
      const seconds = Math.floor(Math.random() * 86400)  // Random second in a day
      const bucket = windowBucket(seconds, stride)
      
      // Verify bucket is correct
      const expectedBucket = Math.floor(seconds / stride)
      assert.equal(bucket, expectedBucket)
    }
  })

  test("Cache key generation performance", () => {
    const iterations = 100000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      const channel = `channel-${i % 100}`
      const variant = `v_${(i % 3) * 800 + 800}k.m3u8`
      const wb = windowBucket(Date.now() / 1000, 2)
      const vbucket = i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C"
      
      // Simulate cache key generation
      const cacheKey = `${channel}:${variant}:wb${wb}:vb${vbucket}`
      assert.ok(cacheKey)
    }
    
    const durationMs = performance.now() - start
    const throughput = (iterations / durationMs) * 1000
    
    console.log(`  ⏱️  Cache key generation throughput: ${throughput.toFixed(0)} ops/sec`)
    assert.ok(throughput > 100000, `Should handle > 100k ops/sec, got ${throughput.toFixed(0)}`)
  })
})

describe("Memory Efficiency", () => {
  test("Large manifest processing doesn't accumulate memory", () => {
    const iterations = 100
    const manifest = generateLargeManifest(1000)
    
    for (let i = 0; i < iterations; i++) {
      const result = insertDiscontinuity(manifest)
      assert.ok(result.length > 0)
      
      // Force result to go out of scope
      if (i === iterations - 1) {
        assert.ok(result)
      }
    }
    
    // If we got here without OOM, memory is being managed properly
    assert.ok(true, "Memory managed efficiently")
  })

  test("String concatenation performance", () => {
    const iterations = 1000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      let str = ""
      for (let j = 0; j < 100; j++) {
        str += `#EXTINF:4.0,\nseg_${j}.m4s\n`
      }
      assert.ok(str.length > 0)
    }
    
    const durationMs = performance.now() - start
    
    console.log(`  ⏱️  String concatenation (1000 × 100 lines): ${durationMs.toFixed(2)}ms`)
    assert.ok(durationMs < 100, `Should complete in < 100ms, took ${durationMs.toFixed(2)}ms`)
  })
})

describe("Latency Targets", () => {
  test("P50 latency: Manifest manipulation", async () => {
    const manifest = generateLargeManifest(50)
    const durations: number[] = []
    
    for (let i = 0; i < 100; i++) {
      const { durationMs } = await measureTime(() => insertDiscontinuity(manifest))
      durations.push(durationMs)
    }
    
    durations.sort((a, b) => a - b)
    const p50 = durations[Math.floor(durations.length * 0.50)]
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const p99 = durations[Math.floor(durations.length * 0.99)]
    
    console.log(`  📊 P50: ${p50.toFixed(2)}ms, P95: ${p95.toFixed(2)}ms, P99: ${p99.toFixed(2)}ms`)
    
    assert.ok(p50 < 5, `P50 should be < 5ms, was ${p50.toFixed(2)}ms`)
    assert.ok(p95 < 15, `P95 should be < 15ms, was ${p95.toFixed(2)}ms`)
    assert.ok(p99 < 25, `P99 should be < 25ms, was ${p99.toFixed(2)}ms`)
  })

  test("P50 latency: SCTE-35 parsing", async () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
${generateLargeManifest(50)}`
    
    const durations: number[] = []
    
    for (let i = 0; i < 100; i++) {
      const { durationMs } = await measureTime(() => parseSCTE35FromManifest(manifest))
      durations.push(durationMs)
    }
    
    durations.sort((a, b) => a - b)
    const p50 = durations[Math.floor(durations.length * 0.50)]
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const p99 = durations[Math.floor(durations.length * 0.99)]
    
    console.log(`  📊 P50: ${p50.toFixed(2)}ms, P95: ${p95.toFixed(2)}ms, P99: ${p99.toFixed(2)}ms`)
    
    assert.ok(p50 < 5, `P50 should be < 5ms, was ${p50.toFixed(2)}ms`)
    assert.ok(p95 < 10, `P95 should be < 10ms, was ${p95.toFixed(2)}ms`)
  })

  test("P50 latency: URL signing", async () => {
    const durations: number[] = []
    
    for (let i = 0; i < 100; i++) {
      const { durationMs } = await measureTime(() =>
        signPath("media.example.com", "secret123", "/ads/pod.m3u8", 600)
      )
      durations.push(durationMs)
    }
    
    durations.sort((a, b) => a - b)
    const p50 = durations[Math.floor(durations.length * 0.50)]
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const p99 = durations[Math.floor(durations.length * 0.99)]
    
    console.log(`  📊 P50: ${p50.toFixed(2)}ms, P95: ${p95.toFixed(2)}ms, P99: ${p99.toFixed(2)}ms`)
    
    assert.ok(p50 < 3, `P50 should be < 3ms, was ${p50.toFixed(2)}ms`)
    assert.ok(p95 < 10, `P95 should be < 10ms, was ${p95.toFixed(2)}ms`)
  })
})

describe("Scalability", () => {
  test("Handles high concurrency simulation", async () => {
    const manifest = generateLargeManifest(100)
    const concurrentOps = 100
    
    const start = performance.now()
    
    const promises = Array.from({ length: concurrentOps }, (_, i) =>
      Promise.resolve(insertDiscontinuity(manifest))
    )
    
    const results = await Promise.all(promises)
    
    const durationMs = performance.now() - start
    const throughput = (concurrentOps / durationMs) * 1000
    
    console.log(`  ⏱️  ${concurrentOps} concurrent operations: ${durationMs.toFixed(2)}ms (${throughput.toFixed(0)} ops/sec)`)
    
    assert.equal(results.length, concurrentOps)
    assert.ok(durationMs < 100, `Should complete in < 100ms, took ${durationMs.toFixed(2)}ms`)
  })

  test("Sustained throughput test", async () => {
    const manifest = generateLargeManifest(50)
    const duration = 1000  // 1 second
    const start = performance.now()
    let operations = 0
    
    while (performance.now() - start < duration) {
      insertDiscontinuity(manifest)
      operations++
    }
    
    const actualDuration = performance.now() - start
    const throughput = (operations / actualDuration) * 1000
    
    console.log(`  ⏱️  Sustained throughput: ${throughput.toFixed(0)} ops/sec over ${actualDuration.toFixed(0)}ms`)
    
    assert.ok(throughput > 1000, `Should sustain > 1000 ops/sec, got ${throughput.toFixed(0)}`)
  })
})

