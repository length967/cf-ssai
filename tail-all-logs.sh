#!/bin/bash

# Tail all worker logs in a single terminal with prefixes
# Usage: ./tail-all-logs.sh

echo "🔍 Starting all worker logs..."
echo "Press Ctrl+C to stop"
echo ""

# Run all three tail commands in parallel and prefix each line
(npx wrangler tail cf-ssai-admin-api --format=json 2>&1 | while IFS= read -r line; do echo "[ADMIN-API] $line"; done) &
PID1=$!

(npx wrangler tail cf-ssai --format=json 2>&1 | while IFS= read -r line; do echo "[MANIFEST] $line"; done) &
PID2=$!

(npx wrangler tail cf-ssai-transcode --format=json 2>&1 | while IFS= read -r line; do echo "[TRANSCODE] $line"; done) &
PID3=$!

# Wait for all background processes
wait $PID1 $PID2 $PID3

