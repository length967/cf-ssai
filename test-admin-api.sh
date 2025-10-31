#!/bin/bash

# Test Admin API Endpoints
# Run this after starting the admin API with: wrangler dev --config wrangler.admin.toml --port 8791

API_URL="http://localhost:8791"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing SSAI Admin API${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Test 1: Login
echo -e "${BLUE}1. Testing Login...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST $API_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo -e "${RED}✗ Login failed${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
else
  echo -e "${GREEN}✓ Login successful${NC}"
  echo "Token: ${TOKEN:0:50}..."
fi

# Test 2: Get Organization
echo -e "\n${BLUE}2. Testing Get Organization...${NC}"
ORG_RESPONSE=$(curl -s $API_URL/api/organization \
  -H "Authorization: Bearer $TOKEN")

if echo "$ORG_RESPONSE" | grep -q "organization"; then
  echo -e "${GREEN}✓ Get Organization successful${NC}"
  echo "$ORG_RESPONSE" | head -c 200
else
  echo -e "${RED}✗ Get Organization failed${NC}"
  echo "$ORG_RESPONSE"
fi

# Test 3: List Channels
echo -e "\n\n${BLUE}3. Testing List Channels...${NC}"
CHANNELS_RESPONSE=$(curl -s $API_URL/api/channels \
  -H "Authorization: Bearer $TOKEN")

if echo "$CHANNELS_RESPONSE" | grep -q "channels"; then
  echo -e "${GREEN}✓ List Channels successful${NC}"
  CHANNEL_COUNT=$(echo "$CHANNELS_RESPONSE" | grep -o '"id"' | wc -l)
  echo "Found $CHANNEL_COUNT channel(s)"
else
  echo -e "${RED}✗ List Channels failed${NC}"
  echo "$CHANNELS_RESPONSE"
fi

# Test 4: Create Channel
echo -e "\n${BLUE}4. Testing Create Channel...${NC}"
CREATE_CHANNEL=$(curl -s -X POST $API_URL/api/channels \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Channel",
    "slug": "test-'$(date +%s)'",
    "origin_url": "https://example.com/hls/test",
    "scte35_enabled": 1,
    "vast_enabled": 1,
    "default_ad_duration": 30
  }')

CHANNEL_ID=$(echo $CREATE_CHANNEL | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$CHANNEL_ID" ]; then
  echo -e "${RED}✗ Create Channel failed${NC}"
  echo "$CREATE_CHANNEL"
else
  echo -e "${GREEN}✓ Create Channel successful${NC}"
  echo "Channel ID: $CHANNEL_ID"
fi

# Test 5: Update Channel
if [ ! -z "$CHANNEL_ID" ]; then
  echo -e "\n${BLUE}5. Testing Update Channel...${NC}"
  UPDATE_CHANNEL=$(curl -s -X PUT $API_URL/api/channels/$CHANNEL_ID \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Updated Test Channel"}')
  
  if echo "$UPDATE_CHANNEL" | grep -q "success"; then
    echo -e "${GREEN}✓ Update Channel successful${NC}"
  else
    echo -e "${RED}✗ Update Channel failed${NC}"
    echo "$UPDATE_CHANNEL"
  fi
fi

# Test 6: List Ad Pods
echo -e "\n${BLUE}6. Testing List Ad Pods...${NC}"
AD_PODS_RESPONSE=$(curl -s $API_URL/api/ad-pods \
  -H "Authorization: Bearer $TOKEN")

if echo "$AD_PODS_RESPONSE" | grep -q "ad_pods"; then
  echo -e "${GREEN}✓ List Ad Pods successful${NC}"
  POD_COUNT=$(echo "$AD_PODS_RESPONSE" | grep -o '"id"' | wc -l)
  echo "Found $POD_COUNT ad pod(s)"
else
  echo -e "${RED}✗ List Ad Pods failed${NC}"
  echo "$AD_PODS_RESPONSE"
fi

# Test 7: Create Ad Pod
echo -e "\n${BLUE}7. Testing Create Ad Pod...${NC}"
CREATE_POD=$(curl -s -X POST $API_URL/api/ad-pods \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Ad Pod",
    "pod_id": "test-pod-'$(date +%s)'",
    "duration_sec": 30,
    "assets": [
      {"bitrate": 800000, "url": "https://ads.example.com/test/800k.m3u8"},
      {"bitrate": 1600000, "url": "https://ads.example.com/test/1600k.m3u8"}
    ],
    "tracking_impressions": ["https://tracking.example.com/imp"]
  }')

POD_ID=$(echo $CREATE_POD | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$POD_ID" ]; then
  echo -e "${RED}✗ Create Ad Pod failed${NC}"
  echo "$CREATE_POD"
else
  echo -e "${GREEN}✓ Create Ad Pod successful${NC}"
  echo "Ad Pod ID: $POD_ID"
fi

# Test 8: Update Ad Pod
if [ ! -z "$POD_ID" ]; then
  echo -e "\n${BLUE}8. Testing Update Ad Pod...${NC}"
  UPDATE_POD=$(curl -s -X PUT $API_URL/api/ad-pods/$POD_ID \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Updated Test Ad Pod"}')
  
  if echo "$UPDATE_POD" | grep -q "success"; then
    echo -e "${GREEN}✓ Update Ad Pod successful${NC}"
  else
    echo -e "${RED}✗ Update Ad Pod failed${NC}"
    echo "$UPDATE_POD"
  fi
fi

# Test 9: List Users
echo -e "\n${BLUE}9. Testing List Users...${NC}"
USERS_RESPONSE=$(curl -s $API_URL/api/users \
  -H "Authorization: Bearer $TOKEN")

if echo "$USERS_RESPONSE" | grep -q "users"; then
  echo -e "${GREEN}✓ List Users successful${NC}"
  USER_COUNT=$(echo "$USERS_RESPONSE" | grep -o '"id"' | wc -l)
  echo "Found $USER_COUNT user(s)"
else
  echo -e "${RED}✗ List Users failed${NC}"
  echo "$USERS_RESPONSE"
fi

# Test 10: List API Keys
echo -e "\n${BLUE}10. Testing List API Keys...${NC}"
API_KEYS_RESPONSE=$(curl -s $API_URL/api/api-keys \
  -H "Authorization: Bearer $TOKEN")

if echo "$API_KEYS_RESPONSE" | grep -q "api_keys"; then
  echo -e "${GREEN}✓ List API Keys successful${NC}"
  KEY_COUNT=$(echo "$API_KEYS_RESPONSE" | grep -o '"id"' | wc -l)
  echo "Found $KEY_COUNT API key(s)"
else
  echo -e "${RED}✗ List API Keys failed${NC}"
  echo "$API_KEYS_RESPONSE"
fi

# Test 11: Get Beacon Events
echo -e "\n${BLUE}11. Testing Get Beacon Events...${NC}"
BEACON_RESPONSE=$(curl -s "$API_URL/api/beacon-events?limit=10" \
  -H "Authorization: Bearer $TOKEN")

if echo "$BEACON_RESPONSE" | grep -q "events"; then
  echo -e "${GREEN}✓ Get Beacon Events successful${NC}"
  EVENT_COUNT=$(echo "$BEACON_RESPONSE" | grep -o '"id"' | wc -l)
  echo "Found $EVENT_COUNT beacon event(s)"
else
  echo -e "${RED}✗ Get Beacon Events failed${NC}"
  echo "$BEACON_RESPONSE"
fi

# Cleanup: Delete test channel
if [ ! -z "$CHANNEL_ID" ]; then
  echo -e "\n${BLUE}12. Testing Delete Channel (cleanup)...${NC}"
  DELETE_CHANNEL=$(curl -s -X DELETE $API_URL/api/channels/$CHANNEL_ID \
    -H "Authorization: Bearer $TOKEN")
  
  if echo "$DELETE_CHANNEL" | grep -q "success"; then
    echo -e "${GREEN}✓ Delete Channel successful${NC}"
  else
    echo -e "${RED}✗ Delete Channel failed${NC}"
    echo "$DELETE_CHANNEL"
  fi
fi

# Cleanup: Delete test ad pod
if [ ! -z "$POD_ID" ]; then
  echo -e "\n${BLUE}13. Testing Delete Ad Pod (cleanup)...${NC}"
  DELETE_POD=$(curl -s -X DELETE $API_URL/api/ad-pods/$POD_ID \
    -H "Authorization: Bearer $TOKEN")
  
  if echo "$DELETE_POD" | grep -q "success"; then
    echo -e "${GREEN}✓ Delete Ad Pod successful${NC}"
  else
    echo -e "${RED}✗ Delete Ad Pod failed${NC}"
    echo "$DELETE_POD"
  fi
fi

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}✓ All API tests completed!${NC}"
echo -e "${BLUE}========================================${NC}"

