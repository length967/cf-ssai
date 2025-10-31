# 🚀 Roadmap Quick Start

**Getting Started with Beacon Consumer & Decision Service**

---

## ⚡ **Quick Setup (3 Steps)**

### **1. Start All Workers Locally**

Open **3 terminal windows**:

```bash
# Terminal 1: Main manifest worker
npm run dev:manifest

# Terminal 2: Decision service
npm run dev:decision

# Terminal 3: Beacon consumer
npm run dev:beacon
```

### **2. Test Decision Service**

```bash
# Health check
curl http://localhost:8788/health

# Make an ad decision
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "sports1",
    "durationSec": 30,
    "viewerInfo": {"geo": {"country": "US"}}
  }'
```

**Expected Response:**
```json
{
  "pod": {
    "podId": "sports-pod-premium",
    "durationSec": 30,
    "items": [
      {"adId": "...", "bitrate": 800000, "playlistUrl": "..."},
      {"adId": "...", "bitrate": 1600000, "playlistUrl": "..."}
    ]
  }
}
```

### **3. Test End-to-End Flow**

```bash
# Trigger ad break (manifest worker → decision service → beacon queue)
curl "http://localhost:8787?channel=sports1&variant=v_1600k.m3u8&force=sgai"
```

**Check Terminal 3** (beacon consumer) for:
```
Processing beacon batch: 1 messages
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Batch complete: 1 processed, 1 succeeded, 0 failed
```

---

## 📊 **What Changed?**

### **Before (Monolithic):**
```
manifest-worker.ts
├── Manifest generation
├── Ad logic
├── Queue sending
└── Queue consuming ← Mixed concerns
```

### **After (Microservices):**
```
manifest-worker.ts        → Manifest generation
decision-worker.ts        → Ad decisions
beacon-consumer-worker.ts → Beacon processing
```

---

## 🎯 **Key Features**

| Worker | Purpose | Key Features |
|--------|---------|--------------|
| **Manifest** | HLS manifest generation | SGAI/SSAI, JWT auth, caching |
| **Decision** | Ad selection | Waterfall, caching, fallback |
| **Beacon** | Tracking pixels | Batch processing, retries, dedupe |

---

## 🧪 **Testing Decision Service**

### **Test 1: Cache Behavior**
```bash
# First request (cache miss)
time curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","durationSec":30}'

# Second request within 60s (cache hit)
time curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","durationSec":30}'
```

**Logs should show:**
```
First:  "Decision from VAST waterfall"
Second: "Cache hit: decision:test:30:US:default"
```

### **Test 2: Different Channels**
```bash
# Sports channel
curl -X POST http://localhost:8788/decision \
  -d '{"channel":"sports-espn","durationSec":30}' \
  -H "Content-Type: application/json"

# News channel  
curl -X POST http://localhost:8788/decision \
  -d '{"channel":"news-cnn","durationSec":30}' \
  -H "Content-Type: application/json"
```

**Different channels return different pods.**

---

## 🧪 **Testing Beacon Consumer**

### **Test 1: Send Beacons**
```bash
# Trigger ad break multiple times
for i in {1..5}; do
  curl "http://localhost:8787?channel=ch$i&variant=v_1600k.m3u8&force=sgai"
done
```

### **Test 2: Check Processing Stats**

**Beacon consumer terminal shows:**
```
Processing beacon batch: 5 messages
Beacon processed: imp/example-pod - 0/0 URLs succeeded
Beacon processed: imp/example-pod - 0/0 URLs succeeded
...
Batch complete: 5 processed, 5 succeeded, 0 failed, 0 retries (150ms)
```

### **Test 3: Retry Logic**

Add a tracker URL and watch retries:

Edit `channel-do.ts` temporarily:
```typescript
trackerUrls: ["https://invalid-tracker-url.example.com/imp"]
```

**Logs show:**
```
Beacon failed: imp/example-pod - fetch failed
(retry 1 of 2)
Beacon failed: imp/example-pod - fetch failed
(retry 2 of 2)
Batch complete: 1 processed, 0 succeeded, 1 failed, 2 retries
```

---

## 🚀 **Production Deployment**

### **Step 1: Create Required Resources**

```bash
# Create KV namespaces
wrangler kv:namespace create "DECISION_CACHE"
wrangler kv:namespace create "BEACON_KV"

# Note the IDs and update wrangler configs
```

### **Step 2: Update Configs**

Replace placeholder IDs in:
- `wrangler.decision.toml` → `DECISION_CACHE` KV ID
- `wrangler.beacon.toml` → `BEACON_KV` KV ID

### **Step 3: Deploy All Workers**

```bash
npm run deploy:all
```

**Or deploy individually:**
```bash
npm run deploy:manifest
npm run deploy:decision  
npm run deploy:beacon
```

### **Step 4: Verify Deployments**

```bash
wrangler deployments list cf-ssai
wrangler deployments list cf-ssai-decision
wrangler deployments list cf-ssai-beacon-consumer
```

---

## 🔧 **Configuration**

### **Decision Service Settings**

Edit `wrangler.decision.toml`:
```toml
[vars]
DECISION_TIMEOUT_MS = "150"      # External API timeout
CACHE_DECISION_TTL = "60"        # Cache duration (seconds)
SLATE_POD_ID = "slate"           # Fallback pod
```

### **Beacon Consumer Settings**

Edit `wrangler.beacon.toml`:
```toml
[vars]
BEACON_RETRY_ATTEMPTS = "2"      # Retry count
BEACON_TIMEOUT_MS = "5000"       # Request timeout

[[queues.consumers]]
max_batch_size = 100             # Messages per batch
max_batch_timeout = 5            # Wait time (seconds)
```

---

## 📈 **Monitoring**

### **View Logs:**
```bash
# Manifest worker
wrangler tail cf-ssai

# Decision service
wrangler tail cf-ssai-decision

# Beacon consumer
wrangler tail cf-ssai-beacon-consumer
```

### **Key Metrics:**

**Decision Service:**
- Cache hit rate (target: >70%)
- Timeout rate (target: <5%)
- Fallback rate (target: <10%)

**Beacon Consumer:**
- Success rate (target: >95%)
- Retry rate (target: <10%)
- Processing time (target: <500ms per batch)

---

## 🐛 **Troubleshooting**

### **Decision Service Returns Slate:**

**Possible causes:**
1. Service binding not configured
2. Decision worker not deployed
3. R2 bucket missing ad pods
4. External API timeout

**Fix:**
```bash
# Check binding
grep -A2 "\[\[services\]\]" wrangler.toml

# Verify deployment
wrangler deployments list cf-ssai-decision

# Check logs
wrangler tail cf-ssai-decision
```

### **Beacons Not Processing:**

**Possible causes:**
1. Beacon consumer not deployed
2. Queue consumer not configured
3. Queue doesn't exist

**Fix:**
```bash
# Check deployment
wrangler deployments list cf-ssai-beacon-consumer

# Verify queue
wrangler queues list

# Check logs
wrangler tail cf-ssai-beacon-consumer
```

### **Port Conflicts in Dev:**

Each worker needs a unique port:
- Manifest: 8787 (default)
- Decision: 8788
- Beacon: 8789

**Fix:**
```bash
# Specify ports explicitly
wrangler dev --local --port 8787  # manifest
wrangler dev --local --port 8788 --config wrangler.decision.toml
wrangler dev --local --port 8789 --config wrangler.beacon.toml
```

---

## 📚 **Examples**

### **Example 1: Custom Decision Logic**

Edit `src/decision-worker.ts`:
```typescript
async function runVastWaterfall(env: Env, req: DecisionRequest) {
  // Add your custom logic
  if (req.channel.includes("premium")) {
    return { pod: premiumPod }
  }
  
  if (req.viewerInfo?.geo?.country === "US") {
    return { pod: usPod }
  }
  
  return null // Fall through to slate
}
```

### **Example 2: Add Tracking URLs**

Edit `src/channel-do.ts`:
```typescript
const beaconMsg: BeaconMessage = {
  event: "imp",
  adId: "example-pod",
  ts: Date.now(),
  trackerUrls: [
    "https://tracking.example.com/imp?pod=example-pod",
    "https://analytics.example.com/event?type=impression"
  ],
  metadata: { variant, bitrate: viewerBitrate }
}
```

### **Example 3: Custom Beacon Logic**

Edit `src/beacon-consumer-worker.ts`:
```typescript
async function processBeacon(beacon: BeaconMessage, env: Env) {
  // Add custom processing
  if (beacon.event === "imp") {
    // Track impression in your analytics system
    await logImpression(beacon.adId, beacon.metadata)
  }
  
  // Continue with tracker URLs
  // ...
}
```

---

## ✅ **Verification Checklist**

Before going to production:

- [ ] All 3 workers deploy successfully
- [ ] Decision service health check returns "ok"
- [ ] Manifest worker can reach decision service
- [ ] Beacons are queued and processed
- [ ] Cache hit rate is acceptable (>50%)
- [ ] Beacon success rate is high (>90%)
- [ ] Logs show no critical errors
- [ ] KV namespaces created and bound
- [ ] Queue created and bound
- [ ] R2 bucket has ad pod structure

---

## 🎓 **Next Steps**

Once everything is working:

1. **Add Real Tracking URLs** - Connect to your analytics platform
2. **Configure External Decision API** - Integrate with SSP/ad server
3. **Upload Ad Pods to R2** - Add real ad creative
4. **Test with Real Traffic** - Start small, monitor closely
5. **Set Up Alerts** - Cloudflare Workers Analytics

---

## 📖 **Documentation Links**

- **Full Implementation:** `ROADMAP_IMPLEMENTATION.md`
- **Testing Guide:** `TESTING_COMPLETE.md`
- **Project Context:** `PROJECT_CONTEXT.md`
- **API Docs:** See ROADMAP_IMPLEMENTATION.md → API Documentation

---

**🎉 You're ready to go! Start all 3 workers and test the flow.**

```bash
npm run dev:manifest    # Terminal 1
npm run dev:decision    # Terminal 2
npm run dev:beacon      # Terminal 3
```

Then test:
```bash
curl "http://localhost:8787?channel=sports1&variant=v_1600k.m3u8&force=sgai"
```

---

**End of Quick Start Guide**

