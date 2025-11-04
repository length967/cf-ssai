#!/bin/bash
# SCTE-35 Monitor Management Script
# Helper for starting/stopping/checking SCTE-35 monitors

set -e

WORKER_URL="${WORKER_URL:-https://cf-ssai-scte35-monitor.markj-3e4.workers.dev}"
LOCAL_URL="http://localhost:8792"

# Detect if running locally
if curl -s "$LOCAL_URL/status/test" > /dev/null 2>&1; then
  BASE_URL="$LOCAL_URL"
  echo "Using local development: $BASE_URL"
else
  BASE_URL="$WORKER_URL"
  echo "Using production: $BASE_URL"
fi

command=$1
channel=${2:-sports1}

case "$command" in
  start)
    echo "Starting SCTE-35 monitoring for channel: $channel"
    curl -X POST "$BASE_URL/start/$channel" | jq
    ;;
    
  stop)
    echo "Stopping SCTE-35 monitoring for channel: $channel"
    curl -X POST "$BASE_URL/stop/$channel" | jq
    ;;
    
  status)
    echo "Getting monitoring status for channel: $channel"
    curl -s "$BASE_URL/status/$channel" | jq
    ;;
    
  list)
    echo "Listing all channels with SCTE-35 enabled..."
    # Query D1 via admin API or wrangler
    wrangler d1 execute ssai-admin --remote --command \
      "SELECT channel_id, scte35_enabled FROM channels WHERE scte35_enabled = 1"
    ;;
    
  logs)
    echo "Tailing SCTE-35 monitor logs..."
    wrangler tail cf-ssai-scte35-monitor --format pretty
    ;;
    
  *)
    echo "SCTE-35 Monitor Management"
    echo ""
    echo "Usage: $0 <command> [channel]"
    echo ""
    echo "Commands:"
    echo "  start [channel]   - Start monitoring for a channel (default: sports1)"
    echo "  stop [channel]    - Stop monitoring for a channel"
    echo "  status [channel]  - Get monitoring status"
    echo "  list              - List all channels with SCTE-35 enabled"
    echo "  logs              - Tail monitor worker logs"
    echo ""
    echo "Examples:"
    echo "  $0 start sports1"
    echo "  $0 status sports1"
    echo "  $0 list"
    exit 1
    ;;
esac
