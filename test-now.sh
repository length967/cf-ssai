#!/bin/bash
# Quick test of the sports channel

echo "Testing Sports Channel with unified-streaming origin..."
echo ""

# Test if manifest worker is running
echo "1. Checking if manifest worker is running..."
HEALTH=$(curl -s -m 2 http://localhost:8787/health 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ Manifest worker is running!"
else
  echo "❌ Manifest worker is NOT running"
  echo ""
  echo "Start it with:"
  echo "  npm run dev:manifest"
  echo ""
  exit 1
fi

echo ""
echo "2. Testing manifest endpoint..."
echo "   URL: http://localhost:8787/demo/sports/v_1600k.m3u8"
echo ""

MANIFEST=$(curl -s -m 5 "http://localhost:8787/demo/sports/v_1600k.m3u8" 2>&1)

if echo "$MANIFEST" | grep -q "#EXTM3U"; then
  echo "✅ Got manifest response!"
  echo ""
  
  # Check for Unified Streaming signature (in comments, not URLs)
  if echo "$MANIFEST" | grep -qi "unified streaming platform"; then
    echo "✅ SUCCESS! Your unified-streaming origin URL is being used!"
    echo ""
    echo "Unified Streaming version:"
    echo "$MANIFEST" | grep -i "unified streaming platform"
    echo ""
  else
    echo "⚠️  Manifest doesn't appear to be from Unified Streaming"
    echo ""
    echo "First few lines:"
    echo "$MANIFEST" | head -10
    echo ""
  fi
  
  # Check in media playlist for SCTE-35 markers (more likely to have them)
  echo "Checking media playlist for SCTE-35 markers..."
  MEDIA_PLAYLIST=$(curl -s -m 5 "http://localhost:8787/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8" 2>&1)
  
  if echo "$MEDIA_PLAYLIST" | grep -q "EXT-X-DATERANGE.*SCTE35"; then
    echo "✅ SCTE-35 markers detected in live stream!"
    echo ""
    echo "Sample ad marker:"
    echo "$MEDIA_PLAYLIST" | grep "EXT-X-DATERANGE.*SCTE35" | head -1
    echo ""
    AD_COUNT=$(echo "$MEDIA_PLAYLIST" | grep -c "EXT-X-DATERANGE.*SCTE35")
    echo "Found $AD_COUNT SCTE-35 ad break(s) in current window"
    echo ""
  else
    echo "ℹ️  No SCTE-35 markers in current playlist window"
    echo "   (This is normal if no ad break is scheduled right now)"
    echo ""
  fi
  
elif echo "$MANIFEST" | grep -q "forbidden\|403"; then
  echo "⚠️  Authentication issue - got 403 Forbidden"
  echo ""
  echo "Make sure DEV_ALLOW_NO_AUTH=1 is in .dev.vars"
  echo ""
  
elif echo "$MANIFEST" | grep -q "Channel not found\|404"; then
  echo "❌ Channel not found"
  echo ""
  echo "Response: $MANIFEST"
  echo ""
  
else
  echo "❌ Unexpected response"
  echo ""
  echo "$MANIFEST" | head -20
  echo ""
fi

echo "=================================================="
echo "Next steps to test ad insertion:"
echo "=================================================="
echo ""
echo "# Test SGAI mode (for iOS/Safari):"
echo "curl 'http://localhost:8787/demo/sports/v_1600k.m3u8?force=sgai'"
echo ""
echo "# Test SSAI mode (for other players):"
echo "curl 'http://localhost:8787/demo/sports/v_1600k.m3u8?force=ssai'"
echo ""
echo "# Trigger a live ad break:"
echo "./scripts/cue.sh start --channel sports --duration 30"
echo ""
echo "# Watch in a player:"
echo "open 'https://hls-js.netlify.app/demo/?src=http://localhost:8787/demo/sports/v_1600k.m3u8'"
echo ""

