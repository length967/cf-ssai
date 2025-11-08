#!/bin/bash
# Deployment script for CF-SSAI to Cloudflare Workers
# Run this after completing deploy-checklist.md

set -e  # Exit on error

echo "🚀 CF-SSAI Deployment Script"
echo "================================"
echo ""

# Check if logged in
echo "Checking Wrangler authentication..."
if ! wrangler whoami &> /dev/null; then
  echo "❌ Not logged in to Cloudflare"
  echo "Please run: wrangler login"
  exit 1
fi

echo "✅ Authenticated with Cloudflare"
echo ""

# Dry run first
echo "Running dry-run deployment checks..."
wrangler deploy --dry-run || exit 1
wrangler deploy --dry-run --config wrangler.decision.toml || exit 1
wrangler deploy --dry-run --config wrangler.beacon.toml || exit 1
wrangler deploy --dry-run --config wrangler.vast.toml || exit 1
echo "✅ Dry-run validation passed"
echo ""

# Confirm deployment
read -p "Deploy to production? This will deploy 5 workers. (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Deployment cancelled"
  exit 0
fi

echo ""
echo "Deploying workers..."
echo "-------------------"

# Deploy in order (dependencies first)
echo "1/5 Deploying VAST parser worker..."
npm run deploy:vast

echo ""
echo "2/5 Deploying decision worker..."
npm run deploy:decision

echo ""
echo "3/5 Deploying manifest worker..."
npm run deploy:manifest

echo ""
echo "4/5 Deploying beacon consumer..."
npm run deploy:beacon

echo ""
echo "5/5 Deploying admin API..."
npm run deploy:admin-api

echo ""
echo "================================"
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Note the worker URLs from output above"
echo "2. Run health checks: curl https://cf-ssai.YOUR_SUBDOMAIN.workers.dev/health"
echo "3. Update test config: export TEST_ENV=production"
echo "4. Run integration tests: npm run test:integration"
echo "5. Monitor logs: wrangler tail"
echo ""
echo "📖 See DEPLOYMENT.md for full post-deployment guide"
