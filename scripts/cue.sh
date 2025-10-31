#!/usr/bin/env bash
# Quick script to trigger ad breaks via /cue API

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
CHANNEL="${CHANNEL:-sports1}"
AUTH_TOKEN="${AUTH_TOKEN:-eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYiLCJleHAiOjI1MzQwOTYwMDAsImJ1Y2tldCI6IkEifQ.x}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
  cat <<EOF
Usage: $0 <command> [options]

Commands:
  start    Start an ad break
  stop     Stop the current ad break
  status   Check current manifest (uses force=sgai)
  help     Show this help

Options:
  --channel CHANNEL      Channel name (default: sports1)
  --duration SECONDS     Ad duration in seconds (default: 30)
  --pod-id POD_ID       Pod ID (default: example-pod)
  --pod-url URL          Custom pod URL
  --base-url URL         Base URL (default: http://127.0.0.1:8787)

Examples:
  # Start a 30s ad break on sports1
  $0 start

  # Start a 60s ad break with custom pod
  $0 start --duration 60 --pod-id premium-ad

  # Stop current ad break
  $0 stop

  # Check manifest
  $0 status
EOF
}

start_ad() {
  local duration="${1:-30}"
  local pod_id="${2:-example-pod}"
  local pod_url="${3:-}"

  echo -e "${YELLOW}Starting ad break...${NC}"
  echo "  Channel: $CHANNEL"
  echo "  Duration: ${duration}s"
  echo "  Pod ID: $pod_id"

  local body="{\"channel\":\"$CHANNEL\",\"type\":\"start\",\"duration\":$duration,\"pod_id\":\"$pod_id\""
  if [ -n "$pod_url" ]; then
    body="$body,\"pod_url\":\"$pod_url\""
  fi
  body="$body}"

  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/cue" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "$body")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Ad break started${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
  else
    echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
    echo "$body"
    exit 1
  fi
}

stop_ad() {
  echo -e "${YELLOW}Stopping ad break...${NC}"
  echo "  Channel: $CHANNEL"

  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/cue" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{\"channel\":\"$CHANNEL\",\"type\":\"stop\"}")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ Ad break stopped${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
  else
    echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
    echo "$body"
    exit 1
  fi
}

check_status() {
  echo -e "${YELLOW}Fetching manifest...${NC}"
  echo "  Channel: $CHANNEL"
  echo "  URL: $BASE_URL?channel=$CHANNEL&variant=v_1600k.m3u8&force=sgai"
  echo

  curl -s "$BASE_URL?channel=$CHANNEL&variant=v_1600k.m3u8&force=sgai" \
    -H "Authorization: Bearer $AUTH_TOKEN"
}

# Parse arguments
COMMAND="${1:-help}"
shift || true

DURATION=30
POD_ID="example-pod"
POD_URL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --pod-id)
      POD_ID="$2"
      shift 2
      ;;
    --pod-url)
      POD_URL="$2"
      shift 2
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

case $COMMAND in
  start)
    start_ad "$DURATION" "$POD_ID" "$POD_URL"
    ;;
  stop)
    stop_ad
    ;;
  status)
    check_status
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo -e "${RED}Unknown command: $COMMAND${NC}"
    usage
    exit 1
    ;;
esac

