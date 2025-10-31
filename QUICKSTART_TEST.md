# 🚀 Quick Start Testing Guide

Follow these steps to test all the immediate fixes in under 5 minutes.

---

## Step 1: Start the Dev Server

Open a terminal and run:

```bash
npm run dev:manifest
```

**Expected output:**
```
⛅️ wrangler
------------------
⎔ Starting local server...
[wrangler:inf] Ready on http://127.0.0.1:8787
```

✅ **Keep this terminal open!** The dev server must stay running for all tests.

---

## Step 2: Open a New Terminal

In a **new terminal window/tab**, navigate to the project:

```bash
cd /Users/markjohns/Development/cf-ssai
```

---

## Step 3: Run Quick Manual Tests

### ✅ Test 1: SGAI Mode (Server-Guided Ads)

```bash
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"
```

**Look for:**
- `#EXT-X-DATERANGE` tag ← SGAI uses this
- `CLASS="com.apple.hls.interstitial"` ← Apple's interstitial standard
- `X-ASSET-URI="https://..."` ← Signed ad URL
- URL contains `token=` and `exp=` ← Signature verification

### ✅ Test 2: SSAI Mode (Server-Side Ads)

```bash
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=ssai"
```

**Look for:**
- `#EXT-X-DISCONTINUITY` tag ← SSAI uses this instead
- NO DATERANGE tags

### ✅ Test 3: Bitrate Matching (1600k)

```bash
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai" | grep "v_1600k"
```

**Should see:** `v_1600k` in the ad pod URL (matches viewer bitrate)

### ✅ Test 4: Bitrate Matching (800k)

```bash
curl "http://127.0.0.1:8787?channel=ch1&variant=v_800k.m3u8&force=sgai" | grep "v_800k"
```

**Should see:** `v_800k` in the ad pod URL (lower bitrate for slower connection)

### ✅ Test 5: Auto-Detection (iOS gets SGAI)

```bash
curl -H "User-Agent: Mozilla/5.0 (iPhone)" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8" | grep "DATERANGE"
```

**Should see:** DATERANGE tag (auto-detected iOS → SGAI)

### ✅ Test 6: Auto-Detection (Chrome gets SSAI)

```bash
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0) Chrome/120.0" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8" | grep "DISCONTINUITY"
```

**Should see:** DISCONTINUITY tag (auto-detected Chrome → SSAI)

---

## Step 4: Run Automated Test Suite

Run all tests automatically:

```bash
./test-local.sh
```

**Expected output:**
```
🧪 Testing Cloudflare SSAI/SGAI Immediate Fixes
================================================

✅ Dev server is running

Test 1: SGAI mode inserts DATERANGE... ✅ PASS
Test 2: SSAI mode inserts DISCONTINUITY... ✅ PASS
Test 3: SGAI includes interstitial class... ✅ PASS
Test 4: 1600k variant gets 1600k ads... ✅ PASS
Test 5: 800k variant gets 800k ads... ✅ PASS
Test 6: Missing channel returns 400... ✅ PASS
Test 7: Signed URLs include token... ✅ PASS
Test 8: Signed URLs include expiration... ✅ PASS
Test 9: iOS User-Agent gets SGAI... ✅ PASS
Test 10: Chrome User-Agent gets SSAI... ✅ PASS
Test 11: force=ssai overrides iOS UA... ✅ PASS
Test 12: Content-Type is HLS... ✅ PASS

================================================
Results: 12 passed, 0 failed

🎉 All tests passed! Your fixes are working correctly.
```

---

## Step 5: Inspect Beacon Queue Messages

Check the dev server terminal for beacon queue activity:

**Look for logs like:**
```json
{
  "event": "imp",
  "adId": "example-pod",
  "channel": "ch1",
  "metadata": {
    "variant": "v_1600k.m3u8",
    "bitrate": 1600000,
    "adVariant": "v_1600k"
  }
}
```

This confirms:
- ✅ Beacons are properly typed
- ✅ Bitrate metadata is captured
- ✅ Queue consumer is configured

---

## Step 6: Verify JWT Handling (Dev Mode)

### Test without JWT (should work in dev):

```bash
curl -i "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Should get:** `200 OK` (dev mode allows no auth)

### Test with fake JWT (should work in dev):

```bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiZXhwIjo5OTk5OTk5OTk5fQ.fake"
curl -i -H "Authorization: Bearer $JWT" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Should get:** `200 OK` + warning in logs: "DEV MODE: Bypassing JWT signature verification"

---

## 📊 Test Summary

If all tests pass, you've verified:

| ✅ Fix | Status |
|--------|---------|
| SGAI/SSAI logic clarity | Working |
| Queue consumer config | Configured |
| TypeScript types | Implemented |
| JWT verification | Ready (dev mode) |
| Bitrate-aware selection | Functioning |

---

## 🐛 Troubleshooting

### Dev server fails to start:

```bash
# Check wrangler version
npx wrangler --version

# Try explicit dev command
npx wrangler dev --local --test-scheduled src/manifest-worker.ts
```

### Tests fail:

**"Dev server not responding"**
- Ensure dev server is running in another terminal
- Try `curl http://127.0.0.1:8787` to verify it's up

**"Tests failed"**
- Check dev server terminal for error messages
- Verify `.dev.vars` file has all required variables
- Try restarting the dev server

### Permission errors during npm install:

```bash
# Fix npm cache permissions (if needed)
sudo chown -R $(whoami) ~/.npm
npm install
```

Or use the system's node if available:
```bash
# Check if wrangler is already installed globally
which wrangler
```

---

## ✨ What's Next?

Once all tests pass:

1. **Run unit tests** (if dependencies installed):
   ```bash
   npm test
   ```

2. **Review changes**:
   ```bash
   git diff
   ```

3. **Commit your work**:
   ```bash
   git add .
   git commit -m "fix: implement immediate security and functionality fixes

   - Add JWT signature verification with WebCrypto
   - Simplify SGAI/SSAI logic for maintainability
   - Implement bitrate-aware ad selection
   - Add proper TypeScript types for queue messages
   - Configure queue consumer for beacon processing"
   ```

4. **Deploy to staging/production**:
   ```bash
   # After setting production secrets
   wrangler deploy
   ```

---

## 📚 More Information

- **Full test details:** See `LOCAL_TESTING_GUIDE.md`
- **Implementation details:** See `IMMEDIATE_FIXES_SUMMARY.md`
- **Project context:** See `PROJECT_CONTEXT.md`

---

**Happy testing! 🎉**

