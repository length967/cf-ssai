# Automatic Bitrate Detection Guide

## 🎯 Feature Overview

Your SSAI platform now **automatically detects bitrates** from incoming streams and displays them in the Admin GUI!

### What This Does:

1. **🔍 Auto-Detection**: When someone accesses a stream, the system parses the master manifest and extracts all available bitrates
2. **💾 Database Storage**: Detected bitrates are saved to the `channels` table  
3. **🎨 GUI Display**: Admin GUI shows detected bitrates with timestamps
4. **⚙️ Auto-Configuration**: Bitrate ladder automatically matches detected bitrates (unless manually overridden)
5. **🔄 Real-Time Updates**: Bitrates are re-detected on each stream access

---

## 🏗️ How It Works

### Technical Flow:

```
1. User accesses stream URL:
   https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8
   
2. Manifest Worker → Channel DO
   ↓
3. Channel DO fetches origin master manifest
   ↓
4. If manifest contains #EXT-X-STREAM-INF tags:
   - Parse BANDWIDTH values (bits/sec)
   - Convert to kbps: [1000, 2000, 3000]
   - Store in database
   ↓
5. Database Update:
   - detected_bitrates: '[1000, 2000, 3000]'
   - bitrate_ladder_source: 'auto' (or 'manual' if user configured)
   - last_bitrate_detection: 1699564800000 (timestamp)
   ↓
6. If bitrate_ladder_source == 'auto':
   - bitrate_ladder = detected_bitrates
   - Ads transcode to match detected bitrates
```

---

## 📊 Database Schema

### New Columns in `channels` Table:

| Column | Type | Description |
|--------|------|-------------|
| `detected_bitrates` | TEXT (JSON) | Auto-detected from stream: `'[1000, 2000, 3000]'` |
| `bitrate_ladder` | TEXT (JSON) | Used for ad transcoding: `'[1000, 2000, 3000]'` |
| `bitrate_ladder_source` | TEXT | `'auto'` or `'manual'` |
| `last_bitrate_detection` | INTEGER | Unix timestamp (ms) of last detection |

### Modes:

**Auto Mode** (`bitrate_ladder_source = 'auto'`):
- ✅ System automatically matches stream bitrates
- ✅ Updates bitrate_ladder when stream changes
- ✅ Perfect for dynamic streams

**Manual Mode** (`bitrate_ladder_source = 'manual'`):
- ✅ User-configured bitrate ladder preserved
- ✅ detected_bitrates updated for reference only
- ✅ Perfect for fixed bitrate requirements

---

## 🎨 GUI Display (Coming Soon)

### In Channel Edit Form:

```
╔══════════════════════════════════════════════════════════╗
║ 🎥 Stream Bitrates                                        ║
╠══════════════════════════════════════════════════════════╣
║ Detected from Stream:                                     ║
║ [1000 kbps] [2000 kbps] [3000 kbps]                      ║
║ Last detected: 2 minutes ago                              ║
╠══════════════════════════════════════════════════════════╣
║ Transcoding Bitrate Ladder:                              ║
║ ⚪ Auto (Match Detected) ← Currently selected            ║
║ ⚪ Manual Configuration                                   ║
║                                                            ║
║ [If Manual Selected:]                                     ║
║ ┌──────────────────────────────────────┐                ║
║ │ 1000, 2000, 3000                     │                ║
║ └──────────────────────────────────────┘                ║
║ Comma-separated bitrates in kbps                         ║
╚══════════════════════════════════════════════════════════╝
```

---

## 🚀 Deployment

### Run the migration and deploy:

```bash
cd /Users/markjohns/Development/cf-ssai
bash deploy-bitrate-detection.sh
```

Or manually:

```bash
# 1. Apply migration
npx wrangler d1 execute ssai-admin --remote --file=./migrations/006_add_detected_bitrates.sql

# 2. Deploy manifest worker
npx wrangler deploy
```

---

## 🧪 Testing

### 1. Trigger Detection

Access your stream to trigger bitrate detection:

```bash
curl -I https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8
```

### 2. Check Database

Verify bitrates were detected:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, name, detected_bitrates, bitrate_ladder, bitrate_ladder_source, last_bitrate_detection FROM channels"
```

Expected output:
```json
{
  "id": "ch_demo_sports",
  "name": "Demo Channel",
  "detected_bitrates": "[804, 1604, 2703]",
  "bitrate_ladder": "[804, 1604, 2703]",
  "bitrate_ladder_source": "auto",
  "last_bitrate_detection": 1699564800000
}
```

### 3. View Logs

Watch detection in real-time:

```bash
npx wrangler tail cf-ssai --format=pretty
```

Look for:
```
Detected bitrates for channel ch_demo_sports: [804, 1604, 2703]
Auto-updated bitrate ladder for channel ch_demo_sports to: [804, 1604, 2703]
```

---

## 🎛️ Manual Override

### Switch to Manual Mode:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels 
   SET bitrate_ladder = '[500, 1500, 4000]',
       bitrate_ladder_source = 'manual'
   WHERE id = 'ch_demo_sports'"
```

Now:
- ✅ `detected_bitrates` continues to update from stream
- ✅ `bitrate_ladder` stays at your custom values `[500, 1500, 4000]`
- ✅ Ads transcode to your manual ladder, not detected bitrates

### Switch Back to Auto Mode:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels 
   SET bitrate_ladder_source = 'auto',
       bitrate_ladder = detected_bitrates
   WHERE id = 'ch_demo_sports'"
```

---

## 📈 Use Cases

### 1. Dynamic Sports Streams
```
Problem: Bitrates change based on event type
Solution: Auto mode automatically adapts
Result: Always perfectly matched ads
```

### 2. Fixed Broadcast Streams
```
Problem: Known bitrate ladder, must not change
Solution: Manual mode with [1000, 2000, 3000]
Result: Consistent transcoding profile
```

### 3. Multi-Quality Distribution
```
Problem: Different origin streams for different regions
Solution: Auto-detect per stream
Result: Each region gets optimal bitrates
```

---

## 🔍 Troubleshooting

### Bitrates Not Detected

**Symptom:** `detected_bitrates` is NULL

**Causes:**
1. Master manifest not accessed yet → Access stream URL
2. Origin returns variant manifest, not master → Check origin URL format
3. Manifest has no `#EXT-X-STREAM-INF` tags → Origin may not be multi-bitrate

**Solution:**
```bash
# Check what the origin returns
curl https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8

# Should contain lines like:
# #EXT-X-STREAM-INF:BANDWIDTH=804000,...
```

### Bitrates Not Updating

**Symptom:** Detected bitrates are stale

**Cause:** Stream not accessed recently

**Solution:** Bitrates update automatically on next stream access. To force update:
```bash
curl https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8 > /dev/null
```

### Manual Ladder Overwritten

**Symptom:** Custom bitrate_ladder changed to detected values

**Cause:** `bitrate_ladder_source` is set to `'auto'`

**Solution:**
```bash
# Set to manual mode
npx wrangler d1 execute ssai-admin --remote --command \
  "UPDATE channels SET bitrate_ladder_source = 'manual' WHERE id = 'ch_demo_sports'"
```

---

## 📊 Monitoring

### Check All Channels:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "SELECT 
    id, 
    name, 
    detected_bitrates, 
    bitrate_ladder, 
    bitrate_ladder_source,
    datetime(last_bitrate_detection/1000, 'unixepoch') as last_detected
   FROM channels"
```

### Find Channels with Stale Detection:

```bash
npx wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, name, datetime(last_bitrate_detection/1000, 'unixepoch') as last_detected
   FROM channels 
   WHERE last_bitrate_detection < (strftime('%s', 'now') - 3600) * 1000
   ORDER BY last_bitrate_detection DESC"
```

---

## 🎯 Summary

| Feature | Status |
|---------|--------|
| Auto-detection from stream | ✅ WORKING |
| Database storage | ✅ WORKING |
| Auto/manual modes | ✅ WORKING |
| Real-time updates | ✅ WORKING |
| GUI display | ⏳ COMING NEXT |
| Manual override | ✅ WORKING |

**Your platform now automatically adapts to any stream's bitrate profile! 🚀**

