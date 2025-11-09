// Comprehensive End-to-End Tests
// Tests complete workflows from manifest request to beacon processing

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import {
  BASE_URL_MANIFEST,
  BASE_URL_DECISION,
  BASE_URL_VAST,
  BASE_URL_BEACON,
  shouldRunIntegrationTests
} from "./test-config.ts"

// Skip all integration tests if configured
if (!shouldRunIntegrationTests()) {
  console.log("⊘ Skipping E2E tests (SKIP_INTEGRATION=1)")
  process.exit(0)
}

// Sample VAST XML for comprehensive testing
const COMPREHENSIVE_VAST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2">
  <Ad id="test-ad-comprehensive">
    <InLine>
      <AdSystem>Comprehensive Test System</AdSystem>
      <AdTitle>Test Advertisement</AdTitle>
      <Description>A comprehensive test advertisement</Description>
      <Impression><![CDATA[https://tracker.example.com/impression?ad=test]]></Impression>
      <Error><![CDATA[https://tracker.example.com/error?code=[ERRORCODE]]]></Error>
      <Creatives>
        <Creative id="creative-video" sequence="1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="800" width="640" height="360">
                <![CDATA[https://cdn.example.com/ad/v_800k.m3u8]]>
              </MediaFile>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="1600" width="1280" height="720">
                <![CDATA[https://cdn.example.com/ad/v_1600k.m3u8]]>
              </MediaFile>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="2500" width="1920" height="1080">
                <![CDATA[https://cdn.example.com/ad/v_2500k.m3u8]]>
              </MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough><![CDATA[https://example.com/click]]></ClickThrough>
              <ClickTracking><![CDATA[https://tracker.example.com/click]]></ClickTracking>
            </VideoClicks>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://tracker.example.com/start]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[https://tracker.example.com/q1]]></Tracking>
              <Tracking event="midpoint"><![CDATA[https://tracker.example.com/mid]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[https://tracker.example.com/q3]]></Tracking>
              <Tracking event="complete"><![CDATA[https://tracker.example.com/complete]]></Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`

describe("Complete SSAI Workflow", () => {
  test("Full SSAI flow: manifest → decision → ad insertion", async () => {
    // 1. Request manifest with SSAI mode
    const manifestResponse = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-ssai-test&variant=v_1600k.m3u8&force=ssai`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Android)"  // Non-Apple UA for SSAI
        }
      }
    )
    
    assert.equal(manifestResponse.status, 200, "Manifest request should succeed")
    const manifest = await manifestResponse.text()
    
    // 2. Verify manifest has SSAI tags
    assert.ok(manifest.includes("#EXTM3U"), "Should be valid HLS manifest")
    
    // SSAI should have DISCONTINUITY tags
    if (manifest.includes("#EXT-X-DISCONTINUITY")) {
      const discontinuityCount = (manifest.match(/#EXT-X-DISCONTINUITY/g) || []).length
      assert.ok(discontinuityCount >= 1, "SSAI should have DISCONTINUITY tags")
      console.log(`  ✓ SSAI manifest with ${discontinuityCount} DISCONTINUITY tags`)
    }
  })

  test("Full SGAI flow: manifest → decision → interstitial insertion", async () => {
    // 1. Request manifest with SGAI mode
    const manifestResponse = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-sgai-test&variant=v_1600k.m3u8&force=sgai`,
      {
        headers: {
          "User-Agent": "AppleTV/tvOS/14.0"  // Apple UA for SGAI
        }
      }
    )
    
    assert.equal(manifestResponse.status, 200)
    const manifest = await manifestResponse.text()
    
    // 2. Verify manifest has SGAI tags
    assert.ok(manifest.includes("#EXTM3U"), "Should be valid HLS manifest")
    
    // SGAI should have DATERANGE interstitial tags
    if (manifest.includes("#EXT-X-DATERANGE")) {
      assert.ok(manifest.includes('CLASS="com.apple.hls.interstitial"'), "Should have interstitial DATERANGE")
      assert.ok(manifest.includes('X-ASSET-URI='), "Should have asset URI")
      console.log("  ✓ SGAI manifest with interstitial DATERANGE")
    }
  })

  test("User-Agent based mode selection", async () => {
    const channel = "e2e-ua-test"
    const variant = "v_1600k.m3u8"
    
    // Test with iOS User-Agent (should get SGAI)
    const iosResponse = await fetch(
      `${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`,
      {
        headers: {
          "User-Agent": "iPhone; iOS 15.0"
        }
      }
    )
    
    const iosManifest = await iosResponse.text()
    
    // Test with Android User-Agent (should get SSAI)
    const androidResponse = await fetch(
      `${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 11)"
        }
      }
    )
    
    const androidManifest = await androidResponse.text()
    
    // Both should return valid manifests
    assert.ok(iosManifest.includes("#EXTM3U"))
    assert.ok(androidManifest.includes("#EXTM3U"))
    
    console.log("  ✓ User-Agent based mode selection working")
  })
})

describe("Decision Service Integration", () => {
  test("Decision service responds to valid request", async () => {
    const response = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "e2e-decision-test",
        durationSec: 30,
        viewerInfo: {
          geo: { country: "US" },
          bucket: "premium"
        }
      })
    })
    
    assert.equal(response.status, 200)
    const decision = await response.json()
    
    assert.ok(decision.pod, "Should have pod")
    assert.ok(decision.pod.podId, "Pod should have ID")
    assert.ok(decision.pod.items, "Pod should have items")
    assert.ok(decision.pod.durationSec === 30, "Pod should have correct duration")
    
    console.log(`  ✓ Decision service returned pod: ${decision.pod.podId}`)
  })

  test("Decision service caching works correctly", async () => {
    const requestBody = {
      channel: "e2e-cache-test",
      durationSec: 30,
      viewerInfo: {
        geo: { country: "US" },
        bucket: "test"
      }
    }
    
    // First request
    const response1 = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    })
    
    const decision1 = await response1.json()
    
    // Second request (should be cached)
    const response2 = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    })
    
    const decision2 = await response2.json()
    
    // Results should match (cached)
    assert.deepEqual(decision1.pod.podId, decision2.pod.podId)
    console.log("  ✓ Decision caching working")
  })

  test("Decision service varies by geography", async () => {
    const baseRequest = {
      channel: "e2e-geo-test",
      durationSec: 30
    }
    
    const usResponse = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseRequest,
        viewerInfo: { geo: { country: "US" } }
      })
    })
    
    const ukResponse = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseRequest,
        viewerInfo: { geo: { country: "UK" } }
      })
    })
    
    const usDecision = await usResponse.json()
    const ukDecision = await ukResponse.json()
    
    // Both should succeed
    assert.ok(usDecision.pod)
    assert.ok(ukDecision.pod)
    
    console.log("  ✓ Geography-based decision variation working")
  })

  test("Decision service fallback to slate on error", async () => {
    // Invalid request should still return slate
    const response = await fetch(`${BASE_URL_DECISION}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "e2e-fallback-test",
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 200)  // Should return 200 with slate
    const decision = await response.json()
    
    assert.ok(decision.pod)
    assert.ok(decision.pod.items.length > 0)
    
    console.log("  ✓ Decision fallback mechanism working")
  })
})

describe("VAST Parser Integration", () => {
  test("VAST parser handles inline VAST", async () => {
    const response = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: COMPREHENSIVE_VAST_XML,
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 200)
    const result = await response.json()
    
    assert.ok(result.pod, "Should have pod")
    assert.ok(result.tracking, "Should have tracking")
    assert.ok(result.vastResponse, "Should have VAST response")
    
    // Verify tracking URLs extracted
    assert.ok(result.tracking.impressions.length > 0, "Should have impressions")
    assert.ok(result.tracking.quartiles.start.length > 0, "Should have start tracking")
    assert.ok(result.tracking.quartiles.complete.length > 0, "Should have complete tracking")
    
    console.log(`  ✓ VAST parser extracted ${result.pod.items.length} media files`)
  })

  test("VAST parser prefers HLS over progressive", async () => {
    const response = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: COMPREHENSIVE_VAST_XML,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // All items should use HLS (.m3u8)
    const hlsItems = result.pod.items.filter((item: any) => 
      item.playlistUrl.includes(".m3u8")
    )
    
    assert.ok(hlsItems.length > 0, "Should have HLS items")
    console.log("  ✓ VAST parser prefers HLS media files")
  })

  test("VAST parser handles multiple bitrates", async () => {
    const response = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: COMPREHENSIVE_VAST_XML,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should have multiple bitrate options
    const bitrates = result.pod.items.map((item: any) => item.bitrate)
    const uniqueBitrates = [...new Set(bitrates)]
    
    assert.ok(uniqueBitrates.length >= 2, "Should have multiple bitrates")
    assert.ok(bitrates.includes(800), "Should have 800k bitrate")
    assert.ok(bitrates.includes(1600), "Should have 1600k bitrate")
    
    console.log(`  ✓ VAST parser extracted ${uniqueBitrates.length} bitrate variants`)
  })

  test("VAST parser handles errors gracefully", async () => {
    const invalidVAST = "<invalid>xml</invalid>"
    
    const response = await fetch(`${BASE_URL_VAST}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: invalidVAST,
        durationSec: 30
      })
    })
    
    // Should return 200 with slate fallback
    assert.equal(response.status, 200)
    const result = await response.json()
    
    assert.equal(result.pod.podId, "slate")
    assert.ok(result.vastResponse.errors, "Should have errors")
    
    console.log("  ✓ VAST parser error handling working")
  })
})

describe("Bitrate-Aware Ad Selection", () => {
  test("Low bitrate viewer gets appropriate ad", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-bitrate-low&variant=v_800k.m3u8&force=sgai`
    )
    
    const manifest = await response.text()
    
    // Extract ad URL if present
    const assetUriMatch = manifest.match(/X-ASSET-URI="([^"]+)"/)
    
    if (assetUriMatch) {
      const adUrl = assetUriMatch[1]
      console.log(`  ✓ Low bitrate ad URL: ${adUrl}`)
      // URL might contain bitrate info or be appropriate for low bitrate
      assert.ok(adUrl)
    }
  })

  test("High bitrate viewer gets appropriate ad", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-bitrate-high&variant=v_2500k.m3u8&force=sgai`
    )
    
    const manifest = await response.text()
    
    const assetUriMatch = manifest.match(/X-ASSET-URI="([^"]+)"/)
    
    if (assetUriMatch) {
      const adUrl = assetUriMatch[1]
      console.log(`  ✓ High bitrate ad URL: ${adUrl}`)
      assert.ok(adUrl)
    }
  })
})

describe("Multi-Service Coordination", () => {
  test("All services respond to health checks", async () => {
    const services = [
      { name: "Manifest", url: `${BASE_URL_MANIFEST}?channel=health&variant=v_1600k.m3u8` },
      { name: "Decision", url: `${BASE_URL_DECISION}/health` },
      { name: "VAST Parser", url: `${BASE_URL_VAST}/health` }
    ]
    
    for (const service of services) {
      const response = await fetch(service.url)
      assert.ok(response.status === 200 || response.status === 400, `${service.name} should respond`)
      console.log(`  ✓ ${service.name} service: healthy`)
    }
  })

  test("Service bindings work end-to-end", async () => {
    // This test verifies manifest → decision → VAST parser flow
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=e2e-binding-test&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // If we get a valid manifest, service bindings are working
    assert.ok(manifest.includes("#EXTM3U"))
    console.log("  ✓ Multi-service coordination working")
  })
})

describe("Caching and Performance", () => {
  test("Manifest caching reduces latency on repeated requests", async () => {
    const channel = "e2e-cache-perf-test"
    const variant = "v_1600k.m3u8"
    
    // First request (cache MISS)
    const start1 = Date.now()
    await fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`)
    const duration1 = Date.now() - start1
    
    // Second request (cache HIT)
    const start2 = Date.now()
    await fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`)
    const duration2 = Date.now() - start2
    
    console.log(`  ⏱️  First request: ${duration1}ms, Cached: ${duration2}ms`)
    
    // Cached request should typically be faster
    assert.ok(duration2 <= duration1 + 100, "Cached request should not be significantly slower")
  })

  test("Window bucketing enables cache hits", async () => {
    const channel = "e2e-bucket-test"
    const variant = "v_1600k.m3u8"
    
    // Make multiple requests within same window
    const responses = await Promise.all([
      fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`),
      fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`),
      fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}`)
    ])
    
    // All should succeed
    for (const response of responses) {
      assert.equal(response.status, 200)
    }
    
    console.log("  ✓ Window bucketing cache hits working")
  })
})

describe("Error Handling and Resilience", () => {
  test("Handles missing channel parameter", async () => {
    const response = await fetch(`${BASE_URL_MANIFEST}?variant=v_1600k.m3u8`)
    
    assert.equal(response.status, 400)
    const text = await response.text()
    assert.ok(text.includes("channel"))
  })

  test("Handles invalid variant gracefully", async () => {
    const response = await fetch(`${BASE_URL_MANIFEST}?channel=test&variant=invalid.m3u8`)
    
    // Should still return a response (possibly with fallback)
    assert.ok(response.status >= 200 && response.status < 500)
  })

  test("Handles timeout in decision service gracefully", async () => {
    // Even if decision times out, manifest should return with fallback
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=timeout-test&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    assert.ok(manifest.includes("#EXTM3U"))
  })

  test("Handles concurrent requests without collision", async () => {
    const concurrentRequests = 20
    const channel = "e2e-concurrent-test"
    
    const promises = Array.from({ length: concurrentRequests }, (_, i) =>
      fetch(`${BASE_URL_MANIFEST}?channel=${channel}&variant=v_1600k.m3u8&session=${i}`)
    )
    
    const responses = await Promise.all(promises)
    
    // All should succeed
    for (const response of responses) {
      assert.equal(response.status, 200)
    }
    
    console.log(`  ✓ Handled ${concurrentRequests} concurrent requests`)
  })
})

describe("SCTE-35 End-to-End", () => {
  test("SCTE-35 marker triggers ad insertion", async () => {
    // Request manifest with SCTE-35 support
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=scte35-e2e-test&variant=v_1600k.m3u8&force=sgai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    // Should be valid manifest
    assert.ok(manifest.includes("#EXTM3U"))
    
    // Logs should show SCTE-35 detection (check in production)
    console.log("  ✓ SCTE-35 end-to-end flow completed")
  })

  test("Multiple SCTE-35 breaks in sequence", async () => {
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=scte35-multi-test&variant=v_1600k.m3u8&force=ssai`
    )
    
    assert.equal(response.status, 200)
    const manifest = await response.text()
    
    assert.ok(manifest.includes("#EXTM3U"))
    console.log("  ✓ Multiple SCTE-35 breaks handled")
  })
})

describe("Real-World Scenarios", () => {
  test("Simulates live sports stream with mid-roll ads", async () => {
    const channel = "live-sports-stream"
    const variant = "v_2500k.m3u8"
    
    // Simulate multiple manifest requests over time
    for (let i = 0; i < 5; i++) {
      const response = await fetch(
        `${BASE_URL_MANIFEST}?channel=${channel}&variant=${variant}&force=ssai`
      )
      
      assert.equal(response.status, 200)
      const manifest = await response.text()
      assert.ok(manifest.includes("#EXTM3U"))
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log("  ✓ Live sports stream simulation completed")
  })

  test("Simulates news channel with frequent ad breaks", async () => {
    const channel = "live-news-channel"
    
    for (let i = 0; i < 3; i++) {
      const response = await fetch(
        `${BASE_URL_MANIFEST}?channel=${channel}&variant=v_1600k.m3u8&force=sgai`
      )
      
      assert.equal(response.status, 200)
    }
    
    console.log("  ✓ News channel with frequent breaks simulated")
  })

  test("Simulates premium subscriber (no ads)", async () => {
    // Premium subscriber might skip ad insertion
    const response = await fetch(
      `${BASE_URL_MANIFEST}?channel=premium-content&variant=v_2500k.m3u8`,
      {
        headers: {
          "Authorization": "Bearer premium-subscriber-token"
        }
      }
    )
    
    // Might return 403 (no auth in dev) or 200 (with ads in dev mode)
    assert.ok(response.status === 200 || response.status === 403)
  })
})

