#!/bin/bash
# Check which SSAI services are running

echo "=================================================="
echo "🔍 SSAI Platform Service Status"
echo "=================================================="
echo ""

check_service() {
  local name=$1
  local url=$2
  
  echo -n "$name: "
  
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 2 "$url" 2>/dev/null)
  
  if [ $? -eq 0 ] && [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Running (HTTP $HTTP_STATUS)"
    return 0
  else
    echo "❌ Not running"
    return 1
  fi
}

RUNNING=0
TOTAL=0

# Check each service
((TOTAL++))
if check_service "Manifest Worker    " "http://localhost:8787/health"; then
  ((RUNNING++))
fi

((TOTAL++))
if check_service "Decision Service   " "http://localhost:8788/health"; then
  ((RUNNING++))
fi

((TOTAL++))
if check_service "Beacon Consumer    " "http://localhost:8789/health"; then
  ((RUNNING++))
fi

((TOTAL++))
if check_service "VAST Parser        " "http://localhost:8790/health"; then
  ((RUNNING++))
fi

((TOTAL++))
if check_service "Admin API          " "http://localhost:8791/health"; then
  ((RUNNING++))
fi

((TOTAL++))
# Frontend check is different - try both 3000 and 3001
echo -n "Admin Frontend     : "
if curl -s -o /dev/null -w "%{http_code}" -m 2 "http://localhost:3000" 2>/dev/null | grep -q "200"; then
  echo "✅ Running (port 3000)"
  ((RUNNING++))
elif curl -s -o /dev/null -w "%{http_code}" -m 2 "http://localhost:3001" 2>/dev/null | grep -q "200"; then
  echo "✅ Running (port 3001)"
  ((RUNNING++))
else
  echo "❌ Not running"
fi

echo ""
echo "=================================================="
echo "Summary: $RUNNING/$TOTAL services running"
echo "=================================================="
echo ""

if [ $RUNNING -eq $TOTAL ]; then
  echo "🎉 All services are running!"
  echo ""
  echo "Test your stream:"
  echo "  ./test-now.sh"
  echo ""
  echo "Or watch in a player:"
  echo "  open 'https://hls-js.netlify.app/demo/?src=http://localhost:8787/demo/sports/scte35-audio_eng=128000-video=1000000.m3u8'"
  echo ""
elif [ $RUNNING -eq 0 ]; then
  echo "⚠️  No services are running!"
  echo ""
  echo "Start them with:"
  echo "  ./start-all.sh"
  echo ""
else
  echo "⚠️  Some services are missing!"
  echo ""
  echo "You need to start:"
  if ! curl -s -m 2 "http://localhost:8787/health" > /dev/null 2>&1; then
    echo "  - Manifest Worker: npm run dev:manifest"
  fi
  if ! curl -s -m 2 "http://localhost:8788/health" > /dev/null 2>&1; then
    echo "  - Decision Service: npm run dev:decision"
  fi
  if ! curl -s -m 2 "http://localhost:8789/health" > /dev/null 2>&1; then
    echo "  - Beacon Consumer: npm run dev:beacon"
  fi
  if ! curl -s -m 2 "http://localhost:8790/health" > /dev/null 2>&1; then
    echo "  - VAST Parser: npm run dev:vast"
  fi
  if ! curl -s -m 2 "http://localhost:8791/health" > /dev/null 2>&1; then
    echo "  - Admin API: npm run dev:admin-api"
  fi
  if ! curl -s -m 2 "http://localhost:3000" > /dev/null 2>&1 && ! curl -s -m 2 "http://localhost:3001" > /dev/null 2>&1; then
    echo "  - Admin Frontend: cd admin-frontend && npm run dev"
  fi
  echo ""
fi

echo "=================================================="

