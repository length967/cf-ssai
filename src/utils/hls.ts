// Minimal HLS helpers suitable for Workers
declare const atob: (data: string) => string

export type VariantInfo = { bandwidth?: number; resolution?: string; uri: string; isVideo?: boolean }

/**
 * Extract bitrates (in kbps) from HLS master manifest
 * Returns sorted array of bitrates for transcoding ladder matching
 * Filters out audio-only variants (< 200 kbps or no video codec/resolution)
 */
export function extractBitrates(masterManifest: string): number[] {
  const lines = masterManifest.split('\n')
  const variants = parseVariant(lines)
  
  // Extract bandwidths and convert from bps to kbps
  // Filter out audio-only variants (isVideo=false or very low bitrate)
  const bitrates = variants
    .filter(v => v.isVideo !== false) // Keep only video variants
    .map(v => v.bandwidth)
    .filter((bw): bw is number => bw !== undefined)
    .map(bw => Math.round(bw / 1000)) // Convert bps to kbps
    .filter(kbps => kbps >= 200) // Extra safety: filter very low bitrates (audio-only)
    .sort((a, b) => a - b) // Sort ascending
  
  // Remove duplicates
  return Array.from(new Set(bitrates))
}

/** Parse #EXT-X-STREAM-INF entries into a simple list */
export function parseVariant(lines: string[]): VariantInfo[] {
  const out: VariantInfo[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("#EXT-X-STREAM-INF")) {
      const attrs = Object.fromEntries(
        l
          .split(":")[1]
          .split(",")
          .map((kv) => {
            const idx = kv.indexOf("=")
            const k = kv.slice(0, idx)
            const v = kv.slice(idx + 1).replace(/^\"|\"$/g, "")
            return [k, v]
          })
      ) as any
      const uri = (lines[i + 1] || "").trim()
      
      // Check if this is video variant (has resolution OR video codec)
      const hasResolution = !!attrs["RESOLUTION"]
      const codecs = attrs["CODECS"] || ""
      const hasVideoCodec = codecs.includes("avc") || codecs.includes("hvc") || codecs.includes("vp")
      const isVideoVariant = hasResolution || hasVideoCodec
      
      out.push({
        bandwidth: attrs["BANDWIDTH"] ? Number(attrs["BANDWIDTH"]) : undefined,
        resolution: attrs["RESOLUTION"],
        uri,
        isVideo: isVideoVariant  // Add flag to identify video variants
      })
    }
  }
  return out
}

/** Insert a DISCONTINUITY marker before the last media segment.
 *  Used as fallback when ad playlist fetch fails.
 *  DEPRECATED: This is a legacy fallback path only.
 */
export function insertDiscontinuity(variantText: string): string {
  const lines = variantText.split("\n")
  
  // Inject before tail media segment
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (!l.startsWith("#") && l.trim().length > 0) {
      // Insert just before this URI line
      lines.splice(i, 0, "#EXT-X-DISCONTINUITY")
      break
    }
  }
  return lines.join("\n")
}

/** Add an HLS Interstitial DATERANGE for SGAI-capable clients. */
type DaterangeAttributeValue = string | number | boolean

export interface InterstitialCueConfig {
  id: string
  startDateISO: string
  durationSec: number
  assetURI: string
  controls?: string
  baseAttributes?: Record<string, DaterangeAttributeValue>
  cueInId?: string
  scte35Payload?: string
}

function formatDaterangeLine(attrs: Record<string, DaterangeAttributeValue>): string {
  const parts: string[] = []
  for (const [key, rawValue] of Object.entries(attrs)) {
    if (rawValue === undefined || rawValue === null) continue
    let encoded: string
    if (typeof rawValue === "number") {
      const value = Number.isFinite(rawValue)
        ? rawValue % 1 === 0
          ? rawValue.toString()
          : rawValue.toFixed(3)
        : rawValue.toString()
      encoded = value
    } else if (typeof rawValue === "boolean") {
      encoded = rawValue ? "YES" : "NO"
    } else {
      encoded = `"${rawValue.replace(/"/g, '\\"')}"`
    }
    parts.push(`${key}=${encoded}`)
  }
  return `#EXT-X-DATERANGE:${parts.join(",")}`
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "").trim()
  if (typeof atob === "function") {
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return Uint8Array.from(Buffer.from(clean, "base64"))
}

function ensureHexEncodedScte35(payload?: string): string | undefined {
  if (!payload) return undefined
  const trimmed = payload.trim()
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return `0x${trimmed.slice(2).toLowerCase()}`
  }
  if (trimmed.toUpperCase() === "YES") {
    return "0x0"
  }
  try {
    const bytes = decodeBase64ToBytes(trimmed)
    if (!bytes.length) return "0x0"
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
    return `0x${hex}`
  } catch {
    return "0x0"
  }
}

function buildBaseAttributes(config: InterstitialCueConfig): Record<string, DaterangeAttributeValue> {
  const attrs: Record<string, DaterangeAttributeValue> = {}
  if (config.baseAttributes) {
    for (const [key, value] of Object.entries(config.baseAttributes)) {
      if (value === undefined || value === null) continue
      attrs[key] = value
    }
  }

  attrs["ID"] = typeof attrs["ID"] === "string" ? attrs["ID"] : config.id
  attrs["CLASS"] = attrs["CLASS"] || "com.apple.hls.interstitial"
  attrs["START-DATE"] = config.startDateISO
  const durationStr = Number.isFinite(config.durationSec)
    ? config.durationSec.toFixed(3)
    : String(config.durationSec)
  attrs["DURATION"] = durationStr
  if ("PLANNED-DURATION" in attrs) {
    attrs["PLANNED-DURATION"] = durationStr
  }
  attrs["X-ASSET-URI"] = config.assetURI
  if (config.controls || !attrs["X-PLAYOUT-CONTROLS"]) {
    attrs["X-PLAYOUT-CONTROLS"] = config.controls || "skip-restrictions=6"
  }

  return attrs
}

export function renderInterstitialCueOut(config: InterstitialCueConfig): string {
  const attrs = buildBaseAttributes(config)
  const existing = typeof attrs["SCTE35-OUT"] === "string" ? (attrs["SCTE35-OUT"] as string) : undefined
  delete attrs["SCTE35-OUT"]
  delete attrs["SCTE35-IN"]
  const encoded = ensureHexEncodedScte35(config.scte35Payload ?? existing)
  if (encoded) {
    attrs["SCTE35-OUT"] = encoded
  }
  return formatDaterangeLine(attrs)
}

export function renderInterstitialCueIn(config: InterstitialCueConfig): string {
  const attrs = buildBaseAttributes(config)
  attrs["ID"] = config.cueInId || `${config.id}:complete`
  const completionStart = addSecondsToTimestamp(config.startDateISO, config.durationSec)
  attrs["START-DATE"] = completionStart
  attrs["END-ON-NEXT"] = true
  attrs["DURATION"] = "0.000"
  if ("PLANNED-DURATION" in attrs) {
    attrs["PLANNED-DURATION"] = "0.000"
  }
  delete attrs["SCTE35-OUT"]
  const existing = typeof attrs["SCTE35-IN"] === "string" ? (attrs["SCTE35-IN"] as string) : undefined
  const encoded = ensureHexEncodedScte35(config.scte35Payload ?? existing)
  if (encoded) {
    attrs["SCTE35-IN"] = encoded
  }
  return formatDaterangeLine(attrs)
}

function renderCueOutTag(durationSec: number, payload?: string): string {
  const normalized = ensureHexEncodedScte35(payload)
  const parts = [`DURATION=${Number.isFinite(durationSec) ? durationSec.toFixed(3) : String(durationSec)}`]
  if (normalized) {
    parts.push(`SCTE35=${normalized}`)
  }
  return `#EXT-X-CUE-OUT:${parts.join(",")}`
}

function renderCueInTag(): string {
  return "#EXT-X-CUE-IN"
}

export function injectInterstitialCues(manifest: string, config: InterstitialCueConfig): string {
  const newlineTerminated = manifest.endsWith("\n")
  const body = newlineTerminated ? manifest.slice(0, -1) : manifest
  const lines = body.length ? body.split("\n") : []
  const insertAt = Math.max(0, lines.length - 6)
  const basePayload = config.scte35Payload ||
    (config.baseAttributes && typeof config.baseAttributes["SCTE35-OUT"] === "string"
      ? (config.baseAttributes["SCTE35-OUT"] as string)
      : undefined)
  const encodedPayload = ensureHexEncodedScte35(basePayload)
  const renderConfig: InterstitialCueConfig = {
    ...config,
    scte35Payload: encodedPayload ?? config.scte35Payload
  }

  const cueOutRange = renderInterstitialCueOut(renderConfig)
  const cueInRange = renderInterstitialCueIn(renderConfig)
  const cueOut = renderCueOutTag(config.durationSec, encodedPayload ?? config.scte35Payload)
  const cueIn = renderCueInTag()

  const updated = [
    ...lines.slice(0, insertAt),
    cueOutRange,
    cueOut,
    cueInRange,
    cueIn,
    ...lines.slice(insertAt)
  ]

  const joined = updated.join("\n")
  return newlineTerminated ? `${joined}\n` : joined
}

function inferSegmentExtension(uri: string): string | null {
  const clean = uri.split(/[?#]/)[0]
  const idx = clean.lastIndexOf(".")
  if (idx === -1) return null
  return clean.slice(idx + 1).toLowerCase()
}

/**
 * Add seconds to an ISO 8601 timestamp
 */
function addSecondsToTimestamp(isoTimestamp: string, seconds: number): string {
  const date = new Date(isoTimestamp)
  date.setMilliseconds(date.getMilliseconds() + seconds * 1000)
  return date.toISOString()
}

/**
 * Parse average segment duration from manifest
 */
function getAverageSegmentDuration(lines: string[]): number {
  const durations: number[] = []
  
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/#EXTINF:([\d.]+)/)
      if (match) {
        durations.push(parseFloat(match[1]))
      }
    }
    // Stop after collecting 10 samples for efficiency
    if (durations.length >= 10) break
  }
  
  if (durations.length === 0) {
    console.warn("No segment durations found in manifest, assuming 2 seconds")
    return 2.0  // Fallback default
  }
  
  // Return average
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
  console.log(`Detected average content segment duration: ${avg.toFixed(3)}s (from ${durations.length} samples)`)
  return avg
}

/**
 * Replace content segments with ad segments for true SSAI
 * Inserts DISCONTINUITY tags before and after ad pod
 * 
 * @param variantText - Original manifest
 * @param scte35StartPDT - PDT where ad break starts
 * @param adSegments - Ad segments with actual durations
 * @param adDuration - Actual ad duration (sum of ad segment durations)
 * @param scte35Duration - SCTE-35 break duration (how much content to skip)
 * @param stableSkipCount - Optional: Pre-calculated stable segment skip count from ad state
 * @returns Object with manifest and skip statistics
 */
export function replaceSegmentsWithAds(
  variantText: string,
  scte35StartPDT: string,
  adSegments: Array<{url: string, duration: number}> | string[],
  adDuration: number,
  scte35Duration?: number,  // Optional: SCTE-35 duration if different from ad duration
  stableSkipCount?: number  // Optional: Use pre-calculated skip count for stability
): { manifest: string, segmentsSkipped: number, durationSkipped: number } {
  // Use SCTE-35 duration for content skipping, or fall back to ad duration
  const contentSkipDuration = scte35Duration || adDuration
  const lines = variantText.split("\n")
  const output: string[] = []
  
  // Detect actual segment duration from content manifest
  const contentSegmentDuration = getAverageSegmentDuration(lines)
  const segmentsToReplace = Math.ceil(contentSkipDuration / contentSegmentDuration)
  
  console.log(`Ad duration: ${adDuration}s, SCTE-35 duration: ${contentSkipDuration}s, Content segment duration: ${contentSegmentDuration}s, Segments to skip: ${segmentsToReplace}`)

  // DISABLED: Manifest window awareness was causing inconsistent skip counts across variants
  // When variants are requested at slightly different times (normal for HLS), they would
  // see different manifest windows and skip different amounts of content, causing timeline desync
  // Instead, we always skip the full SCTE-35 duration from wherever we find the marker
  const effectiveSkipDuration = contentSkipDuration

  let foundMarker = false
  let segmentsReplaced = 0
  let actualSkippedDuration = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Look for SCTE-35 marker or PDT that matches start time
    if (!foundMarker && line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && line.includes(scte35StartPDT)) {
      foundMarker = true
      output.push(line)  // Keep the PDT
      
      // Parse the starting PDT timestamp for ad timeline continuity
      const startPDT = line.replace("#EXT-X-PROGRAM-DATE-TIME:", "").trim()
      
      const startDate = new Date(startPDT)

      let firstContentExtension: string | null = null
      for (let lookAhead = i + 1; lookAhead < lines.length; lookAhead++) {
        const candidate = lines[lookAhead]
        if (!candidate.startsWith('#') && candidate.trim().length > 0) {
          firstContentExtension = inferSegmentExtension(candidate)
          break
        }
      }

      let adExtension: string | null = null
      const adLines: string[] = []

      console.log(`Inserting ${adSegments.length} ad segments without PDT tags (evaluating need for DISCONTINUITY)`)

      for (let j = 0; j < adSegments.length; j++) {
        const segment = adSegments[j]
        let url: string
        let durationValue: number
        if (typeof segment === 'string') {
          durationValue = adDuration / adSegments.length
          url = segment
        } else {
          durationValue = segment.duration
          url = segment.url
        }

        if (!adExtension) {
          adExtension = inferSegmentExtension(url)
        }

        adLines.push(`#EXTINF:${durationValue.toFixed(3)},`)
        adLines.push(url)
      }
      
      // CRITICAL FIX: Use stable skip count if provided, otherwise calculate
      // This ensures all concurrent requests skip the same segments
      let skippedDuration = 0
      let skippedCount = 0
      const skipStartIndex = i
      let resumeIndex = i + 1
      
      if (stableSkipCount !== undefined && stableSkipCount > 0) {
        // Use pre-calculated stable skip count (from ad state persistence)
        console.log(`Using stable skip count: ${stableSkipCount} segments (cached from first request)`)
        
        // Skip exactly stableSkipCount segments
        let segmentsSeen = 0
        while (resumeIndex < lines.length && segmentsSeen < stableSkipCount) {
          const line = lines[resumeIndex]
          
          // Parse EXTINF duration for tracking
          if (line.startsWith('#EXTINF:')) {
            const match = line.match(/#EXTINF:([\d.]+)/)
            if (match) {
              skippedDuration += parseFloat(match[1])
            }
          }
          
          // Count actual segment URIs (not tags)
          if (!line.startsWith('#') && line.trim().length > 0) {
            segmentsSeen++
          }
          
          resumeIndex++
        }
        skippedCount = segmentsSeen
      } else {
        // First request: calculate skip based on duration (adjusted for window movement)
        const targetSkipDuration = effectiveSkipDuration
        while (resumeIndex < lines.length && skippedDuration < targetSkipDuration) {
          const line = lines[resumeIndex]
          
          // Parse EXTINF duration for this segment
          if (line.startsWith('#EXTINF:')) {
            const match = line.match(/#EXTINF:([\d.]+)/)
            if (match) {
              const segDuration = parseFloat(match[1])
              skippedDuration += segDuration
            }
          }
          
          // Count actual segment URIs (not tags)
          if (!line.startsWith('#') && line.trim().length > 0) {
            skippedCount++
          }
          
          resumeIndex++
        }
      }
      
      console.log(`Skipped ${skippedCount} content segments (${skippedDuration.toFixed(2)}s of ${contentSkipDuration}s target) from index ${skipStartIndex} to ${resumeIndex}`)

      // CRITICAL FIX: Validate that we have enough remaining content segments
      // Count remaining segments after the resume point
      let remainingSegments = 0
      for (let j = resumeIndex; j < lines.length; j++) {
        if (!lines[j].startsWith('#') && lines[j].trim().length > 0) {
          remainingSegments++
        }
      }

      console.log(`Remaining content segments after ad break: ${remainingSegments}`)

      // CRITICAL: If no content segments remain, the manifest window has moved past the ad break
      // Return with segmentsSkipped=0 to trigger SGAI fallback in the caller
      if (remainingSegments === 0) {
        console.error(`❌ No content segments remaining after ad insertion - manifest window has rolled past ad break`)
        console.error(`   Ad started at ${startPDT}, tried to skip ${skippedDuration.toFixed(2)}s, but manifest has no segments left`)
        return {
          manifest: variantText,  // Return original manifest unmodified
          segmentsSkipped: 0,      // Signal failure to trigger SGAI fallback
          durationSkipped: 0
        }
      }

      // CRITICAL FIX: Find and preserve the ACTUAL PDT from the resume segment
      // DO NOT calculate resume PDT - the origin stream clock kept running during the ad break
      // We must use the origin's timestamp to avoid timeline discontinuities
      let resumePDT: string | null = null
      let searchIndex = resumeIndex
      let segmentsSearched = 0
      const MAX_SEGMENTS_TO_SEARCH = 15  // Search up to 15 segments (handles sparse PDT tags)

      // Look ahead to find the next PDT tag from the origin manifest
      // Count SEGMENTS not lines (sparse PDT manifests have ~1 PDT per 10 segments)
      while (searchIndex < lines.length && !resumePDT && segmentsSearched < MAX_SEGMENTS_TO_SEARCH) {
        const searchLine = lines[searchIndex]

        if (searchLine.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
          resumePDT = searchLine.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
          console.log(`✅ Found origin resume PDT: ${resumePDT} (searched ${segmentsSearched} segments)`)
          break
        }

        // Count actual segment URLs (not comment lines)
        if (!searchLine.startsWith('#') && searchLine.trim().length > 0) {
          segmentsSearched++
        }

        searchIndex++
      }

      if (!resumePDT && segmentsSearched >= MAX_SEGMENTS_TO_SEARCH) {
        console.warn(`⚠️  Could not find resume PDT after searching ${segmentsSearched} segments`)
      }

      let resumeSegmentExtension: string | null = null
      for (let probe = resumeIndex; probe < lines.length; probe++) {
        const candidate = lines[probe]
        if (!candidate.startsWith('#') && candidate.trim().length > 0) {
          resumeSegmentExtension = inferSegmentExtension(candidate)
          break
        }
      }

      // Insert the resume PDT before continuing with content segments
      if (resumePDT) {
        let needsDiscontinuity = false

        if (adExtension && firstContentExtension && adExtension !== firstContentExtension) {
          needsDiscontinuity = true
          console.log(`ℹ️  Detected segment container change from ${firstContentExtension} to ${adExtension} (pre-ad)`)
        }

        if (adExtension && resumeSegmentExtension && adExtension !== resumeSegmentExtension) {
          needsDiscontinuity = true
          console.log(`ℹ️  Detected segment container change from ad (${adExtension}) to content (${resumeSegmentExtension})`)
        }

        const resumeDate = new Date(resumePDT)
        if (!Number.isNaN(resumeDate.getTime()) && !Number.isNaN(startDate.getTime())) {
          const expectedResume = startDate.getTime() + skippedDuration * 1000
          const delta = Math.abs(resumeDate.getTime() - expectedResume)
          if (delta > 500) {
            console.warn(`⚠️  PROGRAM-DATE-TIME continuity delta ${delta}ms exceeds tolerance, inserting DISCONTINUITY`)
            needsDiscontinuity = true
          }
        } else {
          console.warn(`⚠️  Unable to evaluate PDT continuity (start=${startPDT}, resume=${resumePDT})`)
        }

        if (needsDiscontinuity) {
          output.push('#EXT-X-DISCONTINUITY')
        }

        for (const adLine of adLines) {
          output.push(adLine)
        }

        if (needsDiscontinuity) {
          output.push('#EXT-X-DISCONTINUITY')
        }

        // Use the ACTUAL PDT from origin - this preserves timeline continuity
        output.push(`#EXT-X-PROGRAM-DATE-TIME:${resumePDT}`)
        console.log(`✅ Inserted origin resume PDT: ${resumePDT} (start: ${startPDT}, skipped: ${skippedDuration.toFixed(2)}s, ad: ${adDuration.toFixed(2)}s)`)
      } else {
        // CRITICAL: Cannot find origin PDT - this will cause timeline issues
        // Better to fail gracefully and trigger SGAI fallback than create intermittent stalls
        console.error(`❌ CRITICAL: Cannot find origin resume PDT within search window`)
        console.error(`   SCTE-35 start: ${startPDT}, skipped: ${skippedDuration.toFixed(2)}s`)
        console.error(`   This likely means sparse PDT tags or SCTE-35 signal is too old`)
        console.error(`   Failing gracefully to trigger SGAI fallback`)

        return {
          manifest: variantText,  // Return original manifest unmodified
          segmentsSkipped: 0,     // Signal failure to trigger SGAI fallback
          durationSkipped: 0
        }
      }

      // Update loop index to resume point and CONTINUE processing remaining segments
      i = resumeIndex - 1  // -1 because outer loop will increment
      foundMarker = true  // Mark as processed to prevent duplicate insertion
      segmentsReplaced = skippedCount
      actualSkippedDuration = skippedDuration

      // CRITICAL: DON'T return here - continue loop to append remaining content segments!
      continue
    }

    output.push(line)
  }
  
  // Return final manifest with skip stats (if ad was inserted) or zeros (if PDT not found)
  if (segmentsReplaced > 0) {
    console.log(`✅ Ad insertion completed: ${segmentsReplaced} segments replaced`)
  } else {
    console.warn(`⚠️  SCTE-35 PDT not found in manifest: ${scte35StartPDT} - ad break has rolled out of live window`)
  }

  return {
    manifest: output.join("\n"),
    segmentsSkipped: segmentsReplaced,
    durationSkipped: actualSkippedDuration
  }
}

/**
 * Extract Program Date Time values from manifest
 */
export function extractPDTs(variantText: string): string[] {
  const lines = variantText.split("\n")
  const pdts: string[] = []
  
  for (const line of lines) {
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      const pdt = line.replace("#EXT-X-PROGRAM-DATE-TIME:", "").trim()
      pdts.push(pdt)
    }
  }
  
  return pdts
}

/**
 * Find segment at specific PDT timestamp
 */
export function findSegmentAtPDT(variantText: string, targetPDT: string): number {
  const lines = variantText.split("\n")
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-PROGRAM-DATE-TIME:") && lines[i].includes(targetPDT)) {
      // Return the index of the next media segment
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith("#") && lines[j].trim().length > 0) {
          return j
        }
      }
    }
  }
  
  return -1
}

/**
 * Calculate total duration of segments in manifest
 */
export function calculateManifestDuration(variantText: string): number {
  const lines = variantText.split("\n")
  let totalDuration = 0
  
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/EXTINF:([\d.]+)/)
      if (match) {
        totalDuration += parseFloat(match[1])
      }
    }
  }
  
  return totalDuration
}