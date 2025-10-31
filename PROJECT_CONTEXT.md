Absolutely ✅ — here’s the complete PROJECT_CONTEXT.md file, ready to paste straight into your repo root (/Users/markjohns/Development/cf-ssai/PROJECT_CONTEXT.md).

You can drop this directly into Cursor — it’s formatted and structured so the AI instantly understands everything about your Cloudflare SSAI system and continues development coherently.

⸻


# 🧠 Project Context — Cloudflare SSAI/SGAI Prototype (“cf-ssai”)

### Last Updated
2025-10-31

---

## 1️⃣ Overview

This project implements a **prototype server-side ad insertion (SSAI)** and **server-guided ad insertion (SGAI)** system optimized for **Cloudflare Workers**.  
It’s designed for **live streaming**, not VOD, and prioritizes **ultra-low latency, massive concurrency**, and **edge-native scalability**.

The system combines:

- **Worker-based HLS manifest manipulation**
- **Durable Objects** for per-channel state & synchronization
- **R2** for ad pods or slate assets
- **Queues** for offloading ad beacons and analytics
- **Edge caching + window bucketing** for high-throughput HLS delivery

All code is designed to run natively on **Cloudflare’s runtime (no Node dependencies)** — fully compatible with the Web Crypto API, `fetch`, and durable primitives.

---

## 2️⃣ Core Architecture

### **A. Manifest Worker (entrypoint)**
_File: `src/manifest-worker.ts`_

- Handles incoming manifest (`.m3u8`) requests.
- Verifies the viewer token (JWT) or bypasses auth in dev.
- Computes a **window bucket** (2s default) and uses **Durable Object coalescing** to avoid redundant processing.
- Delegates per-channel logic to **ChannelDO**.
- Uses **caches.default** for short TTL edge micro-caching.
- Exposes a **queue()** handler to consume beacon batches.
- Re-exports the DO class for Wrangler binding.

**Bindings:**
```toml
[[durable_objects.bindings]]
name = "CHANNEL_DO"
class_name = "ChannelDO"

[[queues.producers]]
binding = "BEACON_QUEUE"
queue = "beacon-queue"

[[queues.consumers]]
queue = "beacon-queue"

[[r2_buckets]]
binding = "ADS_BUCKET"
bucket_name = "ads-bucket"


⸻

B. Channel Durable Object

File: src/channel-do.ts

Each live channel runs through a single ChannelDO instance that:
	•	Fetches or synthesizes origin manifests (fetchOriginVariant()).
	•	Determines ad break windows.
	•	Injects SGAI DATERANGE or SSAI DISCONTINUITY tags.
	•	Signs ad pod URLs using WebCrypto HMAC (signPath).
	•	Pushes impression events to the beacon queue asynchronously.

Supports:
	•	?force=sgai or ?force=ssai for dev forcing.
	•	Fallback manifests when no origin is reachable.
	•	Configurable break timing (currently every 5 minutes, 30s break).

⸻

C. Utilities

/src/utils/hls.ts
	•	insertDiscontinuity() → injects #EXT-X-DISCONTINUITY in a variant playlist.
	•	addDaterangeInterstitial() → injects an interstitial ad DATERANGE.
	•	parseVariant() → parses a master playlist into variant descriptors.

/src/utils/sign.ts
	•	Cloudflare WebCrypto signer (HMAC-SHA256).
	•	Generates expiring, optionally IP-bound signed URLs.
	•	No Node crypto or process.

/src/utils/time.ts
	•	nowSec() and windowBucket() for cache key bucketing.

⸻

D. Beacon Queue & Consumer
	•	Manifest worker produces queue messages:

await env.BEACON_QUEUE.send({
  event: "imp",
  adId: "example-pod",
  ts: Date.now(),
  trackerUrls: []
})


	•	The same worker also defines a queue() consumer that fires tracking pixels asynchronously.
	•	Later, we will split this out into a dedicated beacon-consumer Worker (see backlog below).

⸻

3️⃣ Environment Variables (.dev.vars)

Example local config:

ORIGIN_VARIANT_BASE=https://origin.example.com/hls
AD_POD_BASE=https://ads.example.com/pods
WINDOW_BUCKET_SECS=2
DECISION_TIMEOUT_MS=150
SIGN_HOST=media.example.com
JWT_PUBLIC_KEY=dev
SEGMENT_SECRET=dev_secret
DEV_ALLOW_NO_AUTH=1


⸻

4️⃣ Dev Workflows

Start local dev:

npm run dev:manifest

Example calls:

# Force SGAI (Interstitial)
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=sgai"

# Force SSAI (Discontinuity)
curl "http://127.0.0.1:8787?channel=ch1&variant=v_1600k.m3u8&force=ssai"


⸻

5️⃣ Testing

Unit tests (run directly in Cursor or terminal):

npm test

Files:
	•	tests/golden.test.ts → verifies:
	•	insertDiscontinuity() and addDaterangeInterstitial()
	•	signPath() token structure
	•	windowBucket() math correctness

Uses tsx --test (no build step).

⸻

6️⃣ Backlog / Roadmap

✅ Current milestone (MVP)
	•	Manifest worker with DO, queue, and beacon send
	•	SSAI and SGAI injection logic
	•	Local dev-ready with .dev.vars
	•	Unit test coverage for utils

🔜 Next milestone
	•	Split beacon-consumer Worker
	•	Dedicated worker for batch processing of beacon queue.
	•	See README.md → Backlog: Separate Beacon Consumer Worker.
	•	Decision service
	•	Move from static slate fallback to an actual decision API.
	•	Multi-bitrate synchronization
	•	Match DATERANGE / DISCONTINUITY across variant renditions.
	•	Metrics aggregation
	•	Track beacon counts, latency, errors.
	•	iOS / Web player integration
	•	Test SGAI support in Safari / AVFoundation.
	•	CI (GitHub Actions)
	•	wrangler deploy --dry-run lint/test on PR.

⸻

7️⃣ Tech & Philosophy
	•	Everything async + non-blocking — every I/O is await fetch() or queue send.
	•	No external servers — all logic runs edge-native.
	•	No Node built-ins — rely only on crypto.subtle, caches.default, and Workers APIs.
	•	Two-second micro-cache — avoids hot loops on origin manifest generation.
	•	Force flags (?force=sgai|ssai) make it trivial to demo without timers.
	•	Durable Object = per-channel lock to ensure consistent ad marker placement.

⸻

8️⃣ File Map

cf-ssai/
├── src/
│   ├── manifest-worker.ts       # Entry worker
│   ├── channel-do.ts            # Durable Object per channel
│   ├── utils/
│   │   ├── hls.ts               # HLS tag manipulation
│   │   ├── sign.ts              # HMAC signer
│   │   └── time.ts              # Clock utils
│   └── types.d.ts               # (optional) ViewerJWT & DecisionResponse
├── tests/
│   └── golden.test.ts           # Unit tests
├── wrangler.toml                # Manifest worker config
├── README.md                    # General overview + backlog
├── PROJECT_CONTEXT.md           # (← this file)
└── .dev.vars                    # Local environment


⸻

9️⃣ Cursor Notes
	•	Treat Cloudflare Workers APIs as native (use fetch, crypto.subtle, caches.default, etc.).
	•	Never import node: modules — the runtime doesn’t support them.
	•	When generating new code, always:
	•	Include explicit async awaits for any fetch or signing call.
	•	Export ChannelDO named, not default.
	•	Avoid process.env.
	•	Re-export the DO from the manifest entrypoint.
	•	Keep local dev toggles guarded by DEV_ALLOW_NO_AUTH.
	•	For tests: always use tsx --test, not Jest.

⸻

10️⃣ Team conventions
	•	Code style: minimalist TypeScript, no transpilation.
	•	Commit messages: short imperative (“add sgai fallback tag”).
	•	Environment naming: consistent with Cloudflare binding names.
	•	Avoid mixing VOD/Live logic; this repo is Live SSAI first.

⸻


---