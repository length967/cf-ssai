// Minimal HLS helpers suitable for Workers

export type VariantInfo = { bandwidth?: number; resolution?: string; uri: string }

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
            const v = kv.slice(idx + 1).replace(/^"|"$/g, "")
            return [k, v]
          })
      ) as any
      const uri = (lines[i + 1] || "").trim()
      out.push({
        bandwidth: attrs["BANDWIDTH"] ? Number(attrs["BANDWIDTH"]) : undefined,
        resolution: attrs["RESOLUTION"],
        uri,
      })
    }
  }
  return out
}

/** Insert a DISCONTINUITY marker.
 *  If insertAfterPDT is provided, place it immediately after that PDT line.
 *  Otherwise, inject before the last media segment to simulate an ad splice.
 */
export function insertDiscontinuity(variantText: string, insertAfterPDT?: string): string {
  const lines = variantText.split("\n")
  if (insertAfterPDT) {
    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i])
      if (lines[i].startsWith("#EXT-X-PROGRAM-DATE-TIME:") && lines[i].includes(insertAfterPDT)) {
        out.push("#EXT-X-DISCONTINUITY")
      }
    }
    return out.join("\n")
  }
  // No PDT provided: inject before tail media segment
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
 * Replace content segments with ad segments for true SSAI
 * Inserts DISCONTINUITY tags before and after ad pod
 */
export function replaceSegmentsWithAds(
  variantText: string,
  scte35StartPDT: string,
  adSegments: string[],
  adDuration: number
): string {
  const lines = variantText.split("\n")
  const output: string[] = []
  
  let foundMarker = false
  let segmentsReplaced = 0
  const segmentsToReplace = Math.ceil(adDuration / 4)  // Assuming 4-second segments
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Look for SCTE-35 marker or PDT that matches start time
    if (!foundMarker && line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && line.includes(scte35StartPDT)) {
      foundMarker = true
      output.push(line)  // Keep the PDT
      
      // Add DISCONTINUITY before ad
      output.push("#EXT-X-DISCONTINUITY")
      
      // Insert ad segments
      for (let j = 0; j < adSegments.length; j++) {
        output.push(`#EXTINF:${(adDuration / adSegments.length).toFixed(3)},`)
        output.push(adSegments[j])
      }
      
      // Add DISCONTINUITY after ad
      output.push("#EXT-X-DISCONTINUITY")
      
      // Skip the next N content segments
      let skipped = 0
      while (i < lines.length && skipped < segmentsToReplace) {
        i++
        if (i < lines.length && !lines[i].startsWith("#") && lines[i].trim().length > 0) {
          skipped++
        }
      }
      
      continue
    }
    
    output.push(line)
  }
  
  return output.join("\n")
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