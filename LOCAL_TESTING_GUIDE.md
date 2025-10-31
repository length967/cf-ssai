# Local Testing Guide

This guide walks through testing all the immediate fixes locally before production deployment.

---

## Prerequisites

1. **Install dependencies:**
```bash
npm install
```

2. **Create `.dev.vars` file** (if not exists):
```bash
cat > .dev.vars << 'EOF'
ORIGIN_VARIANT_BASE=https://origin.example.com/hls
AD_POD_BASE=https://ads.example.com/pods
WINDOW_BUCKET_SECS=2
DECISION_TIMEOUT_MS=150
SIGN_HOST=media.example.com
JWT_PUBLIC_KEY=dev
JWT_ALGORITHM=HS256
SEGMENT_SECRET=dev_secret
DEV_ALLOW_NO_AUTH=1
EOF
```

---

## Test 1: Basic Unit Tests

Verify utility functions work correctly:

```bash
npm test
```

**Expected output:**
- ✅ `insertDiscontinuity()` tests pass
- ✅ `addDaterangeInterstitial()` tests pass
- ✅ `signPath()` tests pass
- ✅ `windowBucket()` tests pass
- ✅ `parseJWTUnsafe()` tests pass

---

## Test 2: Start Dev Server

```bash
npm run dev:manifest
```

**Expected output:**
```
⛅️ wrangler 3.x.x
------------------
Your worker has access to the following bindings:
- Durable Objects:
  - CHANNEL_DO: ChannelDO
- Queues:
  - BEACON_QUEUE (beacon-queue)
- R2 Buckets:
  - ADS_BUCKET (ads-bucket)

⎔ Starting local server...
[wrangler:inf] Ready on http://127.0.0.1:8787
```

Keep this terminal open and open a new terminal for testing.

---

## Test 3: SGAI (Server-Guided Ad Insertion)

Test that SGAI mode inserts DATERANGE interstitial tags:

```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"
```

**Verify:**
- ✅ Status 200 OK
- ✅ Content-Type: `application/vnd.apple.mpegurl`
- ✅ Response contains `#EXT-X-DATERANGE`
- ✅ Response contains `CLASS="com.apple.hls.interstitial"`
- ✅ Response contains `X-ASSET-URI` with signed URL
- ✅ Response contains token and exp parameters in URL

**Example expected snippet:**
```m3u8
#EXT-X-DATERANGE:ID="ad-31",CLASS="com.apple.hls.interstitial",START-DATE="2025-10-31T...",DURATION=30.000,X-ASSET-URI="https://media.example.com/example-pod/v_1600k/playlist.m3u8?token=...&exp=...",X-PLAYOUT-CONTROLS="skip-restrictions=6"
```

---

## Test 4: SSAI (Server-Side Ad Insertion)

Test that SSAI mode inserts DISCONTINUITY tags:

```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=ssai"
```

**Verify:**
- ✅ Status 200 OK
- ✅ Response contains `#EXT-X-DISCONTINUITY`
- ✅ No DATERANGE tags (SSAI uses discontinuity instead)

---

## Test 5: Bitrate-Aware Ad Selection (1600k)

Test that high bitrate viewer gets high bitrate ads:

```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"
```

**Verify:**
- ✅ X-ASSET-URI contains `/v_1600k/` (matches viewer bitrate)

**Check logs** (in dev server terminal):
Look for beacon message metadata showing:
```json
{
  "variant": "v_1600k.m3u8",
  "bitrate": 1600000,
  "adVariant": "v_1600k"
}
```

---

## Test 6: Bitrate-Aware Ad Selection (800k)

Test that low bitrate viewer gets appropriate ads:

```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_800k.m3u8&force=sgai"
```

**Verify:**
- ✅ X-ASSET-URI contains `/v_800k/` (matches viewer bitrate)
- ✅ Beacon metadata shows `bitrate: 800000` and `adVariant: "v_800k"`

---

## Test 7: JWT Authentication (Dev Mode)

### With No Auth (should work in dev mode):
```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Status 200 OK (DEV_ALLOW_NO_AUTH=1 allows this)

### With Fake JWT (should work in dev mode):
```bash
# Create a fake JWT for testing
JWT_HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64)
JWT_PAYLOAD=$(echo -n '{"sub":"user123","bucket":"A","exp":9999999999}' | base64)
FAKE_JWT="${JWT_HEADER}.${JWT_PAYLOAD}.fake_signature"

curl -v -H "Authorization: Bearer ${FAKE_JWT}" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"
```

**Verify:**
- ✅ Status 200 OK
- ✅ Dev server logs show: "DEV MODE: Bypassing JWT signature verification"

### Test Invalid JWT:
```bash
curl -v -H "Authorization: Bearer invalid.token" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Status 403 Forbidden (in production mode)
- ✅ Status 200 OK (in dev mode with DEV_ALLOW_NO_AUTH=1)

---

## Test 8: Queue Consumer (Beacon Processing)

Test that beacons are queued and processed:

### Trigger an ad break:
```bash
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"
```

**Check dev server logs for:**
```
Queue message sent: {
  event: "imp",
  adId: "example-pod",
  podId: "ad-31",
  channel: "ch1",
  ts: 1730390400000,
  trackerUrls: [],
  metadata: { variant: "v_1600k.m3u8", bitrate: 1600000, adVariant: "v_1600k" }
}
```

**Note:** In local dev, queues are simulated. The consumer should process messages asynchronously.

---

## Test 9: Cache Bucketing

Test that window bucketing works (requests within 2s use cache):

```bash
# First request (cache miss)
time curl -s "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8" > /dev/null

# Second request within 2 seconds (cache hit)
time curl -s "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8" > /dev/null
```

**Verify:**
- ✅ Second request is faster (cache hit)
- ✅ Both requests within same 2s window return identical content

```bash
# Wait 3+ seconds, then request again (cache miss, new window)
sleep 3
time curl -s "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8" > /dev/null
```

---

## Test 10: Auto-Detection (User-Agent Based)

Test SGAI auto-detection for iOS/Safari:

```bash
# iOS Safari (should get SGAI)
curl -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Response contains DATERANGE (SGAI mode)

```bash
# Chrome Desktop (should get SSAI)
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Response contains DISCONTINUITY (SSAI mode)

---

## Test 11: Error Handling

### Missing channel parameter:
```bash
curl -v "http://127.0.0.1:8787?variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Status 400 Bad Request
- ✅ Body: "channel required"

### Invalid variant (should fallback to synthetic manifest):
```bash
curl -v "http://127.0.0.1:8787?channel=nonexistent&variant=invalid.m3u8&force=sgai"
```

**Verify:**
- ✅ Status 200 OK
- ✅ Returns fallback manifest with synthetic segments

---

## Test 12: Signed URL Validation

Extract a signed URL from SGAI response and verify structure:

```bash
# Get SGAI response
RESPONSE=$(curl -s "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai")

# Extract X-ASSET-URI
echo "$RESPONSE" | grep -o 'X-ASSET-URI="[^"]*"'
```

**Verify the URL contains:**
- ✅ `https://media.example.com` (SIGN_HOST)
- ✅ `?token=...` (HMAC signature)
- ✅ `&exp=...` (expiration timestamp)
- ✅ exp is ~600 seconds in future (TTL)

---

## Test 13: Production Mode Simulation

Test JWT verification without dev bypass:

1. **Temporarily disable dev mode** in `.dev.vars`:
```bash
# Set DEV_ALLOW_NO_AUTH to 0 or remove it
sed -i '' 's/DEV_ALLOW_NO_AUTH=1/DEV_ALLOW_NO_AUTH=0/' .dev.vars
```

2. **Restart dev server** (Ctrl+C, then `npm run dev:manifest`)

3. **Test without JWT:**
```bash
curl -v "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Status 403 Forbidden (no valid JWT)

4. **Test with invalid JWT:**
```bash
curl -v -H "Authorization: Bearer fake.invalid.jwt" \
  "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8"
```

**Verify:**
- ✅ Status 403 Forbidden
- ✅ Logs show JWT verification failure

5. **Restore dev mode:**
```bash
sed -i '' 's/DEV_ALLOW_NO_AUTH=0/DEV_ALLOW_NO_AUTH=1/' .dev.vars
```

---

## Automated Test Script

Save this as `test-local.sh`:

```bash
#!/bin/bash

BASE_URL="http://127.0.0.1:8787"
PASS=0
FAIL=0

echo "🧪 Running Local Tests..."
echo "=========================="

# Test 1: SGAI
echo -n "Test 1: SGAI mode... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "EXT-X-DATERANGE"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 2: SSAI
echo -n "Test 2: SSAI mode... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=ssai")
if echo "$RESPONSE" | grep -q "EXT-X-DISCONTINUITY"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 3: Bitrate 1600k
echo -n "Test 3: Bitrate 1600k selection... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "v_1600k"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 4: Bitrate 800k
echo -n "Test 4: Bitrate 800k selection... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_800k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "v_800k"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 5: Missing channel
echo -n "Test 5: Error handling (missing channel)... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}?variant=v_1600k.m3u8")
if [ "$STATUS" = "400" ]; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 6: Signed URLs
echo -n "Test 6: Signed URLs... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "token=" && echo "$RESPONSE" | grep -q "exp="; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

echo "=========================="
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -eq 0 ]; then
  echo "🎉 All tests passed!"
  exit 0
else
  echo "⚠️  Some tests failed"
  exit 1
fi
```

**Make it executable and run:**
```bash
chmod +x test-local.sh
./test-local.sh
```

---

## Troubleshooting

### Dev server won't start:
- Check `wrangler.toml` syntax
- Verify `.dev.vars` file exists
- Try `wrangler dev --local src/manifest-worker.ts` directly

### Tests fail:
- Ensure dev server is running
- Check dev server logs for errors
- Verify `.dev.vars` has `DEV_ALLOW_NO_AUTH=1`

### Signed URLs don't work:
- Verify `SIGN_HOST` and `SEGMENT_SECRET` in `.dev.vars`
- Check token generation in logs

### Queue messages not processing:
- Local queues are simulated; check console logs
- Verify `[[queues.consumers]]` in `wrangler.toml`

---

## Next Steps

Once all tests pass locally:
1. ✅ Commit changes
2. ✅ Set production secrets
3. ✅ Deploy to Cloudflare: `wrangler deploy`
4. ✅ Test in staging environment
5. ✅ Monitor logs and metrics

---

**Happy Testing! 🚀**

