#!/bin/bash

# Deploy Admin Frontend with Production API URL
# Usage: ./deploy-prod.sh <ADMIN_API_URL>
#
# Example:
#   ./deploy-prod.sh https://cf-ssai-admin-api.your-subdomain.workers.dev

set -e

if [ -z "$1" ]; then
  echo "❌ Error: Admin API URL is required"
  echo ""
  echo "Usage: ./deploy-prod.sh <ADMIN_API_URL>"
  echo ""
  echo "Example:"
  echo "  ./deploy-prod.sh https://cf-ssai-admin-api.your-subdomain.workers.dev"
  echo ""
  echo "To find your Admin API URL:"
  echo "  1. Go to Cloudflare Dashboard > Workers & Pages"
  echo "  2. Find 'cf-ssai-admin-api' worker"
  echo "  3. Copy the URL (should end with .workers.dev)"
  exit 1
fi

ADMIN_API_URL="$1"

echo "🔧 Building Admin Frontend with production API..."
echo "   API URL: $ADMIN_API_URL"
echo ""

# Clean previous builds to prevent cache issues
echo "🧹 Cleaning previous build..."
rm -rf .next out

# Set the environment variable for the build (this overrides .env.local)
export NEXT_PUBLIC_API_URL="$ADMIN_API_URL"

echo "📦 Building frontend..."
# Build the frontend
npm run build

# Verify the API URL is in the build
if grep -q "$ADMIN_API_URL" out/_next/static/chunks/app/login/*.js 2>/dev/null; then
  echo "✅ Verified: Production API URL is in the build"
else
  echo "⚠️  Warning: Could not verify API URL in build files"
fi

echo ""
echo "🚀 Deploying to Cloudflare Pages..."
npx wrangler pages deploy out --project-name=ssai-admin

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your admin dashboard should now connect to: $ADMIN_API_URL"

