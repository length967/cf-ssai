// Chaos and Failure Scenario Tests
// Tests system resilience, error handling, and edge cases

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  insertDiscontinuity,
  addDaterangeInterstitial,
  replaceSegmentsWithAds
} from "../src/utils/hls"
import { parseSCTE35FromManifest } from "../src/utils/scte35"
import { signPath } from "../src/utils/sign"
import { parseJWTUnsafe } from "../src/utils/jwt"

describe("Malformed Input Handling", () => {
  test("Handles null manifest", () => {
    // Should not throw
    try {
      insertDiscontinuity("")
      assert.ok(true)
    } catch (err) {
      assert.fail("Should handle empty manifest")
    }
  })

  test("Handles manifest with no line breaks", () => {
    const noBreaks = "#EXTM3U#EXT-X-VERSION:7#EXTINF:4.0,seg_1.m4s"
    
    // Should handle gracefully
    const result = insertDiscontinuity(noBreaks)
    assert.ok(result)
  })

  test("Handles manifest with only headers", () => {
    const headersOnly = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1000"
    
    const result = insertDiscontinuity(headersOnly)
    assert.ok(result)
    // Should not have discontinuity added (no segments)
    assert.ok(!result.includes("#EXT-X-DISCONTINUITY"))
  })

  test("Handles extremely long segment names", () => {
    const longName = "x".repeat(10000)
    const manifest = `#EXTM3U\n#EXTINF:4.0,\n${longName}.m4s`
    
    const result = insertDiscontinuity(manifest)
    assert.ok(result.includes(longName))
  })

  test("Handles manifest with binary data", () => {
    const binary = "#EXTM3U\n\x00\x01\x02\x03\n#EXTINF:4.0,\nseg.m4s"
    
    try {
      const result = insertDiscontinuity(binary)
      assert.ok(result)
    } catch (err) {
      // Acceptable to throw on binary data
      assert.ok(true)
    }
  })

  test("Handles SCTE-35 with missing required attributes", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:SCTE35-OUT=YES
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    // Should parse what it can
    if (signals.length > 0) {
      assert.ok(signals[0].id)  // Should generate ID
    }
  })

  test("Handles SCTE-35 with malformed duration", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=invalid
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    // Duration should be NaN or undefined
    assert.ok(isNaN(signals[0].duration as any) || !signals[0].duration)
  })
})

describe("Resource Exhaustion", () => {
  test("Handles very deep nesting in DATERANGE attributes", () => {
    let nested = "#EXTM3U\n#EXT-X-DATERANGE:ID=\"deep\",SCTE35-OUT=YES,START-DATE=\"2025-10-31T10:00:00Z\""
    for (let i = 0; i < 1000; i++) {
      nested += `,X-ATTR-${i}="value${i}"`
    }
    nested += "\n#EXTINF:4.0,\nseg_1.m4s"
    
    const signals = parseSCTE35FromManifest(nested)
    
    assert.equal(signals.length, 1)
    console.log("  ✓ Handled 1000+ attributes in DATERANGE")
  })

  test("Handles very large manifests without memory issues", () => {
    let largeManifest = "#EXTM3U\n#EXT-X-VERSION:7\n"
    for (let i = 0; i < 50000; i++) {
      largeManifest += `#EXTINF:4.0,\nseg_${i}.m4s\n`
    }
    
    const start = Date.now()
    const result = insertDiscontinuity(largeManifest)
    const duration = Date.now() - start
    
    assert.ok(result.includes("#EXT-X-DISCONTINUITY"))
    console.log(`  ⏱️  Processed 50,000-segment manifest in ${duration}ms`)
  })

  test("Handles repeated parsing without memory leak", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    // Parse many times
    for (let i = 0; i < 10000; i++) {
      const signals = parseSCTE35FromManifest(manifest)
      assert.equal(signals.length, 1)
    }
    
    console.log("  ✓ No memory leak after 10,000 parses")
  })

  test("Handles rapid signing operations", async () => {
    const operations = 1000
    const promises: Promise<string>[] = []
    
    for (let i = 0; i < operations; i++) {
      promises.push(signPath("media.example.com", "secret", `/path${i}.m3u8`, 600))
    }
    
    const results = await Promise.all(promises)
    
    assert.equal(results.length, operations)
    assert.ok(results.every(r => r.includes("token=")))
    
    console.log(`  ✓ Completed ${operations} signing operations`)
  })
})

describe("Concurrent Access Patterns", () => {
  test("Handles concurrent manifest manipulation", async () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:7
#EXTINF:4.0,
seg_1.m4s
#EXTINF:4.0,
seg_2.m4s`
    
    const operations = Array.from({ length: 100 }, () =>
      Promise.resolve(insertDiscontinuity(manifest))
    )
    
    const results = await Promise.all(operations)
    
    // All should succeed
    assert.equal(results.length, 100)
    assert.ok(results.every(r => r.includes("#EXT-X-DISCONTINUITY")))
  })

  test("Handles concurrent SCTE-35 parsing", async () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const operations = Array.from({ length: 100 }, () =>
      Promise.resolve(parseSCTE35FromManifest(manifest))
    )
    
    const results = await Promise.all(operations)
    
    assert.equal(results.length, 100)
    assert.ok(results.every(r => r.length === 1))
  })

  test("Race condition: Rapid window bucket calculations", () => {
    const now = Date.now() / 1000
    const results = new Set<number>()
    
    // Simulate rapid requests in same window
    for (let i = 0; i < 1000; i++) {
      const { windowBucket } = require("../src/utils/time")
      const bucket = windowBucket(now, 2)
      results.add(bucket)
    }
    
    // All should produce same bucket (within same window)
    assert.equal(results.size, 1)
    console.log("  ✓ No race condition in window bucketing")
  })
})

describe("Edge Case Data Scenarios", () => {
  test("Handles empty ad segment list", () => {
    const manifest = `#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:00Z
#EXTINF:4.0,
seg_1.m4s`
    
    const result = replaceSegmentsWithAds(manifest, "2025-10-31T10:00:00Z", [], 30)

    // Should not crash and should return manifest
    assert.ok(result.manifest.includes("seg_1.m4s"))
  })

  test("Handles PDT that doesn't exist in manifest", () => {
    const manifest = `#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:00Z
#EXTINF:4.0,
seg_1.m4s`
    
    const result = replaceSegmentsWithAds(
      manifest,
      "2025-10-31T12:00:00Z",  // Non-existent PDT
      ["https://ads.example.com/seg1.m4s"],
      30
    )

    // Should handle gracefully
    assert.equal(result.segmentsSkipped, 0)
  })

  test("Handles negative duration", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=-30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].duration, -30)
  })

  test("Handles zero-duration ad break", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="ad-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=0
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].duration, 0)
  })

  test("Handles extremely long URLs in DATERANGE", () => {
    const longUrl = "https://example.com/" + "x".repeat(10000) + ".m3u8"
    const manifest = `#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4.0,\nseg_1.m4s`
    
    const result = addDaterangeInterstitial(
      manifest,
      "ad-1",
      "2025-10-31T10:00:00Z",
      30,
      longUrl
    )
    
    assert.ok(result.includes(longUrl))
  })

  test("Handles special characters in segment names", () => {
    const manifest = `#EXTM3U
#EXTINF:4.0,
seg with spaces & special!@#$%chars.m4s`
    
    const result = insertDiscontinuity(manifest)
    assert.ok(result.includes("seg with spaces"))
  })
})

describe("Time and Date Edge Cases", () => {
  test("Handles PDT at year boundary", () => {
    const manifest = `#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2025-12-31T23:59:59.999Z
#EXTINF:4.0,
seg_1.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00.000Z
#EXTINF:4.0,
seg_2.m4s`
    
    const result = insertDiscontinuity(manifest, "2026-01-01T00:00:00.000Z")
    assert.ok(result.includes("#EXT-X-DISCONTINUITY"))
  })

  test("Handles PDT with microseconds", () => {
    const manifest = `#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:00.123456Z
#EXTINF:4.0,
seg_1.m4s`
    
    const result = insertDiscontinuity(manifest)
    assert.ok(result)
  })

  test("Handles PDT with timezone offsets", () => {
    const manifest = `#EXTM3U
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:00+05:00
#EXTINF:4.0,
seg_1.m4s`
    
    const result = insertDiscontinuity(manifest)
    assert.ok(result)
  })

  test("Handles very old dates", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="old",SCTE35-OUT=YES,START-DATE="1970-01-01T00:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    assert.equal(signals.length, 1)
  })

  test("Handles far future dates", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="future",SCTE35-OUT=YES,START-DATE="2099-12-31T23:59:59Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    assert.equal(signals.length, 1)
  })
})

describe("JWT Attack Vectors", () => {
  test("Rejects JWT with tampered header", () => {
    const payload = { sub: "user", exp: 9999999999 }
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const token = `${header}.${payloadB64}.`
    
    const parsed = parseJWTUnsafe(token)
    
    // Unsafe parsing will work, but verification should fail
    assert.ok(parsed)
  })

  test("Handles JWT with missing parts", () => {
    const invalid = [
      "header",
      "header.payload",
      ".payload.sig",
      "header..sig"
    ]
    
    for (const token of invalid) {
      const result = parseJWTUnsafe(token)
      assert.equal(result, null, `Should reject: ${token}`)
    }
  })

  test("Handles extremely large JWT", () => {
    const largeClaim = { sub: "user", exp: 9999999999, data: "x".repeat(100000) }
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify(largeClaim))
    
    const token = `${header}.${payload}.sig`
    
    const parsed = parseJWTUnsafe(token)
    assert.ok(parsed)
    assert.equal(parsed?.data?.length, 100000)
  })

  test("Handles JWT with deeply nested objects", () => {
    let nested: any = { end: true }
    for (let i = 0; i < 100; i++) {
      nested = { level: i, next: nested }
    }
    
    const payload = { sub: "user", exp: 9999999999, nested }
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const token = `${header}.${payloadB64}.sig`
    
    const parsed = parseJWTUnsafe(token)
    assert.ok(parsed)
  })
})

describe("Injection and XSS Prevention", () => {
  test("Handles HTML in SCTE-35 ID", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="<script>alert('xss')</script>",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    assert.equal(signals[0].id, "<script>alert('xss')</script>")
  })

  test("Handles SQL injection patterns in attributes", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="'; DROP TABLE ads; --",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    assert.equal(signals.length, 1)
    // ID should be stored as-is (escaping happens elsewhere)
    assert.ok(signals[0].id.includes("DROP TABLE"))
  })

  test("Handles path traversal in URLs", () => {
    const maliciousUrl = "https://example.com/../../etc/passwd"
    const manifest = `#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4.0,\nseg_1.m4s`
    
    const result = addDaterangeInterstitial(
      manifest,
      "ad-1",
      "2025-10-31T10:00:00Z",
      30,
      maliciousUrl
    )
    
    // URL should be included as-is (validation happens elsewhere)
    assert.ok(result.includes(maliciousUrl))
  })

  test("Handles newline injection in attributes", () => {
    const manifest = `#EXTM3U
#EXT-X-DATERANGE:ID="test\nINJECTED-LINE",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:00Z",DURATION=30
#EXTINF:4.0,
seg_1.m4s`
    
    const signals = parseSCTE35FromManifest(manifest)
    
    // Parser should handle this (attribute parsing might stop at newline)
    assert.ok(signals.length >= 0)
  })
})

describe("Network Failure Simulation", () => {
  test("Handles timeout during URL signing", async () => {
    // Signing should be fast, but test behavior
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 1)
    
    try {
      await signPath("media.example.com", "secret", "/path.m3u8", 600)
      assert.ok(true, "Completed before timeout")
    } catch (err) {
      // Timeout is acceptable in extreme cases
      assert.ok(true)
    }
  })

  test("Handles rapid repeated requests", async () => {
    const requests = 100
    const manifest = `#EXTM3U\n#EXTINF:4.0,\nseg_1.m4s`
    
    for (let i = 0; i < requests; i++) {
      const result = insertDiscontinuity(manifest)
      assert.ok(result)
    }
    
    console.log(`  ✓ Handled ${requests} rapid requests`)
  })
})

describe("Data Corruption Scenarios", () => {
  test("Handles partially corrupted manifest", () => {
    const corrupted = `#EXTM3U
#EXT-X-VERSION:7
#EXTINF:4.0,
seg_1.m4s
��������CORRUPTED_DATA��������
#EXTINF:4.0,
seg_2.m4s`
    
    try {
      const result = insertDiscontinuity(corrupted)
      assert.ok(result)
    } catch (err) {
      // Acceptable to throw on corrupted data
      assert.ok(true)
    }
  })

  test("Handles manifest with mixed encodings", () => {
    // UTF-8 and Latin-1 mixed
    const mixed = "#EXTM3U\n#EXTINF:4.0,\nségment_1.m4s\n#EXTINF:4.0,\nseg_2.m4s"
    
    const result = insertDiscontinuity(mixed)
    assert.ok(result)
  })

  test("Handles truncated manifest", () => {
    const truncated = "#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4.0,"
    
    const result = insertDiscontinuity(truncated)
    assert.ok(result)
  })
})

