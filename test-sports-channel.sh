#!/bin/bash
# Test script for the Sports channel

set -e

MANIFEST_URL="${MANIFEST_URL:-http://localhost:8787}"
ADMIN_API_URL="${ADMIN_API_URL:-http://localhost:8791}"

echo "=================================================="
echo "🏈 Testing Sports Channel Configuration"
echo "=================================================="
echo ""

# Step 1: Get channel details from Admin API
echo "1️⃣ Checking Sports channel configuration..."
echo ""

# Login first (using demo credentials from schema)
LOGIN_RESPONSE=$(curl -s -X POST "$ADMIN_API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}' 2>/dev/null || echo '{"error":"Could not connect to Admin API"}')

if echo "$LOGIN_RESPONSE" | grep -q '"token"'; then
  TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  echo "✅ Login successful"
  echo ""
  
  # Get channels list
  CHANNELS_RESPONSE=$(curl -s -X GET "$ADMIN_API_URL/api/channels" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  
  # Check if sports channel exists
  if echo "$CHANNELS_RESPONSE" | grep -q '"slug":"sports"'; then
    echo "✅ Sports channel found in database"
    echo ""
    echo "Channel Details:"
    echo "$CHANNELS_RESPONSE" | grep -A 20 '"slug":"sports"' | head -20
    echo ""
  else
    echo "⚠️  Sports channel not found in database"
    echo "Available channels:"
    echo "$CHANNELS_RESPONSE"
    echo ""
  fi
else
  echo "⚠️  Could not connect to Admin API"
  echo "Make sure it's running: wrangler dev --config wrangler.admin.toml --port 8791"
  echo ""
fi

# Step 2: Test manifest endpoint
echo "2️⃣ Testing Sports channel manifest endpoint..."
echo ""

# Test with path-based routing (if org slug is available)
# For demo, the org slug is "demo" (from org_demo in schema)
echo "Testing: $MANIFEST_URL/demo/sports/v_1600k.m3u8"
MANIFEST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" "$MANIFEST_URL/demo/sports/v_1600k.m3u8" 2>/dev/null)

HTTP_STATUS=$(echo "$MANIFEST_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Manifest endpoint working! (HTTP $HTTP_STATUS)"
  echo ""
  echo "First few lines of manifest:"
  echo "$MANIFEST_RESPONSE" | head -n 15
  echo ""
elif [ "$HTTP_STATUS" = "403" ]; then
  echo "⚠️  Forbidden (HTTP 403) - JWT authentication required"
  echo ""
  echo "For testing, you can either:"
  echo "  1. Set DEV_ALLOW_NO_AUTH=1 in your .dev.vars file"
  echo "  2. Add a valid JWT token to the request"
  echo ""
else
  echo "❌ Manifest endpoint returned HTTP $HTTP_STATUS"
  echo ""
  echo "Response:"
  echo "$MANIFEST_RESPONSE" | grep -v "HTTP_STATUS"
  echo ""
  
  # Check if manifest worker is running
  HEALTH_CHECK=$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" "$MANIFEST_URL/health" 2>/dev/null)
  HEALTH_STATUS=$(echo "$HEALTH_CHECK" | grep "HTTP_STATUS" | cut -d: -f2)
  
  if [ "$HEALTH_STATUS" = "200" ]; then
    echo "✅ Manifest worker is running"
  else
    echo "❌ Manifest worker not responding"
    echo "Make sure it's running: npm run dev:manifest"
  fi
  echo ""
fi

# Step 3: Check origin stream configuration
echo "3️⃣ Checking origin stream configuration..."
echo ""
echo "The sports channel is configured with origin URL:"
echo "  https://origin.example.com/hls/sports"
echo ""
echo "⚠️  This is a placeholder URL. You need to:"
echo "  1. Update the channel's origin_url to your actual HLS stream"
echo "  2. Go to Admin GUI → Channels → Edit 'Demo Sports Channel'"
echo "  3. Set the 'Origin URL' to your live stream endpoint"
echo ""

# Step 4: Provide next steps
echo "=================================================="
echo "📋 Next Steps"
echo "=================================================="
echo ""
echo "If you have a live HLS stream ready:"
echo ""
echo "1. Open Admin GUI: http://localhost:3000"
echo "2. Navigate to Channels"
echo "3. Click 'Edit' on 'Demo Sports Channel'"
echo "4. Update 'Origin URL' to your actual stream"
echo "   Example: https://your-stream.com/live/sports/master.m3u8"
echo "5. Save and test again"
echo ""
echo "To test the manifest endpoint directly:"
echo "  curl '$MANIFEST_URL/demo/sports/v_1600k.m3u8'"
echo ""
echo "To trigger a live ad break:"
echo "  ./scripts/cue.sh start --channel sports --duration 30"
echo ""
echo "=================================================="

