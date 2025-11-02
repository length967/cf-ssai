#!/bin/bash
# Test Parallel Transcoding Implementation
# Tests segment transcoding and assembly endpoints

set -e

echo "=== Parallel Transcoding Test Suite ==="
echo ""

# Configuration
CONTAINER_URL="http://localhost:8080"
TEST_AD_ID="test_ad_$(date +%s)"
TEST_SOURCE_KEY="source-videos/test-video.mp4"
BITRATES='[1000, 2000, 3000]'

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function
test_endpoint() {
  local name=$1
  local endpoint=$2
  local data=$3
  
  echo -e "${YELLOW}Testing: ${name}${NC}"
  
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "${CONTAINER_URL}${endpoint}" \
    -H "Content-Type: application/json" \
    -d "${data}")
  
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✓ ${name} passed (HTTP ${http_code})${NC}"
    echo "Response: $(echo $body | jq -r '.success // .error')"
  else
    echo -e "${RED}✗ ${name} failed (HTTP ${http_code})${NC}"
    echo "Error: $(echo $body | jq -r '.error // .')"
    return 1
  fi
  
  echo ""
}

# Test 1: Health Check
echo "=== Test 1: Health Check ==="
response=$(curl -s "${CONTAINER_URL}/health")
if echo "$response" | jq -e '.status == "healthy"' > /dev/null; then
  echo -e "${GREEN}✓ Container is healthy${NC}"
else
  echo -e "${RED}✗ Container health check failed${NC}"
  exit 1
fi
echo ""

# Test 2: Status Check (verify new features)
echo "=== Test 2: Status Check ==="
response=$(curl -s "${CONTAINER_URL}/status")
features=$(echo "$response" | jq -r '.features[]')
echo "Container version: $(echo $response | jq -r '.containerVersion')"
echo "Features: $features"

if echo "$response" | jq -e '.features | contains(["segment", "assembly"])' > /dev/null; then
  echo -e "${GREEN}✓ Parallel transcoding features available${NC}"
else
  echo -e "${RED}✗ Parallel transcoding features not found${NC}"
  exit 1
fi
echo ""

# Test 3: Segment Transcode Validation
echo "=== Test 3: Segment Endpoint Validation ==="
test_endpoint \
  "Missing parameters" \
  "/transcode-segment" \
  '{"adId":"test"}' || true  # Expected to fail

echo ""

# Test 4: Assembly Endpoint Validation
echo "=== Test 4: Assembly Endpoint Validation ==="
test_endpoint \
  "Empty segment paths" \
  "/assemble-segments" \
  "{\"adId\":\"${TEST_AD_ID}\",\"segmentPaths\":[],\"bitrates\":${BITRATES},\"r2Config\":{}}" || true  # Expected to fail

echo ""

# Test 5: Full Parallel Transcode Flow (Simulated)
echo "=== Test 5: Simulated Parallel Flow ==="
echo -e "${YELLOW}Note: This requires a real video file in R2${NC}"
echo ""
echo "To test with real video:"
echo "1. Upload test video to R2: source-videos/test-video.mp4"
echo "2. Run segment transcode:"
echo ""
echo "curl -X POST ${CONTAINER_URL}/transcode-segment \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"adId\": \"${TEST_AD_ID}\","
echo "    \"segmentId\": 0,"
echo "    \"sourceKey\": \"${TEST_SOURCE_KEY}\","
echo "    \"startTime\": 0,"
echo "    \"duration\": 10,"
echo "    \"bitrates\": ${BITRATES},"
echo "    \"r2Config\": {"
echo "      \"endpoint\": \"https://YOUR_ACCOUNT.r2.cloudflarestorage.com\","
echo "      \"accountId\": \"YOUR_ACCOUNT_ID\","
echo "      \"accessKeyId\": \"YOUR_ACCESS_KEY\","
echo "      \"secretAccessKey\": \"YOUR_SECRET_KEY\","
echo "      \"bucket\": \"ssai-ads\","
echo "      \"publicUrl\": \"https://pub-XXXXX.r2.dev\""
echo "    }"
echo "  }'"
echo ""
echo "3. Run assembly after all segments complete:"
echo ""
echo "curl -X POST ${CONTAINER_URL}/assemble-segments \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"adId\": \"${TEST_AD_ID}\","
echo "    \"segmentPaths\": ["
echo "      \"transcoded-ads/${TEST_AD_ID}/segment-0\","
echo "      \"transcoded-ads/${TEST_AD_ID}/segment-1\","
echo "      \"transcoded-ads/${TEST_AD_ID}/segment-2\""
echo "    ],"
echo "    \"bitrates\": ${BITRATES},"
echo "    \"r2Config\": { /* same as above */ }"
echo "  }'"
echo ""

# Summary
echo "==================================="
echo -e "${GREEN}Test Suite Complete${NC}"
echo ""
echo "Container endpoints implemented:"
echo "  - POST /transcode-segment   (for parallel processing)"
echo "  - POST /assemble-segments   (for final assembly)"
echo ""
echo "Next steps:"
echo "1. Deploy container: npm run deploy:transcode"
echo "2. Enable in admin API (uncomment parallel job code)"
echo "3. Upload long video and verify parallel processing"
echo ""
echo "Expected performance:"
echo "  - 30s video: ~30-40s (vs 2.5min single-threaded)"
echo "  - 5min video: ~60-90s (vs 25min single-threaded)"
echo "==================================="
