import { addDaterangeInterstitial, insertDiscontinuity, replaceSegmentsWithAds, extractPDTs } from "./utils/hls"
import { signPath } from "./utils/sign"
import { parseSCTE35FromManifest, isAdBreakStart, getBreakDuration, findActiveBreak } from "./utils/scte35"
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

// -----------------------------------------------------------------------------
// Helper: fetch origin or return fallback variant
// -----------------------------------------------------------------------------
async function fetchOriginVariant(originUrl: string, channel: string, variant: string): Promise<string> {
  // Use per-channel origin URL
  const u = `${originUrl}/${encodeURIComponent(variant)}`
  try {
    const r = await fetch(u, { cf: { cacheTtl: 1, cacheEverything: true } })
    if (r.ok) return await r.text()
  } catch {}
  // DEV FALLBACK: simple 3-segment live-like variant
  const base = new Date(Date.now() - 8_000)
  const pdt = (d: Date) => d.toISOString()
  const seg = (i: number) =>
    `#EXT-X-PROGRAM-DATE-TIME:${pdt(new Date(base.getTime() + i * 4000))}\n#EXTINF:4.000,\nseg_${1000 + i}.m4s`
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:4",
    "#EXT-X-MEDIA-SEQUENCE:1000",
    seg(0),
    seg(1),
    seg(2),
    ""
  ].join("\n")
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
  // Match patterns like: v_1600k, v_800k, 1600k, etc.
  const match = variant.match(/(\d+)k/i)
  if (match) {
    return parseInt(match[1], 10) * 1000
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
  
  // Fallback: static slate pod (if service unavailable or in dev mode)
  console.warn("Using fallback slate pod - decision service unavailable")
  // Use per-channel ad pod base URL
  return {
    pod: {
      podId: "slate",
      durationSec,
      items: [
        { adId: "slate", bitrate: 800000, playlistUrl: `${adPodBase}/slate/v_800k/playlist.m3u8` },
        { adId: "slate", bitrate: 1600000, playlistUrl: `${adPodBase}/slate/v_1600k/playlist.m3u8` },
        { adId: "slate", bitrate: 2500000, playlistUrl: `${adPodBase}/slate/v_2500k/playlist.m3u8` }
      ]
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
          // Use per-channel ad pod base URL
          const podUrl: string =
            body?.pod_url || `${adPodBase}/${podId ?? "example-pod"}/v_1600k/playlist.m3u8`

          const now = Date.now()
          const s: AdState = {
            active: true,
            podId,
            podUrl,
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

      // Use per-channel origin URL
      const origin = await fetchOriginVariant(originUrl, channel, variant)

      // Load live ad state (if any) - this takes priority over other signals
      const adState = await loadAdState(this.state)
      const adActive = !!adState && Date.now() < adState.endsAt

      // Parse SCTE-35 signals from origin manifest
      const scte35Signals = parseSCTE35FromManifest(origin)
      const activeBreak = findActiveBreak(scte35Signals)

      // Determine ad insertion mode: SGAI (server-guided) or SSAI (server-side)
      // - force parameter explicitly sets mode
      // - otherwise detect client capability (iOS/Safari → SGAI, others → SSAI)
      const mode = force || (wantsSGAI(req) ? "sgai" : "ssai")

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
      } else if (activeBreak) {
        // SCTE-35 signal detected - use it
        shouldInsertAd = true
        breakDurationSec = getBreakDuration(activeBreak)
        adSource = "scte35"
        
        // Find the PDT timestamp for the break
        const pdts = extractPDTs(origin)
        if (pdts.length > 0) {
          scte35StartPDT = pdts[pdts.length - 1]  // Use most recent PDT near signal
        }
        
        console.log(`SCTE-35 break detected: duration=${breakDurationSec}s, pdt=${scte35StartPDT}`)
      } else if (isBreakMinute) {
        // Fallback to time-based schedule for testing
        shouldInsertAd = true
        adSource = "time"
        console.log("Time-based ad break (no SCTE-35 signal)")
      }

      // Only inject ads if conditions met
      if (shouldInsertAd) {
        const startISO = scte35StartPDT || new Date(Math.floor(now / 1000) * 1000).toISOString()
        
        // Extract viewer bitrate from variant and select matching ad pod
        const viewerBitrate = extractBitrate(variant)
        const adVariant = selectAdVariant(viewerBitrate)
        
        // Get ad decision from decision service (use per-channel ad pod base)
        const decisionResponse = await decision(this.env, adPodBase, channel, breakDurationSec, {
          variant,
          bitrate: viewerBitrate,
          scte35: activeBreak
        })
        
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
              duration: activeBreak.duration
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
          
          const sgai = addDaterangeInterstitial(
            origin,
            adActive ? (adState!.podId || "ad") : pod.podId,
            startISO,
            breakDurationSec,
            interstitialURI
          )
          
          await this.env.BEACON_QUEUE.send(beaconMsg)
          return new Response(sgai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
        } else {
          // SSAI: Replace content segments with ad segments
          
          if (scte35StartPDT) {
            // True SSAI: Replace segments at SCTE-35 marker position
            // In production, we'd fetch the actual ad segments here
            // For now, use placeholder segment URLs from the ad pod
            
            const adSegments = pod.items
              .filter(item => item.bitrate === viewerBitrate)
              .map(item => {
                // Generate segment URLs from playlist URL
                // In production, parse the playlist and extract segment URLs
                const baseUrl = item.playlistUrl.replace("/playlist.m3u8", "")
                return `${baseUrl}/seg_00001.m4s`  // Simplified for demo
              })
            
            if (adSegments.length > 0) {
              const ssai = replaceSegmentsWithAds(
                origin,
                scte35StartPDT,
                adSegments,
                breakDurationSec
              )
              await this.env.BEACON_QUEUE.send(beaconMsg)
              return new Response(ssai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
            }
          }
          
          // Fallback: Insert DISCONTINUITY only (legacy SSAI)
          const ssai = insertDiscontinuity(origin)
          await this.env.BEACON_QUEUE.send(beaconMsg)
          return new Response(ssai, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
        }
      }

      // Non-blocking cleanup of expired ad state
      if (adState && Date.now() >= adState.endsAt) {
        this.state.storage.delete(AD_STATE_KEY).catch(() => {})
      }

      // No ad break: return origin manifest unchanged
      return new Response(origin, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
    })
  }
}

// -----------------------------------------------------------------------------
// Export named class for Wrangler (important for binding)
// -----------------------------------------------------------------------------
export { ChannelDO as default }