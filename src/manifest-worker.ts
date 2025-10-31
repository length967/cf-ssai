// src/manifest-worker.ts
import { nowSec, windowBucket } from "./utils/time"
import { verifyJWT, parseJWTUnsafe } from "./utils/jwt"
import { getChannelConfig, getConfigWithDefaults } from "./utils/channel-config"
import type { ViewerJWT, BeaconMessage } from "./types"

// Bindings available to this Worker
export interface Env {
  CHANNEL_DO: DurableObjectNamespace
  ADS_BUCKET: R2Bucket
  BEACON_QUEUE: Queue
  
  // Service bindings
  DECISION?: Fetcher  // Decision service worker

  // Multi-tenant configuration database
  DB?: D1Database
  CHANNEL_CONFIG_CACHE?: KVNamespace

  // Global defaults (fallback if channel config not set)
  ORIGIN_VARIANT_BASE: string
  AD_POD_BASE: string
  WINDOW_BUCKET_SECS: string
  DECISION_TIMEOUT_MS: string
  SIGN_HOST: string

  // Secrets
  JWT_PUBLIC_KEY: string
  JWT_ALGORITHM?: string  // "HS256" or "RS256" (default: RS256)
  SEGMENT_SECRET: string

  // Dev toggles
  DEV_ALLOW_NO_AUTH?: string
}

/**
 * Verify JWT with proper signature validation.
 * In dev mode (DEV_ALLOW_NO_AUTH=1), falls back to unsafe parsing.
 */
async function authenticateViewer(auth: string | null, env: Env): Promise<ViewerJWT | null> {
  if (!auth?.startsWith("Bearer ")) return null
  
  const token = auth.slice(7)
  
  // Dev mode: allow unsigned tokens for testing
  if (env.DEV_ALLOW_NO_AUTH === "1") {
    console.warn("DEV MODE: Bypassing JWT signature verification")
    return parseJWTUnsafe(token)
  }
  
  // Production: verify signature
  const algorithm = (env.JWT_ALGORITHM as "HS256" | "RS256") || "RS256"
  return await verifyJWT(token, env.JWT_PUBLIC_KEY, algorithm)
}

/** Entitlement gate. In dev, allow unauthenticated if DEV_ALLOW_NO_AUTH=1. */
function entitled(viewer: ViewerJWT | null, env: Env): boolean {
  if (env.DEV_ALLOW_NO_AUTH === "1") return true
  return !!viewer
}

export default {
  /** HTTP entrypoint: edge micro-cache + DO coalescing + passthrough */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    // --- Simple router: /cue endpoint for live ad triggers ---
    if (url.pathname === "/cue") {
      try {
        // Require auth unless dev bypass is enabled
        const viewer = await authenticateViewer(req.headers.get("Authorization"), env)
        if (!entitled(viewer, env)) return new Response("forbidden", { status: 403 })

        if (req.method !== "POST") return new Response("method not allowed", { status: 405 })
        const body = await req.json()
        const channel = body?.channel || url.searchParams.get("channel")
        if (!channel) return new Response("channel required", { status: 400 })

        const id = env.CHANNEL_DO.idFromName(`${channel}`)
        const stub = env.CHANNEL_DO.get(id)

        // Forward the cue to the DO
        const r = await stub.fetch(new Request("https://do/cue", {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(body)
        }))
        return r
      } catch {
        return new Response("bad request", { status: 400 })
      }
    }

    // Parse URL: supports both legacy (?channel=x&variant=y) and new path-based (/:org/:channel/variant.m3u8)
    let orgSlug: string | null = null
    let channelSlug: string | null = null
    let variant: string = "v_1600k.m3u8"
    
    // Try path-based routing first: /:orgSlug/:channelSlug/variant.m3u8
    const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(.+\.m3u8)$/)
    if (pathMatch) {
      [, orgSlug, channelSlug, variant] = pathMatch
    } else {
      // Legacy: query parameter routing
      channelSlug = url.searchParams.get("channel")
      variant = url.searchParams.get("variant") || "v_1600k.m3u8"
    }

    const force = url.searchParams.get("force") // "sgai" | "ssai" | null

    if (!channelSlug) {
      return new Response(JSON.stringify({
        error: "Invalid path format",
        usage: "/:org/:channel/variant.m3u8 or ?channel=x&variant=y"
      }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    const viewer = await authenticateViewer(req.headers.get("Authorization"), env)
    if (!entitled(viewer, env)) return new Response("forbidden", { status: 403 })

    // Fetch per-channel configuration (if multi-tenant mode)
    let channelConfig = null
    let effectiveConfig = {
      originUrl: env.ORIGIN_VARIANT_BASE,
      adPodBaseUrl: env.AD_POD_BASE,
      signHost: env.SIGN_HOST,
      channelId: channelSlug, // fallback to slug if no DB config
    }

    if (orgSlug && env.DB) {
      try {
        channelConfig = await getChannelConfig(env, orgSlug, channelSlug)
        
        if (!channelConfig) {
          return new Response(JSON.stringify({ 
            error: "Channel not found",
            org: orgSlug,
            channel: channelSlug 
          }), { 
            status: 404,
            headers: { "Content-Type": "application/json" }
          })
        }

        // Check channel status
        if (channelConfig.status !== 'active') {
          return new Response(JSON.stringify({
            error: "Channel is not active",
            status: channelConfig.status
          }), { 
            status: 503,
            headers: { "Content-Type": "application/json" }
          })
        }

        // Get configuration with fallbacks
        const config = getConfigWithDefaults(channelConfig, {
          originVariantBase: env.ORIGIN_VARIANT_BASE,
          adPodBase: env.AD_POD_BASE,
          signHost: env.SIGN_HOST,
        })

        effectiveConfig = {
          originUrl: config.originUrl,
          adPodBaseUrl: config.adPodBaseUrl,
          signHost: config.signHost,
          channelId: channelConfig.id,
        }

        console.log('Channel config loaded:', {
          org: orgSlug,
          channel: channelSlug,
          channelId: channelConfig.id,
          originUrl: effectiveConfig.originUrl,
        })
      } catch (error) {
        console.error('Failed to load channel config:', error)
        // Fall back to global defaults on error
      }
    }

    // Build a small micro-cache key: (channel, variant, time bucket, viewer bucket)
    const stride = parseInt(env.WINDOW_BUCKET_SECS || "2", 10)
    const wb = windowBucket(nowSec(), isFinite(stride) && stride > 0 ? stride : 2)
    const vbucket = viewer?.bucket || "A"
    const cacheKey = new Request(
      `https://cache/${encodeURIComponent(channelSlug)}/${encodeURIComponent(variant)}/wb${wb}/vb${vbucket}`
    )

    // Edge micro-cache (short TTL)
    const cache = caches.default
    const hit = await cache.match(cacheKey)
    if (hit) return hit

    // Coalesce identical misses per (channel, variant, bucket)
    const doName = orgSlug 
      ? `${orgSlug}:${channelSlug}:${variant}:wb${wb}`
      : `${channelSlug}:${variant}:wb${wb}` // legacy format
    const id = env.CHANNEL_DO.idFromName(doName)
    const stub = env.CHANNEL_DO.get(id)
    
    // Build DO request URL with all query parameters
    const doUrl = new URL(`https://do/manifest`)
    doUrl.searchParams.set("channel", channelSlug)
    doUrl.searchParams.set("variant", variant)
    if (force) doUrl.searchParams.set("force", force)
    
    // Pass per-channel configuration via headers
    const doRequest = new Request(doUrl.toString(), {
      headers: req.headers,
    })
    doRequest.headers.set('X-Channel-Id', effectiveConfig.channelId)
    doRequest.headers.set('X-Origin-Url', effectiveConfig.originUrl)
    doRequest.headers.set('X-Ad-Pod-Base', effectiveConfig.adPodBaseUrl)
    doRequest.headers.set('X-Sign-Host', effectiveConfig.signHost)
    
    const upstream = await stub.fetch(doRequest)
    const text = await upstream.text()

    const resp = new Response(text, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "private, max-age=2",
      },
      status: upstream.status,
      statusText: upstream.statusText,
    })

    // Write-through short TTL cache
    ctx.waitUntil(cache.put(cacheKey, resp.clone()))
    return resp
  },
}

// Important: Re-export the DO class so Wrangler can bind it from the entrypoint bundle.
export { ChannelDO } from "./channel-do"