import { addDaterangeInterstitial, insertDiscontinuity, replaceSegmentsWithAds, extractPDTs, extractBitrates } from "./utils/hls"
import { signPath } from "./utils/sign"
import { parseSCTE35FromManifest, isAdBreakStart, getBreakDuration, findActiveBreak } from "./utils/scte35"
import { getChannelConfig } from "./utils/channel-config"
import type { Env } from "./manifest-worker"
import type { DecisionResponse, BeaconMessage, SCTE35Signal } from "./types"

// -----------------------------------------------------------------------------
// Live ad state persisted per channel
// -----------------------------------------------------------------------------
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
// Helper: detect if client supports interstitials
// -----------------------------------------------------------------------------
function wantsSGAI(req: Request): boolean {
  const ua = req.headers.get("user-agent") || ""
  // crude detection; replace with feature detection for production
  return /iPhone|iPad|Macintosh/.test(ua)
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
// Helper: make ad decision via decision service worker
// -----------------------------------------------------------------------------
async function decision(env: Env, adPodBase: string, channel: string, durationSec: number, viewerInfo?: any): Promise<DecisionResponse> {
  // If DECISION service binding is available, use it
  if (env.DECISION) {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), parseInt(env.DECISION_TIMEOUT_MS || "150", 10))
    
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
      console.error("Decision service error:", err)
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
      const activeBreak = findActiveBreak(scte35Signals)
      
      if (scte35Signals.length > 0) {
        console.log(`Found ${scte35Signals.length} SCTE-35 signals`)
        
        if (activeBreak) {
          // Log enhanced binary data if available
          if (activeBreak.binaryData) {
            console.log(`SCTE-35 Binary Parsing: Event ID=${activeBreak.binaryData.spliceEventId}, ` +
              `PTS=${activeBreak.pts ? `${activeBreak.pts} (${(activeBreak.pts / 90000).toFixed(3)}s)` : 'N/A'}, ` +
              `CRC Valid=${activeBreak.binaryData.crcValid}, ` +
              `Duration=${activeBreak.duration}s`)
          } else {
            console.log(`SCTE-35 Attribute Parsing: ${activeBreak.id} (${activeBreak.duration}s)`)
          }
        }
      }

      // Determine ad insertion mode: SGAI (server-guided) or SSAI (server-side)
      // Priority order:
      // 1. URL force parameter (?force=sgai or ?force=ssai)
      // 2. Channel config mode setting from database
      // 3. Auto-detect based on client capability (iOS/Safari → SGAI, others → SSAI)
      let mode: string
      if (force) {
        mode = force
      } else if (channelConfig?.mode && channelConfig.mode !== 'auto') {
        mode = channelConfig.mode
      } else {
        mode = wantsSGAI(req) ? "sgai" : "ssai"
      }

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
          
          // Find the PDT timestamp for the break
          const pdts = extractPDTs(origin)
          if (pdts.length > 0) {
            scte35StartPDT = pdts[pdts.length - 1]  // Use most recent PDT near signal
          }
          
          // CRITICAL FIX: Check if existing ad state is still active and overlaps with this SCTE-35 signal
          // This prevents creating duplicate ad breaks for rolling SCTE-35 signals in live manifests
          const existingAdState = await loadAdState(this.state)
          const hasActiveAdBreak = existingAdState && existingAdState.active && Date.now() < existingAdState.endsAt
          
          if (hasActiveAdBreak) {
            // Reuse existing ad state - don't create a new one!
            // This prevents "ad played twice" when SCTE-35 signals roll in the manifest window
            const remainingMs = existingAdState!.endsAt - Date.now()
            console.log(`🔄 Reusing active ad break: id=${existingAdState!.podId}, remaining=${(remainingMs / 1000).toFixed(1)}s`)
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
            }
            await saveAdState(this.state, newAdState)
            console.log(`✨ Created new SCTE-35 ad break: id=${stableId}, start=${new Date(startTime).toISOString()}, duration=${stableDuration}s (rounded from ${breakDurationSec}s), pdt=${scte35StartPDT}`)
            
            // Reload ad state for use in manifest generation below
            adState = newAdState
            adActive = true
          }
          
          if (channelTier !== 0 && scte35Tier === channelTier) {
            console.log(`SCTE-35 tier match: tier=${channelTier} (0x${channelTier.toString(16).padStart(3, '0')}) - allowing ad`)
          }
          console.log(`SCTE-35 break detected (auto-insert enabled): duration=${breakDurationSec}s, pdt=${scte35StartPDT}`)
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
        
        // Extract viewer bitrate from variant and select matching ad pod
        const viewerBitrate = extractBitrate(variant)
        const adVariant = selectAdVariant(viewerBitrate)
        
        console.log(`Calling decision service: channelId=${channelId}, duration=${stableDuration}s, bitrate=${viewerBitrate}`)
        
        // Get ad decision from decision service (use per-channel ad pod base)
        // Pass channelId (e.g., "ch_demo_sports") not channel slug
        // Use stableDuration to ensure consistent ad selection
        const decisionResponse = await decision(this.env, adPodBase, channelId, stableDuration, {
          variant,
          bitrate: viewerBitrate,
          scte35: activeBreak
        })
        
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
                const adSegments: Array<{url: string, duration: number}> = []
                
                // Parse playlist to extract segment filenames AND durations
                const lines = playlistContent.split('\n')
                let currentDuration = 6.0 // Default fallback
                
                for (const line of lines) {
                  const trimmed = line.trim()
                  
                  // Extract duration from #EXTINF
                  if (trimmed.startsWith('#EXTINF:')) {
                    const match = trimmed.match(/#EXTINF:([\d.]+)/)
                    if (match) {
                      currentDuration = parseFloat(match[1])
                    }
                    continue
                  }
                  
                  // Skip other comments and empty lines
                  if (!trimmed || trimmed.startsWith('#')) continue
                  
                  // This is a segment URL - add with its duration
                  adSegments.push({
                    url: `${baseUrl}/${trimmed}`,
                    duration: currentDuration
                  })
                }
                
                // Round total duration to avoid floating-point precision issues
                let totalDuration = Math.round(adSegments.reduce((sum, seg) => sum + seg.duration, 0) * 100) / 100
                console.log(`Extracted ${adSegments.length} ad segments (total: ${totalDuration.toFixed(2)}s) from playlist: ${adItem.playlistUrl}`)
                
                // Pad with slate if ad is shorter than SCTE-35 break duration
                if (totalDuration < stableDuration && Math.abs(totalDuration - stableDuration) > 1.0) {
                  const gapDuration = stableDuration - totalDuration
                  console.log(`⚠️  Ad duration mismatch: ad=${totalDuration.toFixed(2)}s, break=${stableDuration.toFixed(2)}s, gap=${gapDuration.toFixed(2)}s, padding with slate`)
                  
                  // Fetch channel's slate configuration
                  try {
                    const slateSegments = await this.fetchSlateSegments(channelId, viewerBitrate, gapDuration)
                    if (slateSegments.length > 0) {
                      adSegments.push(...slateSegments)
                      totalDuration = Math.round(adSegments.reduce((sum, seg) => sum + seg.duration, 0) * 100) / 100
                      console.log(`Added ${slateSegments.length} slate segments, new total: ${totalDuration.toFixed(2)}s`)
                    } else {
                      console.warn('No slate segments available, gap will remain')
                    }
                  } catch (err) {
                    console.error('Failed to fetch slate segments:', err)
                  }
                }
                
                if (adSegments.length > 0) {
                  const cleanOrigin = stripOriginSCTE35Markers(origin)
                  // CRITICAL: Pass actual ad duration calculated from segments
                  // This ensures PDT timeline continuity
                  // Use stable skip count from ad state if available (prevents concurrent request inconsistency)
                  const stableSkipCount = adState?.contentSegmentsToSkip || undefined
                  
                  const result = replaceSegmentsWithAds(
                    cleanOrigin,
                    scte35StartPDT,
                    adSegments,
                    totalDuration,        // Actual ad duration from segment sum
                    stableDuration,       // SCTE-35 break duration for content skipping
                    stableSkipCount       // Use cached skip count if available
                  )
                  
                  // CRITICAL: Persist skip stats on first request for subsequent use
                  if (adState && (!adState.contentSegmentsToSkip || adState.contentSegmentsToSkip === 0)) {
                    adState.contentSegmentsToSkip = result.segmentsSkipped
                    adState.skippedDuration = result.durationSkipped
                    await saveAdState(this.state, adState)
                    console.log(`Persisted stable skip count: ${result.segmentsSkipped} segments (${result.durationSkipped.toFixed(2)}s)`)
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