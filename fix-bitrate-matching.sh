#!/bin/bash
# Fix bitrate matching by adding the missing bitrate_ladder column

set -e

cd /Users/markjohns/Development/cf-ssai

echo "🔧 Fixing Bitrate Matching Configuration"
echo ""
echo "This will:"
echo "  1. Add bitrate_ladder column to channels table"
echo "  2. Set default bitrate ladder [1000, 2000, 3000] for existing channels"
echo ""

read -p "Apply migration to remote database? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "📦 Applying migration to remote database..."
    npx wrangler d1 execute ssai-admin --remote --file=./migrations/005_add_bitrate_ladder.sql
    
    echo ""
    echo "✅ Migration complete!"
    echo ""
    echo "📊 Verify the column was added:"
    echo "   npx wrangler d1 execute ssai-admin --remote --command \"PRAGMA table_info(channels)\" | grep bitrate_ladder"
    echo ""
    echo "🎯 Next steps:"
    echo "   1. Update Admin GUI to add bitrate ladder field (see BITRATE_MATCHING_STATUS.md)"
    echo "   2. Or manually update a channel:"
    echo "      npx wrangler d1 execute ssai-admin --remote --command \"UPDATE channels SET bitrate_ladder = '[500, 1500, 4000]' WHERE id = 'ch_demo_sports'\""
    echo ""
    echo "📖 Full documentation: BITRATE_MATCHING_STATUS.md"
else
    echo "❌ Migration cancelled"
fi

