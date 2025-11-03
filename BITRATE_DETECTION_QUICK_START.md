# Bitrate Detection Quick Start Guide

## What This Feature Does

Detects available bitrates from your origin HLS stream and ensures ads are transcoded to **exact matching bitrates**, eliminating playback buffering caused by bitrate mismatches.

## 30-Second Overview

1. **Enter origin URL** → Click "Detect Bitrates" → See detected ladder
2. **Review/Edit** bitrates if needed → Save channel
3. **Upload ads** → They automatically transcode to channel's bitrates
4. **No more buffering** from mismatched bitrates!

## Backend Implementation (Complete ✅)

### New Files
- `src/utils/bitrate-detection.ts` - Detection logic
- `BITRATE_DETECTION_UI_GUIDE.md` - Frontend integration guide
- `BITRATE_DETECTION_IMPLEMENTATION.md` - Full technical documentation
- `test-bitrate-detection.sh` - Automated test script

### Modified Files
- `src/admin-api-worker.ts` - Added detection endpoint and enhanced bitrate resolution

### Database Schema
Already exists! Migrations `005` and `006` added required fields:
- `bitrate_ladder` (TEXT) - Configured bitrates (JSON array)
- `bitrate_ladder_source` (TEXT) - "auto" or "manual"
- `detected_bitrates` (TEXT) - Original detected values
- `last_bitrate_detection` (INTEGER) - Timestamp

## API Endpoints

### Detect Bitrates
```bash
POST /api/channels/detect-bitrates
Body: { "originUrl": "https://..." }
Returns: { "success": true, "bitrates": [800, 1600, ...], "variants": [...] }
```

### Create/Update Channel
```bash
POST/PUT /api/channels/:id
Body: {
  "bitrate_ladder": [800, 1600, 2400],
  "bitrate_ladder_source": "auto",
  "detected_bitrates": [800, 1600, 2400],
  "last_bitrate_detection": 1699999999999
}
```

## Testing

### Quick Test
```bash
# Make executable
chmod +x test-bitrate-detection.sh

# Run tests (update credentials first)
./test-bitrate-detection.sh
```

### Manual Test
```bash
# 1. Start admin API
npm run dev:admin-api

# 2. Detect bitrates
curl -X POST http://localhost:8791/api/channels/detect-bitrates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"originUrl":"https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8"}'

# Should return detected bitrates from Apple's test stream
```

## Frontend Integration TODOs

The backend is **complete and working**. Frontend needs:

### 1. Channel Create/Edit Form
```tsx
// Add these UI elements:
<input type="url" placeholder="Origin URL" />
<button onClick={detectBitrates}>🔍 Detect Bitrates</button>
<BitrateEditor bitrates={detected} onChange={setBitrates} />
<span className="badge">{source === 'auto' ? '✅ Auto' : '✏️ Manual'}</span>
```

### 2. Channel Detail View
```tsx
// Add these action buttons:
<button onClick={redetectBitrates}>🔄 Re-detect Bitrates</button>
<button onClick={retranscodeAllAds}>🎬 Re-transcode All Ads</button>
```

### 3. API Calls
```typescript
// Detection
const result = await fetch('/api/channels/detect-bitrates', {
  method: 'POST',
  body: JSON.stringify({ originUrl }),
  headers: { 'Authorization': `Bearer ${token}` }
})

// Save channel with bitrates
await fetch('/api/channels', {
  method: 'POST',
  body: JSON.stringify({
    ...channelData,
    bitrate_ladder: detectedBitrates,
    bitrate_ladder_source: 'auto'
  })
})
```

See `BITRATE_DETECTION_UI_GUIDE.md` for complete React examples.

## How It Works

```
User Flow:
┌─────────────┐
│ Enter       │
│ Origin URL  │
└──────┬──────┘
       │
       ▼
┌─────────────┐      ┌──────────────┐
│ Click       │─────▶│ Fetch Master │
│ "Detect"    │      │ Manifest     │
└─────────────┘      └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Parse        │
                     │ BANDWIDTH    │
                     │ Values       │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Display      │
                     │ Bitrates     │
                     │ [800,1600..] │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ User         │
                     │ Reviews/Edit │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Save         │
                     │ Channel      │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Ads Auto     │
                     │ Transcode to │
                     │ These Rates  │
                     └──────────────┘
```

## Smart Bitrate Resolution

When transcoding an ad, the system automatically finds the best bitrate ladder:

1. ✅ Channel's `bitrate_ladder` (if configured)
2. ⚠️ Fallback to `detected_bitrates` (legacy)
3. ℹ️ Organization's first active channel's ladder
4. 🔄 Default: `[800, 1600, 2400, 3600]`

## Common Scenarios

### Scenario 1: New Channel
```
User creates channel with origin URL
  → Clicks "Detect Bitrates"
  → System fetches master.m3u8
  → Detects: [500, 1000, 2000, 4000] kbps
  → User saves channel
  → All uploaded ads transcode to these exact bitrates
```

### Scenario 2: Change Bitrates
```
User edits channel
  → Clicks "Re-detect Bitrates" or manually edits
  → New ladder: [800, 1600, 2400, 3600]
  → Clicks "Re-transcode All Ads"
  → All ads for this channel re-transcode to new bitrates
```

### Scenario 3: No Origin URL
```
Channel has no origin URL configured
  → Uses organization's other channels as reference
  → Or falls back to sensible default [800, 1600, 2400, 3600]
```

## Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Invalid URL format" | Bad URL syntax | Check URL format |
| "Request timeout" | Can't reach origin | Verify URL is accessible |
| "HTTP 404" | Manifest not found | Check manifest path |
| "Not a valid HLS manifest" | Missing #EXTM3U | Verify it's an HLS file |
| "No playable variants found" | No BANDWIDTH tags | Check manifest format |
| "Bitrates must be in ascending order" | Invalid ladder | Sort bitrates low to high |

## Key Logs to Watch

```bash
# Start admin API with logs
npm run dev:admin-api

# Look for these in logs:
🔍 Detecting bitrates from: <URL>          # Detection started
✅ Detected 4 bitrates: 800, 1600... kbps  # Success
❌ Bitrate detection failed: <error>       # Error
✅ Using channel bitrate ladder (auto)     # Using config
⚠️ Using default bitrate ladder            # Fallback
```

## Production Checklist

Backend (Complete):
- [x] Detection utility implemented
- [x] API endpoint added
- [x] Channel CRUD updated
- [x] Transcoding integration
- [x] Validation logic
- [x] Error handling
- [x] Logging
- [x] Test script

Frontend (TODO):
- [ ] Origin URL input field
- [ ] Detect button + loading state
- [ ] Bitrate display/editor
- [ ] Source indicator badge
- [ ] Re-detect button
- [ ] Bulk re-transcode button
- [ ] Error message display
- [ ] Validation feedback

## Support

- **Full Docs**: `BITRATE_DETECTION_IMPLEMENTATION.md`
- **Frontend Guide**: `BITRATE_DETECTION_UI_GUIDE.md`
- **Test Script**: `./test-bitrate-detection.sh`
- **Example Stream**: Apple test stream (used in tests)

## Example Origin URLs for Testing

```
# Apple Test Stream (multi-bitrate)
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8

# Should detect multiple bitrates (typically 4-8 variants)
```

---

**Status**: Backend ✅ Complete | Frontend ⏳ Ready for Integration

**Next Step**: Frontend team implements UI components using `BITRATE_DETECTION_UI_GUIDE.md`
