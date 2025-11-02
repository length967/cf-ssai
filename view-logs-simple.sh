#!/bin/bash
# Simple consolidated log viewer - shows key events only
# Usage: ./view-logs-simple.sh

echo "🪵  Consolidated Log Viewer (Key Events Only)"
echo "=============================================="
echo ""

# Tail the main manifest worker and filter for important events
npx wrangler tail cf-ssai --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  grep -E "(error|Error|SCTE-35|Ad|decision|tier|Channel config|Fetching origin|INSERT|break|stall|Buffer)" | \
  while IFS= read -r line; do
    echo "[$(date +%H:%M:%S)] $line"
  done

