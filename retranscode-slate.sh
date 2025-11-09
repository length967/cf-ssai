#!/bin/bash

# Re-transcode Slate Script
# This script creates a new slate with the correct bitrate ladder via the Admin API

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

ADMIN_API_URL="https://admin-api.mediamasters.workers.dev"
EMAIL="admin@demo.com"
PASSWORD="admin123"
CHANNEL_ID="ch_demo_sports"

echo -e "${WHITE}=======================================${NC}"
echo -e "${WHITE}  Slate Re-transcode Script${NC}"
echo -e "${WHITE}=======================================${NC}"
echo -e "${CYAN}Admin API: ${ADMIN_API_URL}${NC}"
echo -e "${CYAN}Email: ${EMAIL}${NC}"
echo -e "${CYAN}Channel: ${CHANNEL_ID}${NC}"
echo -e "${WHITE}========================================${NC}\n"

echo -e "${YELLOW}Step 1: Login to Admin API${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${ADMIN_API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo -e "${RED}✗ Login failed${NC}"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Login successful, got JWT token${NC}\n"

echo -e "${YELLOW}Step 2: Create new generated slate${NC}"
CREATE_RESPONSE=$(curl -s -X POST "${ADMIN_API_URL}/api/slates/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"name\": \"Demo Slate (Re-transcoded)\",
    \"text_content\": \"Hello\",
    \"background_color\": \"#000000\",
    \"text_color\": \"#FFFFFF\",
    \"font_size\": 48,
    \"duration\": 10,
    \"channel_id\": \"${CHANNEL_ID}\"
  }")

SLATE_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('slate_id', ''))" 2>/dev/null || echo "")

if [ -z "$SLATE_ID" ]; then
  echo -e "${RED}✗ Slate creation failed${NC}"
  echo "$CREATE_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Slate created: ${SLATE_ID}${NC}\n"

echo -e "${YELLOW}Step 3: Monitor transcode progress${NC}"
echo -e "${CYAN}ℹ️  Checking slate status...${NC}\n"

# Wait for transcode to complete (poll every 5 seconds for up to 5 minutes)
MAX_ATTEMPTS=60
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  SLATE_STATUS=$(curl -s -X GET "${ADMIN_API_URL}/api/slates/${SLATE_ID}" \
    -H "Authorization: Bearer ${TOKEN}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
  
  if [ "$SLATE_STATUS" = "active" ]; then
    echo -e "\n${GREEN}✓ Transcode completed successfully!${NC}\n"
    break
  elif [ "$SLATE_STATUS" = "failed" ]; then
    echo -e "\n${RED}✗ Transcode failed${NC}\n"
    exit 1
  else
    echo -ne "\r${CYAN}Status: ${SLATE_STATUS} (attempt $((ATTEMPT + 1))/${MAX_ATTEMPTS})${NC}"
    sleep 5
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
  echo -e "\n${YELLOW}⚠️  Timeout waiting for transcode (status: ${SLATE_STATUS})${NC}\n"
fi

echo -e "${YELLOW}Step 4: Get slate variants${NC}"
SLATE_INFO=$(curl -s -X GET "${ADMIN_API_URL}/api/slates/${SLATE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

echo -e "${CYAN}Slate info:${NC}"
echo "$SLATE_INFO" | python3 -m json.tool
echo ""

echo -e "${YELLOW}Step 5: Update ad pod to use new slate${NC}"
wrangler d1 execute ssai-admin --command "
  UPDATE ad_pods 
  SET slate_id = '${SLATE_ID}' 
  WHERE id = 'adpod_demo_slate'
" --remote

echo -e "${GREEN}✓ Ad pod updated to use new slate${NC}\n"

echo -e "${WHITE}========================================${NC}"
echo -e "${GREEN}Re-transcode Complete!${NC}"
echo -e "${WHITE}========================================${NC}"
echo -e "${CYAN}New Slate ID: ${SLATE_ID}${NC}"
echo -e "${CYAN}Test URL: https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8${NC}"
echo -e "${WHITE}========================================${NC}"
