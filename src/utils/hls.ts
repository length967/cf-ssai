// Minimal HLS helpers suitable for Workers

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
export function addDaterangeInterstitial(
  variantText: string,
  id: string,
  startDateISO: string,
  durationSec: number,
  assetURI: string,
  controls = "skip-restrictions=6"
) {
  const tag = `#EXT-X-DATERANGE:ID="${id}",CLASS="com.apple.hls.interstitial",START-DATE="${startDateISO}",DURATION=${durationSec.toFixed(
    3
  )},X-ASSET-URI="${assetURI}",X-PLAYOUT-CONTROLS="${controls}"`
  const lines = variantText.trim().split("\n")
  const insertAt = Math.max(0, lines.length - 6)
  lines.splice(insertAt, 0, tag)
  return lines.join("\n") + (variantText.endsWith("\n") ? "" : "\n")
}

/**
 * Add seconds to an ISO 8601 timestamp
 */
function addSecondsToTimestamp(isoTimestamp: string, seconds: number): string {
  const date = new Date(isoTimestamp)
  date.setMilliseconds(date.getMilliseconds() + seconds * 1000)
  return date.toISOString()
}

/** Ad segment metadata used during SSAI replacement. */
export interface AdSegmentInfo {
  url: string
  duration: number
  type?: 'ad' | 'slate'
}

/**
 * Skip plan describing how much origin content will be removed around a PDT marker.
 * This is calculated before inserting ad segments so that slate padding can be sized
 * to the snapped resume boundary.
 */
export interface SkipPlan {
  markerLineIndex: number
  skipStartIndex: number
  resumeContentIndex: number
  segmentsSkipped: number
  durationSkipped: number
  resumePDT?: string | null
  remainingSegments: number
  stableSkipCountUsed: boolean
  segmentsSearchedForPDT: number
}

export interface SkipPlanOptions {
  scte35Duration?: number
  stableSkipCount?: number
}

export interface ReplaceSegmentsOptions {
  adId?: string
  boundarySnap?: string
  cueDecodeStatus?: string
  pidContinuity?: string
  plannedDuration?: number
  durationError?: number
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

function normalizeAdSegments(
  adSegments: Array<{ url: string, duration: number, type?: 'ad' | 'slate' }> | string[],
  adDuration: number
): AdSegmentInfo[] {
  if (adSegments.length === 0) return []

  if (typeof adSegments[0] === 'string') {
    const urls = adSegments as string[]
    const perSegment = urls.length > 0 ? adDuration / urls.length : 0
    return urls.map(url => ({ url, duration: perSegment, type: 'ad' as const }))
  }

  return (adSegments as AdSegmentInfo[]).map(seg => ({ ...seg }))
}

function calculateSkipPlanFromLines(
  lines: string[],
  markerIndex: number,
  options: SkipPlanOptions
): SkipPlan | null {
  const plan: SkipPlan = {
    markerLineIndex: markerIndex,
    skipStartIndex: markerIndex + 1,
    resumeContentIndex: markerIndex + 1,
    segmentsSkipped: 0,
    durationSkipped: 0,
    resumePDT: null,
    remainingSegments: 0,
    stableSkipCountUsed: !!(options.stableSkipCount && options.stableSkipCount > 0),
    segmentsSearchedForPDT: 0
  }

  const targetDuration = options.scte35Duration ?? 0
  const stableSkipCount = options.stableSkipCount ?? 0

  let resumeIndex = markerIndex + 1
  let segmentsSeen = 0
  let skippedDuration = 0

  while (resumeIndex < lines.length) {
    const currentLine = lines[resumeIndex]

    if (currentLine.startsWith('#EXTINF:')) {
      const match = currentLine.match(/#EXTINF:([\d.]+)/)
      if (match) {
        skippedDuration += parseFloat(match[1])
      }
    }

    if (!currentLine.startsWith('#') && currentLine.trim().length > 0) {
      segmentsSeen++
      plan.segmentsSkipped = segmentsSeen
      plan.durationSkipped = skippedDuration

      if (plan.stableSkipCountUsed) {
        if (segmentsSeen >= stableSkipCount) {
          resumeIndex++
          break
        }
      } else if (skippedDuration >= targetDuration) {
        resumeIndex++
        break
      }
    }

    resumeIndex++
  }

  plan.resumeContentIndex = resumeIndex

  // Count remaining segments after resume point
  for (let j = resumeIndex; j < lines.length; j++) {
    if (!lines[j].startsWith('#') && lines[j].trim().length > 0) {
      plan.remainingSegments++
    }
  }

  // Find resume PDT within a limited window
  const MAX_SEGMENTS_TO_SEARCH = 15
  let searchIndex = resumeIndex
  let segmentsSearched = 0
  while (searchIndex < lines.length && segmentsSearched < MAX_SEGMENTS_TO_SEARCH) {
    const searchLine = lines[searchIndex]
    if (searchLine.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      plan.resumePDT = searchLine.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
      plan.resumeContentIndex = searchIndex + 1
      break
    }

    if (!searchLine.startsWith('#') && searchLine.trim().length > 0) {
      segmentsSearched++
    }

    searchIndex++
  }

  plan.segmentsSearchedForPDT = segmentsSearched

  return plan
}

export function calculateSkipPlan(
  variantText: string,
  scte35StartPDT: string,
  options: SkipPlanOptions = {}
): SkipPlan | null {
  const lines = variantText.split('\n')
  const markerIndex = lines.findIndex(line => line.startsWith('#EXT-X-PROGRAM-DATE-TIME:') && line.includes(scte35StartPDT))
  if (markerIndex === -1) {
    return null
  }

  return calculateSkipPlanFromLines(lines, markerIndex, options)
}

function buildClosingDateRangeTag(
  resumePDT: string,
  options: ReplaceSegmentsOptions,
  actualAdDuration: number,
  actualContentDuration: number,
  plannedDuration: number
): string {
  const durationError = options.durationError ?? Math.abs(actualAdDuration - plannedDuration)
  const attrs: string[] = []
  attrs.push(`ID="${options.adId ? `${options.adId}-return` : 'ssai-return'}"`)
  attrs.push('CLASS="com.apple.hls.scte35.in"')
  attrs.push(`START-DATE="${resumePDT}"`)
  attrs.push('SCTE35-IN=YES')
  attrs.push('DURATION=0.000')
  attrs.push(`X-PLANNED-DURATION=${plannedDuration.toFixed(3)}`)
  attrs.push(`X-ACTUAL-AD-DURATION=${actualAdDuration.toFixed(3)}`)
  attrs.push(`X-ACTUAL-CONTENT-DURATION=${actualContentDuration.toFixed(3)}`)
  attrs.push(`X-DURATION-ERROR=${durationError.toFixed(3)}`)
  if (options.boundarySnap) {
    attrs.push(`X-BOUNDARY-SNAP="${options.boundarySnap}"`)
  }
  if (options.cueDecodeStatus) {
    attrs.push(`X-CUE-STATUS="${options.cueDecodeStatus}"`)
  }
  if (options.pidContinuity) {
    attrs.push(`X-PID-CONTINUITY="${options.pidContinuity}"`)
  }
  return `#EXT-X-DATERANGE:${attrs.join(',')}`
}

/**
 * Replace content segments with ad segments for true SSAI
 * Inserts DISCONTINUITY tags before and after ad pod and records telemetry
 */
export function replaceSegmentsWithAds(
  variantText: string,
  scte35StartPDT: string,
  adSegments: Array<{url: string, duration: number, type?: 'ad' | 'slate'}> | string[],
  adDuration: number,
  scte35Duration?: number,
  stableSkipCount?: number,
  options: ReplaceSegmentsOptions = {}
): { manifest: string, segmentsSkipped: number, durationSkipped: number, actualAdDuration: number } {
  const lines = variantText.split('\n')
  const output: string[] = []
  const normalizedSegments = normalizeAdSegments(adSegments, adDuration)
  const actualAdDuration = normalizedSegments.reduce((sum, seg) => sum + seg.duration, 0)
  const plannedDuration = options.plannedDuration ?? scte35Duration ?? actualAdDuration

  // Detect actual segment duration from content manifest
  const contentSegmentDuration = getAverageSegmentDuration(lines)
  const segmentsToReplace = Math.ceil(plannedDuration / contentSegmentDuration)
  console.log(`Ad duration: ${actualAdDuration}s, Planned duration: ${plannedDuration}s, Content segment duration: ${contentSegmentDuration}s, Segments to skip: ${segmentsToReplace}`)

  let segmentsReplaced = 0
  let actualSkippedDuration = 0
  let processedMarker = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!processedMarker && line.startsWith('#EXT-X-PROGRAM-DATE-TIME:') && line.includes(scte35StartPDT)) {
      output.push(line)
      const plan = calculateSkipPlanFromLines(lines, i, {
        scte35Duration: scte35Duration ?? plannedDuration,
        stableSkipCount
      })

      if (!plan || plan.segmentsSkipped === 0) {
        console.warn(`⚠️  Unable to calculate skip plan for PDT ${scte35StartPDT}`)
        return { manifest: variantText, segmentsSkipped: 0, durationSkipped: 0, actualAdDuration }
      }

      if (plan.remainingSegments === 0) {
        console.error('❌ No content segments remaining after ad insertion - manifest window rolled past break')
        return { manifest: variantText, segmentsSkipped: 0, durationSkipped: 0, actualAdDuration }
      }

      if (!plan.resumePDT) {
        console.error('❌ Could not locate resume PDT within search window, aborting SSAI insertion')
        return { manifest: variantText, segmentsSkipped: 0, durationSkipped: 0, actualAdDuration }
      }

      console.log(`Calculated skip plan: skip ${plan.segmentsSkipped} segments (${plan.durationSkipped.toFixed(3)}s), resume PDT ${plan.resumePDT}`)

      output.push('#EXT-X-DISCONTINUITY')
      console.log(`Inserting ${normalizedSegments.length} ad segments WITHOUT PDT tags (DISCONTINUITY resets timeline)`)
      for (const segment of normalizedSegments) {
        output.push(`#EXTINF:${segment.duration.toFixed(3)},`)
        output.push(segment.url)
      }
      output.push('#EXT-X-DISCONTINUITY')

      output.push(`#EXT-X-PROGRAM-DATE-TIME:${plan.resumePDT}`)
      const closingTag = buildClosingDateRangeTag(
        plan.resumePDT,
        options,
        actualAdDuration,
        plan.durationSkipped,
        plannedDuration
      )
      output.push(closingTag)

      i = plan.resumeContentIndex - 1
      segmentsReplaced = plan.segmentsSkipped
      actualSkippedDuration = plan.durationSkipped
      processedMarker = true
      continue
    }

    output.push(line)
  }

  if (!processedMarker) {
    console.warn(`⚠️  SCTE-35 PDT not found in manifest: ${scte35StartPDT} - ad break has rolled out of live window`)
  } else {
    console.log(`✅ Ad insertion completed: ${segmentsReplaced} segments replaced`)
  }

  return {
    manifest: output.join('\n'),
    segmentsSkipped: segmentsReplaced,
    durationSkipped: actualSkippedDuration,
    actualAdDuration
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