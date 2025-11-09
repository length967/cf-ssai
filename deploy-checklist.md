# Pre-Deployment Checklist

Run through this checklist before deploying to production.

## 1. Authentication & Security

- [ ] **Set DEV_ALLOW_NO_AUTH to "0"** in `wrangler.toml` for production
  ```bash
  # wrangler.toml line 61
  DEV_ALLOW_NO_AUTH = "0"  # CHANGE FROM "1"
  ```

- [ ] **Generate secrets**
  ```bash
  # Generate SEGMENT_SECRET
  openssl rand -hex 32

  # Set production secrets
  wrangler secret put JWT_PUBLIC_KEY
  wrangler secret put SEGMENT_SECRET
  ```

- [ ] **R2 credentials configured** (if using R2 API)
  ```bash
  wrangler secret put R2_ACCESS_KEY_ID
  wrangler secret put R2_SECRET_ACCESS_KEY
  ```

## 2. Observability Settings

- [ ] **Reduce log sampling** in `wrangler.toml` (currently 100%)
  ```toml
  # wrangler.toml lines 76, 80
  [observability.logs]
  head_sampling_rate = 0.05  # CHANGE FROM 1.0 to 0.05 (5%)

  [observability.traces]
  head_sampling_rate = 0.15  # CHANGE FROM 1.0 to 0.15 (15%)
  ```

- [ ] **Update decision worker sampling** in `wrangler.decision.toml`
  ```toml
  # Currently at 1.0 (100%) - reduce for production
  head_sampling_rate = 0.05  # Logs
  head_sampling_rate = 0.15  # Traces
  ```

## 3. Database & Storage

- [ ] **R2 bucket created**
  ```bash
  wrangler r2 bucket create ssai-ads
  ```

- [ ] **D1 database initialized**
  ```bash
  npm run db:init
  ```

- [ ] **KV namespaces created** (should already exist based on wrangler.toml IDs)
  - CHANNEL_CONFIG_CACHE: `f03509ea56964ca3ad062b116a683dc4`
  - DECISION_CACHE: `4beba810f4d141e7be9e3298c7b07944`
  - BEACON_KV: `f2771891b6f848f5a3380f9e4d948e33`
  - VAST_CACHE: `30ef6cf22c354288a74b6d8ba001b5b0`

## 4. Queues

- [ ] **Queues created**
  ```bash
  wrangler queues create beacon-queue
  wrangler queues create beacon-dlq
  wrangler queues create transcode-queue
  ```

## 5. Configuration Review

- [ ] **Update R2 public URL** in `wrangler.toml` (if using custom R2 domain)
  ```toml
  R2_PUBLIC_URL = "https://pub-YOUR-BUCKET-ID.r2.dev"
  ```

- [ ] **Review cache settings** (defaults are good for most use cases)
  ```toml
  SEGMENT_CACHE_MAX_AGE = "60"    # 60 seconds for segments
  MANIFEST_CACHE_MAX_AGE = "2"    # 2 seconds for manifests
  ```

- [ ] **Review timeout settings**
  ```toml
  DECISION_TIMEOUT_MS = "2000"  # 2 seconds (max is 50s for Workers)
  ```

## 6. Wrangler Login

- [ ] **Logged in to Cloudflare**
  ```bash
  wrangler login
  wrangler whoami
  ```

## 7. Pre-Deployment Test

- [ ] **Run unit tests locally**
  ```bash
  npm run test:unit
  ```

- [ ] **Validate wrangler configs**
  ```bash
  wrangler deploy --dry-run
  wrangler deploy --dry-run --config wrangler.decision.toml
  wrangler deploy --dry-run --config wrangler.beacon.toml
  wrangler deploy --dry-run --config wrangler.vast.toml
  ```

## 8. Deploy

- [ ] **Deploy all workers**
  ```bash
  npm run deploy:all
  ```

  Or deploy individually:
  ```bash
  npm run deploy:manifest
  npm run deploy:decision
  npm run deploy:beacon
  npm run deploy:vast
  npm run deploy:admin-api
  ```

- [ ] **Save deployed URLs** for testing
  ```
  Manifest worker: https://cf-ssai.________________.workers.dev
  Decision worker: https://cf-ssai-decision.________________.workers.dev
  Beacon worker:   https://cf-ssai-beacon-consumer.________________.workers.dev
  VAST worker:     https://cf-ssai-vast-parser.________________.workers.dev
  Admin API:       https://cf-ssai-admin-api.________________.workers.dev
  ```

## 9. Post-Deployment Verification

- [ ] **Check health endpoints**
  ```bash
  curl https://cf-ssai.YOUR_SUBDOMAIN.workers.dev/health
  curl https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev/health
  ```

- [ ] **Run integration tests** (update TEST_URL_* env vars first)
  ```bash
  export TEST_ENV=production
  export TEST_URL_MANIFEST="https://cf-ssai.YOUR_SUBDOMAIN.workers.dev"
  export TEST_URL_DECISION="https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev"
  # ... etc

  npm run test:integration
  ```

- [ ] **Monitor logs** for errors
  ```bash
  wrangler tail
  ```

- [ ] **Check metrics** in Cloudflare Dashboard
  - Workers & Pages → cf-ssai → Metrics
  - Look for: request rate, error rate, CPU time

## 10. Production Data

- [ ] **Upload test HLS stream** to R2 `origin/` folder
- [ ] **Create channel** via admin API
- [ ] **Upload ad creatives** to R2 `transcoded-ads/` folder
- [ ] **Configure slate** in database

## Notes

**Current Settings That Need Changes:**

1. `DEV_ALLOW_NO_AUTH = "1"` → Change to `"0"` for production
2. `head_sampling_rate = 1.0` → Change to `0.05` (logs) and `0.15` (traces)
3. `CACHE_DECISION_TTL = "0"` (in decision worker) → Change to `"60"` for production caching

**Optional Production Enhancements:**

- Set up custom domain instead of `workers.dev`
- Configure rate limiting (via Transform Rules)
- Enable Cloudflare Analytics
- Set up alerts for error rates > 5%
