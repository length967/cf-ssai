# 🪵 CF-SSAI Logging Guide

Complete guide to viewing, filtering, and analyzing logs across all workers.

---

## 🚀 Quick Start

### **Option 1: Simple Key Events (Recommended)**

Shows only important events (errors, SCTE-35, ad decisions):

```bash
./view-logs-simple.sh
```

**Best for:** Quick debugging, monitoring ad insertion

---

### **Option 2: All Workers Consolidated**

Shows logs from ALL workers in one view with color coding:

```bash
./view-logs.sh
```

**Best for:** Full system monitoring, understanding request flow

---

### **Option 3: Single Worker**

Monitor just one worker:

```bash
# Manifest worker (main HLS processing)
npx wrangler tail cf-ssai --format=pretty

# Decision service (ad selection)
npx wrangler tail cf-ssai-decision --format=pretty

# Admin API (GUI backend)
npx wrangler tail cf-ssai-admin-api --format=pretty

# Transcode worker (FFmpeg processing)
npx wrangler tail cf-ssai-transcode --format=pretty

# Beacon consumer (analytics)
npx wrangler tail cf-ssai-beacon --format=pretty
```

**Best for:** Focused debugging of specific component

---

## 🔍 Filtering Logs

### **By Event Type**

```bash
# SCTE-35 detection
npx wrangler tail cf-ssai --format=pretty | grep "SCTE-35"

# Ad insertion
npx wrangler tail cf-ssai --format=pretty | grep -E "(Ad|decision|pod)"

# Errors only
npx wrangler tail cf-ssai --format=pretty | grep -i error

# Tier filtering
npx wrangler tail cf-ssai --format=pretty | grep tier

# PTS adjustment
npx wrangler tail cf-ssai --format=pretty | grep "PTS"

# Performance (segment timing)
npx wrangler tail cf-ssai --format=pretty | grep -E "(Fetching|origin|duration)"
```

---

### **By Time Window**

```bash
# Last 10 seconds of activity
npx wrangler tail cf-ssai --format=pretty | head -50

# Continuous monitoring
npx wrangler tail cf-ssai --format=pretty
```

---

## 📊 Worker-Specific Logs

### **Manifest Worker (`cf-ssai`)**

**What it logs:**
- SCTE-35 signal detection
- Ad insertion decisions
- Tier filtering
- PTS adjustment
- Segment/manifest requests
- Origin fetches
- Channel config loading

**Key patterns to watch:**
```bash
# SCTE-35 detection
"SCTE-35 signal detected"
"SCTE-35 Binary Parsing"
"Applied PTS adjustment"

# Tier filtering
"SCTE-35 tier match"
"SCTE-35 tier mismatch"

# Ad insertion
"SCTE-35 break detected"
"Calling decision service"
"Extracted X ad segments"

# Performance
"Channel config loaded"
"Fetching origin variant"
```

---

### **Decision Worker (`cf-ssai-decision`)**

**What it logs:**
- Ad pod selection
- Bitrate matching
- Database queries for ads
- Fallback to slate

**Key patterns:**
```bash
# Ad selection
"Ad decision request"
"Selected pod"
"Matched bitrate"

# Errors
"No ads found"
"Fallback to slate"
```

---

### **Admin API (`cf-ssai-admin-api`)**

**What it logs:**
- API requests
- Database operations
- Authentication
- Channel config updates
- Cache invalidation

**Key patterns:**
```bash
# API activity
"POST /api/channels"
"PUT /api/channels"
"Cache invalidated"

# Auth
"JWT verified"
"Unauthorized"
```

---

### **Transcode Worker (`cf-ssai-transcode`)**

**What it logs:**
- Transcode job processing
- FFmpeg container status
- Video encoding progress
- R2 uploads

**Key patterns:**
```bash
# Transcode
"Starting transcode"
"FFmpeg progress"
"Upload complete"

# Errors
"FFmpeg failed"
"Container error"
```

---

### **Beacon Consumer (`cf-ssai-beacon`)**

**What it logs:**
- Beacon event processing
- Analytics aggregation
- Database inserts

**Key patterns:**
```bash
# Events
"Beacon event"
"Ad impression"
"Stream start/stop"
```

---

## 🎯 Common Debugging Scenarios

### **Scenario 1: Ads Not Inserting**

```bash
# Check full ad insertion flow
npx wrangler tail cf-ssai --format=pretty | grep -E "(SCTE-35|decision|Ad|INSERT)"
```

**Look for:**
- ✅ "SCTE-35 signal detected" → Signal found
- ✅ "SCTE-35 break detected (auto-insert enabled)" → Auto-insert on
- ✅ "Calling decision service" → Decision called
- ✅ "Extracted X ad segments" → Ad fetched
- ❌ "tier mismatch" → Check tier settings
- ❌ "No ads found" → Check ad pod config

---

### **Scenario 2: Stream Stalling/Buffering**

```bash
# Check segment performance
npx wrangler tail cf-ssai --format=pretty | grep -E "(Fetching|duration|stall|Buffer)"
```

**Look for:**
- ❌ "Fetching origin" for every segment → Should only be manifests!
- ❌ "Channel config loaded" repeatedly → Caching issue
- ✅ Only manifest requests have logs → Segments passing through ✅

---

### **Scenario 3: SCTE-35 Not Detected**

```bash
# Check SCTE-35 parsing
npx wrangler tail cf-ssai --format=pretty | grep -E "(SCTE-35|DateRange|Invalid)"
```

**Look for:**
- ✅ "SCTE-35 signal detected" → Working
- ❌ "Invalid table_id" → Binary parsing issue (can ignore if fallback works)
- ❌ No SCTE-35 logs at all → Origin not sending markers

---

### **Scenario 4: Tier Filtering Issues**

```bash
# Check tier matching
npx wrangler tail cf-ssai --format=pretty | grep tier
```

**Look for:**
- ✅ "SCTE-35 tier match: tier=X" → Working correctly
- ⚠️ "SCTE-35 tier mismatch" → Channel/signal tier don't match
- No logs → Tier = 0 (no filtering)

---

### **Scenario 5: Database/Config Issues**

```bash
# Check database operations
npx wrangler tail cf-ssai-admin-api --format=pretty | grep -E "(D1|INSERT|UPDATE|SELECT)"
```

**Look for:**
- ❌ "no such column" → Missing migration
- ❌ "SQLITE_ERROR" → Schema mismatch
- ✅ Successful queries → Database working

---

## 🎨 Color-Coded Consolidated View

When using `./view-logs.sh`, each worker has a color:

- 🔵 **BLUE** = Manifest Worker (cf-ssai)
- 🟢 **GREEN** = Decision Service (cf-ssai-decision)
- 🟡 **YELLOW** = Admin API (cf-ssai-admin-api)
- 🔵 **CYAN** = Transcode Worker (cf-ssai-transcode)
- 🟣 **MAGENTA** = Beacon Consumer (cf-ssai-beacon)

---

## 📝 Log Levels

All workers log at these levels:

- **(log)** = Normal operation
- **(warn)** = Non-critical issue
- **(error)** = Critical failure

**Filter by level:**
```bash
# Errors only
npx wrangler tail cf-ssai --format=pretty | grep "(error)"

# Warnings only
npx wrangler tail cf-ssai --format=pretty | grep "(warn)"
```

---

## 🔧 Advanced Filtering

### **Multiple Workers + Filter**

```bash
# SCTE-35 events across manifest + decision
(npx wrangler tail cf-ssai --format=pretty 2>&1 | grep SCTE-35) &
(npx wrangler tail cf-ssai-decision --format=pretty 2>&1 | grep -E "pod|decision") &
wait
```

---

### **Save Logs to File**

```bash
# Save for later analysis
npx wrangler tail cf-ssai --format=pretty > logs-$(date +%Y%m%d-%H%M%S).txt

# Save with automatic rotation (run for 1 hour)
timeout 3600 npx wrangler tail cf-ssai --format=pretty > logs-$(date +%Y%m%d-%H%M%S).txt
```

---

### **Real-Time Analysis**

```bash
# Count SCTE-35 signals per minute
npx wrangler tail cf-ssai --format=pretty | grep "SCTE-35 signal detected" | pv -l -i 60 > /dev/null
```

---

## 🌐 Cloudflare Dashboard

**Alternative:** View logs in Cloudflare Dashboard

1. Go to: https://dash.cloudflare.com/
2. Navigate to: **Workers & Pages** → **cf-ssai**
3. Click: **Logs** tab
4. Filter by: Date/time, status, search term

**Pros:**
- ✅ No terminal needed
- ✅ Long-term storage
- ✅ Advanced filtering UI
- ✅ Export to CSV

**Cons:**
- ❌ Not real-time (30s delay)
- ❌ Limited to 1 worker at a time

---

## 🚨 Critical Logs to Monitor

### **During Ad Insertion:**

```
✅ "SCTE-35 break detected (auto-insert enabled): duration=38.4s"
✅ "Calling decision service: channelId=ch_demo_sports, duration=38.4s"
✅ "Extracted 5 ad segments (total: 30.0s)"
✅ "Inserting resume PDT after ad: 2025-11-02T..."
```

---

### **During Playback:**

```
✅ "Channel config loaded: orgSlug=demo, channelSlug=sports"
✅ Manifest requests only (no segment logs = good!)
❌ "Fetching origin variant: ...segment.ts" (bad - segments shouldn't log!)
```

---

### **Errors to Watch For:**

```
❌ "D1_ERROR: no such column"         → Missing migration
❌ "Buffer is not defined"             → Workers compatibility issue  
❌ "Decision service timeout"          → Increase DECISION_TIMEOUT_MS
❌ "no such column: tier"              → Migration not applied
❌ "R2 bucket 'ads-bucket' not found"  → Old bucket reference
```

---

## 📚 Log Retention

| Location | Retention | Access |
|----------|-----------|--------|
| **Live Tail** | Real-time only | `wrangler tail` |
| **Cloudflare Dashboard** | 24 hours | Web UI |
| **Logpush** | Indefinite (external) | S3/R2/BigQuery |

**To enable long-term storage:** Set up Logpush to R2 or S3

---

## 🎯 Quick Reference

```bash
# Start simple monitoring
./view-logs-simple.sh

# Start full monitoring (all workers)
./view-logs.sh

# Monitor just manifest worker
npx wrangler tail cf-ssai --format=pretty

# Filter for SCTE-35 events
npx wrangler tail cf-ssai --format=pretty | grep SCTE-35

# Filter for errors only
npx wrangler tail cf-ssai --format=pretty | grep -i error

# Save logs to file
npx wrangler tail cf-ssai --format=pretty > logs.txt
```

---

## 🐛 Troubleshooting Log Viewer

### **Problem: "EPERM: operation not permitted"**

**Cause:** Wrangler trying to write log files

**Solution:** Already filtered out in scripts, but if you see it:
```bash
npx wrangler tail cf-ssai --format=pretty 2>&1 | grep -v "EPERM"
```

---

### **Problem: No logs showing**

**Causes:**
1. Worker not receiving requests
2. Wrong worker name
3. Not authenticated

**Solutions:**
```bash
# Check auth
npx wrangler whoami

# Test worker is responding
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8

# Check worker exists
npx wrangler list
```

---

### **Problem: Too many logs**

**Solution:** Use filters or simple view
```bash
# Key events only
./view-logs-simple.sh

# Or filter manually
npx wrangler tail cf-ssai --format=pretty | grep -E "(error|SCTE-35|Ad)"
```

---

## 📊 Log Analysis Tips

### **1. Identify Ad Insertion Flow**

Look for this sequence:
```
1. SCTE-35 signal detected
2. SCTE-35 break detected (auto-insert enabled)
3. Calling decision service
4. Extracted X ad segments
5. Inserting resume PDT after ad
```

**If broken at step X:** That's where to focus debugging

---

### **2. Performance Analysis**

```bash
# Count requests per second
npx wrangler tail cf-ssai --format=pretty | pv -l -i 1 > /dev/null
```

**Normal rates:**
- Manifests: 1-2 per second per viewer
- Segments: 10-20 per second per viewer

---

### **3. Error Rate**

```bash
# Count errors
npx wrangler tail cf-ssai --format=pretty | grep -i error | wc -l
```

**Healthy:** < 1% of total requests

---

## 🎉 Summary

**For daily monitoring:**
```bash
./view-logs-simple.sh
```

**For deep debugging:**
```bash
./view-logs.sh
```

**For specific issues:**
```bash
npx wrangler tail cf-ssai --format=pretty | grep [your-filter]
```

---

**Happy debugging!** 🪵✨

