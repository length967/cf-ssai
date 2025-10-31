# SCTE-35 and VAST Implementation Guide

## 🎯 **Overview**

This guide covers the newly implemented **SCTE-35 marker detection** and **VAST XML parsing** features for the Cloudflare SSAI/SGAI system.

### **What's New**

✅ **SCTE-35 Support**: Automatically detect ad break markers in live HLS streams  
✅ **VAST Parsing**: Parse VAST 3.0/4.2 XML for dynamic creative insertion  
✅ **Wrapper Resolution**: Support for VAST wrapper chains (up to 5 levels)  
✅ **True SSAI**: Replace content segments with ad segments at SCTE-35 markers  
✅ **Bitrate-aware Selection**: Match ad quality to viewer's stream bitrate  
✅ **Comprehensive Tracking**: Extract and fire all VAST tracking pixels (impressions, quartiles, errors)  

---

## 📋 **Table of Contents**

1. [SCTE-35 Marker Detection](#scte-35-marker-detection)
2. [VAST Parser Service](#vast-parser-service)
3. [Integration Architecture](#integration-architecture)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## 🔍 **SCTE-35 Marker Detection**

### **What is SCTE-35?**

SCTE-35 is the industry standard for cueing ad insertion in live video streams. It uses special markers embedded in HLS manifests to indicate when ad breaks should occur.

### **How It Works**

1. **Origin Manifest Parsing**: The system parses incoming HLS manifests for SCTE-35 markers in `#EXT-X-DATERANGE` tags
2. **Break Detection**: Identifies ad break start/end signals and extracts metadata (duration, type, UPID)
3. **Ad Decision**: Triggers ad decision service when a break is detected
4. **Ad Insertion**: Inserts ads at the exact position indicated by the SCTE-35 marker

### **Supported SCTE-35 Formats**

#### **Apple HLS SCTE-35 Format**
```
#EXT-X-DATERANGE:ID="splice-1",CLASS="com.apple.hls.scte35.out",START-DATE="2025-10-31T10:00:00Z",DURATION=30.0,SCTE35-OUT=YES
```

#### **Generic SCTE-35 Format**
```
#EXT-X-DATERANGE:ID="ad-1",START-DATE="2025-10-31T10:00:00Z",DURATION=30,X-SEGMENTATION-TYPE="provider_ad",X-BREAK-DURATION=30.0
```

### **Key Features**

- **Signal Types**: Supports `splice_insert`, `time_signal`, and `return_signal`
- **Segmentation Types**: Provider Ad, Distributor Ad, Program Start/End, Chapter Start, Break Start/End
- **UPID Support**: Extracts Unique Program Identifiers for content targeting
- **Multi-segment Pods**: Handles segmented ad pods with `X-SEGMENT-NUM` and `X-SEGMENTS-EXPECTED`
- **Auto-return**: Respects `X-AUTO-RETURN` flag for automatic content resumption

### **Implementation Files**

- **`src/utils/scte35.ts`**: SCTE-35 parser utility functions
- **`src/channel-do.ts`**: Integration into channel Durable Object
- **`tests/scte35.test.ts`**: Comprehensive unit tests

---

## 🎬 **VAST Parser Service**

### **What is VAST?**

VAST (Video Ad Serving Template) is the industry standard XML format for serving video ads. It provides:
- Ad creative media files (video URLs)
- Tracking pixels (impressions, quartiles, clicks, errors)
- Wrapper chains for programmatic ad serving
- Companion banners and interactive elements

### **Architecture**

The VAST parser is a **dedicated Cloudflare Worker** (`vast-parser-worker.ts`) with:

```
┌─────────────────────────────────────┐
│   VAST Parser Worker (Port 8790)   │
├─────────────────────────────────────┤
│ • Parse VAST 3.0 & 4.2 XML         │
│ • Resolve wrapper chains (5 levels)│
│ • Extract media files (HLS/MP4)    │
│ • Extract tracking URLs            │
│ • Cache parsed results (KV)        │
│ • Fallback to slate on error       │
└─────────────────────────────────────┘
         ▲
         │ Service Binding
         │
┌─────────────────────────────────────┐
│  Decision Service (Port 8788)       │
│  Calls VAST parser for dynamic ads  │
└─────────────────────────────────────┘
```

### **Supported VAST Features**

#### **VAST Versions**
- ✅ VAST 3.0 (most common)
- ✅ VAST 4.0, 4.1, 4.2 (latest standards)

#### **Media Files**
- ✅ HLS streaming (`application/vnd.apple.mpegurl`)
- ✅ Progressive MP4 (`video/mp4`)
- ✅ Multiple bitrates (800k, 1600k, 2500k+)
- ✅ Bitrate-aware selection

#### **Tracking Events**
- ✅ Impressions
- ✅ Start, First Quartile, Midpoint, Third Quartile, Complete
- ✅ Mute, Unmute, Pause, Resume, Rewind, Skip
- ✅ Player Expand/Collapse
- ✅ Click-through URLs
- ✅ Error tracking

#### **Advanced Features**
- ✅ Wrapper resolution (nested VAST tags)
- ✅ Waterfall fallbacks
- ✅ Creative sequencing
- ✅ Multi-creative ads
- ✅ Companion banners (parsing only, not rendering)

### **VAST Parser API**

#### **Endpoint**: `POST /parse`

**Request**:
```json
{
  "vastUrl": "https://adserver.example.com/vast.xml",
  "vastXML": "<VAST>...</VAST>",  // Alternative to vastUrl
  "durationSec": 30,
  "maxWrapperDepth": 5
}
```

**Response**:
```json
{
  "pod": {
    "podId": "vast-ad-123",
    "durationSec": 30,
    "items": [
      {
        "adId": "vast-ad-123",
        "bitrate": 800000,
        "playlistUrl": "https://cdn.example.com/ad/800k/playlist.m3u8"
      },
      {
        "adId": "vast-ad-123",
        "bitrate": 1600000,
        "playlistUrl": "https://cdn.example.com/ad/1600k/playlist.m3u8"
      }
    ]
  },
  "tracking": {
    "impressions": ["https://tracker.example.com/imp?id=123"],
    "quartiles": {
      "start": ["https://tracker.example.com/start?id=123"],
      "firstQuartile": ["https://tracker.example.com/q1?id=123"],
      "midpoint": ["https://tracker.example.com/mid?id=123"],
      "thirdQuartile": ["https://tracker.example.com/q3?id=123"],
      "complete": ["https://tracker.example.com/complete?id=123"]
    },
    "clicks": ["https://tracker.example.com/click?id=123"],
    "errors": ["https://tracker.example.com/error?code=[ERRORCODE]"]
  },
  "vastResponse": {
    "ads": [...],
    "version": "3.0"
  }
}
```

### **Caching Strategy**

1. **VAST XML Cache (R2)**:
   - Stores fetched VAST XML for 5 minutes
   - Reduces external ad server load
   - Key: `vast-xml-${hash(url)}`

2. **Parsed Result Cache (KV)**:
   - Stores parsed ad pod + tracking for 5 minutes
   - Avoids re-parsing identical VAST
   - Key: `vast-parsed-${hash(url)}`

### **Error Handling**

The VAST parser **never fails hard**. On any error, it:
1. Logs the error for debugging
2. Returns a **slate fallback** ad pod
3. Returns HTTP 200 (with slate) instead of 500

This ensures the ad experience never breaks the viewer experience.

---

## 🏗️ **Integration Architecture**

### **Complete Flow Diagram**

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        1. Viewer Request                                     │
│  Viewer → Manifest Worker (manifest-worker.ts)                              │
│           GET /?channel=sports&variant=v_1600k.m3u8                          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   2. Fetch Origin Manifest                                   │
│  Manifest Worker → Origin Server                                             │
│           Receives HLS manifest with SCTE-35 markers                         │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                 3. Parse SCTE-35 (channel-do.ts)                             │
│  • parseSCTE35FromManifest() → Finds #EXT-X-DATERANGE tags                   │
│  • findActiveBreak() → Identifies current ad break                           │
│  • getBreakDuration() → Extracts duration (e.g., 30 seconds)                 │
│  ✅ SCTE-35 Detected: ID="splice-1", Duration=30s                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              4. Call Decision Service (decision-worker.ts)                   │
│  Manifest Worker → Decision Service (via service binding)                   │
│           POST /decision                                                     │
│           { channel, durationSec: 30, viewerInfo: {...} }                    │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              5. VAST Waterfall (decision-worker.ts)                          │
│  Priority 1: Call VAST Parser (if VAST_URL configured)                      │
│  Priority 2: Check R2 for pre-transcoded pods                               │
│  Priority 3: Return slate fallback                                          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│           6. VAST Parsing (vast-parser-worker.ts)                            │
│  • Fetch VAST XML from ad server                                            │
│  • Parse XML → Extract media files + tracking                               │
│  • Resolve wrappers (up to 5 levels deep)                                   │
│  • Convert to AdPod format                                                   │
│  • Cache result in KV                                                        │
│  ✅ Returns: AdPod with HLS URLs + tracking pixels                           │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│           7. Ad Insertion (channel-do.ts)                                    │
│                                                                              │
│  SGAI Mode (iOS/tvOS):                                                       │
│    • Insert #EXT-X-DATERANGE with X-ASSET-URI                               │
│    • Sign ad playlist URL with token                                         │
│    • Client fetches and plays ad seamlessly                                  │
│                                                                              │
│  SSAI Mode (Android/Web):                                                    │
│    • Replace content segments with ad segments                               │
│    • Insert #EXT-X-DISCONTINUITY before/after ad                             │
│    • Server stitches ad directly into manifest                               │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              8. Queue Beacon (beacon-queue)                                  │
│  Manifest Worker → Queue                                                     │
│           BeaconMessage: {                                                   │
│             event: "imp",                                                    │
│             adId: "vast-ad-123",                                             │
│             trackerUrls: [...impressions...],                                │
│             tracking: { errorTracking: [...] },                              │
│             metadata: { vastAdId, creativeId, bitrate }                      │
│           }                                                                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│          9. Fire Tracking Pixels (beacon-consumer-worker.ts)                 │
│  • Dequeue beacon messages                                                   │
│  • Fire all impression trackers                                              │
│  • Fire error trackers (if event=error)                                      │
│  • Retry failed requests (max 2 retries, exponential backoff)               │
│  • Log VAST metadata for analytics                                          │
│  ✅ All tracking pixels fired successfully                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

### **Service Bindings**

```toml
# wrangler.toml (Manifest Worker)
[[services]]
binding = "DECISION"
service = "cf-ssai-decision"

# wrangler.decision.toml (Decision Worker)
[[services]]
binding = "VAST_PARSER"
service = "cf-ssai-vast-parser"
```

---

## ⚙️ **Configuration**

### **Environment Variables**

#### **Decision Service** (`wrangler.decision.toml`)
```toml
[vars]
DECISION_TIMEOUT_MS = "2000"       # Timeout for VAST parser calls
CACHE_DECISION_TTL = "60"          # Cache TTL in seconds
VAST_URL = "https://example.com/vast.xml"  # Optional: Static VAST URL for testing
SLATE_POD_ID = "slate"             # Fallback slate pod ID
```

#### **VAST Parser** (`wrangler.vast.toml`)
```toml
[vars]
VAST_TIMEOUT_MS = "2000"           # Timeout for fetching VAST XML
VAST_MAX_WRAPPER_DEPTH = "5"       # Max wrapper resolution depth
AD_POD_BASE = "https://ads.example.com/pods"
```

#### **Beacon Consumer** (`wrangler.beacon.toml`)
```toml
[vars]
BEACON_TIMEOUT_MS = "5000"         # Timeout for tracker URLs
BEACON_RETRY_ATTEMPTS = "2"        # Max retries per tracker
```

### **KV Namespaces**

```bash
# Create KV namespaces
wrangler kv:namespace create "VAST_CACHE"
wrangler kv:namespace create "DECISION_CACHE"
wrangler kv:namespace create "BEACON_KV"
```

Update IDs in `wrangler.*.toml` files:
```toml
[[kv_namespaces]]
binding = "VAST_CACHE"
id = "your-kv-namespace-id"
```

---

## 🧪 **Testing**

### **Run All Tests**

```bash
# Unit tests (SCTE-35, HLS utilities)
npm test

# Or run specific test suites
tsx --test tests/scte35.test.ts
tsx --test tests/vast.test.ts
tsx --test tests/integration.test.ts
```

### **Local Development**

Start all services in separate terminals:

```bash
# Terminal 1: Manifest worker
npm run dev:manifest

# Terminal 2: Decision service
npm run dev:decision

# Terminal 3: Beacon consumer
npm run dev:beacon

# Terminal 4: VAST parser
npm run dev:vast
```

### **Manual Testing**

#### **Test SCTE-35 Detection**
```bash
curl "http://localhost:8787?channel=test&variant=v_1600k.m3u8&force=sgai"
```

#### **Test VAST Parsing**
```bash
curl -X POST http://localhost:8790/parse \
  -H "Content-Type: application/json" \
  -d '{
    "vastXML": "<VAST version=\"3.0\">...</VAST>",
    "durationSec": 30
  }'
```

#### **Test Decision Service**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "test",
    "durationSec": 30
  }'
```

### **Integration Tests**

```bash
# Run comprehensive integration tests
tsx --test tests/integration.test.ts
```

**Test Coverage**:
- ✅ SCTE-35 detection and ad insertion
- ✅ VAST parsing and waterfall
- ✅ Bitrate-aware ad selection
- ✅ Beacon queueing and tracking
- ✅ Error handling and fallbacks
- ✅ Service bindings
- ✅ Caching behavior
- ✅ Performance benchmarks

---

## 🚀 **Deployment**

### **Deploy All Services**

```bash
# Deploy all workers at once
npm run deploy:all

# Or deploy individually
npm run deploy:manifest
npm run deploy:decision
npm run deploy:beacon
npm run deploy:vast
```

### **Production Checklist**

- [ ] Replace KV namespace IDs with production IDs
- [ ] Configure R2 bucket (`ads-bucket`)
- [ ] Set `VAST_URL` or configure external ad server
- [ ] Set `ORIGIN_VARIANT_BASE` to real origin server
- [ ] Configure `AD_POD_BASE` for ad assets
- [ ] Set `SEGMENT_SECRET` for URL signing
- [ ] Enable observability and logging
- [ ] Test SCTE-35 detection with real live streams
- [ ] Test VAST parsing with real ad server
- [ ] Verify beacon tracking pixels fire correctly
- [ ] Monitor error rates and fallback usage

### **Secrets Management**

```bash
# Set secrets (if using external ad API)
wrangler secret put AD_DECISION_API_KEY --config wrangler.decision.toml
wrangler secret put SEGMENT_SECRET
```

---

## 🔧 **Troubleshooting**

### **SCTE-35 Not Detected**

**Symptoms**: Ads not inserted despite SCTE-35 markers in origin
**Checks**:
1. Verify origin manifest contains `#EXT-X-DATERANGE` tags with SCTE-35 attributes
2. Check `channel-do.ts` logs for "SCTE-35 break detected" message
3. Test parser: `parseSCTE35FromManifest(originManifest)`
4. Ensure `SCTE35-OUT=YES` or `CLASS="com.apple.hls.scte35.out"`

**Common Issues**:
- SCTE-35 tags in wrong format (not using DATERANGE)
- Missing `DURATION` or `X-BREAK-DURATION` attributes
- Origin manifest not refreshing frequently enough

### **VAST Parsing Failures**

**Symptoms**: Always falling back to slate, never using VAST ads
**Checks**:
1. Verify `VAST_URL` is set in decision worker config
2. Check VAST parser logs for "VAST parsing error"
3. Test VAST URL manually: `curl $VAST_URL`
4. Verify VAST XML is valid (use VAST validator tool)
5. Check `VAST_PARSER` service binding exists

**Common Issues**:
- VAST URL returns 404 or timeout
- VAST XML is malformed or invalid
- Missing media files in VAST (no `<MediaFile>` tags)
- All media files are non-HLS (system prefers HLS)

### **Service Binding Errors**

**Symptoms**: "Decision service error" or "VAST parser not available"
**Checks**:
1. Verify all services are deployed: `wrangler deployments list`
2. Check service binding names match exactly
3. Ensure services are on same Cloudflare account
4. Test service health endpoints individually

**Fix**:
```bash
# Redeploy all services
npm run deploy:all

# Verify bindings in wrangler.toml
cat wrangler.toml | grep -A 2 "\[\[services\]\]"
```

### **Tracking Pixels Not Firing**

**Symptoms**: No impressions/quartiles recorded by ad server
**Checks**:
1. Check beacon consumer logs for "Beacon processed successfully"
2. Verify beacon queue is not backed up: `wrangler queues list`
3. Test tracker URLs manually: `curl $TRACKER_URL`
4. Check BEACON_KV deduplication isn't blocking retries

**Common Issues**:
- Tracker URLs require specific headers (User-Agent, Referer)
- Tracker URLs are invalid or return 404
- Beacon timeout too short for slow trackers
- Queue consumer not running or crashed

### **Performance Issues**

**Symptoms**: Slow manifest responses, high latency
**Checks**:
1. Check decision service cache hit rate
2. Verify VAST parsing is cached (shouldn't re-parse same VAST)
3. Monitor VAST XML fetch times (external ad server)
4. Review `DECISION_TIMEOUT_MS` and `VAST_TIMEOUT_MS` settings

**Optimizations**:
- Increase cache TTLs (`CACHE_DECISION_TTL`)
- Pre-transcode popular VAST ads to R2
- Use CDN for VAST XML responses
- Reduce `VAST_MAX_WRAPPER_DEPTH` if wrappers are slow

---

## 📊 **Monitoring and Analytics**

### **Key Metrics to Track**

1. **SCTE-35 Detection Rate**: % of manifests with valid SCTE-35 markers
2. **VAST Success Rate**: % of VAST parses that succeed vs. fallback to slate
3. **Ad Fill Rate**: % of ad opportunities filled (not slate)
4. **Tracking Pixel Success**: % of beacons fired successfully
5. **Decision Service Latency**: P50, P95, P99 response times
6. **VAST Parser Latency**: P50, P95, P99 parsing times
7. **Cache Hit Rates**: Decision cache, VAST cache
8. **Error Rates**: VAST parsing errors, beacon failures, service timeouts

### **Logging**

All services log structured JSON for easy parsing:

```json
{
  "event": "scte35_detected",
  "channel": "sports",
  "scte35_id": "splice-1",
  "duration": 30,
  "timestamp": "2025-10-31T10:00:00Z"
}

{
  "event": "vast_parsed",
  "pod_id": "vast-ad-123",
  "ad_id": "ad-123",
  "duration": 30,
  "media_files": 3,
  "tracking_urls": 12
}

{
  "event": "beacon_success",
  "ad_id": "vast-ad-123",
  "event_type": "imp",
  "tracker_count": 5,
  "retry_count": 0
}
```

### **Cloudflare Analytics**

Monitor via Cloudflare Dashboard:
- Worker invocations
- Worker duration (execution time)
- Worker errors
- KV operations
- Queue depth and consumer lag

---

## 🎓 **Best Practices**

### **For SCTE-35**

1. **Always include duration**: Ensure SCTE-35 markers have `DURATION` or `X-BREAK-DURATION`
2. **Use auto-return**: Set `X-AUTO-RETURN=YES` for seamless content resumption
3. **Test with real streams**: Use actual live streams, not VOD, for testing
4. **Monitor detection rate**: Track % of manifests with valid SCTE-35

### **For VAST**

1. **Prefer HLS over MP4**: Ensure VAST includes HLS media files for best compatibility
2. **Include all tracking**: Provide impression, quartile, and error tracking URLs
3. **Keep wrappers shallow**: Limit wrapper depth to 2-3 for best performance
4. **Test with validators**: Use IAB VAST validator before deploying
5. **Handle errors gracefully**: Always return 200 with slate on VAST errors

### **For Production**

1. **Pre-transcode popular ads**: Store frequently-served ads in R2 for faster delivery
2. **Monitor cache hit rates**: Optimize TTLs based on actual usage patterns
3. **Set appropriate timeouts**: Balance responsiveness vs. reliability
4. **Use multiple ad sources**: Implement full waterfall (direct, programmatic, house ads, slate)
5. **Test failover scenarios**: Ensure system degrades gracefully when services unavailable

---

## 📚 **Additional Resources**

- [SCTE-35 Standard](https://www.scte.org/standards/library/catalog/scte-35-digital-program-insertion-cueing-message/)
- [IAB VAST Specification](https://www.iab.com/guidelines/vast/)
- [Apple HLS SCTE-35 Guidelines](https://developer.apple.com/documentation/http_live_streaming/hls_authoring_specification_for_apple_devices)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)

---

## 🎉 **Summary**

You now have a **production-ready SSAI/SGAI system** with:
- ✅ **SCTE-35 marker detection** for live stream ad insertion
- ✅ **VAST 3.0/4.2 parsing** with wrapper resolution
- ✅ **Bitrate-aware ad selection** for optimal quality matching
- ✅ **Comprehensive tracking** with beacon queueing and retry logic
- ✅ **True SSAI** with segment replacement at SCTE-35 markers
- ✅ **Graceful error handling** with slate fallbacks
- ✅ **Edge caching** for low-latency decisions
- ✅ **Extensive test coverage** with unit and integration tests

**Next Steps**:
1. Deploy to production using `npm run deploy:all`
2. Configure real VAST ad server URL
3. Point to real live stream origin with SCTE-35 markers
4. Monitor metrics and optimize caching/timeouts
5. Expand VAST waterfall with multiple ad sources

Happy ad insertion! 🚀

