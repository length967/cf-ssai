#!/bin/bash

# Test ad upload with actual authentication

echo "=== Testing Ad Upload ==="
echo ""

# Step 1: Login
echo "1. Logging in..."
TOKEN=$(curl -s -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}' | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Login failed!"
  curl -v -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@demo.com","password":"demo123"}'
  exit 1
fi

echo "✅ Login successful! Token: ${TOKEN:0:20}..."
echo ""

# Step 2: List ads (should be empty)
echo "2. Listing ads..."
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads | jq

echo ""

# Step 3: Test upload endpoint (without file, just to see if it's reachable)
echo "3. Testing upload endpoint accessibility..."
curl -s -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads/upload \
  -H "Authorization: Bearer $TOKEN" | jq

echo ""
echo "=== Test Complete ==="

