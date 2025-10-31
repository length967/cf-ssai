// VAST Parser Worker
// Parses VAST 3.0 and 4.2 XML, resolves wrappers, extracts tracking URLs

import type { 
  VASTResponse, VASTAd, VASTCreative, VASTMediaFile, VASTTracking, 
  VASTWrapper, VASTVersion, VASTParseRequest, VASTParseResponse,
  AdPod, AdItem
} from "./types"

export interface Env {
  VAST_CACHE: KVNamespace  // Cache parsed VAST
  ADS_BUCKET: R2Bucket     // Cache VAST XML
  VAST_TIMEOUT_MS?: string
  VAST_MAX_WRAPPER_DEPTH?: string
  AD_POD_BASE: string
}

/**
 * Fetch VAST XML from URL with caching
 */
async function fetchVAST(url: string, env: Env): Promise<string> {
  const timeoutMs = parseInt(env.VAST_TIMEOUT_MS || "2000", 10)
  
  // Try R2 cache first
  const cacheKey = `vast-xml-${hashString(url)}`
  try {
    const cached = await env.ADS_BUCKET.get(cacheKey)
    if (cached) {
      console.log(`VAST XML cache hit: ${url}`)
      return await cached.text()
    }
  } catch (err) {
    console.warn("R2 cache read error:", err)
  }
  
  // Fetch from external URL
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Cloudflare-SSAI-VAST-Parser/1.0"
      }
    })
    
    clearTimeout(timeout)
    
    if (!response.ok) {
      throw new Error(`VAST fetch failed: ${response.status}`)
    }
    
    const xml = await response.text()
    
    // Cache in R2 for 5 minutes
    env.ADS_BUCKET.put(cacheKey, xml, {
      httpMetadata: { contentType: "application/xml" },
      customMetadata: { fetchedAt: Date.now().toString() }
    }).catch(() => {}) // Fire and forget
    
    return xml
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(`VAST fetch error: ${err}`)
  }
}

/**
 * Parse VAST XML to structured format
 */
function parseVASTXML(xmlText: string): VASTResponse {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, "text/xml")
  
  // Check for parsing errors
  const parseError = doc.querySelector("parsererror")
  if (parseError) {
    throw new Error("VAST XML parsing error")
  }
  
  const vastElement = doc.querySelector("VAST")
  if (!vastElement) {
    throw new Error("No VAST root element found")
  }
  
  const version = (vastElement.getAttribute("version") || "3.0") as VASTVersion
  const ads: VASTAd[] = []
  const errors: string[] = []
  
  // Parse all <Ad> elements
  const adElements = vastElement.querySelectorAll("Ad")
  
  for (const adElement of Array.from(adElements)) {
    try {
      const ad = parseAd(adElement, version)
      if (ad) {
        ads.push(ad)
      }
    } catch (err) {
      errors.push(`Ad parsing error: ${err}`)
      console.error("Ad parsing error:", err)
    }
  }
  
  return { ads, version, errors: errors.length > 0 ? errors : undefined }
}

/**
 * Parse a single <Ad> element
 */
function parseAd(adElement: Element, version: VASTVersion): VASTAd | null {
  const id = adElement.getAttribute("id") || `ad-${Date.now()}`
  const sequence = adElement.getAttribute("sequence") ? parseInt(adElement.getAttribute("sequence")!, 10) : undefined
  
  // Check if this is a wrapper
  const wrapperElement = adElement.querySelector("Wrapper")
  if (wrapperElement) {
    return parseWrapper(adElement, id, sequence, version)
  }
  
  // Parse inline ad
  const inlineElement = adElement.querySelector("InLine")
  if (!inlineElement) {
    console.warn("No InLine or Wrapper found in Ad")
    return null
  }
  
  // Ad system and metadata
  const adSystem = inlineElement.querySelector("AdSystem")?.textContent || undefined
  const adTitle = inlineElement.querySelector("AdTitle")?.textContent || undefined
  const description = inlineElement.querySelector("Description")?.textContent || undefined
  const advertiser = inlineElement.querySelector("Advertiser")?.textContent || undefined
  const pricing = inlineElement.querySelector("Pricing")?.textContent || undefined
  const survey = inlineElement.querySelector("Survey")?.textContent || undefined
  
  // Error tracking
  const errorTracking = Array.from(inlineElement.querySelectorAll("Error"))
    .map(el => el.textContent?.trim())
    .filter(Boolean) as string[]
  
  // Impression tracking
  const impressionTracking = Array.from(inlineElement.querySelectorAll("Impression"))
    .map(el => el.textContent?.trim())
    .filter(Boolean) as string[]
  
  // Parse creatives
  const creatives: VASTCreative[] = []
  const creativeElements = inlineElement.querySelectorAll("Creative")
  
  for (const creativeElement of Array.from(creativeElements)) {
    const creative = parseCreative(creativeElement)
    if (creative) {
      creatives.push(creative)
    }
  }
  
  return {
    id,
    sequence,
    version,
    adSystem,
    adTitle,
    description,
    advertiser,
    pricing,
    survey,
    creatives,
    errorTracking: errorTracking.length > 0 ? errorTracking : undefined,
    impressionTracking: impressionTracking.length > 0 ? impressionTracking : undefined
  }
}

/**
 * Parse wrapper ad
 */
function parseWrapper(adElement: Element, id: string, sequence: number | undefined, version: VASTVersion): VASTAd {
  const wrapperElement = adElement.querySelector("Wrapper")!
  
  const vastAdTagURI = wrapperElement.querySelector("VASTAdTagURI")?.textContent?.trim() || ""
  
  const wrapper: VASTWrapper = {
    vastAdTagURI,
    fallbackOnNoAd: wrapperElement.querySelector("Fallback")?.getAttribute("fallbackOnNoAd") === "true",
    followAdditionalWrappers: true,
    allowMultipleAds: wrapperElement.getAttribute("allowMultipleAds") === "true"
  }
  
  // Error tracking
  const errorTracking = Array.from(wrapperElement.querySelectorAll("Error"))
    .map(el => el.textContent?.trim())
    .filter(Boolean) as string[]
  
  // Impression tracking (wrappers can add their own impressions)
  const impressionTracking = Array.from(wrapperElement.querySelectorAll("Impression"))
    .map(el => el.textContent?.trim())
    .filter(Boolean) as string[]
  
  return {
    id,
    sequence,
    version,
    creatives: [],  // Wrappers don't have creatives until resolved
    wrapper,
    errorTracking: errorTracking.length > 0 ? errorTracking : undefined,
    impressionTracking: impressionTracking.length > 0 ? impressionTracking : undefined
  }
}

/**
 * Parse a single <Creative> element
 */
function parseCreative(creativeElement: Element): VASTCreative | null {
  const id = creativeElement.getAttribute("id") || `creative-${Date.now()}`
  const sequence = creativeElement.getAttribute("sequence") ? parseInt(creativeElement.getAttribute("sequence")!, 10) : undefined
  const adId = creativeElement.getAttribute("adId") || undefined
  
  // Parse Linear creative (video)
  const linearElement = creativeElement.querySelector("Linear")
  if (!linearElement) {
    console.warn("Non-linear creative, skipping")
    return null
  }
  
  // Duration
  const durationText = linearElement.querySelector("Duration")?.textContent
  const duration = durationText ? parseDuration(durationText) : undefined
  
  // Media files
  const mediaFiles: VASTMediaFile[] = []
  const mediaFileElements = linearElement.querySelectorAll("MediaFile")
  
  for (const mfElement of Array.from(mediaFileElements)) {
    const mediaFile = parseMediaFile(mfElement)
    if (mediaFile) {
      mediaFiles.push(mediaFile)
    }
  }
  
  // Tracking events
  const trackingEvents: VASTTracking[] = []
  const trackingElements = linearElement.querySelectorAll("Tracking")
  
  for (const trackElement of Array.from(trackingElements)) {
    const event = trackElement.getAttribute("event")
    const url = trackElement.textContent?.trim()
    const offset = trackElement.getAttribute("offset") || undefined
    
    if (event && url) {
      trackingEvents.push({ event: event as any, url, offset })
    }
  }
  
  // Video clicks
  const videoClicksElement = linearElement.querySelector("VideoClicks")
  let videoClicks = undefined
  
  if (videoClicksElement) {
    const clickThrough = videoClicksElement.querySelector("ClickThrough")?.textContent?.trim()
    const clickTracking = Array.from(videoClicksElement.querySelectorAll("ClickTracking"))
      .map(el => el.textContent?.trim())
      .filter(Boolean) as string[]
    const customClick = Array.from(videoClicksElement.querySelectorAll("CustomClick"))
      .map(el => el.textContent?.trim())
      .filter(Boolean) as string[]
    
    videoClicks = {
      clickThrough,
      clickTracking: clickTracking.length > 0 ? clickTracking : undefined,
      customClick: customClick.length > 0 ? customClick : undefined
    }
  }
  
  return {
    id,
    sequence,
    adId,
    mediaFiles,
    trackingEvents,
    duration,
    videoClicks
  }
}

/**
 * Parse a <MediaFile> element
 */
function parseMediaFile(element: Element): VASTMediaFile | null {
  const url = element.textContent?.trim()
  if (!url) return null
  
  const delivery = element.getAttribute("delivery") as "progressive" | "streaming" || "progressive"
  const type = element.getAttribute("type") || "video/mp4"
  const width = element.getAttribute("width") ? parseInt(element.getAttribute("width")!, 10) : undefined
  const height = element.getAttribute("height") ? parseInt(element.getAttribute("height")!, 10) : undefined
  const bitrate = element.getAttribute("bitrate") ? parseInt(element.getAttribute("bitrate")!, 10) : undefined
  const codec = element.getAttribute("codec") || undefined
  
  return { url, delivery, type, width, height, bitrate, codec }
}

/**
 * Parse duration string (HH:MM:SS or HH:MM:SS.mmm)
 */
function parseDuration(durationStr: string): number {
  const parts = durationStr.split(":")
  if (parts.length !== 3) return 0
  
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Resolve VAST wrappers recursively
 */
async function resolveWrappers(
  vast: VASTResponse,
  env: Env,
  depth: number = 0
): Promise<VASTResponse> {
  const maxDepth = parseInt(env.VAST_MAX_WRAPPER_DEPTH || "5", 10)
  
  if (depth >= maxDepth) {
    console.warn(`Max wrapper depth (${maxDepth}) reached`)
    return vast
  }
  
  const resolvedAds: VASTAd[] = []
  
  for (const ad of vast.ads) {
    if (ad.wrapper) {
      console.log(`Resolving wrapper: ${ad.wrapper.vastAdTagURI}`)
      
      try {
        // Fetch wrapped VAST
        const wrappedXML = await fetchVAST(ad.wrapper.vastAdTagURI, env)
        const wrappedVAST = parseVASTXML(wrappedXML)
        
        // Recursively resolve
        const resolvedWrapped = await resolveWrappers(wrappedVAST, env, depth + 1)
        
        // Merge tracking from wrapper into wrapped ads
        for (const wrappedAd of resolvedWrapped.ads) {
          if (ad.impressionTracking) {
            wrappedAd.impressionTracking = [
              ...(ad.impressionTracking || []),
              ...(wrappedAd.impressionTracking || [])
            ]
          }
          if (ad.errorTracking) {
            wrappedAd.errorTracking = [
              ...(ad.errorTracking || []),
              ...(wrappedAd.errorTracking || [])
            ]
          }
          resolvedAds.push(wrappedAd)
        }
      } catch (err) {
        console.error(`Wrapper resolution failed: ${err}`)
        // Continue without this ad
      }
    } else {
      resolvedAds.push(ad)
    }
  }
  
  return { ...vast, ads: resolvedAds }
}

/**
 * Convert VAST to AdPod format
 */
function vastToAdPod(vast: VASTResponse, durationSec: number, env: Env): AdPod {
  const items: AdItem[] = []
  
  // Get all creatives from all ads
  const allCreatives = vast.ads.flatMap(ad => ad.creatives)
  
  // Group media files by bitrate
  const mediaByBitrate = new Map<number, VASTMediaFile>()
  
  for (const creative of allCreatives) {
    for (const mediaFile of creative.mediaFiles) {
      // Prefer HLS streams
      if (mediaFile.type.includes("mpegurl") || mediaFile.type.includes("m3u8")) {
        const bitrate = mediaFile.bitrate || 1600000  // Default bitrate
        if (!mediaByBitrate.has(bitrate) || mediaFile.type.includes("mpegurl")) {
          mediaByBitrate.set(bitrate, mediaFile)
        }
      }
    }
  }
  
  // If no HLS, use progressive (MP4)
  if (mediaByBitrate.size === 0) {
    for (const creative of allCreatives) {
      for (const mediaFile of creative.mediaFiles) {
        const bitrate = mediaFile.bitrate || 1600000
        if (!mediaByBitrate.has(bitrate)) {
          mediaByBitrate.set(bitrate, mediaFile)
        }
      }
    }
  }
  
  // Convert to AdItems
  for (const [bitrate, mediaFile] of mediaByBitrate) {
    items.push({
      adId: vast.ads[0]?.id || "vast-ad",
      bitrate,
      playlistUrl: mediaFile.url
    })
  }
  
  // Ensure we have at least standard bitrates
  if (items.length === 0) {
    // Fallback to slate
    items.push(
      { adId: "slate", bitrate: 800000, playlistUrl: `${env.AD_POD_BASE}/slate/v_800k/playlist.m3u8` },
      { adId: "slate", bitrate: 1600000, playlistUrl: `${env.AD_POD_BASE}/slate/v_1600k/playlist.m3u8` }
    )
  }
  
  return {
    podId: `vast-${vast.ads[0]?.id || Date.now()}`,
    durationSec,
    items
  }
}

/**
 * Extract all tracking URLs from VAST
 */
function extractTracking(vast: VASTResponse): VASTParseResponse["tracking"] {
  const impressions: string[] = []
  const quartiles: Record<string, string[]> = {
    start: [],
    firstQuartile: [],
    midpoint: [],
    thirdQuartile: [],
    complete: []
  }
  const clicks: string[] = []
  const errors: string[] = []
  
  for (const ad of vast.ads) {
    // Impression tracking
    if (ad.impressionTracking) {
      impressions.push(...ad.impressionTracking)
    }
    
    // Error tracking
    if (ad.errorTracking) {
      errors.push(...ad.errorTracking)
    }
    
    // Creative tracking
    for (const creative of ad.creatives) {
      for (const tracking of creative.trackingEvents) {
        if (tracking.event === "start") quartiles.start.push(tracking.url)
        else if (tracking.event === "firstQuartile") quartiles.firstQuartile.push(tracking.url)
        else if (tracking.event === "midpoint") quartiles.midpoint.push(tracking.url)
        else if (tracking.event === "thirdQuartile") quartiles.thirdQuartile.push(tracking.url)
        else if (tracking.event === "complete") quartiles.complete.push(tracking.url)
      }
      
      // Click tracking
      if (creative.videoClicks?.clickTracking) {
        clicks.push(...creative.videoClicks.clickTracking)
      }
    }
  }
  
  return {
    impressions,
    quartiles: quartiles as any,
    clicks: clicks.length > 0 ? clicks : undefined,
    errors: errors.length > 0 ? errors : undefined
  }
}

/**
 * Simple string hash for cache keys
 */
function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash  // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    
    // Health check
    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } })
    }
    
    // Parse VAST endpoint
    if (url.pathname === "/parse" && req.method === "POST") {
      try {
        const request = await req.json() as VASTParseRequest
        
        // Validate request
        if (!request.vastUrl && !request.vastXML) {
          return new Response(
            JSON.stringify({ error: "vastUrl or vastXML required" }),
            { status: 400, headers: { "content-type": "application/json" } }
          )
        }
        
        // Check cache
        const cacheKey = request.vastUrl ? `vast-parsed-${hashString(request.vastUrl)}` : null
        if (cacheKey) {
          const cached = await env.VAST_CACHE.get(cacheKey, "json")
          if (cached) {
            console.log("VAST parse cache hit")
            return new Response(JSON.stringify(cached), {
              headers: { "content-type": "application/json" }
            })
          }
        }
        
        // Fetch or use provided XML
        const vastXML = request.vastXML || await fetchVAST(request.vastUrl!, env)
        
        // Parse VAST
        let vast = parseVASTXML(vastXML)
        
        // Resolve wrappers
        vast = await resolveWrappers(vast, env, 0)
        
        // Convert to AdPod
        const pod = vastToAdPod(vast, request.durationSec, env)
        
        // Extract tracking
        const tracking = extractTracking(vast)
        
        const response: VASTParseResponse = {
          pod,
          tracking,
          vastResponse: vast
        }
        
        // Cache result for 5 minutes
        if (cacheKey) {
          await env.VAST_CACHE.put(cacheKey, JSON.stringify(response), {
            expirationTtl: 300
          })
        }
        
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" }
        })
      } catch (err) {
        console.error("VAST parsing error:", err)
        
        // Return slate fallback
        const fallback: VASTParseResponse = {
          pod: {
            podId: "slate",
            durationSec: 30,
            items: [
              { adId: "slate", bitrate: 800000, playlistUrl: `${env.AD_POD_BASE}/slate/v_800k/playlist.m3u8` },
              { adId: "slate", bitrate: 1600000, playlistUrl: `${env.AD_POD_BASE}/slate/v_1600k/playlist.m3u8` }
            ]
          },
          tracking: {
            impressions: [],
            quartiles: { start: [], firstQuartile: [], midpoint: [], thirdQuartile: [], complete: [] }
          },
          vastResponse: { ads: [], version: "3.0", errors: [String(err)] }
        }
        
        return new Response(JSON.stringify(fallback), {
          status: 200,  // Return 200 with fallback
          headers: { "content-type": "application/json" }
        })
      }
    }
    
    return new Response("Not found", { status: 404 })
  }
}

