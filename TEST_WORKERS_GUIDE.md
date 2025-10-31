# 🧪 Local Workers Testing Guide

Complete guide for testing the Decision Service and Beacon Consumer workers.

---

## 🚀 **Quick Start**

### **Step 1: Open 3 Terminals**

**Terminal 1: Manifest Worker** (port 8787)
```bash
cd /Users/markjohns/Development/cf-ssai
npm run dev:manifest
```

Wait for: `Ready on http://localhost:8787`

**Terminal 2: Decision Service** (port 8788)
```bash
cd /Users/markjohns/Development/cf-ssai
npm run dev:decision
```

Wait for: `Ready on http://localhost:8788`

**Terminal 3: Beacon Consumer** (port 8789)
```bash
cd /Users/markjohns/Development/cf-ssai
npm run dev:beacon
```

Wait for: `Ready on http://localhost:8789`

### **Step 2: Run Automated Tests**

**Open Terminal 4:**
```bash
cd /Users/markjohns/Development/cf-ssai
./test-workers.sh
```

**Expected:** 12/12 tests passing ✅

---

## 📝 **Manual Testing**

### **Test 1: Decision Service Health Check**

```bash
curl http://localhost:8788/health
```

**Expected:**
```
ok
```

---

### **Test 2: Basic Decision Request**

```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "sports1",
    "durationSec": 30
  }' | jq
```

**Expected Output:**
```json
{
  "pod": {
    "podId": "sports-pod-premium",
    "durationSec": 30,
    "items": [
      {
        "adId": "sports-pod-premium-ad-1",
        "bitrate": 800000,
        "playlistUrl": "https://ads.example.com/pods/sports-pod-premium/v_800k/playlist.m3u8",
        "tracking": {
          "impression": ["https://tracking.example.com/imp?pod=sports-pod-premium"]
        }
      },
      {
        "adId": "sports-pod-premium-ad-1",
        "bitrate": 1600000,
        "playlistUrl": "https://ads.example.com/pods/sports-pod-premium/v_1600k/playlist.m3u8"
      },
      {
        "adId": "sports-pod-premium-ad-1",
        "bitrate": 2500000,
        "playlistUrl": "https://ads.example.com/pods/sports-pod-premium/v_2500k/playlist.m3u8"
      }
    ]
  }
}
```

**Check Terminal 2** for logs:
```
Decision from VAST waterfall
Cached decision: decision:sports1:30:US:default (TTL: 60s)
```

---

### **Test 3: Decision Caching**

**First Request (cache miss):**
```bash
time curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test-cache","durationSec":30}' > /dev/null
```

**Second Request (cache hit):**
```bash
time curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test-cache","durationSec":30}' > /dev/null
```

**Expected:**
- First request: ~50ms (cache miss)
- Second request: ~5ms (cache hit)

**Check Terminal 2** for:
```
Cache hit: decision:test-cache:30:US:default
```

---

### **Test 4: Channel-Specific Pods**

**Sports Channel:**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"sports-espn","durationSec":30}' | jq '.pod.podId'
```

**Expected:** `"sports-pod-premium"`

**News Channel:**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"news-cnn","durationSec":30}' | jq '.pod.podId'
```

**Expected:** `"news-pod-standard"`

**Entertainment Channel:**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"entertainment-hbo","durationSec":30}' | jq '.pod.podId'
```

**Expected:** `"entertainment-pod-premium"`

---

### **Test 5: Viewer Context**

```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "premium-channel",
    "durationSec": 30,
    "viewerInfo": {
      "geo": {"country": "UK"},
      "consent": {"tcf": "CPXXXXXX"},
      "bucket": "premium"
    },
    "context": {
      "contentId": "show-123",
      "contentGenre": "drama"
    }
  }' | jq
```

**Expected:** Valid pod response with targeting considered

---

### **Test 6: End-to-End Integration**

**Trigger ad break (uses decision service):**
```bash
curl "http://localhost:8787?channel=sports1&variant=v_1600k.m3u8&force=sgai"
```

**Expected in response:**
```m3u8
#EXT-X-DATERANGE:ID="ad-XX",CLASS="com.apple.hls.interstitial"
X-ASSET-URI="https://media.example.com/pods/.../v_1600k/playlist.m3u8?token=...&exp=..."
```

**Check Terminal 1** (manifest worker):
```
[wrangler:info] GET /?channel=sports1&variant=v_1600k.m3u8&force=sgai 200 OK
```

**Check Terminal 2** (decision service):
```
Decision from VAST waterfall
(or)
Cache hit: decision:sports1:30:US:default
```

**Check Terminal 3** (beacon consumer):
```
Processing beacon batch: 1 messages
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Batch complete: 1 processed, 1 succeeded, 0 failed
```

---

### **Test 7: Beacon Processing**

**Send multiple beacons:**
```bash
for i in {1..5}; do
  curl -s "http://localhost:8787?channel=test-$i&variant=v_1600k.m3u8&force=sgai" > /dev/null
  echo "Sent beacon $i"
done
```

**Check Terminal 3** for batch processing:
```
Processing beacon batch: 5 messages
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Batch complete: 5 processed, 5 succeeded, 0 failed, 0 retries (120ms)
```

**Metrics to check:**
- `totalProcessed: 5`
- `successCount: 5`
- `failureCount: 0`
- `retryCount: 0`
- Duration: ~100-200ms

---

### **Test 8: Bitrate-Aware Selection**

**800k variant:**
```bash
curl "http://localhost:8787?channel=bitrate-test&variant=v_800k.m3u8&force=sgai" | grep "ASSET-URI"
```

**Expected:** URL contains `/v_800k/`

**1600k variant:**
```bash
curl "http://localhost:8787?channel=bitrate-test&variant=v_1600k.m3u8&force=sgai" | grep "ASSET-URI"
```

**Expected:** URL contains `/v_1600k/`

---

### **Test 9: Error Handling**

**Invalid decision request (missing durationSec):**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test"}'
```

**Expected:**
```json
{
  "error": "Missing required fields: channel, durationSec"
}
```

**HTTP Status:** 400

**Malformed JSON:**
```bash
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d 'not valid json'
```

**Expected:** Still returns valid slate pod (graceful fallback)
**HTTP Status:** 200

---

### **Test 10: Service Binding Communication**

**Verify manifest worker can reach decision service:**

```bash
# This should work even without decision service running separately
# because it uses service binding
curl "http://localhost:8787?channel=binding-test&variant=v_1600k.m3u8&force=sgai"
```

**Expected:** Valid SGAI manifest

**Check logs to verify:**
- Terminal 1 shows request received
- Terminal 2 shows decision made
- Terminal 3 shows beacon queued

---

### **Test 11: Legacy Endpoint**

**Test backward compatibility:**
```bash
curl -X POST http://localhost:8788/pod \
  -H "Content-Type: application/json" \
  -d '{"channel":"legacy","durationSec":30}' | jq
```

**Expected:** Same pod structure as `/decision` endpoint

---

## 📊 **What to Look For**

### **Decision Service Logs** (Terminal 2):
```
✅ "Decision from VAST waterfall" - First request
✅ "Cache hit: decision:..." - Subsequent requests
✅ "Falling back to slate" - When no ads available
```

### **Beacon Consumer Logs** (Terminal 3):
```
✅ "Processing beacon batch: X messages"
✅ "Beacon processed: imp/... - 0/0 URLs succeeded"
✅ "Batch complete: X processed, X succeeded, 0 failed"
```

### **Manifest Worker Logs** (Terminal 1):
```
✅ "GET /?channel=... 200 OK"
✅ "QUEUE beacon-queue" - Beacons being sent
```

---

## 🐛 **Troubleshooting**

### **Issue: Decision service not responding**

**Check:**
```bash
curl http://localhost:8788/health
```

If fails:
1. Verify Terminal 2 shows "Ready on http://localhost:8788"
2. Check for port conflicts: `lsof -i :8788`
3. Restart: `npm run dev:decision`

---

### **Issue: Beacons not processing**

**Check:**
1. Terminal 3 should show "Ready on http://localhost:8789"
2. Queue consumer configuration in `wrangler.beacon.toml`
3. Look for errors in Terminal 3

**Test queue directly:**
```bash
# Send beacon
curl "http://localhost:8787?channel=queue-test&variant=v_1600k.m3u8&force=sgai" > /dev/null

# Wait 5 seconds (max_batch_timeout)
sleep 6

# Check Terminal 3 for processing logs
```

---

### **Issue: Service binding not working**

**Symptom:** Manifest worker shows "Using fallback slate pod"

**Check:**
```bash
# Verify service binding in wrangler.toml
grep -A2 "\[\[services\]\]" wrangler.toml
```

**Should see:**
```toml
[[services]]
binding = "DECISION"
service = "cf-ssai-decision"
```

**Fix:** Restart manifest worker after checking config

---

### **Issue: Port conflicts**

**Check what's running:**
```bash
lsof -i :8787  # Manifest worker
lsof -i :8788  # Decision service
lsof -i :8789  # Beacon consumer
```

**Kill conflicting processes:**
```bash
kill -9 $(lsof -t -i:8787)
kill -9 $(lsof -t -i:8788)
kill -9 $(lsof -t -i:8789)
```

---

## 📈 **Performance Benchmarks**

### **Decision Service:**
```bash
# Test 100 requests
time for i in {1..100}; do
  curl -s -X POST http://localhost:8788/decision \
    -H "Content-Type: application/json" \
    -d '{"channel":"perf-test","durationSec":30}' > /dev/null
done
```

**Expected:**
- First request: ~50ms
- Cached requests: ~5ms each
- Total time: ~500-1000ms (cache working!)

### **Beacon Processing:**
```bash
# Send 50 beacons
time for i in {1..50}; do
  curl -s "http://localhost:8787?channel=perf-$i&variant=v_1600k.m3u8&force=sgai" > /dev/null
done
```

**Check Terminal 3:**
- Batch processing (max 100 per batch)
- Should process in < 1 second total

---

## ✅ **Success Criteria**

All tests should:
- ✅ Return valid responses
- ✅ Show correct logs in terminals
- ✅ Process within expected timeframes
- ✅ Handle errors gracefully
- ✅ Cache effectively

**If all tests pass, you're ready to deploy!**

```bash
npm run deploy:all
```

---

## 🎓 **Advanced Testing**

### **Test Cache Expiration:**
```bash
# Make request
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"cache-exp","durationSec":30}' > /dev/null

# Wait for cache TTL (60 seconds)
echo "Waiting 65 seconds for cache to expire..."
sleep 65

# Request again (should be cache miss)
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"cache-exp","durationSec":30}' > /dev/null
```

**Check Terminal 2:** Should see "Decision from VAST waterfall" again

### **Test Different Countries:**
```bash
for country in US UK DE FR JP; do
  echo "Testing $country:"
  curl -X POST http://localhost:8788/decision \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"geo-test\",\"durationSec\":30,\"viewerInfo\":{\"geo\":{\"country\":\"$country\"}}}" \
    | jq '.pod.podId'
done
```

### **Stress Test:**
```bash
# 10 concurrent requests
for i in {1..10}; do
  (
    curl -s -X POST http://localhost:8788/decision \
      -H "Content-Type: application/json" \
      -d '{"channel":"stress-test","durationSec":30}' > /dev/null
  ) &
done
wait

echo "Check Terminal 2 for cache hits!"
```

---

## 📝 **Next Steps**

Once all tests pass:

1. ✅ Review logs for any warnings
2. ✅ Monitor resource usage
3. ✅ Verify cache hit rates
4. ✅ Check beacon success rates
5. ✅ Ready to deploy to staging!

---

**End of Testing Guide**

