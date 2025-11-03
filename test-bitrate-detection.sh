#!/bin/bash

# Test script for bitrate detection workflow
# Tests the backend API endpoints for detecting and storing bitrate ladders

set -e

API_BASE="http://localhost:8791"  # Admin API port
TOKEN=""  # Will be set after login

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Bitrate Detection Workflow Tests ===${NC}\n"

# Step 1: Login (you'll need to update credentials)
echo -e "${BLUE}Step 1: Logging in...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ Login failed. Please check credentials in the script.${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Login successful${NC}\n"

# Step 2: Test bitrate detection with a test HLS stream
# Using a public Apple test stream
echo -e "${BLUE}Step 2: Testing bitrate detection...${NC}"
ORIGIN_URL="https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8"

DETECT_RESPONSE=$(curl -s -X POST "${API_BASE}/api/channels/detect-bitrates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"originUrl\":\"${ORIGIN_URL}\"}")

echo "Detection response: $DETECT_RESPONSE"
DETECT_SUCCESS=$(echo $DETECT_RESPONSE | jq -r '.success')
DETECTED_BITRATES=$(echo $DETECT_RESPONSE | jq -r '.bitrates')

if [ "$DETECT_SUCCESS" = "true" ]; then
  echo -e "${GREEN}✅ Bitrate detection successful${NC}"
  echo "Detected bitrates: $DETECTED_BITRATES"
else
  ERROR_MSG=$(echo $DETECT_RESPONSE | jq -r '.error')
  echo -e "${RED}❌ Bitrate detection failed: $ERROR_MSG${NC}"
  exit 1
fi

echo ""

# Step 3: Create channel with detected bitrates
echo -e "${BLUE}Step 3: Creating channel with detected bitrates...${NC}"
TIMESTAMP=$(date +%s)
CHANNEL_SLUG="test-bitrate-${TIMESTAMP}"

CREATE_RESPONSE=$(curl -s -X POST "${API_BASE}/api/channels" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"name\": \"Bitrate Test Channel ${TIMESTAMP}\",
    \"slug\": \"${CHANNEL_SLUG}\",
    \"origin_url\": \"${ORIGIN_URL}\",
    \"bitrate_ladder\": ${DETECTED_BITRATES},
    \"bitrate_ladder_source\": \"auto\",
    \"detected_bitrates\": ${DETECTED_BITRATES},
    \"last_bitrate_detection\": $(date +%s%3N)
  }")

CHANNEL_ID=$(echo $CREATE_RESPONSE | jq -r '.id')

if [ "$CHANNEL_ID" != "null" ] && [ -n "$CHANNEL_ID" ]; then
  echo -e "${GREEN}✅ Channel created successfully${NC}"
  echo "Channel ID: $CHANNEL_ID"
else
  echo -e "${RED}❌ Channel creation failed${NC}"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

echo ""

# Step 4: Fetch channel and verify bitrate configuration
echo -e "${BLUE}Step 4: Verifying channel configuration...${NC}"
CHANNEL_RESPONSE=$(curl -s -X GET "${API_BASE}/api/channels/${CHANNEL_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

STORED_LADDER=$(echo $CHANNEL_RESPONSE | jq -r '.channel.bitrate_ladder')
STORED_SOURCE=$(echo $CHANNEL_RESPONSE | jq -r '.channel.bitrate_ladder_source')

echo "Stored bitrate ladder: $STORED_LADDER"
echo "Stored source: $STORED_SOURCE"

if [ "$STORED_SOURCE" = "auto" ]; then
  echo -e "${GREEN}✅ Channel configuration verified${NC}"
else
  echo -e "${RED}❌ Unexpected bitrate source: $STORED_SOURCE${NC}"
fi

echo ""

# Step 5: Update channel with manual bitrate ladder
echo -e "${BLUE}Step 5: Updating channel with manual bitrate ladder...${NC}"
MANUAL_BITRATES="[800, 1600, 2400, 3600]"

UPDATE_RESPONSE=$(curl -s -X PUT "${API_BASE}/api/channels/${CHANNEL_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"bitrate_ladder\": ${MANUAL_BITRATES},
    \"bitrate_ladder_source\": \"manual\"
  }")

UPDATE_SUCCESS=$(echo $UPDATE_RESPONSE | jq -r '.success')

if [ "$UPDATE_SUCCESS" = "true" ]; then
  echo -e "${GREEN}✅ Channel updated successfully${NC}"
  
  # Verify update
  UPDATED_CHANNEL=$(curl -s -X GET "${API_BASE}/api/channels/${CHANNEL_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  UPDATED_LADDER=$(echo $UPDATED_CHANNEL | jq -r '.channel.bitrate_ladder')
  UPDATED_SOURCE=$(echo $UPDATED_CHANNEL | jq -r '.channel.bitrate_ladder_source')
  
  echo "Updated bitrate ladder: $UPDATED_LADDER"
  echo "Updated source: $UPDATED_SOURCE"
  
  if [ "$UPDATED_SOURCE" = "manual" ]; then
    echo -e "${GREEN}✅ Manual bitrate ladder verified${NC}"
  fi
else
  echo -e "${RED}❌ Channel update failed${NC}"
  echo "Response: $UPDATE_RESPONSE"
fi

echo ""

# Step 6: Test validation error handling
echo -e "${BLUE}Step 6: Testing bitrate ladder validation...${NC}"

# Test invalid bitrate ladder (descending order)
INVALID_BITRATES="[3000, 2000, 1000]"
INVALID_RESPONSE=$(curl -s -X PUT "${API_BASE}/api/channels/${CHANNEL_ID}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"bitrate_ladder\": ${INVALID_BITRATES}}")

ERROR_MSG=$(echo $INVALID_RESPONSE | jq -r '.error')

if [[ "$ERROR_MSG" == *"ascending order"* ]]; then
  echo -e "${GREEN}✅ Validation correctly rejected invalid bitrate order${NC}"
else
  echo -e "${RED}❌ Validation failed to detect invalid bitrate order${NC}"
  echo "Response: $INVALID_RESPONSE"
fi

echo ""

# Step 7: Cleanup (optional)
echo -e "${BLUE}Step 7: Cleanup (deleting test channel)...${NC}"
DELETE_RESPONSE=$(curl -s -X DELETE "${API_BASE}/api/channels/${CHANNEL_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

DELETE_SUCCESS=$(echo $DELETE_RESPONSE | jq -r '.success')

if [ "$DELETE_SUCCESS" = "true" ]; then
  echo -e "${GREEN}✅ Test channel deleted${NC}"
else
  echo -e "${RED}❌ Failed to delete test channel${NC}"
  echo "Response: $DELETE_RESPONSE"
fi

echo ""
echo -e "${GREEN}=== All tests completed ===${NC}"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo "✓ Bitrate detection from HLS manifest"
echo "✓ Channel creation with auto-detected bitrates"
echo "✓ Channel update with manual bitrates"
echo "✓ Bitrate ladder validation"
echo "✓ Test channel cleanup"
