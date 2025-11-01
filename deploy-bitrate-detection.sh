#!/bin/bash
# Deploy automatic bitrate detection feature

set -e

cd /Users/markjohns/Development/cf-ssai

echo "🎯 Deploying Automatic Bitrate Detection"
echo ""
echo "This will:"
echo "  1. Add detected_bitrates, bitrate_ladder_source, and last_bitrate_detection columns"
echo "  2. Deploy updated manifest worker with detection logic"
echo "  3. Test bitrate detection on your stream"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "❌ Cancelled"
    exit 1
fi

# Step 1: Apply database migration
echo ""
echo "📦 Step 1: Applying database migration..."
npx wrangler d1 execute ssai-admin --remote --file=./migrations/006_add_detected_bitrates.sql

# Step 2: Deploy manifest worker
echo ""
echo "🚀 Step 2: Deploying manifest worker..."
npx wrangler deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Testing bitrate detection:"
echo ""
echo "1. Access your stream to trigger detection:"
echo "   curl -I https://cf-ssai.mediamasters.workers.dev/demo/sports/master.m3u8"
echo ""
echo "2. Check the database for detected bitrates:"
echo "   npx wrangler d1 execute ssai-admin --remote --command \"SELECT id, name, detected_bitrates, bitrate_ladder, bitrate_ladder_source FROM channels\""
echo ""
echo "3. View detection logs:"
echo "   npx wrangler tail cf-ssai --format=pretty"
echo "   Look for: 'Detected bitrates for channel...'"
echo ""
echo "📖 Full documentation: BITRATE_DETECTION_GUIDE.md"

