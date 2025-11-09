// VAST Parser Worker Tests
// These are integration tests that require the VAST parser worker to be running

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import { BASE_URL_VAST as VAST_PARSER_URL, shouldRunIntegrationTests } from "./test-config.ts"

// Skip all integration tests if configured
if (!shouldRunIntegrationTests()) {
  console.log("⊘ Skipping VAST integration tests (SKIP_INTEGRATION=1)")
  process.exit(0)
}

// Sample VAST 3.0 XML for testing
const SAMPLE_VAST_3_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="test-ad-1">
    <InLine>
      <AdSystem>Test Ad Server</AdSystem>
      <AdTitle>Test Advertisement</AdTitle>
      <Impression><![CDATA[https://tracker.example.com/impression?id=123]]></Impression>
      <Creatives>
        <Creative id="creative-1" sequence="1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="1600" width="1920" height="1080">
                <![CDATA[https://cdn.example.com/ad1/playlist.m3u8]]>
              </MediaFile>
              <MediaFile delivery="progressive" type="video/mp4" bitrate="800" width="1280" height="720">
                <![CDATA[https://cdn.example.com/ad1/video_800k.mp4]]>
              </MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough><![CDATA[https://example.com/click]]></ClickThrough>
              <ClickTracking><![CDATA[https://tracker.example.com/click?id=123]]></ClickTracking>
            </VideoClicks>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://tracker.example.com/start?id=123]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[https://tracker.example.com/q1?id=123]]></Tracking>
              <Tracking event="midpoint"><![CDATA[https://tracker.example.com/mid?id=123]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[https://tracker.example.com/q3?id=123]]></Tracking>
              <Tracking event="complete"><![CDATA[https://tracker.example.com/complete?id=123]]></Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`

// Sample VAST 4.2 XML with wrapper
const SAMPLE_VAST_4_WRAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2">
  <Ad id="wrapper-ad">
    <Wrapper>
      <AdSystem>Test Wrapper</AdSystem>
      <VASTAdTagURI><![CDATA[https://example.com/vast-inline.xml]]></VASTAdTagURI>
      <Impression><![CDATA[https://wrapper-tracker.example.com/impression]]></Impression>
      <Error><![CDATA[https://wrapper-tracker.example.com/error]]></Error>
    </Wrapper>
  </Ad>
</VAST>`

describe("VAST Parser Worker", () => {
  test("Health check", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/health`)
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.equal(text, "ok")
  })

  test("Parse VAST 3.0 XML directly", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: SAMPLE_VAST_3_XML,
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 200)
    const result = await response.json()
    
    // Verify pod structure
    assert.ok(result.pod, "Should return a pod")
    assert.equal(result.pod.durationSec, 30)
    assert.ok(result.pod.items.length > 0, "Pod should have items")
    
    // Verify tracking
    assert.ok(result.tracking, "Should return tracking")
    assert.ok(result.tracking.impressions.length > 0, "Should have impressions")
    assert.ok(result.tracking.quartiles.start.length > 0, "Should have start tracking")
    assert.ok(result.tracking.quartiles.complete.length > 0, "Should have complete tracking")
    
    // Verify VAST response
    assert.ok(result.vastResponse, "Should return VAST response")
    assert.equal(result.vastResponse.version, "3.0")
    assert.ok(result.vastResponse.ads.length > 0, "Should have ads")
  })

  test("Parse VAST with media file preference (HLS over MP4)", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: SAMPLE_VAST_3_XML,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should prefer HLS streaming over progressive MP4
    const hlsItems = result.pod.items.filter((item: any) => 
      item.playlistUrl.includes("playlist.m3u8")
    )
    
    assert.ok(hlsItems.length > 0, "Should prefer HLS media files")
  })

  test("Extract tracking URLs correctly", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: SAMPLE_VAST_3_XML,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Verify impression tracking
    assert.ok(
      result.tracking.impressions.some((url: string) => url.includes("impression")),
      "Should extract impression URLs"
    )
    
    // Verify quartile tracking
    assert.ok(
      result.tracking.quartiles.start.some((url: string) => url.includes("start")),
      "Should extract start tracking"
    )
    assert.ok(
      result.tracking.quartiles.midpoint.some((url: string) => url.includes("mid")),
      "Should extract midpoint tracking"
    )
    
    // Verify click tracking
    assert.ok(result.tracking.clicks, "Should have click tracking")
    assert.ok(
      result.tracking.clicks.some((url: string) => url.includes("click")),
      "Should extract click URLs"
    )
  })

  test("Handle invalid VAST XML gracefully", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: "<invalid>xml</invalid>",
        durationSec: 30
      })
    })
    
    // Should return 200 with slate fallback
    assert.equal(response.status, 200)
    const result = await response.json()
    
    // Should fallback to slate
    assert.equal(result.pod.podId, "slate")
    assert.ok(result.vastResponse.errors, "Should have errors")
  })

  test("Handle missing vastUrl and vastXML", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 400)
    const result = await response.json()
    assert.ok(result.error, "Should return error message")
  })

  test("Parse VAST with multiple creatives", async () => {
    const multiCreativeVAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="multi-ad">
    <InLine>
      <AdSystem>Test</AdSystem>
      <AdTitle>Multi Creative</AdTitle>
      <Impression><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Creatives>
        <Creative id="creative-1" sequence="1">
          <Linear>
            <Duration>00:00:15</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="1600">
                <![CDATA[https://cdn.example.com/ad1.m3u8]]>
              </MediaFile>
            </MediaFiles>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://tracker.example.com/start1]]></Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
        <Creative id="creative-2" sequence="2">
          <Linear>
            <Duration>00:00:15</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="800">
                <![CDATA[https://cdn.example.com/ad2.m3u8]]>
              </MediaFile>
            </MediaFiles>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://tracker.example.com/start2]]></Tracking>
            </TrackingEvents>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`
    
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: multiCreativeVAST,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should have media files from multiple creatives
    assert.ok(result.pod.items.length >= 2, "Should have items from multiple creatives")
    
    // Should have tracking from all creatives
    assert.ok(
      result.tracking.quartiles.start.length >= 2,
      "Should have tracking from all creatives"
    )
  })

  test("Parse VAST with different bitrates", async () => {
    const multiBitrateVAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="bitrate-ad">
    <InLine>
      <AdSystem>Test</AdSystem>
      <AdTitle>Bitrate Test</AdTitle>
      <Impression><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Creatives>
        <Creative id="creative-1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="800">
                <![CDATA[https://cdn.example.com/ad_800k.m3u8]]>
              </MediaFile>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="1600">
                <![CDATA[https://cdn.example.com/ad_1600k.m3u8]]>
              </MediaFile>
              <MediaFile delivery="streaming" type="application/vnd.apple.mpegurl" bitrate="2500">
                <![CDATA[https://cdn.example.com/ad_2500k.m3u8]]>
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
    
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: multiBitrateVAST,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should have multiple bitrate options
    const bitrates = result.pod.items.map((item: any) => item.bitrate)
    assert.ok(bitrates.includes(800), "Should have 800k bitrate")
    assert.ok(bitrates.includes(1600), "Should have 1600k bitrate")
    assert.ok(bitrates.includes(2500), "Should have 2500k bitrate")
  })

  test("Handle VAST with error tracking URLs", async () => {
    const errorTrackingVAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="error-ad">
    <InLine>
      <AdSystem>Test</AdSystem>
      <AdTitle>Error Test</AdTitle>
      <Error><![CDATA[https://tracker.example.com/error?code=[ERRORCODE]]]></Error>
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
    
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: errorTrackingVAST,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should have error tracking URLs
    assert.ok(result.tracking.errors, "Should have error tracking")
    assert.ok(
      result.tracking.errors.some((url: string) => url.includes("error")),
      "Should extract error tracking URLs"
    )
  })
})

describe("VAST Parser Edge Cases", () => {
  test("Handle empty VAST (no ads)", async () => {
    const emptyVAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
</VAST>`
    
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: emptyVAST,
        durationSec: 30
      })
    })
    
    assert.equal(response.status, 200)
    const result = await response.json()
    
    // Should fallback to slate
    assert.equal(result.pod.podId, "slate")
  })

  test("Handle VAST with no media files", async () => {
    const noMediaVAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="no-media-ad">
    <InLine>
      <AdSystem>Test</AdSystem>
      <AdTitle>No Media</AdTitle>
      <Impression><![CDATA[https://tracker.example.com/imp]]></Impression>
      <Creatives>
        <Creative id="creative-1">
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`
    
    const response = await fetch(`${VAST_PARSER_URL}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastXML: noMediaVAST,
        durationSec: 30
      })
    })
    
    const result = await response.json()
    
    // Should fallback to slate when no media files found
    assert.equal(result.pod.podId, "slate")
  })

  test("Unknown endpoint returns 404", async () => {
    const response = await fetch(`${VAST_PARSER_URL}/unknown`)
    assert.equal(response.status, 404)
  })
})

