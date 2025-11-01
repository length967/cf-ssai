#!/bin/bash
# Test script to verify the Sports channel is using the correct origin URL

set -e

MANIFEST_URL="${MANIFEST_URL:-http://localhost:8787}"

echo "=================================================="
echo "🏈 Testing Sports Channel - Live Connection"
echo "=================================================="
echo ""

echo "Expected Origin URL:"
echo "  https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8"
echo ""

echo "Testing manifest endpoint..."
echo ""

# Test the manifest endpoint
echo "Request: $MANIFEST_URL/demo/sports/v_1600k.m3u8"
echo ""

RESPONSE=$(curl -s -v "$MANIFEST_URL/demo/sports/v_1600k.m3u8" 2>&1)

# Extract HTTP status
HTTP_STATUS=$(echo "$RESPONSE" | grep "< HTTP" | awk '{print $3}')

echo "HTTP Status: $HTTP_STATUS"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Manifest endpoint is responding!"
  echo ""
  
  # Get the manifest body
  MANIFEST=$(echo "$RESPONSE" | sed -n '/^#EXTM3U/,$p')
  
  # Check if it contains the unified-streaming origin
  if echo "$MANIFEST" | grep -q "demo.unified-streaming.com"; then
    echo "✅ GREAT! Your unified-streaming origin URL is being used!"
    echo ""
    echo "Sample of manifest (showing origin URLs):"
    echo "$MANIFEST" | grep -E "(unified-streaming|http)" | head -5
    echo ""
  else
    echo "⚠️  Manifest doesn't contain unified-streaming URLs"
    echo ""
    echo "First 20 lines of manifest:"
    echo "$MANIFEST" | head -20
    echo ""
    echo "This might mean:"
    echo "  1. The channel config isn't being loaded from the database"
    echo "  2. The fallback to ORIGIN_VARIANT_BASE is being used"
    echo ""
  fi
  
  # Check for SCTE-35 markers
  if echo "$MANIFEST" | grep -q "EXT-X-DATERANGE"; then
    echo "✅ SCTE-35 markers detected in the stream!"
    echo ""
    echo "Sample SCTE-35 markers:"
    echo "$MANIFEST" | grep "EXT-X-DATERANGE" | head -3
    echo ""
  else
    echo "ℹ️  No SCTE-35 markers found in current manifest"
    echo "   (This is normal if there's no ad break right now)"
    echo ""
  fi
  
elif [ "$HTTP_STATUS" = "403" ]; then
  echo "⚠️  HTTP 403 Forbidden - Authentication issue"
  echo ""
  echo "The manifest worker requires authentication."
  echo ""
  echo "For testing, make sure DEV_ALLOW_NO_AUTH=1 in .dev.vars"
  echo "Then restart the manifest worker:"
  echo "  npm run dev:manifest"
  echo ""
  
else
  echo "❌ Unexpected HTTP status: $HTTP_STATUS"
  echo ""
  echo "Full response:"
  echo "$RESPONSE"
  echo ""
fi

# Check if the manifest worker is even running
echo "Checking if manifest worker is running..."
HEALTH_CHECK=$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" "$MANIFEST_URL/health" 2>/dev/null || echo "")
HEALTH_STATUS=$(echo "$HEALTH_CHECK" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HEALTH_STATUS" = "200" ]; then
  echo "✅ Manifest worker is running"
else
  echo "❌ Manifest worker is not responding"
  echo ""
  echo "Start it with: npm run dev:manifest"
fi

echo ""
echo "=================================================="
echo "📊 Database Check"
echo "=================================================="
echo ""

# Check what's in the database
echo "Checking database for sports channel..."
echo ""

DB_OUTPUT=$(wrangler d1 execute ssai-admin --command "SELECT id, name, slug, origin_url, status FROM channels WHERE slug='sports'" --config wrangler.admin.toml 2>&1)

if echo "$DB_OUTPUT" | grep -q "ch_demo_sports"; then
  echo "✅ Sports channel found in database!"
  echo ""
  echo "$DB_OUTPUT"
  echo ""
  
  # Check if the origin URL is the unified-streaming one
  if echo "$DB_OUTPUT" | grep -q "unified-streaming"; then
    echo "✅ Database has the correct unified-streaming URL!"
  else
    echo "⚠️  Database doesn't show unified-streaming URL"
    echo "   You may need to update the database:"
    echo ""
    echo "   wrangler d1 execute ssai-admin \\"
    echo "     --command \"UPDATE channels SET origin_url='https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8' WHERE slug='sports'\" \\"
    echo "     --config wrangler.admin.toml"
    echo ""
  fi
else
  echo "❌ Sports channel not found in database"
  echo ""
  echo "Database output:"
  echo "$DB_OUTPUT"
  echo ""
  echo "You may need to run the schema setup:"
  echo "  wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml"
  echo ""
fi

echo "=================================================="
echo "🔧 Next Steps"
echo "=================================================="
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "Your channel is responding! To test ad insertion:"
  echo ""
  echo "1. Test SGAI mode (for iOS/Safari):"
  echo "   curl '$MANIFEST_URL/demo/sports/v_1600k.m3u8?force=sgai'"
  echo ""
  echo "2. Test SSAI mode (for other players):"
  echo "   curl '$MANIFEST_URL/demo/sports/v_1600k.m3u8?force=ssai'"
  echo ""
  echo "3. Trigger a live ad break:"
  echo "   ./scripts/cue.sh start --channel sports --duration 30"
  echo ""
  echo "4. Watch it in a player:"
  echo "   - HLS.js demo: https://hls-js.netlify.app/demo/"
  echo "   - VLC: Open Network Stream → $MANIFEST_URL/demo/sports/v_1600k.m3u8"
  echo ""
else
  echo "Troubleshooting steps:"
  echo ""
  echo "1. Make sure the manifest worker is running:"
  echo "   npm run dev:manifest"
  echo ""
  echo "2. Check that DEV_ALLOW_NO_AUTH=1 in .dev.vars"
  echo ""
  echo "3. Verify the database has your channel:"
  echo "   wrangler d1 execute ssai-admin --command \"SELECT * FROM channels\" --config wrangler.admin.toml"
  echo ""
  echo "4. Check worker logs for errors"
  echo ""
fi

echo "=================================================="

