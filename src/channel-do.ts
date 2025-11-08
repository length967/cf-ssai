import { addDaterangeInterstitial, insertDiscontinuity, replaceSegmentsWithAds, extractPDTs, extractBitrates, calculateSkipPlan, AdSegmentInfo, SkipPlan } from "./utils/hls"
import { signPath } from "./utils/sign"
import { parseSCTE35FromManifest, isAdBreakStart, getBreakDuration, findActiveBreak, validateSCTE35Signal } from "./utils/scte35"
import { getChannelConfig } from "./utils/channel-config"
import type { ChannelConfig } from "./utils/channel-config"
import type { Env } from "./manifest-worker"
import type { DecisionResponse, BeaconMessage, SCTE35Signal } from "./types"

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Maximum age of a pre-calculated ad decision in milliseconds.
 * If decision is older than this, it will be refreshed to catch drift
 * or stale ad inventory. Typical: 30 seconds (balances freshness vs. performance).
 */
const DECISION_TTL_MS = 30 * 1000

/**
 * Key for telemetry counter tracking skip count recalculation attempts.
 * Used to detect bugs where concurrent requests produce different skip counts.
 */
const SKIP_COUNT_RECALC_COUNTER_KEY = 'skip_count_recalc_attempts'

// ============================================================================
// Live ad state persisted per channel
// ============================================================================
interface AdState {
  active: boolean
  podId?: string
  podUrl: string
  startedAt: number // ms epoch
  endsAt: number    // ms epoch
  durationSec: number
  // CRITICAL: Stable segment skipping tracking (prevents double ads and sticking)
  scte35StartPDT?: string  // PDT where ad break starts
  contentSegmentsToSkip?: number  // Number of content segments to skip
  skippedDuration?: number  // Duration of skipped content in seconds
  // DEDUPLICATION: Track processed SCTE-35 event IDs to prevent duplicate ad breaks from rolling signals
  processedEventIds?: string[]  // Array of SCTE-35 IDs that triggered this break
  // PRE-CALCULATED DECISION: Store decision once to avoid repeated Worker binding calls and CPU timeouts
  decision?: DecisionResponse  // Pre-calculated ad pod decision
  decisionCalculatedAt?: number  // Timestamp when decision was calculated (for debugging)
}

const AD_STATE_KEY = "ad_state"

async function loadAdState(state: DurableObjectState): Promise<AdState | null> {
  const v = await state.storage.get<AdState>(AD_STATE_KEY)
  if (!v) return null
  if (Date.now() >= v.endsAt) return null // auto-expire
  return v
}

async function saveAdState(state: DurableObjectState, s: AdState): Promise<void> {
  // Increment version to detect concurrent modifications
  const currentVersion = await state.storage.get<number>('ad_state_version') || 0
  await state.storage.put({
    [AD_STATE_KEY]: s,
    'ad_state_version': currentVersion + 1
  })
}

async function clearAdState(state: DurableObjectState): Promise<void> {
  // Increment version when clearing state
  const currentVersion = await state.storage.get<number>('ad_state_version') || 0
  await state.storage.put('ad_state_version', currentVersion + 1)
  await state.storage.delete(AD_STATE_KEY)
}

/**
 * Detect and store bitrates from master manifest
 * Updates the database with detected bitrates for GUI display and auto-configuration
 */
async function detectAndStoreBitrates(
  env: Env,
  channelId: string,
  manifestContent: string
): Promise<void> {
  try {
    // Check if this is a master manifest (contains #EXT-X-STREAM-INF)
    if (!manifestContent.includes('#EXT-X-STREAM-INF')) {
      return // Not a master manifest, skip detection
    }
    
    // Extract bitrates from manifest
    const detectedBitrates = extractBitrates(manifestContent)
    
    if (detectedBitrates.length === 0) {
      console.warn(`No bitrates detected in manifest for channel ${channelId}`)
      return
    }
    
    console.log(`Detected bitrates for channel ${channelId}:`, detectedBitrates)
    
    // Check if bitrate_ladder is currently auto-detected or not set
    const channel = await env.DB.prepare(`
      SELECT bitrate_ladder, bitrate_ladder_source 
      FROM channels 
      WHERE id = ?
    `).bind(channelId).first<any>()
    
    if (!channel) return
    
    const now = Date.now()
    const bitratesJSON = JSON.stringify(detectedBitrates)
    
    // Update detected bitrates and timestamp
    // Only auto-update bitrate_ladder if it's not manually configured
    if (!channel.bitrate_ladder_source || channel.bitrate_ladder_source === 'auto') {
      // Auto mode: update both detected_bitrates and bitrate_ladder
      await env.DB.prepare(`
        UPDATE channels 
        SET detected_bitrates = ?,
            bitrate_ladder = ?,
            bitrate_ladder_source = 'auto',
            last_bitrate_detection = ?
        WHERE id = ?
      `).bind(bitratesJSON, bitratesJSON, now, channelId).run()
      
      console.log(`Auto-updated bitrate ladder for channel ${channelId} to:`, detectedBitrates)
    } else {
      // Manual mode: only update detected_bitrates for reference
      await env.DB.prepare(`
        UPDATE channels 
        SET detected_bitrates = ?,
            last_bitrate_detection = ?
        WHERE id = ?
      `).bind(bitratesJSON, now, channelId).run()
      
      console.log(`Updated detected bitrates for channel ${channelId} (manual ladder preserved)`)
    }
  } catch (error) {
    console.error(`Failed to detect/store bitrates for channel ${channelId}:`, error)
  }
}

/**
 * Parse DATERANGE attributes from a tag line
 */
function parseDateRangeAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const content = line.replace('#EXT-X-DATERANGE:', '')
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g
  let match
  
  while ((match = regex.exec(content)) !== null) {
    const key = match[1]
    const value = match[2] || match[3]
    attrs[key] = value
  }
  
  return attrs
}

/**
 * Strip origin SCTE-35 markers from manifest
 * Safari can be confused by origin SCTE-35 markers; we only want our own ad markers
 * CRITICAL FIX: Properly parse DATERANGE tags to avoid breaking manifest structure
 */
function stripOriginSCTE35Markers(manifest: string): string {
  const lines = manifest.split('\n')
  const filtered: string[] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Handle #EXT-X-DATERANGE tags with proper attribute parsing
    if (line.startsWith('#EXT-X-DATERANGE:')) {
      const attrs = parseDateRangeAttributes(line)
      
      // Keep our own interstitials
      if (attrs['CLASS'] === 'com.apple.hls.interstitial') {
        filtered.push(line)
        continue
      }
      
      // Skip origin SCTE-35 markers (SCTE35-CMD, SCTE35-OUT, SCTE35-IN)
      if (attrs['SCTE35-CMD'] || attrs['SCTE35-OUT'] || attrs['SCTE35-IN']) {
        continue
      }
      
      // Skip SCTE-35 class markers
      if (attrs['CLASS'] && (
        attrs['CLASS'].includes('scte35') ||
        attrs['CLASS'].includes('SCTE35')
      )) {
        continue
      }
      
      // Keep other DATERANGE tags (chapter markers, etc.)
      filtered.push(line)
      continue
    }
    
    // Skip legacy SCTE-35 comment markers
    if (
      line.includes('#EXT-X-CUE-OUT') ||
      line.includes('#EXT-X-CUE-IN') ||
      line.includes('## splice_insert') ||
      line.includes('## Auto Return Mode')
    ) {
      continue
    }
    
    filtered.push(line)
  }
  
  return filtered.join('\n')
}

// -----------------------------------------------------------------------------
// Helper: fetch origin or return fallback variant
// -----------------------------------------------------------------------------
async function fetchOriginVariant(originUrl: string, channel: string, variant: string): Promise<Response> {
  // Normalize origin URL: if it ends with .m3u8 or a file extension, strip it to get base path
  // This handles both formats:
  // - Base path: https://origin.com/path/to/stream
  // - Full master manifest: https://origin.com/path/to/stream/.m3u8
  let baseUrl = originUrl
  if (baseUrl.endsWith('.m3u8') || baseUrl.endsWith('.isml/.m3u8')) {
    // Remove the manifest filename to get base path
    const lastSlash = baseUrl.lastIndexOf('/')
    if (lastSlash > 0) {
      baseUrl = baseUrl.substring(0, lastSlash)
    }
  }
  
  // Construct the full URL for the requested variant
  // NOTE: Don't use encodeURIComponent() - the = signs are part of the filename!
  // Unified Streaming format: scte35-audio_eng=64000-video=500000.m3u8
  const u = `${baseUrl}/${variant}`
  console.log(`Fetching origin variant: ${u}`)
  
  try {
    const r = await fetch(u, { cf: { cacheTtl: 1, cacheEverything: true } })
    if (r.ok) {
      console.log(`Origin fetch success: ${r.status} ${u}`)
      return r
    }
    console.log(`Origin fetch failed: ${r.status} ${u}`)
  } catch (err) {
    console.log(`Origin fetch error: ${err}`)
  }
  
  // Origin fetch failed - return HLS slate manifest (not plain text!)
  console.error(`Origin unavailable for: ${u}`)
  
  // Return a minimal valid HLS manifest with a slate message
  const slateManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
#EXT-X-ENDLIST
`
  
  return new Response(slateManifest, { 
    status: 200,  // Return 200 so HLS.js doesn't error immediately
    headers: { 
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-cache"
    }
  })
}

// -----------------------------------------------------------------------------
// FIX #6: Robust player detection with multi-tier fallback
// -----------------------------------------------------------------------------

/**
 * Determine if client wants SGAI (Server-Guided Ad Insertion) based on:
 * 1. Query parameter override (?mode=sgai / ?mode=ssai)
 * 2. Channel configuration default mode
 * 3. Feature-based client detection (Apple devices with HLS Interstitial support)
 * 4. Default fallback (SSAI for broad compatibility)
 *
 * @param req - HTTP request with headers and URL
 * @param channelConfig - Channel configuration with mode setting
 * @param forceMode - Optional mode override from query params
 * @returns true for SGAI, false for SSAI
 */
function determineAdInsertionMode(
  req: Request, 
  channelConfig?: ChannelConfig, 
  forceMode?: string
): 'sgai' | 'ssai' {
  // Priority 1: Explicit query parameter override (highest precedence)
  // This allows developers and QA to force specific modes for testing
  if (forceMode === 'sgai' || forceMode === 'ssai') {
    console.log(`🔧 Mode forced via query param: ${forceMode}`)
    return forceMode
  }
  
  // Priority 2: Channel-level configuration override
  // Allows per-channel customization in admin interface
  if (channelConfig?.mode && channelConfig.mode !== 'auto') {
    console.log(`⚙️  Mode from channel config: ${channelConfig.mode}`)
    return channelConfig.mode as 'sgai' | 'ssai'
  }
  
  // Priority 3: Feature-based client detection
  const ua = req.headers.get('user-agent') || ''
  
  // Apple ecosystem: Check for devices/browsers that support HLS Interstitials
  // SGAI (HLS Interstitials) only work with:
  // - iOS Safari (iPhone/iPad)
  // - macOS Safari (not Chrome/Firefox on Mac)
  // - tvOS (Apple TV)
  // - AVPlayer-based apps
  
  const isAppleDevice = /iPhone|iPad|iPod/.test(ua)
  const isTvOS = /Apple TV|tvOS/.test(ua)
  const isMacSafari = /Macintosh.*Safari/.test(ua) && !/Chrome|Firefox|Edge|Opera/.test(ua)
  const isAVPlayerApp = /AVPlayer/.test(ua) || req.headers.has('X-AVPlayer-Version')
  
  // Additional Apple-specific request headers that indicate Safari/AVPlayer
  const hasAppleHeaders = req.headers.has('X-Apple-Request-UUID') || 
                          req.headers.has('X-Playback-Session-Id') ||
                          req.headers.get('Accept')?.includes('application/vnd.apple')
  
  // Determine if client likely supports HLS Interstitials
  const supportsInterstitials = isAppleDevice || isTvOS || isMacSafari || isAVPlayerApp || hasAppleHeaders
  
  if (supportsInterstitials) {
    // Additional validation: check for known incompatible clients
    const isWebView = /WebView|wkwebview/i.test(ua)
    const isKnownIncompatible = /Chrome|Firefox|Edge|Opera/i.test(ua) && !isAppleDevice
    
    if (isWebView) {
      console.log(`🔍 Detected WebView client, falling back to SSAI (WebViews may not support interstitials)`)
      return 'ssai'
    }
    
    if (isKnownIncompatible) {
      console.log(`🔍 Detected non-Safari browser on desktop, using SSAI`)
      return 'ssai'
    }
    
    console.log(`🍎 Detected Apple-compatible client (${isAppleDevice ? 'iOS' : isTvOS ? 'tvOS' : isMacSafari ? 'macOS Safari' : 'AVPlayer'}), using SGAI`)
    return 'sgai'
  }
  
  // Priority 4: Default fallback to SSAI for broad compatibility
  // SSAI works with all HLS players (hls.js, ExoPlayer, etc.)
  console.log(`🌐 Default client detection → SSAI (UA: ${ua.substring(0, 100)}...)`)
  return 'ssai'
}

/**
 * Legacy wrapper for backwards compatibility
 * @deprecated Use determineAdInsertionMode() instead
 */
function wantsSGAI(req: Request): boolean {
  return determineAdInsertionMode(req) === 'sgai'
}

// -----------------------------------------------------------------------------
// Helper: extract bitrate from variant filename (e.g., "v_1600k.m3u8" → 1600000)
// -----------------------------------------------------------------------------
function extractBitrate(variant: string): number | null {
  // Match Unified Streaming format: video=1000000
  const unifiedMatch = variant.match(/video=(\d+)/i)
  if (unifiedMatch) {
    return parseInt(unifiedMatch[1], 10)
  }
  
  // Match simple format: v_1600k, v_800k, 1600k, etc.
  const simpleMatch = variant.match(/(\d+)k/i)
  if (simpleMatch) {
    return parseInt(simpleMatch[1], 10) * 1000
  }
  
  return null
}

// -----------------------------------------------------------------------------
// Helper: select best matching ad pod variant based on viewer bitrate
// -----------------------------------------------------------------------------
function selectAdVariant(viewerBitrate: number | null): string {
  // Available ad pod bitrates (in order of preference)
  const available = [
    { bitrate: 1600000, path: "v_1600k" },
    { bitrate: 800000, path: "v_800k" },
  ]
  
  if (!viewerBitrate) {
    // Default to mid-tier if no bitrate detected
    return available[1].path
  }
  
  // Find closest match (prefer equal or lower bitrate to avoid buffering)
  let best = available[available.length - 1] // Start with lowest
  for (const av of available) {
    if (av.bitrate <= viewerBitrate) {
      best = av
      break
    }
  }
  
  return best.path
}

// -----------------------------------------------------------------------------
// Helper: make ad decision via decision service worker (with caching support)
// -----------------------------------------------------------------------------
async function decision(
  env: Env,
  adPodBase: string,
  channel: string,
  durationSec: number,
  viewerInfo?: any,
  cachedDecision?: DecisionResponse  // PRE-CALCULATED: Use this if available (avoids Worker binding call)
): Promise<DecisionResponse> {
  // PERFORMANCE OPTIMIZATION: Use pre-calculated decision if available
  // This eliminates Worker binding calls and CPU timeout risk on hot path
  if (cachedDecision) {
    console.log(`✅ Using pre-calculated decision (cache hit): podId=${cachedDecision.pod?.podId}, items=${cachedDecision.pod?.items?.length || 0}`)
    return cachedDecision
  }

  console.log(`⚠️  No cached decision, calling decision service (on-demand)`)

  // If DECISION service binding is available, use it
  if (env.DECISION) {
    const ctrl = new AbortController()
    // INCREASED TIMEOUT: 2000ms instead of 150ms for on-demand calls (less critical path)
    // Pre-calculated decisions avoid this entirely
    const timeoutMs = parseInt(env.DECISION_TIMEOUT_MS || "2000", 10)
    const to = setTimeout(() => ctrl.abort(), timeoutMs)

    try {
      const response = await env.DECISION.fetch("https://decision/decision", {
        method: "POST",
        body: JSON.stringify({ channel, durationSec, viewerInfo }),
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
      })

      clearTimeout(to)

      if (response.ok) {
        return await response.json()
      }
    } catch (err) {
      clearTimeout(to)
      console.error(`Decision service error (timeout: ${timeoutMs}ms):`, err)
    }
  }

  // Fallback: return empty response when decision service unavailable
  console.error("Decision service unavailable and no fallback configured")
  return {
    pod: {
      podId: 'decision-unavailable',
      durationSec,
      items: []
    }
  }
}

// -----------------------------------------------------------------------------
// Helper: Fetch with exponential backoff retry
// -----------------------------------------------------------------------------
async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        cf: { cacheTtl: 60, cacheEverything: true }
      })
      if (response.ok) return response
      
      console.warn(`Fetch attempt ${attempt + 1} failed with status ${response.status}: ${url}`)
    } catch (err) {
      console.error(`Fetch attempt ${attempt + 1} error: ${err}`)
    }
    
    // Exponential backoff: 100ms, 200ms, 400ms
    if (attempt < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100))
    }
  }
  
  throw new Error(`Failed to fetch after ${retries} retries: ${url}`)
}

// -----------------------------------------------------------------------------
// Helper: async signer using WebCrypto-based signPath
// -----------------------------------------------------------------------------
async function signAdPlaylist(signHost: string, segmentSecret: string, playlistPath: string): Promise<string> {
  const path = new URL(playlistPath).pathname
  return await signPath(signHost, segmentSecret, path, 600)
}

// -----------------------------------------------------------------------------
// Durable Object: ChannelDO
// -----------------------------------------------------------------------------
export class ChannelDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }
  
  /**
   * Generate synthetic slate segments when no slate is configured
   * Creates black segments to fill gap duration
   */
  private generateSyntheticSlate(gapDuration: number): Array<{url: string, duration: number}> {
    console.log(`Generating synthetic slate for ${gapDuration.toFixed(2)}s gap`)
    
    // Create synthetic segments with 6-second duration (standard HLS segment)
    const segments: Array<{url: string, duration: number}> = []
    const segmentDuration = 6.0
    const segmentCount = Math.ceil(gapDuration / segmentDuration)
    
    for (let i = 0; i < segmentCount; i++) {
      // Generate a synthetic URL that won't resolve but maintains manifest structure
      // In production, this should point to actual black slate segments in R2
      segments.push({
        url: `/slate/synthetic_black_${i}.ts`,
        duration: i === segmentCount - 1 
          ? gapDuration - (i * segmentDuration)  // Last segment gets remaining duration
          : segmentDuration
      })
    }
    
    console.log(`Generated ${segments.length} synthetic slate segments (total: ${gapDuration.toFixed(2)}s)`)
    return segments
  }
  
  /**
   * Fetch slate segments to pad ad breaks
   * Returns segments that fill the gap duration
   */
  private async fetchSlateSegments(
    channelId: string,
    viewerBitrate: number | null,
    gapDuration: number
  ): Promise<Array<{url: string, duration: number}>> {
    try {
      // Get channel's configured slate from database
      const channel = await this.env.DB.prepare(`
        SELECT slate_id FROM channels WHERE id = ?
      `).bind(channelId).first<any>()
      
      // CRITICAL FIX: Fallback to organization-level slate or global slate
      let slateId = channel?.slate_id
      
      if (!slateId) {
        console.log('No channel-specific slate, checking organization defaults...')
        
        // Try organization-level slate
        const orgSlate = await this.env.DB.prepare(`
          SELECT s.id FROM slates s
          JOIN organizations o ON s.organization_id = o.id
          JOIN channels c ON c.organization_id = o.id
          WHERE c.id = ? AND s.status = 'ready'
          ORDER BY s.created_at DESC
          LIMIT 1
        `).bind(channelId).first<any>()
        
        slateId = orgSlate?.id
      }
      
      if (!slateId) {
        console.warn('No slate configured for channel or organization')
        // FALLBACK: Generate synthetic slate segments from content stream
        return this.generateSyntheticSlate(gapDuration)
      }
      
      // Get slate details
      const slate = await this.env.DB.prepare(`
        SELECT id, master_playlist_url, variants, duration FROM slates 
        WHERE id = ? AND status = 'ready'
      `).bind(slateId).first<any>()
      
      if (!slate || !slate.variants) {
        console.warn('Slate not ready or has no variants')
        return []
      }
      
      // Parse variants and find best match for viewer bitrate
      const variants = JSON.parse(slate.variants)
      let slateVariant = variants[0]
      
      if (viewerBitrate) {
        // Find closest bitrate match
        slateVariant = variants.reduce((best: any, current: any) => {
          const bestDiff = Math.abs(best.bitrate - viewerBitrate)
          const currentDiff = Math.abs(current.bitrate - viewerBitrate)
          return currentDiff < bestDiff ? current : best
        })
      }
      
      // Fetch slate playlist with retry
      const playlistResponse = await fetchWithRetry(slateVariant.url, 3).catch(err => {
        console.error(`Failed to fetch slate playlist after retries: ${slateVariant.url}`, err)
        return null
      })
      
      if (!playlistResponse) {
        return []
      }
      
      const playlistContent = await playlistResponse.text()
      const baseUrl = slateVariant.url.replace('/playlist.m3u8', '')
      
      // Parse slate segments
      const slateSegments: Array<{url: string, duration: number}> = []
      const lines = playlistContent.split('\n')
      let currentDuration = 6.0
      
      for (const line of lines) {
        const trimmed = line.trim()
        
        if (trimmed.startsWith('#EXTINF:')) {
          const match = trimmed.match(/#EXTINF:([\d.]+)/)
          if (match) {
            currentDuration = parseFloat(match[1])
          }
          continue
        }
        
        if (!trimmed || trimmed.startsWith('#')) continue
        
        slateSegments.push({
          url: `${baseUrl}/${trimmed}`,
          duration: currentDuration
        })
      }
      
      if (slateSegments.length === 0) {
        console.warn('No segments found in slate playlist')
        return []
      }
      
      // Loop slate segments to fill gap duration
      const paddingSegments: Array<{url: string, duration: number}> = []
      let filledDuration = 0
      let slateIndex = 0
      
      while (filledDuration < gapDuration) {
        const segment = slateSegments[slateIndex % slateSegments.length]
        paddingSegments.push(segment)
        filledDuration += segment.duration
        slateIndex++
        
        // Safety limit: don't add more than 100 segments
        if (paddingSegments.length > 100) {
          console.warn('Hit safety limit on slate padding segments')
          break
        }
      }
      
      console.log(`Slate padding: added ${paddingSegments.length} segments (${filledDuration.toFixed(2)}s) to fill ${gapDuration.toFixed(2)}s gap`)
      return paddingSegments
      
    } catch (err) {
      console.error('Error fetching slate segments:', err)
      return []
    }
  }

  /**
   * Trim slate segments from the end of the adjusted ad pod to reduce overrun duration.
   * Returns total duration trimmed.
   */
  private trimSlateSegments(segments: AdSegmentInfo[], trimAmount: number): number {
    if (trimAmount <= 0) return 0

    let remaining = trimAmount
    let trimmed = 0

    for (let i = segments.length - 1; i >= 0 && remaining > 0; i--) {
      const segment = segments[i]
      if (segment.type === 'slate') {
        trimmed += segment.duration
        remaining -= segment.duration
        segments.splice(i, 1)
      }
    }

    return Math.round(trimmed * 1000) / 1000
  }

  async fetch(req: Request): Promise<Response> {
    // CRITICAL FIX: Load ad state version before blocking to detect mid-request changes
    const initialAdStateVersion = await this.state.storage.get<number>('ad_state_version') || 0
    
    return await this.state.blockConcurrencyWhile(async () => {
      const u = new URL(req.url)

      // Extract per-channel configuration from headers (set by manifest worker)
      const channelId = req.headers.get('X-Channel-Id') || 'unknown'
      const originUrl = req.headers.get('X-Origin-Url') || this.env.ORIGIN_VARIANT_BASE
      const adPodBase = req.headers.get('X-Ad-Pod-Base') || this.env.AD_POD_BASE
      const signHost = req.headers.get('X-Sign-Host') || this.env.SIGN_HOST

      // Control plane: POST /cue to start/stop an ad break for this channel
      if (u.pathname === "/cue") {
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 })
        try {
          const body = await req.json()
          const type = (body?.type || "start").toString()

          if (type === "stop") {
            await clearAdState(this.state)
            return new Response(JSON.stringify({ ok: true, cleared: true }), {
              headers: { "content-type": "application/json" },
            })
          }

          const durationSec = Number(body?.duration ?? 30)
          if (!Number.isFinite(durationSec) || durationSec <= 0) {
            return new Response("invalid duration", { status: 400 })
          }

          const podId: string | undefined = body?.pod_id
          const podUrl: string | undefined = body?.pod_url
          
          // If no pod_url provided, we need either pod_id or return error
          if (!podUrl && !podId) {
            return new Response("Missing pod_url or pod_id in request body", { status: 400 })
          }
          
          // If pod_url not provided but pod_id is, construct URL (requires valid pod_id)
          const finalPodUrl = podUrl || `${adPodBase}/${podId}/1000k/playlist.m3u8`

          const now = Date.now()
          const s: AdState = {
            active: true,
            podId,
            podUrl: finalPodUrl,
            startedAt: now,
            endsAt: now + durationSec * 1000,
            durationSec,
          }
          await saveAdState(this.state, s)

          // Best-effort beacon for ad-start
          await this.env.BEACON_QUEUE.send({
            event: "ad_start",
            adId: podId || "pod",
            ts: now,
            trackerUrls: [],
          })

          return new Response(JSON.stringify({ ok: true, state: s }), {
            headers: { "content-type": "application/json" },
          })
        } catch {
          return new Response("bad request", { status: 400 })
        }
      }

      const channel = u.searchParams.get("channel")
      const variant = u.searchParams.get("variant") || "v_1600k.m3u8"
      const force = u.searchParams.get("force") // "sgai" | "ssai" | null

      if (!channel) return new Response("channel required", { status: 400 })

      // Extract viewer bitrate from variant name for ad selection
      // Format: scte35-audio_eng=128000-video=1000000.m3u8
      const viewerBitrate = extractBitrateFromVariant(variant)

      // PERFORMANCE FIX: Check if this is a segment request FIRST
      // Segments should bypass all config/database lookups
      if (!variant.endsWith('.m3u8')) {
        // This is a segment (.ts, .m4s, etc.) - pass through immediately
        const originResponse = await fetchOriginVariant(originUrl, channel, variant)
        return originResponse
      }
      
      // This is a manifest - fetch channel configuration
      const orgSlug = req.headers.get('X-Org-Slug') || null
      const channelSlug = req.headers.get('X-Channel-Slug') || channel
      const channelConfig = orgSlug ? await getChannelConfig(this.env, orgSlug, channelSlug) : null
      
      console.log(`Channel config loaded: orgSlug=${orgSlug}, channelSlug=${channelSlug}, config=`, JSON.stringify(channelConfig))

      // Fetch origin manifest for processing
      const originResponse = await fetchOriginVariant(originUrl, channel, variant)
      
      // For manifests, read as text for processing
      const origin = await originResponse.text()

      // Detect and store bitrates if this is a master manifest
      // Fire-and-forget to avoid delaying the response
      const channelIdHeader = req.headers.get('X-Channel-Id')
      if (channelIdHeader) {
        detectAndStoreBitrates(this.env, channelIdHeader, origin).catch(err => 
          console.error('Bitrate detection failed:', err)
        )
      }

      // REQUEST-SCOPED CACHE: Cache PDT extraction results to avoid redundant parsing
      // extractPDTs() may be called multiple times in a single manifest request:
      // 1. For SCTE-35 temporal validation (line ~795)
      // 2. For SCTE-35 start time extraction (line ~904)
      // 3. For manifest window validation (line ~1218)
      // This cache ensures O(1) lookup after first extraction
      const pdtCache: Map<string, string[]> = new Map()
      const getCachedPDTs = (manifest: string): string[] => {
        const hash = manifest.substring(0, 100)  // Use manifest prefix as cache key
        if (!pdtCache.has(hash)) {
          pdtCache.set(hash, extractPDTs(manifest))
        }
        return pdtCache.get(hash)!
      }
      
      // Load live ad state (if any) - this takes priority over other signals
      // Check if state was modified during request queueing
      const currentAdStateVersion = await this.state.storage.get<number>('ad_state_version') || 0
      let adState = await loadAdState(this.state)
      let adActive = !!adState && Date.now() < adState.endsAt
      
      // If version changed, state was updated by /cue API or another request
      if (currentAdStateVersion !== initialAdStateVersion) {
        console.log(`Ad state version changed during request (${initialAdStateVersion} -> ${currentAdStateVersion}), using latest state`)
      }

      // Parse SCTE-35 signals from origin manifest (with enhanced binary parsing)
      const scte35Signals = parseSCTE35FromManifest(origin)
      let activeBreak = findActiveBreak(scte35Signals)

      if (scte35Signals.length > 0) {
        console.log(`Found ${scte35Signals.length} SCTE-35 signals`)

        if (activeBreak) {
          // CRITICAL: Validate SCTE-35 signal before using it
          // Extract PDT for temporal validation (using request-scoped cache)
          const pdts = getCachedPDTs(origin)
          const mostRecentPDT = pdts.length > 0 ? pdts[pdts.length - 1] : undefined

          const validation = validateSCTE35Signal(activeBreak, mostRecentPDT)

          // Log validation results
          if (!validation.valid) {
            console.error(`❌ SCTE-35 Validation FAILED for signal ${activeBreak.id}:`)
            validation.errors.forEach(err => console.error(`   - ${err}`))

            // Reject invalid signal - do not attempt ad insertion
            activeBreak = null
            console.log(`⚠️  Rejecting invalid SCTE-35 signal to prevent playback issues`)
          } else {
            // Log warnings but allow signal through
            if (validation.warnings.length > 0) {
              console.warn(`⚠️  SCTE-35 Validation warnings for signal ${activeBreak.id}:`)
              validation.warnings.forEach(warn => console.warn(`   - ${warn}`))
            }

            // Log enhanced binary data if available
            if (activeBreak.binaryData) {
              console.log(`✅ SCTE-35 Binary Parsing: Event ID=${activeBreak.binaryData.spliceEventId}, ` +
                `PTS=${activeBreak.pts ? `${activeBreak.pts} (${(activeBreak.pts / 90000).toFixed(3)}s)` : 'N/A'}, ` +
                `CRC Valid=${activeBreak.binaryData.crcValid}, ` +
                `Duration=${activeBreak.duration}s`)
            } else {
              console.log(`✅ SCTE-35 Attribute Parsing: ${activeBreak.id} (${activeBreak.duration}s)`)
            }
          }
        }
      }

      // FIX #6: Determine ad insertion mode with robust multi-tier detection
      // Priority order:
      // 1. Query parameter override (?mode=sgai or ?mode=ssai) - for testing/debugging
      // 2. Channel config mode setting from database - for per-channel control
      // 3. Feature-based client detection - iOS/Safari/tvOS/AVPlayer → SGAI, others → SSAI
      // 4. Default fallback - SSAI for maximum compatibility
      const mode = determineAdInsertionMode(req, channelConfig, force)

      // NOTE: SGAI (HLS Interstitials) only works with Safari/iOS/AVPlayer
      // hls.js and most web players do NOT support HLS Interstitials
      // Users can force SGAI with ?mode=sgai query param for Apple devices
      // Default behavior: respect channel config or query param

      // Determine if we should inject ads (priority order):
      // 1. Live ad state from /cue API (highest priority)
      // 2. SCTE-35 signal detected (preferred for live streams)
      // 3. Fallback to time-based for testing (every 5 minutes)
      const now = Date.now()
      const minute = new Date(now).getUTCMinutes()
      const isBreakMinute = force ? true : minute % 5 === 0
      
      let shouldInsertAd = false
      let breakDurationSec = 30
      let scte35StartPDT: string | null = null
      let adSource: "api" | "scte35" | "time" = "time"

      // CRITICAL: Check if persisted ad state has expired
      // Check both wall-clock expiration AND manifest-window expiration for SCTE-35 breaks
      if (adActive && adState) {
        // Wall-clock expiration (use <= to include boundary)
        if (adState.endsAt <= now) {
          console.log(`⏱️  Ad break expired (wall-clock): ended at ${new Date(adState.endsAt).toISOString()}, now is ${new Date(now).toISOString()} - clearing stale state`)
          await this.state.storage.delete('adState')
          adActive = false
          adState = null
        }
        // CRITICAL: For SCTE-35 breaks, also check if PDT has rolled out of manifest window
        // Live HLS windows are typically 2-3 minutes. If ad PDT is > 90 seconds old, it's stale
        else if (adState.scte35StartPDT) {
          const adStartTime = new Date(adState.scte35StartPDT).getTime()
          const ageSeconds = (now - adStartTime) / 1000

          if (ageSeconds > 90) {  // 90 second window (conservative for 2-minute manifest windows)
            console.log(`⏱️  SCTE-35 ad break expired (manifest window): PDT ${adState.scte35StartPDT} is ${ageSeconds.toFixed(1)}s old - clearing stale state`)
            await this.state.storage.delete('adState')
            adActive = false
            adState = null
          }
        }
      }

      if (adActive) {
        // Live ad triggered via /cue API - highest priority
        shouldInsertAd = true
        breakDurationSec = adState!.durationSec
        adSource = "api"
        console.log(`API-triggered ad break: duration=${breakDurationSec}s, podId=${adState!.podId}`)
      } else if (activeBreak && channelConfig?.scte35AutoInsert) {
        // SCTE-35 signal detected - check tier filtering first
        const channelTier = channelConfig?.tier ?? 0
        const scte35Tier = activeBreak.binaryData?.tier ?? 0
        
        // Tier filtering (SCTE-35 spec section 9.2)
        // If channel tier is 0, accept all ads
        // Otherwise, only accept ads matching the channel's tier
        if (channelTier !== 0 && scte35Tier !== channelTier) {
          console.log(`SCTE-35 tier mismatch: channel tier=${channelTier} (0x${channelTier.toString(16).padStart(3, '0')}), signal tier=${scte35Tier} (0x${scte35Tier.toString(16).padStart(3, '0')}) - skipping ad`)
          // Don't insert this ad - wrong tier
          shouldInsertAd = false
        } else {
          // Tier matches or no tier restriction - proceed with ad insertion
          shouldInsertAd = true
          breakDurationSec = getBreakDuration(activeBreak)
          adSource = "scte35"
          
          // Find the PDT timestamp for the break (using request-scoped cache)
          const pdts = getCachedPDTs(origin)
          if (pdts.length > 0) {
            scte35StartPDT = pdts[pdts.length - 1]  // Use most recent PDT near signal
          }

          // DEDUPLICATION: Check if we've already processed this SCTE-35 signal
          // Rolling signals in live manifests can cause the same event to appear 5+ times
          const scte35EventId = activeBreak.binaryData?.spliceEventId?.toString() || activeBreak.id
          const existingAdState = await loadAdState(this.state)

          // Check if this specific SCTE-35 event has been processed
          if (existingAdState?.processedEventIds?.includes(scte35EventId)) {
            console.log(`⏭️  Skipping duplicate SCTE-35 signal: ${scte35EventId} (already processed)`)
            shouldInsertAd = false
            adActive = false
          } else {
            // CRITICAL FIX: Check if existing ad state should be reused
            // For SCTE-35 breaks with historical PDTs, we can't use wall clock expiration
            // Instead, check if the SCTE-35 PDT falls within the existing break's time range
            let hasActiveAdBreak = false

            if (existingAdState && existingAdState.active && existingAdState.scte35StartPDT) {
              const scte35Time = new Date(scte35StartPDT).getTime()
              const existingStartTime = existingAdState.startedAt
              const existingEndTime = existingAdState.endsAt

              // Check if this SCTE-35 signal refers to the same time window (within 60s tolerance)
              const timeDiff = Math.abs(scte35Time - existingStartTime)
              hasActiveAdBreak = timeDiff < 60000  // 60 second window for deduplication

              if (hasActiveAdBreak) {
                console.log(`🔄 Reusing ad break for nearby SCTE-35 signal: existing_start=${new Date(existingStartTime).toISOString()}, new_pdt=${scte35StartPDT}, diff=${(timeDiff/1000).toFixed(1)}s`)
              }
            }

            if (hasActiveAdBreak) {
              // Add this event ID to the processed set to prevent reprocessing
              if (!existingAdState!.processedEventIds) {
                existingAdState!.processedEventIds = []
              }
              if (!existingAdState!.processedEventIds.includes(scte35EventId)) {
                existingAdState!.processedEventIds.push(scte35EventId)
                await saveAdState(this.state, existingAdState!)
                console.log(`🔄 Reusing active ad break: id=${existingAdState!.podId}, added event ${scte35EventId} to dedup set, remaining=${((existingAdState!.endsAt - Date.now()) / 1000).toFixed(1)}s`)
              } else {
                console.log(`🔄 Reusing active ad break: id=${existingAdState!.podId}, event ${scte35EventId} already in dedup set`)
              }
              adState = existingAdState
              adActive = true
            } else if (!adActive) {
              // Only create new ad state if no active break exists
            const startTime = scte35StartPDT ? new Date(scte35StartPDT).getTime() : now
          // CRITICAL FIX: Use integer milliseconds to avoid floating-point drift
            // This prevents HLS.js from detecting schedule changes mid-playback
            const durationMs = Math.round(breakDurationSec * 1000)
            const stableDuration = durationMs / 1000  // Exact representation
            
            // CRITICAL: Use stable, time-based ID to prevent HLS.js from canceling interstitials
            // The ID must remain constant across all manifest requests during the break
            // activeBreak.id can change or disappear as the live window moves
            const stableId = `ad_${channelId}_${Math.floor(startTime / 1000)}`
            
            const newAdState: AdState = {
              active: true,
              podId: stableId,
              podUrl: '', // Will be filled in after decision service call
              startedAt: startTime,
              endsAt: startTime + stableDuration * 1000,
              durationSec: stableDuration,
              scte35StartPDT: scte35StartPDT || undefined,  // Stable PDT reference
              contentSegmentsToSkip: 0,  // Will be calculated during first manifest generation
              skippedDuration: 0,  // Will be calculated during first manifest generation
              processedEventIds: [scte35EventId],  // Initialize with current event ID
            }

            // PERFORMANCE OPTIMIZATION: Pre-calculate decision asynchronously BEFORE viewers arrive
            // This eliminates Worker binding calls on hot path and prevents CPU timeouts
            console.log(`🚀 Pre-calculating ad decision for SCTE-35 break (channel=${channelId}, duration=${stableDuration}s)`)
            try {
              const preCalcStart = Date.now()
              const preCalculatedDecision = await decision(this.env, adPodBase, channelId, stableDuration, {
                scte35: activeBreak  // Pass SCTE-35 metadata for targeting
              }, undefined)  // No cached decision yet (this IS the calculation)

              newAdState.decision = preCalculatedDecision
              newAdState.decisionCalculatedAt = Date.now()

              const calcDuration = Date.now() - preCalcStart
              console.log(`✅ Pre-calculated decision ready (${calcDuration}ms): podId=${preCalculatedDecision.pod?.podId}, items=${preCalculatedDecision.pod?.items?.length || 0}`)
            } catch (err) {
              console.error(`⚠️  Decision pre-calculation failed (will fall back to on-demand):`, err)
              // Don't block ad state creation - on-demand fallback will handle it
            }

            await saveAdState(this.state, newAdState)
            console.log(`✨ Created new SCTE-35 ad break: id=${stableId}, start=${new Date(startTime).toISOString()}, duration=${stableDuration}s (rounded from ${breakDurationSec}s), pdt=${scte35StartPDT}, eventId=${scte35EventId}`)

            // Reload ad state for use in manifest generation below
            adState = newAdState
            adActive = true

            if (channelTier !== 0 && scte35Tier === channelTier) {
              console.log(`SCTE-35 tier match: tier=${channelTier} (0x${channelTier.toString(16).padStart(3, '0')}) - allowing ad`)
            }
          }
          }
        }
      } else if (isBreakMinute && channelConfig?.timeBasedAutoInsert) {
        // Fallback to time-based schedule (only if auto-insert enabled)
        shouldInsertAd = true
        adSource = "time"
        console.log("Time-based ad break (auto-insert enabled)")
      }

      // Only inject ads if conditions met
      if (shouldInsertAd) {
        console.log(`✅ shouldInsertAd=true, adSource=${adSource}, mode=${mode}`)
        
        // CRITICAL: Use stable start time AND duration to prevent HLS.js schedule recalculation mid-playback
        // If ad state exists (from /cue API or previous SCTE-35), reuse its start time and duration
        // Otherwise, use SCTE-35 PDT or current time (rounded to whole second)
        let startISO: string
        let stableDuration: number
        
        if (adActive && adState!.startedAt) {
          // Reuse persisted values for stable interstitial timing
          startISO = new Date(adState!.startedAt).toISOString()
          stableDuration = adState!.durationSec
          console.log(`Using persisted ad state: start=${startISO}, duration=${stableDuration}s`)
        } else {
          startISO = scte35StartPDT || new Date(Math.floor(now / 1000) * 1000).toISOString()
          // Use integer milliseconds to avoid floating-point precision issues
          const durationMs = Math.round(breakDurationSec * 1000)
          stableDuration = durationMs / 1000  // Exact representation
          console.log(`Using calculated values: start=${startISO}, duration=${stableDuration}s (from ${breakDurationSec}s)`)
        }
        
        // PERFORMANCE OPTIMIZATION: Use pre-calculated decision if available in ad state
        // This avoids Worker binding call and eliminates CPU timeout risk
        // CRITICAL: Enforce decision TTL - refresh if too old to catch inventory drift
        const decisionAge = adState?.decisionCalculatedAt ? Date.now() - adState.decisionCalculatedAt : Infinity
        const decisionIsStale = decisionAge > DECISION_TTL_MS
        const cachedDecision = adState?.decision && !decisionIsStale ? adState.decision : undefined

        if (cachedDecision) {
          console.log(`✅ Using pre-calculated decision from ad state (age: ${decisionAge}ms, TTL: ${DECISION_TTL_MS}ms)`)
        } else if (adState?.decision && decisionIsStale) {
          console.log(`🔄 Decision stale (age: ${decisionAge}ms > TTL: ${DECISION_TTL_MS}ms), refreshing...`)
        } else {
          console.log(`⚠️  No cached decision, calling decision service on-demand: channelId=${channelId}, duration=${stableDuration}s`)
        }

        // Get ad decision from decision service (use per-channel ad pod base)
        // Pass channelId (e.g., "ch_demo_sports") not channel slug
        // Use stableDuration to ensure consistent ad selection
        // IMPORTANT: Don't pass viewer-specific bitrate/variant - decision service returns ALL variants
        // This allows pre-calculated decisions to work for all viewers regardless of quality level
        const decisionResponse = await decision(this.env, adPodBase, channelId, stableDuration, {
          scte35: activeBreak  // Only pass SCTE-35 metadata (same as pre-calculation)
        }, cachedDecision)  // Pass cached decision if available
        
        console.log(`Decision response received: podId=${decisionResponse.pod?.podId}, items=${decisionResponse.pod?.items?.length || 0}`)
        
        const pod = decisionResponse.pod
        const tracking = decisionResponse.tracking || { impressions: [], quartiles: {} }
        
        // Build beacon message with tracking URLs
        const beaconMsg: BeaconMessage = {
          event: "imp",
          adId: pod.podId,
          podId: pod.podId,
          channel,
          ts: Date.now(),
          trackerUrls: tracking.impressions || [],
          metadata: { 
            variant,
            bitrate: viewerBitrate,
            adVariant,
            scte35: activeBreak ? {
              id: activeBreak.id,
              type: activeBreak.type,
              duration: activeBreak.duration,
              spliceEventId: activeBreak.binaryData?.spliceEventId,
              pts: activeBreak.pts,
              crcValid: activeBreak.binaryData?.crcValid,
              upid: activeBreak.upid
            } : undefined
          },
          tracking: {
            errorTracking: tracking.errors
          }
        }

        if (mode === "sgai") {
          // SGAI: Insert HLS Interstitial DATERANGE tag
          // Client will fetch and play the ad asset seamlessly
          
          // Use ad state URL if from API, otherwise use decision service pod
          let interstitialURI: string
          if (adActive && adState!.podUrl) {
            interstitialURI = adState!.podUrl
          } else {
            // Find best matching ad item for viewer's bitrate
            const adItem = pod.items.find(item => item.bitrate === viewerBitrate) || 
                           pod.items[0]  // Fallback to first item
            // Use per-channel signing configuration
            interstitialURI = await signAdPlaylist(signHost, this.env.SEGMENT_SECRET, adItem.playlistUrl)
          }
          
          // Strip origin SCTE-35 markers before adding our interstitial
          const cleanOrigin = stripOriginSCTE35Markers(origin)
          // Use stableDuration for consistent interstitial timing
          const sgai = addDaterangeInterstitial(
            cleanOrigin,
            adActive ? (adState!.podId || "ad") : pod.podId,
            startISO,
            stableDuration,
            interstitialURI
          )
          
          await this.env.BEACON_QUEUE.send(beaconMsg)
          return new Response(sgai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
        } else {
          // SSAI: Replace content segments with ad segments
          
          if (scte35StartPDT) {
            // True SSAI: Replace segments at SCTE-35 marker position
            // Fetch the actual ad playlist and extract real segment URLs
            
            // Try exact bitrate match first, fall back to closest available
            let adItem = pod.items.find(item => item.bitrate === viewerBitrate)
            
            if (!adItem && pod.items.length > 0) {
              // No exact match - find closest bitrate (prefer lower to avoid buffering)
              const sorted = [...pod.items].sort((a, b) => {
                const diffA = Math.abs(a.bitrate - viewerBitrate)
                const diffB = Math.abs(b.bitrate - viewerBitrate)
                // If diffs are equal, prefer lower bitrate
                if (diffA === diffB) return a.bitrate - b.bitrate
                return diffA - diffB
              })
              adItem = sorted[0]
              console.log(`No exact match for ${viewerBitrate}bps, using closest: ${adItem.bitrate}bps`)
            }
            
            if (adItem) {
              const baseUrl = adItem.playlistUrl.replace("/playlist.m3u8", "")
              
              // Fetch the actual ad playlist to get real segment URLs
              // CRITICAL FIX: Add retry logic with exponential backoff
              try {
                const playlistResponse = await fetchWithRetry(adItem.playlistUrl, 3)
                
                const playlistContent = await playlistResponse.text()
                const adSegments: AdSegmentInfo[] = []

                // Parse playlist to extract segment filenames AND durations
                const lines = playlistContent.split('\n')
                let currentDuration = 6.0 // Default fallback

                for (const line of lines) {
                  const trimmed = line.trim()

                  if (trimmed.startsWith('#EXTINF:')) {
                    const match = trimmed.match(/#EXTINF:([\d.]+)/)
                    if (match) {
                      currentDuration = parseFloat(match[1])
                    }
                    continue
                  }

                  if (!trimmed || trimmed.startsWith('#')) continue

                  adSegments.push({
                    url: `${baseUrl}/${trimmed}`,
                    duration: currentDuration,
                    type: 'ad'
                  })
                }

                let baseAdDuration = Math.round(adSegments.reduce((sum, seg) => sum + seg.duration, 0) * 1000) / 1000
                console.log(`Extracted ${adSegments.length} ad segments (total: ${baseAdDuration.toFixed(3)}s) from playlist: ${adItem.playlistUrl}`)

                if (adSegments.length > 0) {
                  const cleanOrigin = stripOriginSCTE35Markers(origin)

                  // FIX #4: MANIFEST WINDOW VALIDATION
                  let shouldAttemptSSAI = true
                  if (scte35StartPDT) {
                    const pdtsInManifest = getCachedPDTs(cleanOrigin)
                    if (!pdtsInManifest.includes(scte35StartPDT)) {
                      console.warn(`🚨 FIX #4: SCTE-35 PDT not in manifest window! pdt=${scte35StartPDT}, manifest_has=${pdtsInManifest.length} segments, first=${pdtsInManifest[0]}, last=${pdtsInManifest[pdtsInManifest.length - 1]}. Skipping SSAI, falling back to SGAI immediately.`)
                      shouldAttemptSSAI = false
                    }
                  }

                  const stableSkipCount = adState?.contentSegmentsToSkip || undefined
                  let skipPlan: SkipPlan | null = null
                  if (shouldAttemptSSAI) {
                    skipPlan = calculateSkipPlan(cleanOrigin, scte35StartPDT, {
                      scte35Duration: stableDuration,
                      stableSkipCount
                    })

                    if (!skipPlan || skipPlan.segmentsSkipped === 0 || skipPlan.remainingSegments === 0 || !skipPlan.resumePDT) {
                      console.warn(`⚠️  Unable to build skip plan for PDT ${scte35StartPDT} (plan=${JSON.stringify(skipPlan)})`)
                      shouldAttemptSSAI = false
                    }
                  }

                  const cueDecodeStatus = adSource === 'api'
                    ? 'manual'
                    : activeBreak
                      ? (activeBreak.binaryData
                        ? (activeBreak.binaryData.crcValid === false ? 'binary-crc-invalid' : 'binary')
                        : 'attributes')
                      : (adSource === 'time' ? 'schedule' : 'unknown')

                  let boundarySnapOutcome = 'exact'
                  let adjustedSegments: AdSegmentInfo[] = [...adSegments]
                  let adPlaybackDuration = baseAdDuration
                  const telemetryFallback = { boundarySnapOutcome: 'fallback', durationError: Math.abs(adPlaybackDuration - stableDuration) }

                  let result = { manifest: cleanOrigin, segmentsSkipped: 0, durationSkipped: 0, actualAdDuration: adPlaybackDuration }

                  if (shouldAttemptSSAI && skipPlan) {
                    const tolerance = 0.5
                    const targetContentDuration = Math.round(skipPlan.durationSkipped * 1000) / 1000
                    let durationDelta = targetContentDuration - adPlaybackDuration

                    if (Math.abs(durationDelta) > tolerance) {
                      if (durationDelta > 0) {
                        boundarySnapOutcome = 'padded'
                        try {
                          const slateSegments = await this.fetchSlateSegments(channelId, viewerBitrate, durationDelta)
                          if (slateSegments.length > 0) {
                            const slateInfos: AdSegmentInfo[] = slateSegments.map(seg => ({ ...seg, type: 'slate' as const }))
                            adjustedSegments = [...adjustedSegments, ...slateInfos]
                            adPlaybackDuration = Math.round(adjustedSegments.reduce((sum, seg) => sum + seg.duration, 0) * 1000) / 1000
                            console.log(`Added ${slateInfos.length} slate segments to align with snapped IN boundary, new ad duration=${adPlaybackDuration.toFixed(3)}s`)
                          } else {
                            console.warn('No slate segments available to fill snapped boundary gap')
                            boundarySnapOutcome = 'underrun'
                          }
                        } catch (err) {
                          console.error('Failed to fetch slate segments for snapped boundary padding:', err)
                          boundarySnapOutcome = 'underrun'
                        }
                      } else {
                        boundarySnapOutcome = 'trimmed'
                        const trimmed = this.trimSlateSegments(adjustedSegments, Math.abs(durationDelta))
                        if (trimmed > 0) {
                          adPlaybackDuration = Math.round(adjustedSegments.reduce((sum, seg) => sum + seg.duration, 0) * 1000) / 1000
                          console.log(`Trimmed ${trimmed.toFixed(3)}s of slate to match snapped IN boundary, new ad duration=${adPlaybackDuration.toFixed(3)}s`)
                        } else {
                          boundarySnapOutcome = 'overrun'
                        }
                      }
                    }

                    const replacement = replaceSegmentsWithAds(
                      cleanOrigin,
                      scte35StartPDT,
                      adjustedSegments,
                      adPlaybackDuration,
                      stableDuration,
                      stableSkipCount,
                      {
                        adId: adActive ? (adState!.podId || 'ad') : pod.podId,
                        boundarySnap: boundarySnapOutcome,
                        cueDecodeStatus,
                        pidContinuity: 'reset',
                        plannedDuration: stableDuration,
                        durationError: Math.abs(adPlaybackDuration - stableDuration)
                      }
                    )

                    result = replacement

                    beaconMsg.metadata = {
                      ...beaconMsg.metadata,
                      telemetry: {
                        pidContinuity: 'reset',
                        cueDecodeStatus,
                        boundarySnap: boundarySnapOutcome,
                        durationError: Math.abs(replacement.actualAdDuration - stableDuration),
                        plannedDuration: stableDuration,
                        actualAdDuration: replacement.actualAdDuration,
                        actualContentDuration: replacement.durationSkipped
                      }
                    }
                  } else {
                    beaconMsg.metadata = {
                      ...beaconMsg.metadata,
                      telemetry: {
                        pidContinuity: 'reset',
                        cueDecodeStatus,
                        boundarySnap: telemetryFallback.boundarySnapOutcome,
                        durationError: telemetryFallback.durationError,
                        plannedDuration: stableDuration,
                        actualAdDuration: adPlaybackDuration,
                        actualContentDuration: 0
                      }
                    }
                  }

                  // HYBRID SSAI/SGAI fallback logic
                  if (result.segmentsSkipped === 0) {
                    console.log(`🔄 SSAI failed (PDT not in manifest), falling back to SGAI for late-joining viewer`)

                    // Use SGAI interstitial insertion instead
                    const adItem = pod.items.find(item => item.bitrate === viewerBitrate) || pod.items[0]
                    const interstitialURI = await signAdPlaylist(signHost, this.env.SEGMENT_SECRET, adItem.playlistUrl)

                    const sgai = addDaterangeInterstitial(
                      cleanOrigin,
                      adActive ? (adState!.podId || "ad") : pod.podId,
                      startISO,
                      stableDuration,
                      interstitialURI
                    )

                    await this.env.BEACON_QUEUE.send(beaconMsg)
                    return new Response(sgai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
                  }

                  // SSAI succeeded - persist skip stats ONLY on first request (when skip count is unset/zero)
                  // CRITICAL: Once set, never overwrite to ensure timeline consistency across all variants
                  if (adState && (!adState.contentSegmentsToSkip || adState.contentSegmentsToSkip === 0)) {
                    // Only persist if we actually skipped content (PDT was found in manifest)
                    if (result.segmentsSkipped > 0) {
                      adState.contentSegmentsToSkip = result.segmentsSkipped
                      adState.skippedDuration = result.durationSkipped
                      await saveAdState(this.state, adState)
                      console.log(`✅ Persisted stable skip count (FIRST REQUEST): ${result.segmentsSkipped} segments (${result.durationSkipped.toFixed(2)}s)`)
                    } else {
                      console.log(`⚠️  Skip count is 0 (PDT not in window) - not persisting, will retry on next request`)
                    }
                  } else if (adState && adState.contentSegmentsToSkip) {
                    // TELEMETRY: Detect if recalculation produces different skip count (potential bug)
                    if (result.segmentsSkipped > 0 && result.segmentsSkipped !== adState.contentSegmentsToSkip) {
                      console.warn(`🚨 TELEMETRY: Skip count mismatch detected! cached=${adState.contentSegmentsToSkip}, recalc=${result.segmentsSkipped}. This may indicate concurrent request inconsistency.`)
                      // FUTURE: Send to analytics/alerting system
                    } else {
                      console.log(`ℹ️  Using existing stable skip count: ${adState.contentSegmentsToSkip} segments (${adState.skippedDuration?.toFixed(2) || 'unknown'}s)`)
                    }
                  }

                  await this.env.BEACON_QUEUE.send(beaconMsg)
                  return new Response(result.manifest, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
                }
              } catch (err) {
                console.error(`Error fetching/parsing ad playlist:`, err)
                // Fall through to no-ad-insertion
              }
            }
          }
          
          // Fallback: Insert DISCONTINUITY only (legacy SSAI)
          const cleanOrigin = stripOriginSCTE35Markers(origin)
          const ssai = insertDiscontinuity(cleanOrigin)
          await this.env.BEACON_QUEUE.send(beaconMsg)
          return new Response(ssai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
        }
      }

      // Non-blocking cleanup of expired ad state
      if (adState && Date.now() >= adState.endsAt) {
        this.state.storage.delete(AD_STATE_KEY).catch(() => {})
      }

      // No ad break: return origin manifest, but strip origin SCTE-35 markers for Safari compatibility
      const cleaned = stripOriginSCTE35Markers(origin)
      return new Response(cleaned, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
    })
  }
}

// -----------------------------------------------------------------------------
// Export named class for Wrangler (important for binding)
// -----------------------------------------------------------------------------
export { ChannelDO as default }