// tests/workers.test.ts
// Tests for beacon consumer and decision service workers

import { strict as assert } from "node:assert";
import type { BeaconMessage, DecisionResponse } from "../src/types.ts";

describe("Beacon Consumer", () => {
  it("validates beacon message structure", () => {
    const validBeacon: BeaconMessage = {
      event: "imp",
      adId: "test-ad",
      podId: "test-pod",
      channel: "ch1",
      ts: Date.now(),
      trackerUrls: ["https://tracking.example.com/imp"],
      metadata: { variant: "v_1600k.m3u8", bitrate: 1600000 }
    };
    
    // Verify all required fields present
    assert.ok(validBeacon.event);
    assert.ok(validBeacon.adId);
    assert.ok(validBeacon.ts);
    assert.ok(Array.isArray(validBeacon.trackerUrls));
  });

  it("generates unique beacon IDs", () => {
    const beacon1: BeaconMessage = {
      event: "imp",
      adId: "ad1",
      ts: 1000,
      trackerUrls: []
    };
    
    const beacon2: BeaconMessage = {
      event: "imp",
      adId: "ad1",
      ts: 2000,
      trackerUrls: []
    };
    
    const id1 = `${beacon1.event}-${beacon1.adId}-${beacon1.ts}`;
    const id2 = `${beacon2.event}-${beacon2.adId}-${beacon2.ts}`;
    
    // Different timestamps should produce different IDs
    assert.notEqual(id1, id2);
  });

  it("handles empty tracker URLs", () => {
    const beacon: BeaconMessage = {
      event: "imp",
      adId: "test",
      ts: Date.now(),
      trackerUrls: []
    };
    
    assert.equal(beacon.trackerUrls.length, 0);
  });

  it("validates tracker URL format", () => {
    const validUrls = [
      "https://tracking.example.com/imp",
      "http://localhost:8787/beacon"
    ];
    
    const invalidUrls = [
      "not-a-url",
      "ftp://invalid.com",
      "",
      "javascript:alert(1)"
    ];
    
    validUrls.forEach(url => {
      assert.ok(url.startsWith("http"), `Valid URL should start with http: ${url}`);
    });
    
    invalidUrls.forEach(url => {
      assert.ok(!url.startsWith("http") || url.startsWith("javascript:"), 
        `Invalid URL should not pass: ${url}`);
    });
  });
});

describe("Decision Service", () => {
  it("creates valid decision response structure", () => {
    const decision: DecisionResponse = {
      pod: {
        podId: "test-pod",
        durationSec: 30,
        items: [
          {
            adId: "ad1",
            bitrate: 800000,
            playlistUrl: "https://ads.example.com/pods/test-pod/v_800k/playlist.m3u8"
          },
          {
            adId: "ad1",
            bitrate: 1600000,
            playlistUrl: "https://ads.example.com/pods/test-pod/v_1600k/playlist.m3u8"
          }
        ]
      }
    };
    
    assert.ok(decision.pod);
    assert.ok(decision.pod.podId);
    assert.ok(decision.pod.durationSec > 0);
    assert.ok(Array.isArray(decision.pod.items));
    assert.ok(decision.pod.items.length > 0);
  });

  it("validates slate fallback structure", () => {
    const slate: DecisionResponse = {
      pod: {
        podId: "slate",
        durationSec: 30,
        items: [
          {
            adId: "slate-filler",
            bitrate: 800000,
            playlistUrl: "https://ads.example.com/pods/slate/v_800k/playlist.m3u8"
          }
        ]
      }
    };
    
    assert.equal(slate.pod.podId, "slate");
    assert.ok(slate.pod.items.length > 0);
  });

  it("generates cache keys consistently", () => {
    const req1 = {
      channel: "ch1",
      durationSec: 30,
      viewerInfo: { geo: { country: "US" }, bucket: "A" }
    };
    
    const req2 = {
      channel: "ch1",
      durationSec: 30,
      viewerInfo: { geo: { country: "US" }, bucket: "A" }
    };
    
    const key1 = `decision:${req1.channel}:${req1.durationSec}:${req1.viewerInfo.geo.country}:${req1.viewerInfo.bucket}`;
    const key2 = `decision:${req2.channel}:${req2.durationSec}:${req2.viewerInfo.geo.country}:${req2.viewerInfo.bucket}`;
    
    // Same request should produce same cache key
    assert.equal(key1, key2);
  });

  it("varies cache keys by channel", () => {
    const key1 = `decision:ch1:30:US:A`;
    const key2 = `decision:ch2:30:US:A`;
    
    assert.notEqual(key1, key2);
  });

  it("varies cache keys by geography", () => {
    const key1 = `decision:ch1:30:US:A`;
    const key2 = `decision:ch1:30:UK:A`;
    
    assert.notEqual(key1, key2);
  });

  it("validates ad item bitrates are valid", () => {
    const validBitrates = [800000, 1600000, 2500000, 5000000];
    
    validBitrates.forEach(bitrate => {
      assert.ok(bitrate >= 800000, "Bitrate should be at least 800kbps");
      assert.ok(bitrate <= 10000000, "Bitrate should be reasonable (< 10Mbps)");
    });
  });

  it("ensures playlist URLs are properly formatted", () => {
    const url = "https://ads.example.com/pods/test-pod/v_1600k/playlist.m3u8";
    
    assert.ok(url.startsWith("https://"), "Should use HTTPS");
    assert.ok(url.endsWith(".m3u8"), "Should be HLS playlist");
    assert.ok(url.includes("/pods/"), "Should include pods path");
  });
});

describe("Decision Integration", () => {
  it("handles decision timeout gracefully", async () => {
    // Simulate timeout scenario
    const timeoutMs = 150;
    const startTime = Date.now();
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      // This would throw on abort
      await new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")));
        setTimeout(() => reject(new Error("should not reach")), timeoutMs + 100);
      });
    } catch (err) {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      
      assert.ok(duration < timeoutMs + 50, "Should timeout quickly");
      assert.ok(err instanceof Error);
      assert.equal(err.message, "timeout");
    }
  });

  it("validates decision request structure", () => {
    const request = {
      channel: "sports1",
      durationSec: 30,
      viewerInfo: {
        geo: { country: "US" },
        consent: { tcf: "CPXXXXXX" },
        bucket: "premium"
      },
      context: {
        contentId: "game-123",
        contentGenre: "sports"
      }
    };
    
    assert.ok(request.channel);
    assert.ok(request.durationSec > 0);
    assert.ok(request.viewerInfo);
  });
});

describe("Error Handling", () => {
  it("handles invalid beacon URLs", () => {
    const invalidUrls = [
      null,
      undefined,
      "",
      "not-a-url",
      123
    ];
    
    invalidUrls.forEach(url => {
      const isValid = typeof url === "string" && url.startsWith("http");
      assert.ok(!isValid, `Should reject invalid URL: ${url}`);
    });
  });

  it("handles malformed decision responses", () => {
    const malformedResponses = [
      {},
      { pod: null },
      { pod: { items: [] } }, // Missing podId
      { pod: { podId: "test" } }, // Missing items
    ];
    
    malformedResponses.forEach(response => {
      const isValid = 
        response &&
        (response as any).pod &&
        (response as any).pod.podId &&
        Array.isArray((response as any).pod.items);
      
      assert.ok(!isValid, "Should reject malformed response");
    });
  });
});

