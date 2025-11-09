# Testing Guide

This document explains how to run tests for the CF-SSAI project in different environments.

## Test Configuration

All test URLs are centralized in `tests/test-config.ts`, which supports both local development and production testing environments.

### Local Development (Default)

By default, tests use localhost URLs matching the dev server ports:

```bash
# Run unit tests (no network dependencies)
npm run test:unit

# Start dev servers in separate terminals
npm run dev:manifest    # Port 8787
npm run dev:decision    # Port 8788
npm run dev:beacon      # Port 8789
npm run dev:vast        # Port 8790
npm run dev:admin-api   # Port 8791

# Run integration tests (requires dev servers running)
npm run test:integration

# Run all tests
npm test
```

### Production/Deployed Testing

To test against deployed Cloudflare Workers:

```bash
# Set environment to production
export TEST_ENV=production

# Override worker URLs (replace YOUR_SUBDOMAIN with your actual subdomain)
export TEST_URL_MANIFEST="https://cf-ssai.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_DECISION="https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_BEACON="https://cf-ssai-beacon-consumer.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_VAST="https://cf-ssai-vast-parser.YOUR_SUBDOMAIN.workers.dev"
export TEST_URL_ADMIN_API="https://cf-ssai-admin-api.YOUR_SUBDOMAIN.workers.dev"

# Run tests
npm run test:integration
```

### Skipping Integration Tests

If you want to run only unit tests without integration tests:

```bash
export SKIP_INTEGRATION=1
npm test
```

## Test Types

### Unit Tests
- **Location**: `tests/golden.test.ts`, `tests/scte35.test.ts`, `tests/hls-advanced.test.ts`, etc.
- **Dependencies**: None (pure functions, no network)
- **Run**: `npm run test:unit`
- **Purpose**: Test individual utilities like SCTE-35 parsing, HLS manifest manipulation, IDR snapping

### Integration Tests
- **Location**: `tests/integration.test.ts`, `tests/e2e-comprehensive.test.ts`, `tests/vast.test.ts`
- **Dependencies**: Requires workers running (local or deployed)
- **Run**: `npm run test:integration`
- **Purpose**: Test worker-to-worker communication, SCTE-35 detection, ad insertion flow

### Performance Tests
- **Location**: `tests/performance.test.ts`
- **Run**: `npm run test:performance`
- **Purpose**: Benchmark manifest parsing, SCTE-35 decoding, large playlist handling

### Chaos Tests
- **Location**: `tests/chaos.test.ts`
- **Run**: `npm run test:chaos`
- **Purpose**: Test error handling, edge cases, malformed inputs

## Fake URLs in Tests

Tests use realistic but fake URLs for test data:

- `FAKE_AD_URL`: `https://test-ads.example.internal/ad.m3u8`
- `FAKE_ORIGIN_URL`: `https://test-origin.example.internal/stream.m3u8`
- `FAKE_VAST_URL`: `https://test-vast.example.internal/vast.xml`
- `FAKE_BEACON_URL`: `https://test-tracking.example.internal/beacon`

These URLs are **never** actually fetched during tests. They're used for:
- Manifest generation test fixtures
- URL validation logic
- VAST XML mock responses

**Note**: Any URLs containing `example.com`, `example.internal`, or `tracker.example.com` in test files are intentional test fixtures and will not be contacted.

## Continuous Integration

In CI environments (GitHub Actions, etc.), set these environment variables:

```yaml
env:
  TEST_ENV: production
  TEST_URL_MANIFEST: ${{ secrets.WORKER_URL_MANIFEST }}
  TEST_URL_DECISION: ${{ secrets.WORKER_URL_DECISION }}
  # ... etc
```

Or skip integration tests if workers aren't deployed yet:

```yaml
env:
  SKIP_INTEGRATION: "1"
```

## Troubleshooting

### "Connection refused" errors
- Make sure dev servers are running on the correct ports
- Check `npm run dev:manifest` etc. are active
- Verify no port conflicts (check with `lsof -i :8787`)

### "fetch is not defined" (Node.js < 18)
- Upgrade to Node.js 18+ which includes native fetch
- Or use `node --experimental-fetch` flag

### Tests timing out
- Increase timeout: `export TEST_TIMEOUT_MS=30000`
- Check worker logs for errors: `wrangler tail`

### Production tests failing
- Verify worker URLs are correct (check `wrangler whoami` and subdomain)
- Ensure database migrations ran: `npm run db:init`
- Check R2 bucket permissions and KV namespace bindings
