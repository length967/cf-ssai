#!/bin/bash
# Create a test ad pod in the database for testing

set -e

echo "=================================================="
echo "🎬 Creating Test Ad Pod"
echo "=================================================="
echo ""

# First, get auth token
echo "1. Logging in to Admin API..."
TOKEN=$(curl -s -X POST "http://localhost:8791/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}' | \
  grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get auth token"
  echo "Make sure Admin API is running: npm run dev:admin-api"
  exit 1
fi

echo "✅ Logged in successfully"
echo ""

# Create a test ad pod using a public test video
echo "2. Creating test ad pod..."
RESPONSE=$(curl -s -X POST "http://localhost:8791/api/ad-pods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Ad - Big Buck Bunny",
    "pod_id": "test-ad-001",
    "duration_sec": 30,
    "status": "active",
    "assets": [
      {
        "bitrate": 1600000,
        "url": "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8"
      },
      {
        "bitrate": 800000,
        "url": "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8"
      }
    ],
    "tracking_impressions": ["https://httpbin.org/get?event=impression&ad=test-ad-001"],
    "tracking_quartiles": {
      "start": ["https://httpbin.org/get?event=start&ad=test-ad-001"],
      "25": ["https://httpbin.org/get?event=firstQuartile&ad=test-ad-001"],
      "50": ["https://httpbin.org/get?event=midpoint&ad=test-ad-001"],
      "75": ["https://httpbin.org/get?event=thirdQuartile&ad=test-ad-001"],
      "complete": ["https://httpbin.org/get?event=complete&ad=test-ad-001"]
    },
    "tracking_clicks": ["https://httpbin.org/get?event=click&ad=test-ad-001"],
    "tracking_errors": ["https://httpbin.org/get?event=error&ad=test-ad-001"],
    "tags": ["test", "demo"]
  }')

if echo "$RESPONSE" | grep -q '"id"'; then
  AD_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  echo "✅ Test ad pod created successfully!"
  echo "   ID: $AD_ID"
  echo "   Pod ID: test-ad-001"
else
  echo "❌ Failed to create ad pod"
  echo "Response: $RESPONSE"
  exit 1
fi

echo ""
echo "=================================================="
echo "🎯 Testing Ad Insertion"
echo "=================================================="
echo ""

echo "Now you can test ad insertion in multiple ways:"
echo ""
echo "1️⃣  Manual Trigger (via /cue API):"
echo "   curl -X POST http://localhost:8787/cue \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"channel\":\"sports\",\"type\":\"start\",\"duration\":30,\"pod_id\":\"test-ad-001\"}'"
echo ""
echo "2️⃣  Automatic SCTE-35 Detection:"
echo "   Your stream already has SCTE-35 markers - ads will insert automatically!"
echo "   Just keep watching in VLC"
echo ""
echo "3️⃣  Watch with SGAI Mode (Apple HLS Interstitials):"
echo "   open http://localhost:8888/test-player.html"
echo ""
echo "4️⃣  Watch with SSAI Mode (for testing discontinuity):"
echo "   curl 'http://localhost:8787/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8?force=ssai'"
echo ""
echo "=================================================="

