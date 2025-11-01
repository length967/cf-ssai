#!/bin/bash
# Deploy all workers for the SSAI platform

set -e

cd /Users/markjohns/Development/cf-ssai

echo "🚀 Deploying SSAI Workers..."
echo ""

echo "1️⃣  Deploying Manifest Worker (cf-ssai)..."
npx wrangler deploy --config wrangler.toml
echo "✅ Manifest Worker deployed"
echo ""

echo "2️⃣  Deploying Admin API Worker (cf-ssai-admin-api)..."
npx wrangler deploy --config wrangler.admin.toml
echo "✅ Admin API deployed"
echo ""

echo "3️⃣  Deploying Decision Service Worker (cf-ssai-decision)..."
npx wrangler deploy --config wrangler.decision.toml
echo "✅ Decision Service deployed"
echo ""

echo "4️⃣  Deploying Transcode Worker (cf-ssai-transcode)..."
npx wrangler deploy --config wrangler-transcode.toml
echo "✅ Transcode Worker deployed"
echo ""

echo "5️⃣  Deploying VAST Parser Worker (cf-ssai-vast-parser)..."
npx wrangler deploy --config wrangler.vast.toml
echo "✅ VAST Parser deployed"
echo ""

echo "6️⃣  Deploying Beacon Consumer Worker (cf-ssai-beacon)..."
npx wrangler deploy --config wrangler.beacon.toml
echo "✅ Beacon Consumer deployed"
echo ""

echo "✨ All workers deployed successfully!"
echo ""
echo "🎥 Your stream URL: https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8"
echo "🎛️  Admin GUI: https://main.ssai-admin.pages.dev"
echo ""

