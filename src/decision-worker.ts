// Ad Decision Service
// Handles ad pod selection with VAST waterfall, caching, and fallback logic

import type { DecisionResponse, AdPod, AdItem, VASTParseResponse } from "./types"

export interface Env {
  // R2 bucket for pre-normalized ad pods
  ADS_BUCKET: R2Bucket
  
  // KV for decision caching
  DECISION_CACHE?: KVNamespace
  
  // External ad decision API (optional)
  AD_DECISION_API_URL?: string
  AD_DECISION_API_KEY?: string
  
  // VAST parser service binding
  VAST_PARSER?: Fetcher
  
  // Configuration
  AD_POD_BASE: string
  DECISION_TIMEOUT_MS?: string
  CACHE_DECISION_TTL?: string
  VAST_URL?: string  // Optional: Static VAST URL for testing
  
  // Fallback settings
  SLATE_POD_ID?: string
}

interface DecisionRequest {
  channel: string
  durationSec: number
  viewerInfo?: {
    geo?: { country?: string }
    consent?: { tcf?: string }
    bucket?: string
  }
  context?: {
    contentId?: string
    contentGenre?: string
  }
}

/**
 * Generate a cache key for decision results
 */
function getCacheKey(req: DecisionRequest): string {
  const { channel, durationSec, viewerInfo } = req
  const country = viewerInfo?.geo?.country || "US"
  const bucket = viewerInfo?.bucket || "default"
  return `decision:${channel}:${durationSec}:${country}:${bucket}`
}

/**
 * Get cached decision from KV
 */
async function getCachedDecision(
  kv: KVNamespace | undefined,
  cacheKey: string
): Promise<DecisionResponse | null> {
  if (!kv) return null
  
  const cached = await kv.get(cacheKey, "json")
  if (cached) {
    console.log(`Cache hit: ${cacheKey}`)
    return cached as DecisionResponse
  }
  
  return null
}

/**
 * Store decision in KV cache
 */
async function cacheDecision(
  kv: KVNamespace | undefined,
  cacheKey: string,
  decision: DecisionResponse,
  ttlSec: number
): Promise<void> {
  if (!kv) return
  
  await kv.put(cacheKey, JSON.stringify(decision), {
    expirationTtl: ttlSec,
  })
  
  console.log(`Cached decision: ${cacheKey} (TTL: ${ttlSec}s)`)
}

/**
 * Call external ad decision API
 */
async function fetchExternalDecision(
  env: Env,
  req: DecisionRequest
): Promise<DecisionResponse | null> {
  if (!env.AD_DECISION_API_URL) return null
  
  const timeoutMs = parseInt(env.DECISION_TIMEOUT_MS || "150", 10)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }
    
    if (env.AD_DECISION_API_KEY) {
      headers["Authorization"] = `Bearer ${env.AD_DECISION_API_KEY}`
    }
    
    const response = await fetch(env.AD_DECISION_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    
    clearTimeout(timeout)
    
    if (!response.ok) {
      console.error(`External API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return data as DecisionResponse
  } catch (err) {
    clearTimeout(timeout)
    console.error(`External API failed: ${err}`)
    return null
  }
}

/**
 * Build ad pod items for different bitrates
 */
function buildAdItems(
  env: Env,
  podId: string,
  adId: string,
  trackingUrls?: string[]
): AdItem[] {
  const baseUrl = env.AD_POD_BASE
  
  return [
    {
      adId,
      bitrate: 800000,
      playlistUrl: `${baseUrl}/${podId}/v_800k/playlist.m3u8`,
      tracking: trackingUrls ? { impression: trackingUrls } : undefined,
    },
    {
      adId,
      bitrate: 1600000,
      playlistUrl: `${baseUrl}/${podId}/v_1600k/playlist.m3u8`,
      tracking: trackingUrls ? { impression: trackingUrls } : undefined,
    },
    {
      adId,
      bitrate: 2500000,
      playlistUrl: `${baseUrl}/${podId}/v_2500k/playlist.m3u8`,
      tracking: trackingUrls ? { impression: trackingUrls } : undefined,
    },
  ]
}

/**
 * Create slate fallback pod (used when no ads available)
 */
function createSlatePod(env: Env, durationSec: number): AdPod {
  const podId = env.SLATE_POD_ID || "slate"
  
  return {
    podId,
    durationSec,
    items: buildAdItems(env, podId, "slate-filler"),
  }
}

/**
 * Parse VAST XML using the VAST parser service
 */
async function parseVAST(
  env: Env,
  vastUrl: string,
  durationSec: number
): Promise<VASTParseResponse | null> {
  if (!env.VAST_PARSER) {
    console.warn("VAST parser service not available")
    return null
  }
  
  const timeoutMs = parseInt(env.DECISION_TIMEOUT_MS || "2000", 10)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const response = await env.VAST_PARSER.fetch("https://vast-parser/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vastUrl,
        durationSec,
        maxWrapperDepth: 5
      }),
      signal: controller.signal
    })
    
    clearTimeout(timeout)
    
    if (!response.ok) {
      console.error(`VAST parser error: ${response.status}`)
      return null
    }
    
    const result = await response.json() as VASTParseResponse
    return result
  } catch (err) {
    clearTimeout(timeout)
    console.error(`VAST parsing failed: ${err}`)
    return null
  }
}

/**
 * Simulate VAST waterfall with multiple ad sources
 * In production, this would call multiple ad servers in priority order
 */
async function runVastWaterfall(
  env: Env,
  req: DecisionRequest
): Promise<DecisionResponse | null> {
  // Waterfall priority:
  // 1. VAST-based dynamic ads (programmatic/direct sold)
  // 2. Pre-transcoded R2 pods (house ads)
  // 3. Fallback to slate
  
  const channel = req.channel
  const durationSec = req.durationSec
  
  // Priority 1: Try VAST parser if VAST_URL is configured
  if (env.VAST_URL && env.VAST_PARSER) {
    console.log(`Attempting VAST fetch: ${env.VAST_URL}`)
    
    const vastResult = await parseVAST(env, env.VAST_URL, durationSec)
    
    if (vastResult && vastResult.pod && vastResult.pod.items.length > 0) {
      console.log(`VAST parsing successful: pod=${vastResult.pod.podId}`)
      
      return {
        pod: vastResult.pod,
        tracking: vastResult.tracking
      }
    }
    
    console.warn("VAST parsing failed or returned no ads")
  }
  
  // Priority 2: Pre-transcoded R2 pods based on channel type
  const podMap: Record<string, string> = {
    "sports": "sports-pod-premium",
    "news": "news-pod-standard",
    "entertainment": "entertainment-pod-premium",
  }
  
  const channelType = channel.includes("sport") ? "sports" 
    : channel.includes("news") ? "news" 
    : "entertainment"
  
  const podId = podMap[channelType] || "example-pod"
  
  // Check if pod exists in R2
  try {
    const podExists = await env.ADS_BUCKET.head(`${podId}/v_1600k/playlist.m3u8`)
    
    if (podExists) {
      console.log(`Using R2 pod: ${podId}`)
      
      return {
        pod: {
          podId,
          durationSec,
          items: buildAdItems(env, podId, `${podId}-ad-1`, [
            `https://tracking.example.com/imp?pod=${podId}`,
          ]),
        },
        tracking: {
          impressions: [`https://tracking.example.com/imp?pod=${podId}`],
          quartiles: {
            start: [`https://tracking.example.com/start?pod=${podId}`],
            firstQuartile: [`https://tracking.example.com/q1?pod=${podId}`],
            midpoint: [`https://tracking.example.com/mid?pod=${podId}`],
            thirdQuartile: [`https://tracking.example.com/q3?pod=${podId}`],
            complete: [`https://tracking.example.com/complete?pod=${podId}`]
          }
        }
      }
    }
  } catch {
    // Pod doesn't exist in R2, fall through
    console.warn(`R2 pod not found: ${podId}`)
  }
  
  return null
}

/**
 * Main decision logic with waterfall and fallback
 */
async function makeDecision(
  env: Env,
  req: DecisionRequest
): Promise<DecisionResponse> {
  // Try external API first
  const externalDecision = await fetchExternalDecision(env, req)
  if (externalDecision) {
    console.log("Decision from external API")
    return externalDecision
  }
  
  // Try VAST waterfall
  const waterfallDecision = await runVastWaterfall(env, req)
  if (waterfallDecision) {
    console.log("Decision from VAST waterfall")
    return waterfallDecision
  }
  
  // Fallback to slate
  console.log("Falling back to slate")
  return {
    pod: createSlatePod(env, req.durationSec),
  }
}

export default {
  /**
   * HTTP entrypoint for ad decision requests
   */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    
    // Health check
    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } })
    }
    
    // Decision endpoint
    if (url.pathname === "/decision" && req.method === "POST") {
      try {
        const decisionReq = (await req.json()) as DecisionRequest
        
        // Validate request
        if (!decisionReq.channel || !decisionReq.durationSec) {
          return new Response(
            JSON.stringify({ error: "Missing required fields: channel, durationSec" }),
            { status: 400, headers: { "content-type": "application/json" } }
          )
        }
        
        // Check cache
        const cacheKey = getCacheKey(decisionReq)
        const cacheTTL = parseInt(env.CACHE_DECISION_TTL || "60", 10)
        
        let decision = await getCachedDecision(env.DECISION_CACHE, cacheKey)
        
        if (!decision) {
          // Make new decision
          decision = await makeDecision(env, decisionReq)
          
          // Cache it
          await cacheDecision(env.DECISION_CACHE, cacheKey, decision, cacheTTL)
        }
        
        return new Response(JSON.stringify(decision), {
          headers: { "content-type": "application/json" },
        })
      } catch (err) {
        console.error("Decision error:", err)
        
        // Return slate on any error
        const fallback = {
          pod: createSlatePod(env, 30),
        }
        
        return new Response(JSON.stringify(fallback), {
          status: 200, // Return 200 with slate rather than error
          headers: { "content-type": "application/json" },
        })
      }
    }
    
    // Legacy endpoint (backward compatibility)
    if (url.pathname.endsWith("/pod") && req.method === "POST") {
      const { channel, durationSec = 30 } = await req.json().catch(() => ({}))
      
      const decision = await makeDecision(env, { 
        channel: channel || "default",
        durationSec,
      })
      
      return new Response(JSON.stringify(decision), {
        headers: { "content-type": "application/json" },
      })
    }
    
    return new Response("Not found", { status: 404 })
  },
}
