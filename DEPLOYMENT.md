# Deployment Guide

This guide walks through deploying the CF-SSAI system to Cloudflare Workers.

## Prerequisites

1. **Cloudflare Account**
   - Sign up at https://dash.cloudflare.com
   - Note your Account ID (found in Workers & Pages overview)

2. **Wrangler CLI**
   - Already installed via `npm install`
   - Login: `wrangler login`
   - Verify: `wrangler whoami`

3. **R2 Bucket** (for ad storage)
   - Create: `wrangler r2 bucket create ssai-ads`
   - Note: Bucket name must match `wrangler.toml` settings

4. **D1 Database** (for configuration)
   - Already created (database_id in wrangler files)
   - Or create new: `npm run db:create`

## Pre-Deployment Checklist

### 1. Update Configuration

Edit `.dev.vars` for local secrets (do NOT commit this file):

```bash
# .dev.vars (local development only)
JWT_PUBLIC_KEY="your-jwt-public-key"
SEGMENT_SECRET="your-hmac-secret-for-url-signing"
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
```

### 2. Set Production Secrets

Set secrets for production (stored encrypted by Cloudflare):

```bash
# Required secrets
wrangler secret put JWT_PUBLIC_KEY --config wrangler.toml
wrangler secret put SEGMENT_SECRET --config wrangler.toml

# R2 credentials (if using external R2 access)
wrangler secret put R2_ACCESS_KEY_ID --config wrangler.toml
wrangler secret put R2_SECRET_ACCESS_KEY --config wrangler.toml

# Optional: External ad decision API
wrangler secret put AD_DECISION_API_URL --config wrangler.decision.toml
wrangler secret put AD_DECISION_API_KEY --config wrangler.decision.toml
```

### 3. Initialize Database

Run migrations on production D1:

```bash
npm run db:init
```

This creates the required tables:
- `organizations`
- `channels`
- `ad_pods`
- `ad_creatives`
- `slate_configs`

### 4. Configure Environment Variables

Review and update `wrangler.toml` files:

**Important settings to verify:**

```toml
# wrangler.toml (main manifest worker)
[vars]
DEV_ALLOW_NO_AUTH = "0"  # MUST be "0" in production!
MANIFEST_CACHE_MAX_AGE = "2"  # HLS manifest cache (seconds)
SEGMENT_CACHE_MAX_AGE = "60"  # HLS segment cache (seconds)

# Update R2 public URL if using custom domain
R2_PUBLIC_URL = "https://pub-YOUR-BUCKET-ID.r2.dev"
ORIGIN_VARIANT_BASE = "https://pub-YOUR-BUCKET-ID.r2.dev/origin"
AD_POD_BASE = "https://pub-YOUR-BUCKET-ID.r2.dev/transcoded-ads"
```

**Observability settings** (adjust sampling rates for cost management):

```toml
[observability.logs]
head_sampling_rate = 0.05  # 5% of requests (reduce from 100% dev setting)

[observability.traces]
head_sampling_rate = 0.15  # 15% of requests
```

## Deployment Steps

### Option 1: Deploy All Workers at Once

```bash
npm run deploy:all
```

This runs:
1. `deploy:manifest` - Main HLS manifest worker
2. `deploy:decision` - Ad decision service
3. `deploy:beacon` - Beacon consumer (queue worker)
4. `deploy:vast` - VAST XML parser
5. `deploy:admin-api` - Admin API

### Option 2: Deploy Individually

Useful for incremental updates:

```bash
# Deploy specific workers
npm run deploy:manifest
npm run deploy:decision
npm run deploy:beacon
npm run deploy:vast
npm run deploy:admin-api
```

## Post-Deployment Verification

### 1. Check Worker URLs

After deployment, Wrangler will output URLs:

```
Published cf-ssai (X.XX sec)
  https://cf-ssai.YOUR_SUBDOMAIN.workers.dev
Published cf-ssai-decision (X.XX sec)
  https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev
...
```

**Note your subdomain** - you'll need this for testing.

### 2. Verify Service Bindings

Service bindings allow worker-to-worker communication:

```bash
# In wrangler.toml
[[services]]
binding = "DECISION"
service = "cf-ssai-decision"  # Must match deployed service name
```

Check bindings are correct:
```bash
wrangler deployments list
```

### 3. Test Health Endpoints

```bash
# Test manifest worker
curl https://cf-ssai.YOUR_SUBDOMAIN.workers.dev/health

# Test decision worker
curl https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev/health

# Test VAST parser
curl https://cf-ssai-vast-parser.YOUR_SUBDOMAIN.workers.dev/health
```

### 4. Run Integration Tests

Update test configuration for your deployed URLs:

```bash
export TEST_ENV=production
export TEST_URL_MANIFEST="https://cf-ssai.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_DECISION="https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_BEACON="https://cf-ssai-beacon-consumer.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_VAST="https://cf-ssai-vast-parser.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_ADMIN_API="https://cf-ssai-admin-api.YOUR_SUBDOMAIN.workers.dev"

npm run test:integration
```

## Production Configuration

### Queues Setup

Queues are used for asynchronous beacon processing:

```bash
# Create queues (if not already created)
wrangler queues create beacon-queue
wrangler queues create beacon-dlq
wrangler queues create transcode-queue
```

Verify queue bindings in `wrangler.toml`:

```toml
# Producer (manifest worker)
[[queues.producers]]
binding = "BEACON_QUEUE"
queue = "beacon-queue"

# Consumer (beacon worker)
[[queues.consumers]]
queue = "beacon-queue"
max_batch_size = 100
max_batch_timeout = 5
```

### Custom Domains (Optional)

To use custom domains instead of `workers.dev`:

1. Add domain in Cloudflare dashboard
2. Update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "ssai.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

3. Deploy: `wrangler deploy --env production`

## Monitoring & Observability

### Logs

View real-time logs:

```bash
# Tail manifest worker logs
wrangler tail

# Tail decision worker logs
wrangler tail --config wrangler.decision.toml

# Filter for errors only
wrangler tail --format pretty | grep ERROR
```

### Metrics

Access metrics in Cloudflare Dashboard:
- **Workers & Pages** → Select worker → **Metrics**
- Key metrics:
  - Requests/sec
  - CPU time (watch for timeouts)
  - Errors (4xx, 5xx rates)
  - Durable Object operations

### Alerts

Set up alerts for:
- Error rate > 5%
- CPU time > 50ms (approaching 50ms limit)
- Queue depth > 1000 messages

## Rollback

If deployment fails:

```bash
# View deployment history
wrangler deployments list

# Rollback to previous version
wrangler rollback [DEPLOYMENT_ID]
```

## Cost Optimization

### Worker Pricing
- **Free Tier**: 100,000 requests/day
- **Paid Plan**: $5/10M requests
- **Durable Objects**: $0.15/million requests

### Recommendations
1. **Reduce logging** in production (5% sampling)
2. **Enable caching**: Set appropriate `Cache-Control` headers
3. **Batch beacon processing**: Use queue `max_batch_size=100`
4. **Monitor DO usage**: Each channel = 1 DO instance

## Troubleshooting

### "Service binding not found"
- Ensure target worker is deployed first
- Check service name matches exactly
- Redeploy dependent worker

### "Database not found"
- Run migrations: `npm run db:init`
- Verify `database_id` in wrangler.toml matches actual D1 database

### "R2 bucket not found"
- Create bucket: `wrangler r2 bucket create ssai-ads`
- Verify bucket name in wrangler.toml

### "CPU time limit exceeded"
- Check decision service timeout (DECISION_TIMEOUT_MS)
- Enable pre-calculated decisions
- Optimize SCTE-35 parsing (use binary parser)

### "Queue messages backing up"
- Increase beacon consumer concurrency
- Check beacon tracker URLs are reachable
- Review dead letter queue for failed messages

## Security Checklist

Before going live:

- [ ] `DEV_ALLOW_NO_AUTH = "0"` in all production configs
- [ ] JWT_PUBLIC_KEY set as secret (not in wrangler.toml)
- [ ] SEGMENT_SECRET set as secret (for URL signing)
- [ ] R2 bucket has restricted access (not public-read)
- [ ] Rate limiting enabled (if using paid plan)
- [ ] CORS configured correctly for HLS delivery
- [ ] Log sampling reduced (avoid leaking sensitive data)

## Next Steps

1. **Upload test content**: Add HLS streams to R2 `origin/` folder
2. **Create channels**: Use admin API to configure channels
3. **Upload ads**: Add ad creatives to R2 `transcoded-ads/` folder
4. **Configure slate**: Set default slate in database
5. **Test SCTE-35 flow**: Send test stream with SCTE-35 markers

## Support

- **Wrangler docs**: https://developers.cloudflare.com/workers/wrangler/
- **Workers docs**: https://developers.cloudflare.com/workers/
- **Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **R2 docs**: https://developers.cloudflare.com/r2/
