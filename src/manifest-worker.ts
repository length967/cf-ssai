// src/manifest-worker.ts
import { nowSec, windowBucket } from "./utils/time"
import { verifyJWT, parseJWTUnsafe } from "./utils/jwt"
import { getChannelConfig, getConfigWithDefaults } from "./utils/channel-config"
import { getActiveAdBreak } from "./utils/kv-adbreak"
import { replaceSegmentsWithAds, addDaterangeInterstitial, extractMostRecentPDT } from "./utils/hls"
import type { ViewerJWT, BeaconMessage } from "./types"

// Bindings available to this Worker
// In-memory LRU cache for channel configs (optimization for segment passthrough)
const configCache = new Map<string, {config: any, expires: number}>()
const CONFIG_CACHE_TTL_MS = 60000 // 1 minute

export interface Env {
  CHANNEL_DO: DurableObjectNamespace
  BEACON_QUEUE: Queue
  TRANSCODE_QUEUE: Queue
  
  // Service bindings
  DECISION?: Fetcher  // Decision service worker

  // Multi-tenant configuration database
  DB?: D1Database
  CHANNEL_CONFIG_CACHE?: KVNamespace
  ADBREAK_STATE: KVNamespace  // Phase 1: Ad break state for stateless serving

  // R2 Storage
  R2?: R2Bucket

  // Global defaults (fallback if channel config not set)
  ORIGIN_VARIANT_BASE: string
  AD_POD_BASE: string
  WINDOW_BUCKET_SECS: string
  DECISION_TIMEOUT_MS: string
  SIGN_HOST: string
  
  // Cache settings
  SEGMENT_CACHE_MAX_AGE?: string
  MANIFEST_CACHE_MAX_AGE?: string

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

/** CORS headers for HLS playback */
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Max-Age': '86400'
  }
}

export default {
  /** HTTP entrypoint: edge micro-cache + DO coalescing + passthrough */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      })
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response("OK", { 
        status: 200,
        headers: corsHeaders()
      })
    }

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

        // Phase 1: Look up channel config to get proper channelId for KV keys
        let channelId = 'unknown'
        const org = body?.org || 'demo' // Default to demo for backward compatibility
        if (env.DB) {
          try {
            const config = await getChannelConfig(env, org, channel)
            if (config?.id) {
              channelId = config.id
            }
          } catch (err) {
            console.warn(`Failed to load channel config for /cue: ${err}`)
          }
        }

        const id = env.CHANNEL_DO.idFromName(`${channel}`)
        const stub = env.CHANNEL_DO.get(id)

        // Forward the cue to the DO with proper channelId header
        const doRequest = new Request("https://do/cue", {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(body)
        })
        doRequest.headers.set('X-Channel-Id', channelId)
        doRequest.headers.set('X-Org-Slug', org)
        doRequest.headers.set('X-Channel-Slug', channel)
        
        const r = await stub.fetch(doRequest)
        return r
      } catch {
        return new Response("bad request", { status: 400 })
      }
    }

    // Parse URL: supports both legacy (?channel=x&variant=y) and new path-based (/:org/:channel/file)
    let orgSlug: string | null = null
    let channelSlug: string | null = null
    let variant: string = "v_1600k.m3u8"
    
    // Try path-based routing first: /:orgSlug/:channelSlug/file (matches .m3u8, .ts, .m4s, etc.)
    const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(.+)$/)
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
        usage: "/:org/:channel/file or ?channel=x&variant=y"
      }), { 
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      })
    }

    const viewer = await authenticateViewer(req.headers.get("Authorization"), env)
    if (!entitled(viewer, env)) return new Response("forbidden", { status: 403 })

    // PERFORMANCE OPTIMIZATION: Bypass DO entirely for segments
    // Segments don't need manifest processing, just pass-through to origin
    if (variant.endsWith('.ts') || variant.endsWith('.m4s') || variant.endsWith('.aac') || 
        (!variant.endsWith('.m3u8') && !variant.includes('master'))) {
      
      // OPTIMIZATION: Use in-memory cache to avoid D1/KV lookup for every segment
      let originUrl = env.ORIGIN_VARIANT_BASE
      
      if (orgSlug && env.DB) {
        const cacheKey = `${orgSlug}:${channelSlug}`
        const cached = configCache.get(cacheKey)
        
        if (cached && Date.now() < cached.expires) {
          originUrl = cached.config.originUrl || env.ORIGIN_VARIANT_BASE
        } else {
          // Cache miss - fetch from DB and cache in memory
          const config = await getChannelConfig(env, orgSlug, channelSlug)
          if (config?.originUrl) {
            originUrl = config.originUrl
            configCache.set(cacheKey, {
              config: { originUrl },
              expires: Date.now() + CONFIG_CACHE_TTL_MS
            })
            
            // LRU cleanup: limit cache size to 100 entries
            if (configCache.size > 100) {
              const firstKey = configCache.keys().next().value
              configCache.delete(firstKey)
            }
          }
        }
      }
      
      // Normalize origin URL and construct segment URL
      let baseUrl = originUrl
      if (baseUrl.endsWith('.m3u8') || baseUrl.endsWith('.isml/.m3u8')) {
        const lastSlash = baseUrl.lastIndexOf('/')
        if (lastSlash > 0) {
          baseUrl = baseUrl.substring(0, lastSlash)
        }
      }
      
      const segmentUrl = `${baseUrl}/${variant}`
      
      // Proxy directly to origin, skip DO coordination entirely
      const segmentResponse = await fetch(segmentUrl, {
        cf: { cacheTtl: 60, cacheEverything: true }
      })
      
      // Add CORS headers for browser playback
      const headers = new Headers(segmentResponse.headers)
      const cors = corsHeaders()
      for (const [key, value] of Object.entries(cors)) {
        headers.set(key, value)
      }
      
      return new Response(segmentResponse.body, {
        status: segmentResponse.status,
        statusText: segmentResponse.statusText,
        headers
      })
    }

    // For manifests, proceed with normal DO processing
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
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          })
        }

        // Check channel status
        if (channelConfig.status !== 'active') {
          return new Response(JSON.stringify({
            error: "Channel is not active",
            status: channelConfig.status
          }), { 
            status: 503,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
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

    // Build a small micro-cache key: (channel, variant, time bucket, viewer bucket, ad state)
    // CRITICAL FIX: Include ad state hash to prevent pre-ad and in-ad manifest collisions
    const stride = parseInt(env.WINDOW_BUCKET_SECS || "2", 10)
    const wb = windowBucket(nowSec(), isFinite(stride) && stride > 0 ? stride : 2)
    const vbucket = viewer?.bucket || "A"
    // Use smaller bucket size (1 sec) for finer granularity during ad transitions
    const fineWb = windowBucket(nowSec(), 1)
    const cacheKey = new Request(
      `https://cache/${encodeURIComponent(channelSlug)}/${encodeURIComponent(variant)}/wb${fineWb}/vb${vbucket}`
    )

    // Edge micro-cache (short TTL)
    const cache = caches.default
    const hit = await cache.match(cacheKey)
    if (hit) return hit

    // Phase 1: Check KV for active ad break (hybrid architecture)
    // Try KV first for better performance, fallback to DO if not found
    const kvAdBreak = await getActiveAdBreak(env, effectiveConfig.channelId)
    if (kvAdBreak) {
      console.log(`🚀 Phase 1: KV HIT - Active ad break found for channel ${effectiveConfig.channelId}`)
      console.log(`   Source: ${kvAdBreak.source}, Duration: ${kvAdBreak.duration}s, Items: ${kvAdBreak.decision.items.length}`)
      
      // STATELESS SERVING: Serve manifest directly from KV without calling DO
      try {
        // Fetch origin manifest
        const originResponse = await fetch(`${effectiveConfig.originUrl}/${channelSlug}/${variant}`)
        if (!originResponse.ok) {
          throw new Error(`Origin fetch failed: ${originResponse.status}`)
        }
        const originText = await originResponse.text()
        
        // Determine SSAI vs SGAI based on user agent
        const ua = req.headers.get('user-agent') || ''
        const isSafari = ua.includes('Safari') && !ua.includes('Chrome')
        const forceMode = force === 'sgai' || force === 'ssai' ? force : null
        const useSGAI = forceMode === 'sgai' || (!forceMode && isSafari)
        
        let modifiedManifest: string
        
        if (useSGAI) {
          // SGAI: Add interstitial tag
          console.log('Using SGAI (interstitial) for Safari/iOS')
          const adPodUrl = kvAdBreak.decision.items[0]?.variants?.['1600000'] || 
                          `${effectiveConfig.adPodBaseUrl}/${kvAdBreak.decision.podId}/1600k/playlist.m3u8`
          modifiedManifest = addDaterangeInterstitial(
            originText,
            kvAdBreak.eventId,
            kvAdBreak.startTime,
            kvAdBreak.duration,
            adPodUrl
          )
        } else {
          // SSAI: Replace content segments with ads
          console.log('Using SSAI (segment replacement)')
          
          // Build ad segments from decision
          const adSegments = kvAdBreak.decision.items.map(item => ({
            url: item.variants['1600000'] || `${effectiveConfig.adPodBaseUrl}/${item.id}/seg.ts`,
            duration: item.duration
          }))
          
          // For manual ad breaks, use the LIVE EDGE (most recent PDT) instead of historical PDT
          // For SCTE-35 breaks, use the exact PDT from the signal
          let insertionPDT: string
          if (kvAdBreak.source === 'manual') {
            const liveEdgePDT = extractMostRecentPDT(originText)
            if (!liveEdgePDT) {
              throw new Error('No PDT found in manifest - cannot insert ads')
            }
            insertionPDT = liveEdgePDT
            console.log(`Manual ad break: inserting at live edge PDT: ${insertionPDT}`)
          } else {
            insertionPDT = kvAdBreak.scte35Data?.pdt || kvAdBreak.startTime
            console.log(`SCTE-35 ad break: inserting at signal PDT: ${insertionPDT}`)
          }
          
          const result = replaceSegmentsWithAds(
            originText,
            insertionPDT,
            adSegments,
            kvAdBreak.duration
          )
          modifiedManifest = result.manifest
          console.log(`SSAI: Skipped ${result.segmentsSkipped} segments (${result.durationSkipped.toFixed(2)}s)`)
        }
        
        // Return modified manifest
        const manifestResponse = new Response(modifiedManifest, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': `private, max-age=${channelConfig?.manifestCacheMaxAge || 2}`,
            ...corsHeaders()
          }
        })
        
        // Cache the response
        ctx.waitUntil(cache.put(cacheKey, manifestResponse.clone()))
        
        console.log(`✅ Served manifest from KV (stateless), no DO call`)
        return manifestResponse
        
      } catch (error) {
        console.error('Failed to serve from KV, falling back to DO:', error)
        // Fall through to DO call below
      }
    } else {
      console.log(`🔍 Phase 1: KV MISS - No active ad break in KV for channel ${effectiveConfig.channelId}, using DO`)
    }
    
    // CRITICAL FIX: Route by channel ONLY (not variant) to share ad state across all renditions
    // Per SCTE-35 Section 8.7: All renditions must splice at the same segmentation_event_id
    const doName = orgSlug
      ? `${orgSlug}:${channelSlug}`
      : channelSlug // legacy format
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
    doRequest.headers.set('X-Org-Slug', orgSlug || '')
    doRequest.headers.set('X-Channel-Slug', channelSlug)
    
    const upstream = await stub.fetch(doRequest)
    
    // Determine content type based on file extension
    let contentType = "application/vnd.apple.mpegurl"
    if (variant.endsWith('.ts')) {
      contentType = "video/MP2T"
    } else if (variant.endsWith('.m4s') || variant.endsWith('.mp4')) {
      contentType = "video/mp4"
    } else if (variant.endsWith('.vtt')) {
      contentType = "text/vtt"
    }

    // For segments (.ts, .m4s), pass through binary data; for manifests, we can read as text
    const body = contentType.startsWith('video/') ? upstream.body : await upstream.text()

    // Cache control: segments are immutable (longer cache), manifests update frequently (shorter cache)
    // Use per-channel settings if available, otherwise fall back to global env vars
    const isSegment = contentType.startsWith('video/')
    const segmentMaxAge = channelConfig?.segmentCacheMaxAge || parseInt(env.SEGMENT_CACHE_MAX_AGE || "60", 10)
    const manifestMaxAge = channelConfig?.manifestCacheMaxAge || parseInt(env.MANIFEST_CACHE_MAX_AGE || "4", 10)
    const cacheControl = isSegment 
      ? `public, max-age=${segmentMaxAge}, immutable` 
      : `private, max-age=${manifestMaxAge}`

    const resp = new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        ...corsHeaders()
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