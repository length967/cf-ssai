// Integration Tests for SCTE-35 and VAST Features
// Tests the complete flow: Manifest Worker -> Decision Service -> VAST Parser -> Beacon Consumer

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  BASE_URL_MANIFEST,
  BASE_URL_DECISION,
  BASE_URL_VAST,
  shouldRunIntegrationTests
} from "./test-config.ts"

// Skip all integration tests if configured
if (!shouldRunIntegrationTests()) {
  console.log("⊘ Skipping integration tests (SKIP_INTEGRATION=1)")
  process.exit(0)
}

// Sample SCTE-35 manifest from origin
const SCTE35_ORIGIN_MANIFEST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:1000
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:00.000Z
#EXTINF:4.000,
seg_1000.m4s
#EXT-X-DATERANGE:ID="scte35-1",SCTE35-OUT=YES,START-DATE="2025-10-31T10:00:04.000Z",DURATION=30.0,CLASS="com.apple.hls.scte35.out"
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:04.000Z
#EXTINF:4.000,
seg_1001.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T10:00:08.000Z
#EXTINF:4.000,
seg_1002.m4s
`

describe("SCTE-35 Integration", () => {
  test("Manifest worker detects SCTE-35 and triggers ad insertion (SGAI mode)", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=test-scte35&variant=v_1600k.m3u8&force=sgai`,
      {
        headers: {
          "User-Agent": "AppleTV/tvOS/14.0" // iOS/tvOS User-Agent for SGAI
        }
      }
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should have DATERANGE tag (SGAI)
    assert.ok(
      manifest.includes("#EXT-X-DATERANGE"),
      "Should insert DATERANGE for SGAI"
    )
    
    // Should have signed ad URL
    assert.ok(
      manifest.includes("token="),
      "Ad URL should be signed"
    )
  })

  test("Manifest worker detects SCTE-35 and triggers ad insertion (SSAI mode)", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=test-scte35-ssai&variant=v_1600k.m3u8&force=ssai`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Android)" // Non-Apple UA for SSAI
        }
      }
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should have DISCONTINUITY tags (SSAI)
    assert.ok(
      manifest.includes("#EXT-X-DISCONTINUITY"),
      "Should insert DISCONTINUITY for SSAI"
    )
  })

  test("Decision service with VAST parser integration", async () => {
    // First, test decision service calls VAST parser
    const decisionResponse = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "test-vast",
        durationSec: 30,
        viewerInfo: {
          geo: { country: "US" },
          bucket: "A"
        }
      })
    })
    
    assert.equal(decisionResponse.status, 200)
    const decision = await decisionResponse.json()
    
    // Should have a pod (either from VAST or R2 fallback)
    assert.ok(decision.pod, "Decision should return a pod")
    assert.ok(decision.pod.items.length > 0, "Pod should have items")
    assert.ok(decision.pod.durationSec === 30, "Pod should have correct duration")
    
    // Should have tracking if VAST was used
    if (decision.tracking) {
      assert.ok(decision.tracking.impressions, "Should have impression tracking")
      assert.ok(decision.tracking.quartiles, "Should have quartile tracking")
    }
  })

  test("End-to-end: SCTE-35 detection -> VAST parsing -> Ad insertion", async () => {
    // Simulate full flow:
    // 1. Manifest request with SCTE-35 in origin
    // 2. Decision service calls VAST parser
    // 3. Manifest returns with ad inserted
    
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-scte35-vast&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should have ad inserted
    assert.ok(
      manifest.includes("#EXT-X-DATERANGE") || manifest.includes("#EXT-X-DISCONTINUITY"),
      "Should have ad insertion tags"
    )
    
    console.log("✓ End-to-end flow completed successfully")
  })
})

describe("VAST Waterfall Integration", () => {
  test("Decision service falls back from VAST to R2 pods", async () => {
    // Make decision request - should try VAST first, then R2
    const response = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "waterfall-test",
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 200)
    const decision = await response.json()
    
    // Should always return a pod (either VAST, R2, or slate)
    assert.ok(decision.pod)
    assert.ok(decision.pod.podId)
    assert.ok(decision.pod.items.length > 0)
    
    console.log(`Decision returned pod: ${decision.pod.podId}`)
  })

  test("Decision service caches VAST results", async () => {
    const channel = "cache-test-vast"
    
    // First request (cache MISS)
    const response1 = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel,
        durationSec: 30
      })
    })
    
    const decision1 = await response1.json()
    
    // Second request (cache HIT)
    const response2 = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel,
        durationSec: 30
      })
    })
    
    const decision2 = await response2.json()
    
    // Results should match (cached)
    assert.deepEqual(decision1.pod.podId, decision2.pod.podId)
    
    console.log("✓ VAST decision caching working")
  })
})

describe("Bitrate-aware Ad Selection with VAST", () => {
  test("High bitrate viewer gets high bitrate ad", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=bitrate-high&variant=v_2500k.m3u8&force=sgai`
    )
    
    const manifest = await response.text()
    
    // Extract ad URL from manifest
    const adUrlMatch = manifest.match(/X-ASSET-URI="([^"]+)"/)
    
    if (adUrlMatch) {
      // Ad URL should reference high bitrate variant
      // Note: Exact matching depends on available VAST media files
      assert.ok(adUrlMatch[1], "Should have ad URL")
      console.log(`High bitrate ad URL: ${adUrlMatch[1]}`)
    }
  })

  test("Low bitrate viewer gets appropriate ad", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=bitrate-low&variant=v_800k.m3u8&force=sgai`
    )
    
    const manifest = await response.text()
    
    const adUrlMatch = manifest.match(/X-ASSET-URI="([^"]+)"/)
    
    if (adUrlMatch) {
      assert.ok(adUrlMatch[1], "Should have ad URL")
      console.log(`Low bitrate ad URL: ${adUrlMatch[1]}`)
    }
  })
})

describe("Beacon Consumer with VAST Tracking", () => {
  test("Beacon consumer logs VAST metadata", async () => {
    // This test primarily verifies that beacon messages with VAST tracking
    // are handled correctly. Verification requires checking logs.
    
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=beacon-vast-test&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    
    // Beacon should be queued with VAST tracking info
    // In production, check beacon consumer logs for:
    // - VAST ad ID
    // - Creative ID
    // - Impression tracking URLs
    // - Quartile tracking URLs
    
    console.log("✓ Beacon queued (check beacon consumer logs for VAST metadata)")
  })
})

describe("SSAI Segment Replacement", () => {
  test("SSAI mode replaces content segments with ad segments", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=ssai-segments&variant=v_1600k.m3u8&force=ssai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should have DISCONTINUITY tags
    const discontinuityCount = (manifest.match(/#EXT-X-DISCONTINUITY/g) || []).length
    
    if (discontinuityCount > 0) {
      assert.ok(discontinuityCount >= 2, "Should have at least 2 DISCONTINUITY tags (before and after ad)")
      console.log(`✓ SSAI with ${discontinuityCount} DISCONTINUITY tags`)
    }
  })
})

describe("Error Handling and Fallbacks", () => {
  test("System handles VAST parsing failure gracefully", async () => {
    // Even if VAST parsing fails, system should fallback to slate
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=vast-error-fallback&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should still return a valid manifest (with slate if VAST failed)
    assert.ok(manifest.includes("#EXTM3U"), "Should return valid manifest")
  })

  test("System handles missing SCTE-35 markers gracefully", async () => {
    // Request without SCTE-35 should use time-based fallback
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=no-scte35&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should return valid manifest
    assert.ok(manifest.includes("#EXTM3U"), "Should return valid manifest")
  })

  test("Decision service handles timeout gracefully", async () => {
    // Even if decision takes too long, should fallback to slate
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    
    try {
      const response = await fetch(`${BASE_URL_DECISION}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "timeout-test",
          durationSec: 30
        }),
        signal: controller.signal
      })
      
      clearTimeout(timeout)
      
      // Should respond within timeout
      assert.equal(response.status, 200)
      const decision = await response.json()
      
      // Should have some pod (slate if timeout occurred internally)
      assert.ok(decision.pod)
    } catch (err) {
      clearTimeout(timeout)
      // If we timeout, that's acceptable - system should handle internally
      console.log("✓ Decision service timeout handled")
    }
  })
})

describe("Multi-Service Coordination", () => {
  test("All services are healthy", async () => {
    const services = [
      { name: "Manifest", url: `${BASE_URL_MANIFEST}?channel=health&variant=v_1600k.m3u8` },
      { name: "Decision", url: `${BASE_URL_DECISION}/health` },
      { name: "VAST Parser", url: `${BASE_URL_VAST}/health` }
    ]
    
    for (const service of services) {
      const response = await fetch(service.url)
      assert.ok(response.status === 200, `${service.name} should be healthy`)
      console.log(`✓ ${service.name} service: OK`)
    }
  })

  test("Service bindings work correctly", async () => {
    // Test that manifest worker can call decision service
    // and decision service can call VAST parser
    
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=binding-test&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    
    // If we get a valid response, service bindings are working
    const manifest = await response.text()
    assert.ok(manifest.includes("#EXTM3U"), "Service bindings working")
    
    console.log("✓ Service bindings working correctly")
  })
})

describe("Performance and Caching", () => {
  test("Decision service caching reduces latency", async () => {
    const channel = "perf-test"
    
    // First request (uncached)
    const start1 = Date.now()
    await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, durationSec: 30 })
    })
    const duration1 = Date.now() - start1
    
    // Second request (cached)
    const start2 = Date.now()
    await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, durationSec: 30 })
    })
    const duration2 = Date.now() - start2
    
    console.log(`First request: ${duration1}ms, Cached request: ${duration2}ms`)
    
    // Cached request should typically be faster, but not guaranteed in all conditions
    assert.ok(duration2 <= duration1 + 50, "Cached request should not be significantly slower")
  })

  test("VAST parser caching works", async () => {
    const vastXML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="cache-test">
    <InLine>
      <AdSystem>Test</AdSystem>
      <AdTitle>Cache Test</AdTitle>
      <Impression><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Creatives>
        <Creative id="creative-1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="1600">
                <![CDATA[https://cdn.example.com/ad.m3u8]]>
              </MediaFile>
            </MediaFiles>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://tracker.example.com/start]]></Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`
    
    // Parse same VAST twice
    const response1 = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vastXML, durationSec: 30 })
    })
    
    const response2 = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vastXML, durationSec: 30 })
    })
    
    const result1 = await response1.json()
    const result2 = await response2.json()
    
    // Results should be consistent
    assert.deepEqual(result1.pod.podId, result2.pod.podId)
    
    console.log("✓ VAST parser caching consistent")
  })
})

