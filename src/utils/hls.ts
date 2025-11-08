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

  // Find resume PDT - search through ALL remaining manifest lines
  // PDT tags can be sparse (40-90 segments apart in some streams)
  // CRITICAL: Must search entire manifest, not just a limited window
  let searchIndex = resumeIndex
  let segmentsSearched = 0
  while (searchIndex < lines.length) {
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

  // If no PDT found in manifest, calculate expected resume PDT
  // This is CRITICAL for SSAI to work when PDT tags are sparse or manifest window is short
  if (!plan.resumePDT && lines[markerIndex]) {
    const markerLine = lines[markerIndex]
    if (markerLine.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const startPDT = markerLine.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
      try {
        const startTime = new Date(startPDT).getTime()
        // Calculate expected resume time based on actual duration skipped
        const expectedResumeTime = startTime + (plan.durationSkipped * 1000)
        const calculatedPDT = new Date(expectedResumeTime).toISOString()
        plan.resumePDT = calculatedPDT
        console.log(`✅ Calculated resume PDT: ${calculatedPDT} (start=${startPDT}, skipped=${plan.durationSkipped}s)`)
      } catch (e) {
        console.warn(`Failed to calculate resume PDT:`, e)
      }
    }
  }

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
export interface ReplaceSegmentsWithAdsOptions {
  cuePts90k?: number
  idrTimeline?: IDRTimeline | IDRTimestamp[]
  recordBoundaryDecision?: (decision: SnapDecision, validation: BoundaryValidation) => void
  snapLookAheadPts?: number
  boundaryTolerancePts?: number
}

export interface ReplaceSegmentsBoundary {
  decision: SnapDecision
  validation: BoundaryValidation
}

export interface ReplaceSegmentsResult {
  manifest: string
  segmentsSkipped: number
  durationSkipped: number
  boundary?: ReplaceSegmentsBoundary
  requestedCut?: {
    cuePts90k: number
    snappedPts90k: number
    deltaPts: number
    deltaSeconds: number
    source: string
  }
}

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