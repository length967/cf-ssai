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
}

const AD_STATE_KEY = "ad_state"

async function loadAdState(state: DurableObjectState): Promise<AdState | null> {
  const v = await state.storage.get<AdState>(AD_STATE_KEY)
  if (!v) return null
  if (Date.now() >= v.endsAt) return null // auto-expire
  return v
}

async function saveAdState(state: DurableObjectState, s: AdState): Promise<void> {
  await state.storage.put(AD_STATE_KEY, s)
}

async function clearAdState(state: DurableObjectState): Promise<void> {
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
 * Strip origin SCTE-35 markers from manifest
 * Safari can be confused by origin SCTE-35 markers; we only want our own ad markers
 */
function stripOriginSCTE35Markers(manifest: string): string {
  const lines = manifest.split('\n')
  const filtered: string[] = []
  let skipNext = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Skip SCTE-35 related tags from origin
    if (
      line.includes('#EXT-X-DATERANGE') ||
      line.includes('#EXT-X-CUE-OUT') ||
      line.includes('#EXT-X-CUE-IN') ||
      line.includes('## splice_insert') ||
      line.includes('## Auto Return Mode')
    ) {
      // Skip this line unless it's OUR interstitial (has CLASS="com.apple.hls.interstitial")
      if (line.includes('CLASS="com.apple.hls.interstitial"')) {
        // This is our SGAI interstitial - keep it!
        filtered.push(line)
      }
      // Otherwise skip origin SCTE-35 markers
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

// getSlatePodFromDB function removed - use decision service with org default slate instead

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
      
      if (!channel?.slate_id) {
        console.log('No slate configured for channel, skipping padding')
        return []
      }
      
      // Get slate details
      const slate = await this.env.DB.prepare(`
        SELECT id, master_playlist_url, variants, duration FROM slates 
        WHERE id = ? AND status = 'ready'
      `).bind(channel.slate_id).first<any>()
      
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
      
      // Fetch slate playlist
      const playlistResponse = await fetch(slateVariant.url)
      if (!playlistResponse.ok) {
        console.error(`Failed to fetch slate playlist: ${slateVariant.url}`)
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
      let adState = await loadAdState(this.state)
      let adActive = !!adState && Date.now() < adState.endsAt

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
          
          // CRITICAL: Persist SCTE-35 break to storage for stable timing
          // Only create new ad state if one doesn't exist (don't overwrite existing)
          if (!adActive) {
            const startTime = scte35StartPDT ? new Date(scte35StartPDT).getTime() : now
            // CRITICAL FIX: Round duration to 2 decimal places to avoid floating-point drift
            // This prevents HLS.js from detecting schedule changes mid-playback
            const stableDuration = Math.round(breakDurationSec * 100) / 100
            
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
            }
            await saveAdState(this.state, newAdState)
            console.log(`Persisted SCTE-35 break to storage: id=${stableId}, start=${new Date(startTime).toISOString()}, duration=${stableDuration}s (rounded from ${breakDurationSec}s)`)
            
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
          // Round duration to avoid floating-point precision issues
          stableDuration = Math.round(breakDurationSec * 100) / 100
          console.log(`Using calculated values: start=${startISO}, duration=${stableDuration}s (rounded from ${breakDurationSec}s)`)
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
              try {
                const playlistResponse = await fetch(adItem.playlistUrl)
                if (!playlistResponse.ok) {
                  console.error(`Failed to fetch ad playlist: ${adItem.playlistUrl} - ${playlistResponse.status}`)
                  throw new Error(`Ad playlist fetch failed: ${playlistResponse.status}`)
                }
                
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
                  console.log(`Ad is ${gapDuration.toFixed(2)}s shorter than break duration, padding with slate`)
                  
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
                  // CRITICAL: Use actual ad duration for BOTH parameters
                  // This prevents cutting off the last few seconds of the ad
                  // The totalDuration is calculated from actual segment durations
                  const ssai = replaceSegmentsWithAds(
                    cleanOrigin,
                    scte35StartPDT,
                    adSegments,
                    totalDuration,        // Actual ad duration (for ad segment PDTs)
                    totalDuration         // Use actual ad duration (not SCTE-35 duration) for content resume
                  )
                  await this.env.BEACON_QUEUE.send(beaconMsg)
                  return new Response(ssai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
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