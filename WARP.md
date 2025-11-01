# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Production-ready **Server-Side Ad Insertion (SSAI)** and **Server-Guided Ad Insertion (SGAI)** system for live streaming on **Cloudflare Workers**. The system performs real-time HLS manifest manipulation to insert dynamic ads into live streams with SCTE-35 detection, VAST parsing, and comprehensive tracking.

**Key Characteristics:**
- **Edge-native**: Runs entirely on Cloudflare Workers (no Node.js runtime dependencies)
- **Live-first**: Optimized for live streaming, not VOD
- **Multi-tenant**: D1-based configuration with per-channel settings
- **Cost-effective**: FFmpeg + R2 architecture (~$5-10/month vs $100-500/month with Cloudflare Stream)

## Development Commands

### Local Development

Start all workers (use separate terminals):

```bash
npm run dev:manifest     # Main manifest worker (port 8787)
npm run dev:decision     # Decision service (port 8788)
npm run dev:beacon       # Beacon consumer (port 8789)
npm run dev:vast         # VAST parser (port 8790)
npm run dev:admin-api    # Admin API (port 8791)
```

Quick start all services:
```bash
./start-all.sh
```

### Testing

```bash
npm test                    # Run all unit tests (335+ tests)
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests (requires running workers)
npm run test:quick          # Quick smoke test (golden, scte35, vast)
./run-tests.sh              # Comprehensive test suite with reporting
./test-local.sh             # Automated local integration tests (12 tests)
```

### Database Operations

```bash
npm run db:init:local       # Initialize local D1 database
npm run db:init             # Initialize production D1 database
npm run db:query            # Interactive D1 query mode
```

### Deployment

```bash
npm run deploy:all          # Deploy all workers
npm run deploy:manifest     # Deploy manifest worker only
npm run deploy:decision     # Deploy decision service only
npm run deploy:beacon       # Deploy beacon consumer only
npm run deploy:vast         # Deploy VAST parser only
npm run deploy:admin-api    # Deploy admin API only
```

### Monitoring

```bash
wrangler tail cf-ssai                    # Manifest worker logs
wrangler tail cf-ssai-decision           # Decision service logs
wrangler tail cf-ssai-beacon-consumer    # Beacon consumer logs
wrangler tail cf-ssai-vast-parser        # VAST parser logs
wrangler tail cf-ssai-admin              # Admin API logs
./tail-all-logs.sh                       # All worker logs simultaneously
```

### Ad Break Control (Live Testing)

```bash
./scripts/cue.sh start --channel sports1 --duration 30    # Start ad break
./scripts/cue.sh status                                    # Check status
./scripts/cue.sh stop                                      # Stop ad break
```

## Architecture Overview

### Worker-Based Microservices

1. **Manifest Worker** (`src/manifest-worker.ts`)
   - Main entry point for HLS manifest requests
   - JWT verification and viewer authentication
   - Delegates to ChannelDO for per-channel processing
   - Window bucketing for edge caching (2-second buckets)

2. **Channel Durable Object** (`src/channel-do.ts`)
   - Per-channel state management (one DO instance per channel)
   - SCTE-35 marker detection from origin manifests
   - Dynamic ad insertion (SGAI interstitials or SSAI discontinuity)
   - Multi-tenant configuration via D1 database
   - Priority: `/cue` API > SCTE-35 > time-based schedules

3. **Decision Worker** (`src/decision-worker.ts`)
   - Ad decision service with VAST waterfall
   - Bitrate-aware ad selection (matches viewer quality)
   - Caching with fallback to slate on timeout
   - Communicates with VAST parser worker

4. **VAST Parser Worker** (`src/vast-parser-worker.ts`)
   - Parses VAST 3.0/4.2 XML
   - Resolves wrapper chains (up to 5 levels)
   - Extracts tracking URLs (impressions, quartiles, errors)
   - Converts VAST to AdPod format

5. **Beacon Consumer Worker** (`src/beacon-consumer-worker.ts`)
   - Queue-based async beacon processing
   - Batch processing with retries and deduplication
   - Fires VAST tracking pixels
   - Aggregates analytics

6. **Admin API Worker** (`src/admin-api-worker.ts`)
   - Multi-tenant admin platform API
   - JWT-based authentication
   - Channel CRUD operations
   - Ad pod management with R2 integration
   - Video upload and transcoding queue management

7. **Transcode Worker** (`src/transcode-worker.ts`)
   - FFmpeg container orchestration
   - Queue consumer for transcode jobs
   - R2 source download and HLS upload
   - Automatic bitrate matching from channel config

### Core Utilities (`src/utils/`)

- **`hls.ts`**: HLS manifest parsing and manipulation
  - `insertDiscontinuity()`: SSAI segment replacement
  - `addDaterangeInterstitial()`: SGAI interstitial injection
  - Works with master and variant playlists

- **`scte35.ts`**: SCTE-35 marker detection
  - Parses `#EXT-X-DATERANGE` tags
  - Detects all signal types (splice_insert, time_signal, return_signal)
  - Calculates break duration and timing

- **`jwt.ts`**: JWT verification (RS256/HS256)
  - WebCrypto-based (no Node dependencies)
  - Token validation with expiry checks

- **`sign.ts`**: URL signing with HMAC-SHA256
  - Signed URLs for ad assets
  - Optional IP binding and expiration

- **`channel-config.ts`**: Multi-tenant configuration
  - Fetches channel config from D1
  - KV caching with 5-minute TTL
  - Fallback to global defaults

### Data Flow

```
Client Request
    ↓
Manifest Worker (JWT auth)
    ↓
Channel DO (per-channel state)
    ↓
[SCTE-35 Detection OR /cue API OR Time-based]
    ↓
Decision Worker (VAST waterfall)
    ↓
VAST Parser Worker (XML → AdPod)
    ↓
Return modified manifest (SGAI/SSAI)
    ↓
Beacon Queue (async tracking)
    ↓
Beacon Consumer (fire pixels)
```

### Ad Upload & Transcoding Flow

```
Admin GUI Upload
    ↓
Admin API Worker (R2 upload)
    ↓
Queue Transcode Job
    ↓
Transcode Worker (queue consumer)
    ↓
FFmpeg Container (Docker)
    ↓
Download source from R2
    ↓
Transcode to exact bitrates
    ↓
Upload HLS (master.m3u8 + segments) to R2
    ↓
Update D1 status → "ready"
```

## Critical Implementation Details

### SSAI vs SGAI Mode Selection

- **SGAI (Interstitials)**: iOS/Safari, tvOS
  - Uses `#EXT-X-DATERANGE` with `CLASS="com.apple.hls.interstitial"`
  - No segment replacement, player downloads ads
  
- **SSAI (True Replacement)**: All other clients
  - Uses `#EXT-X-DISCONTINUITY` with segment replacement
  - Seamless ad insertion, server-side stitching

Auto-detection via User-Agent, or force with `?force=sgai` or `?force=ssai`

### Multi-Tenancy Architecture

Every channel config is stored in D1 with organization scoping:
- `channels` table: per-channel origin, VAST URL, ad settings
- `organizations` table: multi-tenant isolation
- `users` table: admin users per organization

Configuration hierarchy:
1. Per-channel config (D1)
2. Global defaults (wrangler.toml)

### Window Bucketing for Caching

Manifests use 2-second window buckets to enable edge caching while maintaining freshness:
```typescript
const bucket = Math.floor(Date.now() / 1000 / WINDOW_BUCKET_SECS) * WINDOW_BUCKET_SECS
```

This allows multiple requests within the same 2-second window to hit cached responses.

### SCTE-35 Detection Priority

Ad breaks are triggered in this order:
1. **Manual `/cue` API** (highest priority, persisted in DO state)
2. **SCTE-35 markers** from origin manifest
3. **Time-based schedule** (e.g., every 5 minutes)

### Durable Object State Management

Each channel gets a single DO instance:
- Maintains `ChannelState` with phase tracking
- Phases: `IDLE`, `PENDING_BREAK`, `IN_BREAK`
- Ensures consistent ad insertion across concurrent requests
- Stores `/cue` API state with auto-expiration

### FFmpeg Bitrate Matching

The transcode worker reads channel configuration to generate exact bitrate variants:
```typescript
// Channel config specifies: 800k, 1600k, 2400k
// FFmpeg generates those exact bitrates
// No more buffering from mismatched bitrates
```

### R2 Structure

```
ssai-ads/
├── source-videos/           # Original uploaded videos
│   └── ad_<id>.<ext>
└── transcoded-ads/          # HLS output from FFmpeg
    └── ad_<id>/
        ├── master.m3u8
        ├── v_800k/
        ├── v_1600k/
        └── v_2400k/
```

## Testing Patterns

### Unit Tests

Located in `tests/` directory:
- `golden.test.ts`: Core utilities (HLS, JWT, signing, time)
- `scte35.test.ts` + `scte35-advanced.test.ts`: SCTE-35 parsing (75+ tests)
- `vast.test.ts`: VAST parsing (14+ tests)
- `hls-advanced.test.ts`: Advanced HLS manipulation (50+ tests)
- `security.test.ts`: JWT and URL signing (40+ tests)
- `integration.test.ts`: Multi-worker integration (20+ tests)
- `performance.test.ts`: Latency and throughput benchmarks (25+ tests)
- `chaos.test.ts`: Failure scenarios and edge cases (50+ tests)

Test framework: `tsx --test` (built-in Node test runner, no Jest/Mocha)

### Integration Testing

Start dev servers first, then run:
```bash
./test-local.sh              # Automated 12-test suite
npm run test:integration     # Full integration tests
```

### Manual Testing

```bash
# Test SCTE-35 detection
curl "http://localhost:8787?channel=test&variant=v_1600k.m3u8&force=sgai"

# Test VAST parsing
curl -X POST http://localhost:8790/parse \
  -H "Content-Type: application/json" \
  -d '{"vastXML":"<VAST>...</VAST>","durationSec":30}'

# Test decision service
curl -X POST http://localhost:8788/decision \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","durationSec":30}'
```

## Configuration Management

### Environment Variables (`.dev.vars`)

Required for local development:
```bash
ORIGIN_VARIANT_BASE=https://origin.example.com/hls
AD_POD_BASE=https://ads.example.com/pods
JWT_PUBLIC_KEY=dev_test_key_not_for_production
SEGMENT_SECRET=dev_secret_replace_in_production
DEV_ALLOW_NO_AUTH=1                               # Dev only!
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
```

### Production Secrets

Set via `wrangler secret put`:
```bash
wrangler secret put JWT_PUBLIC_KEY      # RS256 public key or HS256 secret
wrangler secret put SEGMENT_SECRET      # HMAC key for URL signing
wrangler secret put R2_ACCESS_KEY_ID    # R2 API credentials
wrangler secret put R2_SECRET_ACCESS_KEY
```

### Per-Channel Configuration

Stored in D1 `channels` table:
- `origin_url`: Origin manifest base URL
- `vast_url`: VAST ad server URL
- `ad_pod_base_url`: Base URL for ad assets
- `scte35_enabled`: Enable SCTE-35 detection
- `scte35_auto_insert`: Auto-insert on SCTE-35 signals
- `time_based_auto_insert`: Auto-insert on time schedule
- `default_ad_duration`: Default ad break duration
- `sign_host`: Host for URL signing

## Common Debugging Scenarios

### "Decision service returns slate"
- Check service binding in `wrangler.toml`
- Verify decision worker is deployed
- Check R2 bucket has ad pods
- Review decision worker logs: `wrangler tail cf-ssai-decision`

### "Beacons not processing"
- Verify beacon consumer is deployed
- Check queue configuration in wrangler configs
- Review logs: `wrangler tail cf-ssai-beacon-consumer`

### "JWT verification fails"
- Set `DEV_ALLOW_NO_AUTH=1` for local dev
- Verify `JWT_PUBLIC_KEY` secret is set correctly
- Check algorithm matches (`RS256` vs `HS256`)

### "SCTE-35 not detected"
- Verify origin manifest contains `#EXT-X-DATERANGE` tags
- Check for `SCTE35-OUT=YES` or `CLASS="com.apple.hls.scte35.out"`
- Review manifest worker logs for "SCTE-35 break detected"

### "Ad bitrate mismatch / buffering"
- Check channel config in D1 has correct bitrate variants
- Verify transcoded ads in R2 match channel bitrates
- Run `./fix-bitrate-matching.sh` to sync configurations

## Performance Targets

- **Decision Latency**: <200ms (target), ~150ms (achieved)
- **Cache Hit Rate**: >50% (target), 70%+ (achieved)
- **Beacon Success**: >90% (target), 95%+ (achieved)
- **Manifest Generation**: <50ms (target), ~40ms (achieved)
- **HLS Manipulation (1K segments)**: <100ms
- **SCTE-35 Parsing**: >10,000 ops/sec
- **URL Signing**: <3ms P50 latency
- **Transcode Time**: 30-60 seconds for 30-second video

## Important Constraints

- **Cloudflare Workers Runtime**: No Node.js built-ins (use WebCrypto, not Node crypto)
- **Durable Objects**: Single-threaded per instance, use for coordination only
- **R2 Operations**: Eventual consistency, design for it
- **Queue Batching**: Max 100 messages per batch
- **Request Timeout**: Workers have 50ms CPU time (unbounded wall time for I/O)
- **Container Limits**: 1 vCPU, 6GB RAM, 12GB disk (standard-2 instance type)

## Key Documentation Files

- `README.md`: Project overview and quick start
- `DEPLOYMENT_GUIDE.md`: Production deployment steps
- `SCTE35_VAST_GUIDE.md`: Comprehensive SCTE-35 & VAST guide (600+ lines)
- `IMPLEMENTATION_SUMMARY.md`: FFmpeg + R2 migration summary
- `PROJECT_CONTEXT.md`: Architecture and design decisions
- `BITRATE_MATCHING_GUIDE.md`: Why exact bitrate matching matters
- `ADMIN_PLATFORM_GUIDE.md`: Admin GUI setup and usage
- `tests/README.md`: Test suite documentation
- `scripts/README.md`: Helper scripts documentation
