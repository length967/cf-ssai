# 🎯 Bitrate Matching for SSAI - Complete Guide

## 🔑 **Why Exact Bitrate Matching Matters**

For **Server-Side Ad Insertion (SSAI)** to work seamlessly, your **ad videos must have the exact same bitrate variants as your live stream**.

### **The Problem:**

```
Live Stream has:
├─ 1000k (1Mbps) variant
├─ 2000k (2Mbps) variant
└─ 3000k (3Mbps) variant

Viewer watching 2Mbps variant
  ↓
Ad break triggers
  ↓
Ad only has: 800k, 1600k, 2400k variants ❌
  ↓
Bitrate mismatch = buffering, quality jump, or playback failure!
```

### **The Solution:**

```
Live Stream has:
├─ 1000k variant
├─ 2000k variant
└─ 3000k variant

Viewer watching 2Mbps variant
  ↓
Ad break triggers
  ↓
Ad also has: 1000k, 2000k, 3000k variants ✅
  ↓
Seamless ad insertion! Same bitrate, no buffering.
```

---

## 📊 **Your Live Stream Setup**

First, identify your live stream's bitrate ladder. Check your origin stream:

```bash
# Fetch your live stream master playlist
curl "http://localhost:8787/demo/sports/scte35.m3u8"

# Look for lines like:
#EXT-X-STREAM-INF:BANDWIDTH=1000000  ← 1Mbps
#EXT-X-STREAM-INF:BANDWIDTH=2000000  ← 2Mbps
#EXT-X-STREAM-INF:BANDWIDTH=3000000  ← 3Mbps
```

**Example: Unified Streaming Demo**
```
Common bitrates:
- audio_eng=128000-video=700000   (700kbps)
- audio_eng=128000-video=1000000  (1Mbps)
- audio_eng=128000-video=2000000  (2Mbps)
- audio_eng=128000-video=3000000  (3Mbps)
```

---

## 🎬 **Workflow: Creating Matched Ads**

### **Method 1: FFmpeg Transcoding (Recommended)**

#### **Step 1: Get Your Bitrates**

Identify your stream bitrates:
```bash
# Example for your demo stream
1000k, 2000k, 3000k
```

#### **Step 2: Transcode Your Commercial**

```bash
./transcode-ad.sh summer-sale.mp4 ./ads/summer-sale 1000k,2000k,3000k
```

This creates:
```
ads/summer-sale/
├─ master.m3u8              # Master playlist
├─ 1000k/
│  ├─ playlist.m3u8         # 1Mbps variant
│  └─ segment_*.ts
├─ 2000k/
│  ├─ playlist.m3u8         # 2Mbps variant
│  └─ segment_*.ts
└─ 3000k/
   ├─ playlist.m3u8         # 3Mbps variant
   └─ segment_*.ts
```

#### **Step 3: Upload to R2**

```bash
# Upload to Cloudflare R2
npx wrangler r2 object put ads-bucket/summer-sale/master.m3u8 \
  --file=./ads/summer-sale/master.m3u8

npx wrangler r2 object put ads-bucket/summer-sale/1000k/playlist.m3u8 \
  --file=./ads/summer-sale/1000k/playlist.m3u8

# ... repeat for each variant and segments
# Or use recursive upload (if available)
```

#### **Step 4: Get R2 Public URLs**

Your R2 bucket needs a public URL:
```
https://pub-XXXXX.r2.dev/summer-sale/1000k/playlist.m3u8
https://pub-XXXXX.r2.dev/summer-sale/2000k/playlist.m3u8
https://pub-XXXXX.r2.dev/summer-sale/3000k/playlist.m3u8
```

#### **Step 5: Create Ad Pod in GUI**

1. Go to **Ad Pods** → **New Ad Pod**
2. Name: "Summer Sale Ad"
3. Pod ID: `summer-sale-001`
4. Duration: `30`
5. **Add Bitrate Variants:**
   - Bitrate: `1000000`, URL: `https://pub-XXXXX.r2.dev/summer-sale/1000k/playlist.m3u8`
   - Bitrate: `2000000`, URL: `https://pub-XXXXX.r2.dev/summer-sale/2000k/playlist.m3u8`
   - Bitrate: `3000000`, URL: `https://pub-XXXXX.r2.dev/summer-sale/3000k/playlist.m3u8`
6. Save

---

### **Method 2: Cloudflare Stream (Auto-Bitrates)**

If you use Cloudflare Stream, it auto-generates bitrates. You'll need to:

1. Upload via Ads Library
2. Wait for "ready" status
3. **Check what bitrates Stream created**
4. **Map them to your stream bitrates**

**Example mapping:**
```
Your Stream: 1000k, 2000k, 3000k
Stream Auto: 800k,  1600k, 2400k

Mapping (closest match):
- 1000k stream → 800k ad   (close enough)
- 2000k stream → 1600k ad  (close enough)
- 3000k stream → 2400k ad  (close enough)
```

**Downside:** Not exact, may cause small bitrate jumps.

---

## 🏗️ **Advanced: Automated Transcoding Service**

For production, integrate transcoding into the upload flow:

### **Architecture:**

```
User uploads MP4 → Admin API → Transcode Worker → R2 → Ad Pod
```

### **Implementation Steps:**

1. **Create Transcode Worker**
   - Receives video + target bitrates
   - Uses FFmpeg (via external service or DO)
   - Uploads results to R2
   - Updates database with URLs

2. **Update Admin GUI**
   - Add "Target Bitrates" field
   - Use channel's detected bitrates as default
   - Auto-transcode on upload

3. **Auto-Detect Stream Bitrates**
   - Fetch channel origin manifest
   - Parse bitrate ladder
   - Store in channel config
   - Use for ad transcoding

---

## 📝 **FFmpeg Transcode Script Details**

The `transcode-ad.sh` script:

### **What It Does:**

1. Accepts input video + target bitrates
2. For each bitrate:
   - Transcodes to exact bitrate
   - Adjusts resolution appropriately
   - Creates HLS playlist + segments
3. Creates master playlist
4. Outputs organized directory structure

### **Quality Settings:**

```bash
-c:v libx264          # H.264 codec (widely supported)
-b:v ${BITRATE}       # Target video bitrate
-maxrate ${BITRATE}   # Max bitrate (for CBR)
-bufsize ${2*BITRATE} # Buffer size
-preset medium        # Encoding speed vs quality
-g 60                 # Keyframe every 60 frames (2s at 30fps)
-c:a aac              # AAC audio codec
-b:a 128k             # Audio bitrate
```

### **HLS Settings:**

```bash
-f hls                # Output format: HLS
-hls_time 6           # 6-second segments
-hls_list_size 0      # No limit on playlist size
```

### **Resolution Mapping:**

```
< 800kbps   → 640x360   (360p)
< 1500kbps  → 854x480   (480p)
< 2500kbps  → 1280x720  (720p)
≥ 2500kbps  → 1920x1080 (1080p)
```

---

## 🧪 **Testing**

### **Test Transcoded Ad:**

```bash
# Start local HTTP server
cd ads
python3 -m http.server 8000

# Test in VLC
vlc http://localhost:8000/summer-sale/master.m3u8

# Or test a specific variant
vlc http://localhost:8000/summer-sale/2000k/playlist.m3u8
```

### **Verify Bitrate:**

```bash
# Check actual bitrate of transcoded file
ffprobe -v error -show_entries stream=bit_rate \
  -of default=noprint_wrappers=1:nokey=1 \
  ads/summer-sale/2000k/segment_000.ts

# Should output ~2000000 (2Mbps)
```

### **Test Ad Insertion:**

```bash
# Trigger ad break with your ad
curl -X POST "http://localhost:8787/cue" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "sports",
    "duration": 30,
    "pod_id": "summer-sale-001"
  }'

# Watch stream in VLC - should switch seamlessly to ad
vlc "http://localhost:8787/demo/sports/scte35-audio_eng=128000-video=2000000.m3u8"
```

---

## 🎯 **Best Practices**

### **1. Match Exactly**
✅ Use **exact same bitrates** as your live stream  
❌ Don't rely on "close enough" bitrates

### **2. Consistent GOP**
✅ Use same keyframe interval as your stream  
❌ Different GOP can cause alignment issues

### **3. Test All Variants**
✅ Test each bitrate individually  
❌ Don't assume if 2Mbps works, all work

### **4. Monitor Quality**
✅ Check for artifacts at lower bitrates  
❌ Don't just transcode and assume quality is good

### **5. Organize Assets**
✅ Use consistent naming: `ad-name/1000k/playlist.m3u8`  
❌ Random file names make debugging hard

---

## 🚨 **Troubleshooting**

### **Ad Causes Buffering**

**Diagnosis:**
```bash
# Check bitrate mismatch
# Live stream: 2000k
# Ad: 1600k or 2400k
```

**Fix:** Re-transcode ad to exact 2000k

### **Quality Jumps During Ad**

**Cause:** Resolution or bitrate mismatch  
**Fix:** Ensure resolution scales appropriately for bitrate

### **Playback Fails at Ad**

**Cause:** CORS, missing files, or format mismatch  
**Fix:** 
- Check R2 CORS settings
- Verify all `.ts` segments uploaded
- Check HLS format matches stream

---

## 📚 **Reference**

### **Common Live Stream Bitrate Ladders:**

**Low Latency (Mobile-First):**
```
500k, 1000k, 2000k
```

**Standard (Desktop + Mobile):**
```
800k, 1200k, 2000k, 3000k
```

**High Quality (Premium):**
```
1000k, 2000k, 3000k, 5000k, 8000k
```

### **Recommended Resolutions:**

| Bitrate | Resolution | Use Case |
|---------|-----------|----------|
| 500k | 480x270 | Mobile, poor connection |
| 800k | 640x360 | Mobile, average connection |
| 1200k | 854x480 | Mobile, good connection |
| 2000k | 1280x720 | Desktop, HD |
| 3000k | 1920x1080 | Desktop, Full HD |
| 5000k+ | 1920x1080 | Desktop, High quality |

---

## 🎬 **Quick Start**

```bash
# 1. Identify your stream bitrates
curl "http://localhost:8787/demo/sports/scte35.m3u8" | grep BANDWIDTH

# 2. Transcode your ad
./transcode-ad.sh my-commercial.mp4 ./ads/my-ad 1000k,2000k,3000k

# 3. Upload to R2 (or test locally)
python3 -m http.server 8000

# 4. Create Ad Pod with exact URLs
# Use Admin GUI → Ad Pods → New Ad Pod
# Add each bitrate variant

# 5. Test!
curl -X POST "http://localhost:8787/cue" -d '{"channel":"sports","pod_id":"my-ad"}'
```

---

**Exact bitrate matching = Seamless ad insertion!** ✨

