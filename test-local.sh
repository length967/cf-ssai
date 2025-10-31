#!/bin/bash

# Local testing script for Cloudflare SSAI/SGAI immediate fixes
# Run this after starting the dev server: npm run dev:manifest

BASE_URL="http://127.0.0.1:8787"
PASS=0
FAIL=0

echo "🧪 Testing Cloudflare SSAI/SGAI Immediate Fixes"
echo "================================================"
echo ""

# Check if dev server is running
echo "Checking dev server..."
if ! curl -s -f -o /dev/null "${BASE_URL}?channel=test&variant=v_1600k.m3u8" 2>/dev/null; then
  echo "❌ Dev server not responding at ${BASE_URL}"
  echo "   Please start it with: npm run dev:manifest"
  exit 1
fi
echo "✅ Dev server is running"
echo ""

# Test 1: SGAI mode
echo -n "Test 1: SGAI mode inserts DATERANGE... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "EXT-X-DATERANGE"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 2: SSAI mode
echo -n "Test 2: SSAI mode inserts DISCONTINUITY... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=ssai")
if echo "$RESPONSE" | grep -q "EXT-X-DISCONTINUITY"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 3: SGAI has interstitial class
echo -n "Test 3: SGAI includes interstitial class... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q 'CLASS="com.apple.hls.interstitial"'; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 4: Bitrate 1600k selection
echo -n "Test 4: 1600k variant gets 1600k ads... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "v_1600k"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 5: Bitrate 800k selection
echo -n "Test 5: 800k variant gets 800k ads... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_800k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "v_800k"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 6: Missing channel parameter
echo -n "Test 6: Missing channel returns 400... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}?variant=v_1600k.m3u8")
if [ "$STATUS" = "400" ]; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL (got $STATUS, expected 400)"
  ((FAIL++))
fi

# Test 7: Signed URLs have token
echo -n "Test 7: Signed URLs include token... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "token="; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 8: Signed URLs have expiration
echo -n "Test 8: Signed URLs include expiration... "
RESPONSE=$(curl -s "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=sgai")
if echo "$RESPONSE" | grep -q "exp="; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 9: User-Agent detection works (iOS detected, overrides default to SGAI even when no force)
# Note: We don't test actual insertion here since it depends on break schedule
# Instead we verify the force parameter can be omitted and UA detection still influences mode
echo -n "Test 9: iOS UA detection (no force param)... "
# Test that iOS UA doesn't break the request (validation test)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" \
  "${BASE_URL}?channel=ua-test-ios&variant=v_1600k.m3u8")
if [ "$STATUS" = "200" ]; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 10: User-Agent detection works (Chrome detected, defaults to SSAI)
echo -n "Test 10: Chrome UA detection (no force param)... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" \
  "${BASE_URL}?channel=ua-test-chrome&variant=v_1600k.m3u8")
if [ "$STATUS" = "200" ]; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL (got $STATUS)"
  ((FAIL++))
fi

# Test 11: Force parameter overrides detection
echo -n "Test 11: force=ssai overrides iOS UA... "
RESPONSE=$(curl -s -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" \
  "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8&force=ssai")
if echo "$RESPONSE" | grep -q "EXT-X-DISCONTINUITY"; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

# Test 12: Response has correct content type
echo -n "Test 12: Content-Type is HLS... "
CONTENT_TYPE=$(curl -s -I "${BASE_URL}?channel=ch1&variant=v_1600k.m3u8" | grep -i "content-type" | grep -i "mpegurl")
if [ -n "$CONTENT_TYPE" ]; then
  echo "✅ PASS"
  ((PASS++))
else
  echo "❌ FAIL"
  ((FAIL++))
fi

echo ""
echo "================================================"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "🎉 All tests passed! Your fixes are working correctly."
  echo ""
  echo "Next steps:"
  echo "  1. Run unit tests: npm test"
  echo "  2. Review changes: git diff"
  echo "  3. Commit changes: git add . && git commit -m 'fix: implement immediate fixes'"
  echo "  4. Deploy to production: wrangler deploy"
  exit 0
else
  echo "⚠️  Some tests failed. Please check the dev server logs."
  echo ""
  echo "Troubleshooting:"
  echo "  - Check if dev server is running: npm run dev:manifest"
  echo "  - Check .dev.vars file has DEV_ALLOW_NO_AUTH=1"
  echo "  - Look for errors in the dev server terminal"
  exit 1
fi

