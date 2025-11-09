# Deployed URLs

Deployment completed: 2025-11-08

## 🎯 Admin Dashboard (Cloudflare Pages)

**Production URL**: https://ssai-admin.pages.dev
**Deployment URL**: https://61d8e2d6.ssai-admin.pages.dev
**Branch Alias**: https://main.ssai-admin.pages.dev

### Login Access
- The dashboard connects to: https://cf-ssai-admin-api.mediamasters.workers.dev
- Default authentication is currently disabled (DEV_ALLOW_NO_AUTH=1)
- Configure JWT authentication for production use

## Worker Endpoints

### Main Services
- **Manifest Worker**: https://cf-ssai.mediamasters.workers.dev
- **Decision Service**: https://cf-ssai-decision.mediamasters.workers.dev
- **Beacon Consumer**: https://cf-ssai-beacon-consumer.mediamasters.workers.dev
- **VAST Parser**: https://cf-ssai-vast-parser.mediamasters.workers.dev
- **Admin API**: https://cf-ssai-admin-api.mediamasters.workers.dev

## Testing These Deployments

### Update Test Configuration

```bash
export TEST_ENV=production
export TEST_URL_MANIFEST="https://cf-ssai.mediamasters.workers.dev"
export TEST_URL_DECISION="https://cf-ssai-decision.mediamasters.workers.dev"
export TEST_URL_BEACON="https://cf-ssai-beacon-consumer.mediamasters.workers.dev"
export TEST_URL_VAST="https://cf-ssai-vast-parser.mediamasters.workers.dev"
export TEST_URL_ADMIN_API="https://cf-ssai-admin-api.mediamasters.workers.dev"
```

### Run Integration Tests

```bash
npm run test:integration
```

### Health Checks

```bash
# Test manifest worker
curl https://cf-ssai.mediamasters.workers.dev/health

# Test decision worker
curl https://cf-ssai-decision.mediamasters.workers.dev/health

# Test VAST parser
curl https://cf-ssai-vast-parser.mediamasters.workers.dev/health

# Test admin API
curl https://cf-ssai-admin-api.mediamasters.workers.dev/health
```

### Monitor Logs

```bash
# Tail manifest worker logs
wrangler tail

# Tail decision worker logs
wrangler tail --config wrangler.decision.toml

# Tail beacon consumer logs
wrangler tail --config wrangler.beacon.toml
```

## Deployment Details

- **Account**: Mark.johns@me.com's Account
- **Account ID**: a872c8de0c1a9e713c7f4f92b3221f92
- **Subdomain**: mediamasters.workers.dev
- **Date**: 2025-11-08

## Version IDs

- cf-ssai: `14fca6df-1a8c-4059-9da2-e29d67c4008d`
- cf-ssai-decision: `26d1bed7-67fa-43f3-aa8d-b40aa2b77a56`
- cf-ssai-beacon-consumer: `0a49f50d-2575-4fef-9e9f-622a35d47027`
- cf-ssai-vast-parser: `38d0e8f9-8e13-4ef3-9036-6c12ec66274f`
- cf-ssai-admin-api: `d7692be7-e789-462b-8bd1-7c89451720f3`

## Next Steps

1. **Initialize Database** (if not already done):
   ```bash
   npm run db:init
   ```

2. **Set Production Secrets**:
   ```bash
   wrangler secret put JWT_PUBLIC_KEY
   wrangler secret put SEGMENT_SECRET
   ```

3. **Upload Test Content** to R2:
   - Origin HLS streams → `ssai-ads` bucket, `origin/` folder
   - Ad creatives → `ssai-ads` bucket, `transcoded-ads/` folder

4. **Configure Channels** via Admin API

5. **Run Integration Tests** (see above)

## Important Notes

⚠️ **Security Warning**: `DEV_ALLOW_NO_AUTH` is currently set to "1" in production!
- This allows access without JWT authentication
- **Change to "0" before handling real traffic**
- Update `wrangler.toml` and redeploy: `npm run deploy:manifest`

⚠️ **Observability**: Logging is at 100% sampling rate
- Consider reducing to 5-15% for cost optimization
- See `deploy-checklist.md` for recommended settings
