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
  
  let foundMarker = false
  let segmentsReplaced = 0
  
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
      
      // Insert ad segments with actual durations AND PDT tags for timeline continuity
      let currentPDT = startPDT
      
      for (let j = 0; j < adSegments.length; j++) {
        const segment = adSegments[j]
        
        // Add PDT tag for this ad segment (maintains live stream timeline)
        output.push(`#EXT-X-PROGRAM-DATE-TIME:${currentPDT}`)
        
        // Support both object format {url, duration} and legacy string format
        let segmentDuration: number
        
        if (typeof segment === 'string') {
          // Legacy: calculate duration (fallback)
          segmentDuration = adDuration / adSegments.length
          output.push(`#EXTINF:${segmentDuration.toFixed(3)},`)
          output.push(segment)
        } else {
          // New: use actual duration from ad playlist
          segmentDuration = segment.duration
          output.push(`#EXTINF:${segment.duration.toFixed(3)},`)
          output.push(segment.url)
        }
        
        // Advance PDT for next segment
        currentPDT = addSecondsToTimestamp(currentPDT, segmentDuration)
      }
      
      // Add DISCONTINUITY after ad
      output.push("#EXT-X-DISCONTINUITY")
      
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
        // First request: calculate skip based on duration
        while (resumeIndex < lines.length && skippedDuration < contentSkipDuration) {
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
      
      // CRITICAL FIX: Calculate resume PDT as last ad PDT + total ad duration
      // This preserves linear timeline consistency and avoids playback jumps
      // The PDT timeline must be continuous: start -> ad segments -> resume
      const lastAdPDT = addSecondsToTimestamp(startPDT, adDuration)
      output.push(`#EXT-X-PROGRAM-DATE-TIME:${lastAdPDT}`)
      console.log(`Inserted calculated resume PDT for buffer continuity: ${lastAdPDT} (start: ${startPDT} + ${adDuration}s)`)
      
      // Update loop index to resume point
      i = resumeIndex - 1  // -1 because outer loop will increment
      
      // Return skip stats for persistence
      return {
        manifest: output.join("\n"),
        segmentsSkipped: skippedCount,
        durationSkipped: skippedDuration
      }
    }
    
    output.push(line)
  }
  
  // No ad insertion occurred, return original manifest
  return {
    manifest: output.join("\n"),
    segmentsSkipped: 0,
    durationSkipped: 0
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