#!/bin/bash
# Start all SSAI workers for local development

echo "=================================================="
echo "🚀 Starting Complete SSAI Platform"
echo "=================================================="
echo ""

# Check if any are already running
check_port() {
  lsof -ti:$1 > /dev/null 2>&1
}

echo "Checking for running services..."
echo ""

# Port assignments
MANIFEST_PORT=8787
DECISION_PORT=8788
BEACON_PORT=8789
VAST_PORT=8790
ADMIN_API_PORT=8791
ADMIN_FRONTEND_PORT=3000

if check_port $MANIFEST_PORT; then
  echo "⚠️  Port $MANIFEST_PORT (Manifest Worker) is already in use"
else
  echo "✓ Port $MANIFEST_PORT available"
fi

if check_port $DECISION_PORT; then
  echo "⚠️  Port $DECISION_PORT (Decision Service) is already in use"
else
  echo "✓ Port $DECISION_PORT available"
fi

if check_port $BEACON_PORT; then
  echo "⚠️  Port $BEACON_PORT (Beacon Consumer) is already in use"
else
  echo "✓ Port $BEACON_PORT available"
fi

if check_port $VAST_PORT; then
  echo "⚠️  Port $VAST_PORT (VAST Parser) is already in use"
else
  echo "✓ Port $VAST_PORT available"
fi

if check_port $ADMIN_API_PORT; then
  echo "⚠️  Port $ADMIN_API_PORT (Admin API) is already in use"
else
  echo "✓ Port $ADMIN_API_PORT available"
fi

if check_port $ADMIN_FRONTEND_PORT; then
  echo "⚠️  Port $ADMIN_FRONTEND_PORT (Admin Frontend) is already in use"
else
  echo "✓ Port $ADMIN_FRONTEND_PORT available"
fi

if check_port 3001; then
  echo "⚠️  Port 3001 (Admin Frontend alt) is already in use"
else
  echo "✓ Port 3001 available"
fi

echo ""
echo "=================================================="
echo "📋 To start all services, open 6 terminal tabs:"
echo "=================================================="
echo ""
echo "Terminal 1 - Manifest Worker (Main HLS Assembly):"
echo "  cd $(pwd)"
echo "  npm run dev:manifest"
echo ""
echo "Terminal 2 - Decision Service (VAST Ad Decisions):"
echo "  cd $(pwd)"
echo "  npm run dev:decision"
echo ""
echo "Terminal 3 - Beacon Consumer (Tracking Processing):"
echo "  cd $(pwd)"
echo "  npm run dev:beacon"
echo ""
echo "Terminal 4 - VAST Parser (VAST XML Parsing):"
echo "  cd $(pwd)"
echo "  npm run dev:vast"
echo ""
echo "Terminal 5 - Admin API (Backend for GUI):"
echo "  cd $(pwd)"
echo "  npm run dev:admin-api"
echo ""
echo "Terminal 6 - Admin Frontend (GUI):"
echo "  cd $(pwd)/admin-frontend"
echo "  npm run dev"
echo "  (Will run on port 3000 or 3001 depending on availability)"
echo ""
echo "=================================================="
echo "🔗 Service URLs:"
echo "=================================================="
echo ""
echo "Manifest Worker:    http://localhost:$MANIFEST_PORT"
echo "Decision Service:   http://localhost:$DECISION_PORT"
echo "Beacon Consumer:    http://localhost:$BEACON_PORT"
echo "VAST Parser:        http://localhost:$VAST_PORT"
echo "Admin API:          http://localhost:$ADMIN_API_PORT"
echo "Admin Frontend:     http://localhost:3000 or http://localhost:3001"
echo ""
echo "=================================================="
echo "📺 Test Your Stream:"
echo "=================================================="
echo ""
echo "HLS Stream URL:"
echo "  http://localhost:$MANIFEST_PORT/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8"
echo ""
echo "Watch in HLS.js player:"
echo "  open 'https://hls-js.netlify.app/demo/?src=http://localhost:$MANIFEST_PORT/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8'"
echo ""
echo "Trigger ad break:"
echo "  ./scripts/cue.sh start --channel sports --duration 30"
echo ""
echo "=================================================="

