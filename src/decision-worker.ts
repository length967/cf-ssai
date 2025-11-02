// Ad Decision Service
// Handles ad pod selection with VAST waterfall, caching, and fallback logic

import type { DecisionResponse, AdPod, AdItem, VASTParseResponse } from "./types"
import { getVariantsForChannel } from "./on-demand-transcode"

export interface Env {
  // D1 Database for channel config and ad pods
  DB: D1Database
  
  // R2 bucket for transcoded HLS ads
  R2: R2Bucket
  
  // KV for decision caching AND on-demand transcode locks
  DECISION_CACHE?: KVNamespace
  KV: KVNamespace
  
  // Queue for on-demand transcoding
  TRANSCODE_QUEUE: Queue
  
  // External ad decision API (optional)
  AD_DECISION_API_URL?: string
  AD_DECISION_API_KEY?: string
  
  // VAST parser service binding
  VAST_PARSER?: Fetcher
  
  // Configuration (global defaults - overridden by channel config)
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

interface ChannelConfig {
  id: string
  organizationId: string
  adPodBaseUrl?: string
  vastUrl?: string
  vastEnabled: boolean
  slatePodId?: string
  bitrateLadder?: string // JSON array of bitrates in kbps
}

interface DBAdPod {
  id: string
  name: string
  organizationId: string
  channelId?: string
  ads: string // JSON array of ad IDs
}

interface DBAd {
  id: string
  name: string
  transcode_status: string
  master_playlist_url?: string
  variants?: string // JSON array of bitrate variants
  duration?: number
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
 * Get channel configuration from D1 database
 */
async function getChannelConfig(
  env: Env,
  channelId: string
): Promise<ChannelConfig | null> {
  try {
    const result = await env.DB.prepare(`
      SELECT 
        c.id,
        c.organization_id as organizationId,
        c.ad_pod_base_url as adPodBaseUrl,
        c.vast_url as vastUrl,
        c.vast_enabled as vastEnabled,
        c.slate_pod_id as slatePodId,
        c.bitrate_ladder as bitrateLadder
      FROM channels c
      WHERE c.id = ? AND c.status = 'active'
    `).bind(channelId).first<any>()
    
    if (!result) return null
    
    return {
      id: result.id,
      organizationId: result.organizationId,
      adPodBaseUrl: result.adPodBaseUrl,
      vastUrl: result.vastUrl,
      vastEnabled: Boolean(result.vastEnabled),
      slatePodId: result.slatePodId,
      bitrateLadder: result.bitrateLadder
    }
  } catch (error) {
    console.error(`Failed to get channel config: ${error}`)
    return null
  }
}

/**
 * Get ad pods for a channel from D1 database
 */
async function getAdPodsForChannel(
  env: Env,
  channelId: string,
  organizationId: string
): Promise<DBAdPod[]> {
  try {
    // Get pods for this channel or organization
    const results = await env.DB.prepare(`
      SELECT id, name, organization_id as organizationId, channel_id as channelId, ads
      FROM ad_pods
      WHERE (channel_id = ? OR channel_id IS NULL) 
        AND organization_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(channelId, organizationId).all()
    
    return results.results as DBAdPod[]
  } catch (error) {
    console.error(`Failed to get ad pods: ${error}`)
    return []
  }
}

/**
 * Get ads by IDs from D1 database
 */
async function getAdsById(
  env: Env,
  adIds: string[]
): Promise<DBAd[]> {
  if (adIds.length === 0) return []
  
  try {
    const placeholders = adIds.map(() => '?').join(',')
    const query = `
      SELECT id, name, transcode_status, master_playlist_url, variants, duration
      FROM ads
      WHERE id IN (${placeholders}) 
        AND transcode_status = 'ready'
      ORDER BY created_at DESC
    `
    
    const results = await env.DB.prepare(query).bind(...adIds).all()
    return results.results as DBAd[]
  } catch (error) {
    console.error(`Failed to get ads: ${error}`)
    return []
  }
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
 * Build ad pod items from database ad with transcoded variants
 */
function buildAdItemsFromAd(
  ad: DBAd,
  trackingUrls?: string[]
): AdItem[] {
  if (!ad.variants) return []
  
  try {
    const variants = JSON.parse(ad.variants) as Array<{ bitrate: number; url: string }>
    
    return variants.map(variant => ({
      adId: ad.id,
      bitrate: variant.bitrate,
      playlistUrl: variant.url,
      tracking: trackingUrls ? { impression: trackingUrls } : undefined
    }))
  } catch (error) {
    console.error(`Failed to parse ad variants: ${error}`)
    return []
  }
}

/**
 * Build ad pod items for different bitrates (legacy/fallback)
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
 * Database-driven ad waterfall with VAST, DB pods, and fallback
 */
async function runAdWaterfall(
  env: Env,
  req: DecisionRequest,
  channelConfig: ChannelConfig | null
): Promise<DecisionResponse | null> {
  // Waterfall priority:
  // 1. VAST-based dynamic ads (if enabled for channel)
  // 2. Database ad pods (uploaded via GUI)
  // 3. Return null (caller will use slate fallback)
  
  const durationSec = req.durationSec
  
  // Priority 1: Try VAST if enabled for this channel
  const vastUrl = channelConfig?.vastUrl || env.VAST_URL
  if (vastUrl && channelConfig?.vastEnabled && env.VAST_PARSER) {
    console.log(`Attempting VAST fetch: ${vastUrl}`)
    
    const vastResult = await parseVAST(env, vastUrl, durationSec)
    
    if (vastResult && vastResult.pod && vastResult.pod.items.length > 0) {
      console.log(`VAST parsing successful: pod=${vastResult.pod.podId}`)
      
      return {
        pod: vastResult.pod,
        tracking: vastResult.tracking
      }
    }
    
    console.warn("VAST parsing failed or returned no ads")
  }
  
  // Priority 2: Database ad pods (transcoded ads)
  if (channelConfig) {
    const adPods = await getAdPodsForChannel(env, channelConfig.id, channelConfig.organizationId)
    
    if (adPods.length > 0) {
      // Pick the first available pod (could be randomized or weighted)
      const selectedPod = adPods[0]
      console.log(`Selected ad pod from DB: ${selectedPod.id} (${selectedPod.name})`)
      
      // Parse ad IDs from the pod
      const adIds = JSON.parse(selectedPod.ads) as string[]
      
      // Get the actual ad details
      const ads = await getAdsById(env, adIds)
      
      // Parse channel bitrate ladder for on-demand transcoding
      let channelBitrates: number[] = []
      if (channelConfig.bitrateLadder) {
        try {
          channelBitrates = JSON.parse(channelConfig.bitrateLadder)
        } catch (e) {
          console.warn('Failed to parse bitrate ladder:', e)
        }
      }
      
      if (ads.length > 0) {
        // Build ad items from all ads in the pod
        const allItems: AdItem[] = []
        let totalDuration = 0
        
        for (const ad of ads) {
          // Check if ad has all required variants for this channel
          // If not, trigger on-demand transcode (non-blocking)
          if (channelBitrates.length > 0) {
            try {
              const variantResult = await getVariantsForChannel(
                env,
                ad.id,
                channelConfig.id,
                channelBitrates,
                false // Don't wait - use closest available and queue missing
              )
              
              if (variantResult.missingBitrates.length > 0) {
                console.log(`Ad ${ad.id} missing variants ${variantResult.missingBitrates}, queued=${variantResult.transcodeQueued}`)
              }
            } catch (e) {
              console.warn(`On-demand transcode check failed for ad ${ad.id}:`, e)
            }
          }
          
          const items = buildAdItemsFromAd(ad)
          if (items.length > 0) {
            allItems.push(...items)
            totalDuration += ad.duration || 30
          }
          
          // Stop if we've filled the ad break duration
          if (totalDuration >= durationSec) break
        }
        
        if (allItems.length > 0) {
          console.log(`Using database pod: ${selectedPod.id} with ${ads.length} ads (${allItems.length} variants)`)
          
          return {
            pod: {
              podId: selectedPod.id,
              durationSec: Math.min(totalDuration, durationSec),
              items: allItems
            },
            // Tracking handled by beacon system - no hardcoded URLs
            tracking: {
              impressions: []
            }
          }
        }
      }
      
      console.warn(`Pod ${selectedPod.id} has no ready ads`)
    } else {
      console.warn(`No ad pods found for channel ${channelConfig.id}`)
    }
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
  // Get channel configuration from database
  const channelConfig = await getChannelConfig(env, req.channel)
  
  if (channelConfig) {
    console.log(`Channel config loaded: ${channelConfig.id} (org: ${channelConfig.organizationId})`)
  } else {
    console.warn(`No channel config found for: ${req.channel}`)
  }
  
  // Try external API first
  const externalDecision = await fetchExternalDecision(env, req)
  if (externalDecision) {
    console.log("Decision from external API")
    return externalDecision
  }
  
  // Try ad waterfall (VAST + Database pods)
  const waterfallDecision = await runAdWaterfall(env, req, channelConfig)
  if (waterfallDecision) {
    console.log("Decision from ad waterfall")
    return waterfallDecision
  }
  
  // Fallback to slate
  console.log("Falling back to slate")
  
  // Use channel-specific slate pod ID if configured
  const slatePodId = channelConfig?.slatePodId || env.SLATE_POD_ID || 'slate'
  
  return {
    pod: {
      podId: slatePodId,
      durationSec: req.durationSec,
      items: buildAdItems(env, slatePodId, 'slate-filler')
    }
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
