#!/bin/bash
# Deploy the manifest worker with updated configuration

cd /Users/markjohns/Development/cf-ssai
npx wrangler deploy

echo ""
echo "✅ Manifest worker deployed!"
echo ""
echo "You can now test your stream URLs:"
echo "https://cf-ssai.mediamasters.workers.dev/demo/ch_demo_sports/master.m3u8"
echo ""
echo "Note: The channel slug is visible in the Admin GUI under Channels > Edit"

