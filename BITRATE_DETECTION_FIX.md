# Bitrate Detection Fix - November 3, 2025

## 🐛 Issues Fixed

### Issue 1: HTML5 Number Input Validation Error ✅ FIXED

**Problem:**
```
"Please enter a valid value. The two nearest valid values are 100 and 200"
```

**Root Cause:**
- Line 138 in `BitrateDetector.tsx` had `step="100"`
- HTML5 number inputs with `step` attribute only allow values that are multiples of the step
- Example: With `step="100"`, values like 150, 236, 1316 are invalid

**Fix:**
```typescript
// Before:
<input type="number" step="100" ... />

// After:
<input type="number" step="1" ... />
```

**Result:** Now accepts any integer bitrate value (no validation errors)

---

### Issue 2: Low Bitrate Values in Screenshot

**Observed Values:**
- 150 kbps
- 1316 kbps

**Possible Causes:**

1. **Audio-only variants detected**
   - Some HLS manifests include audio-only streams (typically 64-192 kbps)
   - Detection should filter these out

2. **Manual entry error**
   - User may have manually entered these values
   - Old validation prevented correction

3. **Origin manifest issue**
   - Origin may have unusual bitrate ladder
   - Need to see raw detection data to diagnose

---

## ✨ New Feature: Raw Data Display

Added debug view to show actual API response:

**Location:** After detecting bitrates, click "▶ Show Raw Detection Data"

**What It Shows:**
```json
{
  "success": true,
  "bitrates": [236, 500, 748, 1102, 1600, 2500, 3632],
  "variants": [
    {
      "bandwidth": 236000,
      "bitrate": 236,
      "resolution": "416x234",
      "uri": "v5/prog_index.m3u8"
    },
    {
      "bandwidth": 500000,
      "bitrate": 500,
      "resolution": "480x270",
      "uri": "v4/prog_index.m3u8"
    }
    // ... etc
  ]
}
```

**Purpose:**
- Verify detection is working correctly
- See actual bandwidth values from origin
- Debug unusual bitrate ladders
- Identify audio-only variants

---

## 🚀 Deployment

**Deployed to Production:**
- URL: https://main.ssai-admin.pages.dev
- Latest: https://91bd844e.ssai-admin.pages.dev
- Time: November 3, 2025 01:00 UTC
- Status: ✅ Live

**Changes:**
1. ✅ Fixed `step="1"` in number input
2. ✅ Added raw data display component
3. ✅ Stores API response in state for debugging

---

## 🧪 How to Test

### 1. Clear Browser Cache

```bash
# Hard refresh in browser
# Chrome/Edge: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
# Safari: Cmd+Option+R
# Or use private/incognito window
```

### 2. Test With Known Good Stream

**Apple Test Stream:**
```
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
```

**Expected Result:**
```
Bitrates: 236, 500, 748, 1102, 1600, 2500, 3632 kbps
Status: ✅ Auto-detected
```

### 3. Verify Input Accepts Any Value

Try entering these values manually:
- ✅ 150 (should work now)
- ✅ 1316 (should work now)
- ✅ 236 (should work)
- ✅ 1500 (should work)

**No more validation errors!**

### 4. Check Raw Data

1. Detect bitrates from origin
2. Click "▶ Show Raw Detection Data"
3. Verify JSON structure:
   - `success: true`
   - `bitrates` array has values
   - `variants` array has details
   - No audio-only streams (<200 kbps)

---

## 🔍 Diagnostic Checklist

If you still see issues:

### Issue: Still Getting Validation Errors

**Check:**
- [ ] Hard refresh browser (Cmd+Shift+R)
- [ ] Clear browser cache completely
- [ ] Try incognito/private window
- [ ] Check deployment URL is https://main.ssai-admin.pages.dev (not old cached version)

### Issue: Unusually Low Bitrates Detected

**Steps:**
1. Click "Show Raw Detection Data"
2. Look at `variants` array
3. Check if any have:
   - `bandwidth < 200000` (< 200 kbps) → likely audio-only
   - Missing `resolution` → could be audio-only
   - Very low resolution (e.g., "160x90") → extremely low quality

**If Audio-Only Detected:**
We may need to add filtering:
```typescript
// Filter out audio-only variants (< 200 kbps)
const videoVariants = variants.filter(v => v.bitrate >= 200)
```

### Issue: Detection Returns Wrong Bitrates

**Get Raw Origin Manifest:**
```bash
# Fetch origin manifest directly
curl "YOUR_ORIGIN_URL" > manifest.txt

# Check for BANDWIDTH values
grep "BANDWIDTH" manifest.txt

# Example output:
# #EXT-X-STREAM-INF:BANDWIDTH=236000,RESOLUTION=416x234
# #EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=480x270
```

**Compare:**
- BANDWIDTH values in manifest (in bps)
- Detected bitrates in GUI (in kbps)
- Should be: BANDWIDTH / 1000 = bitrate

---

## 📊 Understanding Bitrate Values

### Typical HLS Bitrate Ladder

**Low Quality (Mobile/Poor Connection):**
- 200-500 kbps
- Resolution: 416x234 to 640x360
- Use case: 3G/4G networks

**Medium Quality (Standard HD):**
- 800-1600 kbps
- Resolution: 960x540 to 1280x720
- Use case: WiFi, good 4G/5G

**High Quality (Full HD):**
- 2400-3600 kbps
- Resolution: 1920x1080
- Use case: High-speed WiFi/Ethernet

**Ultra HD (4K):**
- 6000-12000 kbps
- Resolution: 3840x2160
- Use case: Fiber/high-speed connections

### Audio-Only Variants

**Should be filtered out:**
- 64-192 kbps
- No video resolution
- Only audio codec specified

---

## 🔧 Next Steps

### If You See Low Bitrates (< 200 kbps)

1. **Check Raw Data**
   - Click "Show Raw Detection Data"
   - Share the JSON output with developer

2. **Manual Override**
   - Delete the low bitrates
   - Click "+ Add Bitrate"
   - Enter correct values manually
   - Badge will show "✏️ Manual"

3. **Report Origin URL**
   - Share the origin URL
   - Developer can investigate manifest
   - May need to add audio filtering

### If Validation Still Failing

1. **Verify Deployment**
   ```bash
   # Check latest deployment
   curl -I https://main.ssai-admin.pages.dev
   # Look for: x-deployment-id: 91bd844e (or newer)
   ```

2. **Check Browser Console**
   - Open DevTools (F12)
   - Check Console for errors
   - Check Network tab for API calls

3. **Test Locally**
   ```bash
   cd admin-frontend
   npm run dev
   # Visit http://localhost:3000
   # Test bitrate detection
   ```

---

## 📝 Code Changes Summary

### File: `admin-frontend/src/components/BitrateDetector.tsx`

**Line 22-24:** Added state for raw data
```typescript
const [rawData, setRawData] = useState<any>(null)
const [showRawData, setShowRawData] = useState(false)
```

**Line 36-37:** Store API response
```typescript
const result = await api.detectBitrates(originUrl)
setRawData(result) // Store raw API response
```

**Line 141:** Fixed validation
```typescript
step="1"  // Was: step="100"
```

**Line 164-180:** Added debug view
```typescript
{/* Raw Data Debug View */}
{rawData && (
  <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
    <button onClick={() => setShowRawData(!showRawData)}>
      {showRawData ? '▼' : '▶'} Show Raw Detection Data
    </button>
    {showRawData && (
      <pre className="mt-2 p-3 bg-white border border-gray-200 rounded text-xs overflow-x-auto">
        {JSON.stringify(rawData, null, 2)}
      </pre>
    )}
  </div>
)}
```

---

## ✅ Verification

**To confirm fix is working:**

1. Visit: https://main.ssai-admin.pages.dev/channels
2. Click "New Channel" or "Edit" existing channel
3. Scroll to "Bitrate Configuration"
4. Manually enter: `150`
5. **Expected:** No validation error ✅
6. Manually enter: `1316`
7. **Expected:** No validation error ✅
8. Click "Detect Bitrates" on valid origin URL
9. Click "Show Raw Detection Data"
10. **Expected:** See JSON with bitrates and variants ✅

---

## 🐞 Known Issues & Workarounds

### Audio-Only Variants

**Issue:** Some origins include audio-only streams in master manifest  
**Detection:** Very low bitrates (< 200 kbps) without video resolution  
**Workaround:** Manually delete these bitrates before saving  
**Future Fix:** Add filtering in detection utility

### Browser Caching

**Issue:** Old deployment may be cached  
**Solution:** Hard refresh (Cmd+Shift+R) or use incognito  

### Origin CORS

**Issue:** Some origins may block requests from worker  
**Solution:** Detection happens server-side (worker), not browser  
**If Fails:** Check Admin API logs: `wrangler tail cf-ssai-admin-api`

---

## 📞 Support Commands

```bash
# View admin API logs (detection)
wrangler tail cf-ssai-admin-api

# View frontend deployment
wrangler pages deployment list --project-name=ssai-admin

# Redeploy if needed
cd admin-frontend
./deploy-prod.sh https://cf-ssai-admin-api.mediamasters.workers.dev

# Test locally
cd admin-frontend
npm run dev
```

---

**Status:** ✅ Fix deployed and verified  
**Last Updated:** November 3, 2025 01:00 UTC
