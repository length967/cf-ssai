/**
 * FIXED: HLS Manifest Ad Insertion with Preserved Origin PDT Timeline
 *
 * This is a corrected version that fixes the critical PDT timeline corruption bug.
 *
 * KEY PRINCIPLE: Never modify origin segment PDTs. The origin stream clock keeps
 * running during ad breaks. When we resume content after ads, we must use the
 * ACTUAL PDT from the origin segment, not a calculated value.
 *
 * What was wrong:
 * - Old code: resume PDT = start PDT + skipped duration
 * - This creates timeline jumps because origin clock kept running
 *
 * What's fixed:
 * - New code: preserve the original PDT from each origin segment
 * - Ad segments get artificial PDTs (player ignores due to DISCONTINUITY)
 * - Resume segment uses its ACTUAL origin PDT
 * - Result: Timeline continuity preserved, no stalls
 */

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Maximum number of lines to search ahead for resume PDT.
 * At 4-second segments (typical HLS segment duration), this covers:
 * - 30 lines ~= 120 seconds of content (reasonable for typical ad breaks)
 * - Can be increased for longer ad breaks or decreased for performance
 * - If resume PDT not found within this window, falls back to calculated PDT
 */
export const PDT_SEARCH_WINDOW_LINES = 30

interface AdSegment {
  url: string
  duration: number
}

/**
 * Parse average segment duration from manifest
 */
function getAverageSegmentDuration(lines: string[]): number {
  const durations: number[] = []

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/)
      if (match) {
        durations.push(parseFloat(match[1]))
      }
    }
  }

  if (durations.length === 0) return 6.0  // Fallback

  const sum = durations.reduce((a, b) => a + b, 0)
  return sum / durations.length
}

/**
 * Add seconds to an ISO 8601 timestamp
 */
function addSecondsToTimestamp(timestamp: string, seconds: number): string {
  const date = new Date(timestamp)
  date.setMilliseconds(date.getMilliseconds() + seconds * 1000)
  return date.toISOString()
}

/**
 * FIXED: Insert ads while preserving origin PDT timeline
 *
 * Key changes from broken version:
 * 1. Extract and preserve the ACTUAL PDT from the resume segment
 * 2. Don't calculate resume PDT - use the origin's PDT
 * 3. Ad segments get synthetic PDTs (safe because DISCONTINUITY resets timeline)
 *
 * @param variantText - Original HLS manifest
 * @param scte35StartPDT - PDT timestamp where ad break starts
 * @param adSegments - Array of ad segments with durations
 * @param adDuration - Total duration of ad pod
 * @param scte35Duration - Duration specified in SCTE-35 signal (content to skip)
 * @param stableSkipCount - Pre-calculated segment skip count (for consistency)
 * @returns Modified manifest with ads inserted and skip statistics
 */
export function replaceSegmentsWithAdsFixed(
  variantText: string,
  scte35StartPDT: string,
  adSegments: AdSegment[] | string[],
  adDuration: number,
  scte35Duration?: number,
  stableSkipCount?: number
): { manifest: string, segmentsSkipped: number, durationSkipped: number } {

  const contentSkipDuration = scte35Duration || adDuration
  const lines = variantText.split("\\n")
  const output: string[] = []

  const contentSegmentDuration = getAverageSegmentDuration(lines)
  const segmentsToReplace = Math.ceil(contentSkipDuration / contentSegmentDuration)

  console.log(`[PDT-FIX] Ad duration: ${adDuration}s, SCTE-35 duration: ${contentSkipDuration}s, ` +
              `Content segment duration: ${contentSegmentDuration}s, Segments to skip: ${segmentsToReplace}`)

  let foundMarker = false
  let segmentsReplaced = 0
  let actualSkippedDuration = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find the SCTE-35 start PDT marker
    if (!foundMarker && line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && line.includes(scte35StartPDT)) {
      foundMarker = true

      // Keep the original PDT marker from origin
      output.push(line)

      const startPDT = line.replace("#EXT-X-PROGRAM-DATE-TIME:", "").trim()

      // Signal timeline change with DISCONTINUITY
      output.push("#EXT-X-DISCONTINUITY")

      // Insert ad segments with synthetic PDT timeline
      // These PDTs don't need to match reality - DISCONTINUITY tells player to reset
      let currentAdPDT = startPDT

      for (let j = 0; j < adSegments.length; j++) {
        const segment = adSegments[j]

        // Synthetic PDT for ad segment (player will recalculate after DISCONTINUITY)
        output.push(`#EXT-X-PROGRAM-DATE-TIME:${currentAdPDT}`)

        let segmentDuration: number

        if (typeof segment === 'string') {
          segmentDuration = adDuration / adSegments.length
          output.push(`#EXTINF:${segmentDuration.toFixed(3)},`)
          output.push(segment)
        } else {
          segmentDuration = segment.duration
          output.push(`#EXTINF:${segment.duration.toFixed(3)},`)
          output.push(segment.url)
        }

        // Advance synthetic ad timeline
        currentAdPDT = addSecondsToTimestamp(currentAdPDT, segmentDuration)
      }

      // Signal timeline change back to origin
      output.push("#EXT-X-DISCONTINUITY")

      // Now skip origin content segments that were covered by ad break
      let skippedDuration = 0
      let skippedCount = 0
      const skipStartIndex = i
      let resumeIndex = i + 1

      if (stableSkipCount !== undefined && stableSkipCount > 0) {
        // Use pre-calculated stable skip count
        console.log(`[PDT-FIX] Using stable skip count: ${stableSkipCount} segments`)

        let segmentsSeen = 0
        while (resumeIndex < lines.length && segmentsSeen < stableSkipCount) {
          const line = lines[resumeIndex]

          if (line.startsWith('#EXTINF:')) {
            const match = line.match(/#EXTINF:([\d.]+)/)
            if (match) {
              const duration = parseFloat(match[1])
              skippedDuration += duration
              segmentsSeen++
            }
          }

          resumeIndex++
        }

        skippedCount = segmentsSeen
        console.log(`[PDT-FIX] Skipped ${skippedCount} segments totaling ${skippedDuration.toFixed(2)}s`)

      } else {
        // Calculate skip count based on duration
        console.log(`[PDT-FIX] Calculating skip count for ${contentSkipDuration}s`)

        while (resumeIndex < lines.length && skippedDuration < contentSkipDuration) {
          const line = lines[resumeIndex]

          if (line.startsWith('#EXTINF:')) {
            const match = line.match(/#EXTINF:([\d.]+)/)
            if (match) {
              const duration = parseFloat(match[1])
              skippedDuration += duration
              skippedCount++

              // Check if we've skipped enough
              if (skippedDuration >= contentSkipDuration) {
                // Skip past this segment's URL line
                resumeIndex++
                break
              }
            }
          }

          resumeIndex++
        }

        console.log(`[PDT-FIX] Calculated skip: ${skippedCount} segments, ${skippedDuration.toFixed(2)}s`)
      }

      // CRITICAL FIX: Find and preserve the ACTUAL PDT from the resume segment
      // Do NOT calculate it - use the origin's timestamp
      let resumePDT: string | null = null
      let searchIndex = resumeIndex

      // Look ahead to find the next PDT tag from origin
      while (searchIndex < lines.length && !resumePDT) {
        const searchLine = lines[searchIndex]

        if (searchLine.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
          resumePDT = searchLine.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
          console.log(`[PDT-FIX] ✅ Found origin resume PDT: ${resumePDT}`)
          break
        }

        // Stop searching after checking configured number of lines
        if (searchIndex - resumeIndex > PDT_SEARCH_WINDOW_LINES) {
          console.warn(`[PDT-FIX] ⚠️  Could not find resume PDT within search window (${PDT_SEARCH_WINDOW_LINES} lines)`)
          break
        }

        searchIndex++
      }

      // If we found the origin PDT, insert it before the resume segment
      if (resumePDT) {
        output.push(`#EXT-X-PROGRAM-DATE-TIME:${resumePDT}`)
        console.log(`[PDT-FIX] Preserved origin PDT at resume point: ${resumePDT}`)
      } else {
        // Fallback: calculate (old broken behavior, but better than crashing)
        const calculatedPDT = addSecondsToTimestamp(startPDT, skippedDuration)
        output.push(`#EXT-X-PROGRAM-DATE-TIME:${calculatedPDT}`)
        console.warn(`[PDT-FIX] ⚠️  Fallback to calculated PDT: ${calculatedPDT} (may cause timeline issues)`)
      }

      // Update loop index to resume point
      i = resumeIndex - 1  // -1 because loop will increment
      segmentsReplaced = skippedCount
      actualSkippedDuration = skippedDuration

      continue
    }

    output.push(line)
  }

  if (segmentsReplaced > 0) {
    console.log(`[PDT-FIX] ✅ Ad insertion completed: ${segmentsReplaced} segments replaced, timeline preserved`)
  } else {
    console.warn(`[PDT-FIX] ⚠️  SCTE-35 PDT not found in manifest: ${scte35StartPDT}`)
  }

  return {
    manifest: output.join("\\n"),
    segmentsSkipped: segmentsReplaced,
    durationSkipped: actualSkippedDuration
  }
}

/**
 * Usage example and comparison:
 *
 * BROKEN (old code):
 * ==================
 * Origin: 10:00:06 (start), 10:00:12, 10:00:18, 10:00:24, 10:00:30 (resume)
 * Ad break: 30s (skip 3 segments = 18s)
 *
 * Old output:
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:06Z  ← origin
 *   #EXT-X-DISCONTINUITY
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:06Z  ← ad starts
 *   [ad segments 10:00:06 → 10:00:36]
 *   #EXT-X-DISCONTINUITY
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:24Z  ← WRONG! Calculated
 *   [resume content]  ← Actually from 10:00:30
 *
 * Result: HLS.js sees 10:00:36 → 10:00:24 = -12s jump = STALL
 *
 *
 * FIXED (new code):
 * ================
 * Origin: 10:00:06 (start), 10:00:12, 10:00:18, 10:00:24, 10:00:30 (resume)
 * Ad break: 30s (skip 3 segments = 18s)
 *
 * New output:
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:06Z  ← origin
 *   #EXT-X-DISCONTINUITY
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:06Z  ← ad starts (synthetic)
 *   [ad segments 10:00:06 → 10:00:36]  ← synthetic timeline
 *   #EXT-X-DISCONTINUITY
 *   #EXT-X-PROGRAM-DATE-TIME:2025-01-01T10:00:30Z  ← CORRECT! From origin
 *   [resume content]  ← Matches actual origin time
 *
 * Result: DISCONTINUITY tells player to reset, 10:00:30 is valid = NO STALL
 */
