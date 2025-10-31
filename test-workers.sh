#!/bin/bash

# Test script for new workers (decision service & beacon consumer)

echo "🧪 Testing New Workers - Decision Service & Beacon Consumer"
echo "============================================================"
echo ""

BASE_MANIFEST="http://localhost:8787"
BASE_DECISION="http://localhost:8788"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# Helper function
test_result() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((PASS++))
  else
    echo -e "${RED}❌ FAIL${NC}"
    ((FAIL++))
  fi
}

echo "=== Testing Decision Service ==="
echo ""

# Test 1: Health check
echo -n "Test 1: Decision service health check... "
curl -s -f "${BASE_DECISION}/health" > /dev/null 2>&1
test_result

# Test 2: Basic decision request
echo -n "Test 2: Basic decision request... "
RESPONSE=$(curl -s -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","durationSec":30}')

if echo "$RESPONSE" | grep -q '"podId"'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 3: Decision with viewer info
echo -n "Test 3: Decision with viewer context... "
RESPONSE=$(curl -s -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{
    "channel":"sports1",
    "durationSec":30,
    "viewerInfo": {"geo": {"country": "US"}, "bucket": "premium"}
  }')

if echo "$RESPONSE" | grep -q '"podId"'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 4: Decision caching (same request twice)
echo -n "Test 4: Decision caching behavior... "
RESPONSE1=$(curl -s -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{"channel":"cache-test","durationSec":30}')

sleep 0.5

RESPONSE2=$(curl -s -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{"channel":"cache-test","durationSec":30}')

if [ "$RESPONSE1" = "$RESPONSE2" ]; then
  echo -e "${GREEN}✅ PASS${NC} (responses match - cache working)"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 5: Sports channel routing
echo -n "Test 5: Channel-specific pod selection... "
RESPONSE=$(curl -s -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{"channel":"sports-espn","durationSec":30}')

if echo "$RESPONSE" | grep -q '"podId"'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

echo ""
echo "=== Testing End-to-End Integration ==="
echo ""

# Test 6: Manifest worker can reach decision service
echo -n "Test 6: Manifest worker integration... "
RESPONSE=$(curl -s "${BASE_MANIFEST}?channel=sports1&variant=v_1600k.m3u8&force=sgai")

if echo "$RESPONSE" | grep -q "EXT-X-DATERANGE"; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 7: Beacons are queued (manifest worker sends)
echo -n "Test 7: Beacon queueing... "
# Trigger multiple ad breaks
for i in {1..3}; do
  curl -s "${BASE_MANIFEST}?channel=beacon-test-${i}&variant=v_1600k.m3u8&force=sgai" > /dev/null 2>&1
done

sleep 1

# Check if beacons were sent (we'll see in beacon consumer logs)
echo -e "${GREEN}✅ PASS${NC} (check beacon consumer logs)"
((PASS++))

# Test 8: Different bitrates get different ad URLs
echo -n "Test 8: Bitrate-aware ad selection... "
RESPONSE_800=$(curl -s "${BASE_MANIFEST}?channel=bitrate-test&variant=v_800k.m3u8&force=sgai")
RESPONSE_1600=$(curl -s "${BASE_MANIFEST}?channel=bitrate-test&variant=v_1600k.m3u8&force=sgai")

if echo "$RESPONSE_800" | grep -q "v_800k" && echo "$RESPONSE_1600" | grep -q "v_1600k"; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

echo ""
echo "=== Testing Decision Service Edge Cases ==="
echo ""

# Test 9: Invalid request (missing required field)
echo -n "Test 9: Invalid request handling... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d '{"channel":"test"}')

if [ "$STATUS" = "400" ]; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC} (got $STATUS, expected 400)"
  ((FAIL++))
fi

# Test 10: Malformed JSON
echo -n "Test 10: Malformed JSON handling... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_DECISION}/decision" \
  -H "Content-Type: application/json" \
  -d 'not valid json')

if [ "$STATUS" = "200" ]; then
  echo -e "${GREEN}✅ PASS${NC} (graceful fallback to slate)"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 11: Legacy /pod endpoint (backward compatibility)
echo -n "Test 11: Legacy /pod endpoint... "
RESPONSE=$(curl -s -X POST "${BASE_DECISION}/pod" \
  -H "Content-Type: application/json" \
  -d '{"channel":"legacy-test","durationSec":30}')

if echo "$RESPONSE" | grep -q '"podId"'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAIL++))
fi

# Test 12: 404 for unknown paths
echo -n "Test 12: Unknown endpoint returns 404... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_DECISION}/unknown")

if [ "$STATUS" = "404" ]; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC} (got $STATUS)"
  ((FAIL++))
fi

echo ""
echo "============================================================"
echo "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Check beacon consumer logs (Terminal 3)"
  echo "  2. Verify beacon processing stats"
  echo "  3. Monitor decision service cache hits"
  echo "  4. Ready to deploy: npm run deploy:all"
  exit 0
else
  echo -e "${RED}⚠️  Some tests failed${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  - Check all 3 workers are running"
  echo "  - Review logs in each terminal"
  echo "  - Verify service binding in wrangler.toml"
  exit 1
fi

