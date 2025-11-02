#!/bin/bash
# Consolidated log viewer for all CF-SSAI workers
# Usage: ./view-logs.sh [filter]
# Example: ./view-logs.sh error
# Example: ./view-logs.sh SCTE-35

FILTER="${1:-}"

echo "🪵  Starting consolidated log viewer for CF-SSAI"
echo "📊 Monitoring: manifest, decision, admin-api, transcode, beacon"
echo ""

if [ -n "$FILTER" ]; then
  echo "🔍 Filter: '$FILTER'"
  echo ""
fi

# Function to format worker logs with color
format_logs() {
  local worker=$1
  local color=$2
  
  while IFS= read -r line; do
    # Skip empty lines
    if [ -z "$line" ]; then
      continue
    fi
    
    # Color codes
    case $color in
      "blue")   COLOR="\033[0;34m" ;;
      "green")  COLOR="\033[0;32m" ;;
      "yellow") COLOR="\033[0;33m" ;;
      "cyan")   COLOR="\033[0;36m" ;;
      "magenta") COLOR="\033[0;35m" ;;
      *)        COLOR="\033[0m" ;;
    esac
    RESET="\033[0m"
    
    # Add timestamp and worker prefix
    echo -e "${COLOR}[$(date +%H:%M:%S)] [$worker]${RESET} $line"
  done
}

# Tail all workers in parallel and merge output
(npx wrangler tail cf-ssai --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  format_logs "MANIFEST" "blue") &

(npx wrangler tail cf-ssai-decision --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  format_logs "DECISION" "green") &

(npx wrangler tail cf-ssai-admin-api --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  format_logs "ADMIN" "yellow") &

(npx wrangler tail cf-ssai-transcode --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  format_logs "TRANSCODE" "cyan") &

(npx wrangler tail cf-ssai-beacon --format=pretty 2>&1 | \
  grep -v "EPERM\|Would have written\|Writing logs to" | \
  format_logs "BEACON" "magenta") &

# Wait for user to press Ctrl+C
echo "Press Ctrl+C to stop..."
wait

