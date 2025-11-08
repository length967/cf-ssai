// Minimal HLS helpers suitable for Workers

import {
  BoundaryValidation,
  IDRTimeline,
  IDRTimestamp,
  SnapDecision,
  snapCueToIdr,
  validateBoundaryError
} from "./idr"

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
  adSegments: Array<{url: string, duration: number}> | string[],
  adDuration: number,
  scte35Duration?: number,  // Optional: SCTE-35 duration if different from ad duration
  stableSkipCount?: number,  // Optional: Use pre-calculated skip count for stability
  options: ReplaceSegmentsWithAdsOptions = {}
): ReplaceSegmentsResult {
  // Use SCTE-35 duration for content skipping, or fall back to ad duration
  const contentSkipDuration = scte35Duration || adDuration
  const lines = variantText.split("\n")
  const output: string[] = []

  let boundaryInfo: ReplaceSegmentsBoundary | undefined
  let requestedCut: ReplaceSegmentsResult["requestedCut"]
  
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
      
      // Add DISCONTINUITY before ad
      output.push("#EXT-X-DISCONTINUITY")

      // Insert ad segments WITHOUT PDT tags
      // CRITICAL: Ad segment PDTs are unnecessary after DISCONTINUITY and can cause timeline issues
      // The DISCONTINUITY tag tells the player to reset its timeline tracking
      // Adding PDTs calculated from historical SCTE-35 time creates backwards jumps
      console.log(`Inserting ${adSegments.length} ad segments WITHOUT PDT tags (DISCONTINUITY resets timeline)`)

      for (let j = 0; j < adSegments.length; j++) {
        const segment = adSegments[j]

        // NO PDT TAG - let player handle timeline after DISCONTINUITY

        // Support both object format {url, duration} and legacy string format
        if (typeof segment === 'string') {
          // Legacy: calculate duration (fallback)
          const segmentDuration = adDuration / adSegments.length
          output.push(`#EXTINF:${segmentDuration.toFixed(3)},`)
          output.push(segment)
        } else {
          // New: use actual duration from ad playlist
          output.push(`#EXTINF:${segment.duration.toFixed(3)},`)
          output.push(segment.url)
        }
      }
      
      // Add DISCONTINUITY after ad
      output.push("#EXT-X-DISCONTINUITY")
      
      // IDR snapping support (optional)
      if (typeof options.cuePts90k === "number" && options.idrTimeline) {
        const decision = snapCueToIdr(options.idrTimeline, options.cuePts90k, {
          lookAheadPts: options.snapLookAheadPts
        })
        const validation = validateBoundaryError(decision, {
          tolerancePts: options.boundaryTolerancePts
        })
        boundaryInfo = { decision, validation }
        requestedCut = {
          cuePts90k: options.cuePts90k,
          snappedPts90k: decision.snappedPts,
          deltaPts: decision.deltaPts,
          deltaSeconds: decision.deltaSeconds,
          source: decision.source
        }

        try {
          options.recordBoundaryDecision?.(decision, validation)
        } catch (err) {
          console.warn("Failed to record boundary decision", err)
        }

        const deltaSecondsFormatted = decision.deltaSeconds.toFixed(3)
        console.log(
          `[IDR Snap] cuePts=${options.cuePts90k} snapped=${decision.snappedPts} ` +
          `delta=${decision.deltaPts} (${deltaSecondsFormatted}s) reason=${decision.reason} source=${decision.source}`
        )

        if (!validation.withinTolerance) {
          console.warn(
            `[IDR Snap] Boundary error ${validation.absoluteErrorSeconds.toFixed(3)}s ` +
            `exceeds tolerance ${validation.toleranceSeconds.toFixed(3)}s`
          )
        }
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

      // Insert the resume PDT before continuing with content segments
      if (resumePDT) {
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
    durationSkipped: actualSkippedDuration,
    boundary: boundaryInfo,
    requestedCut
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