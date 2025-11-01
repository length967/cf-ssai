// SCTE-35 Parser for HLS Manifests
// Parses SCTE-35 markers from #EXT-X-DATERANGE tags in HLS manifests

import type { SCTE35Signal, SCTE35SignalType, SCTE35SegmentationType } from "../types"

/**
 * Parse SCTE-35 signals from HLS manifest
 * Looks for #EXT-X-DATERANGE tags with SCTE35 attributes
 */
export function parseSCTE35FromManifest(manifestText: string): SCTE35Signal[] {
  const lines = manifestText.split("\n")
  const signals: SCTE35Signal[] = []
  
  for (const line of lines) {
    if (line.startsWith("#EXT-X-DATERANGE:")) {
      const signal = parseDateRangeSCTE35(line)
      if (signal) {
        console.log(`SCTE-35 signal detected: ${signal.id}, type: ${signal.type}, duration: ${signal.duration || signal.breakDuration}s`)
        signals.push(signal)
      }
    }
  }
  
  console.log(`Total SCTE-35 signals found: ${signals.length}`)
  return signals
}

/**
 * Parse a single #EXT-X-DATERANGE line for SCTE-35 data
 */
function parseDateRangeSCTE35(line: string): SCTE35Signal | null {
  // Parse attributes from DATERANGE tag
  const attrs = parseDateRangeAttributes(line)
  
  // Check if this is an SCTE-35 signal
  // SCTE-35 signals typically have SCTE35-CMD or SCTE35-OUT/SCTE35-IN attributes
  const scte35Cmd = attrs["SCTE35-CMD"]
  const scte35Out = attrs["SCTE35-OUT"]
  const scte35In = attrs["SCTE35-IN"]
  
  if (!scte35Cmd && !scte35Out && !scte35In) {
    return null  // Not an SCTE-35 signal
  }
  
  const id = attrs["ID"] || `scte35-${Date.now()}`
  const duration = attrs["DURATION"] ? parseFloat(attrs["DURATION"]) : 
                   attrs["PLANNED-DURATION"] ? parseFloat(attrs["PLANNED-DURATION"]) : undefined
  const pts = attrs["X-PTS"] ? parseInt(attrs["X-PTS"], 10) : undefined
  
  // Determine signal type
  let type: SCTE35SignalType = "time_signal"
  if (scte35Out || attrs["CLASS"] === "com.apple.hls.scte35.out") {
    type = "splice_insert"
  } else if (scte35In || attrs["CLASS"] === "com.apple.hls.scte35.in") {
    type = "return_signal"
  }
  
  // Parse segmentation information
  const segmentationType = parseSegmentationType(attrs)
  const breakDuration = attrs["X-BREAK-DURATION"] ? parseFloat(attrs["X-BREAK-DURATION"]) : duration
  const autoReturn = attrs["X-AUTO-RETURN"] === "YES" || attrs["X-AUTO-RETURN"] === "true"
  
  // Segment numbering (for multi-segment ad pods)
  const segmentNum = attrs["X-SEGMENT-NUM"] ? parseInt(attrs["X-SEGMENT-NUM"], 10) : undefined
  const segmentsExpected = attrs["X-SEGMENTS-EXPECTED"] ? parseInt(attrs["X-SEGMENTS-EXPECTED"], 10) : undefined
  
  // UPID (Unique Program Identifier)
  const upid = attrs["X-UPID"] || attrs["UPID"]
  
  return {
    id,
    type,
    pts,
    duration,
    segmentationType,
    upid,
    breakDuration,
    autoReturn,
    segmentNum,
    segmentsExpected
  }
}

/**
 * Parse attributes from a DATERANGE line
 */
function parseDateRangeAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  
  // Remove the tag prefix
  const content = line.replace("#EXT-X-DATERANGE:", "")
  
  // Parse key=value pairs
  // Handle quoted values: KEY="value" or KEY=value
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g
  let match
  
  while ((match = regex.exec(content)) !== null) {
    const key = match[1]
    const value = match[2] || match[3]  // Quoted or unquoted value
    attrs[key] = value
  }
  
  return attrs
}

/**
 * Parse segmentation type from attributes
 */
function parseSegmentationType(attrs: Record<string, string>): SCTE35SegmentationType | undefined {
  const segType = attrs["X-SEGMENTATION-TYPE"] || attrs["SCTE35-TYPE"]
  
  if (!segType) return undefined
  
  // Map common segmentation type IDs to names
  const typeMap: Record<string, SCTE35SegmentationType> = {
    "0x30": "Provider Ad",
    "0x32": "Distributor Ad",
    "0x34": "Provider Ad",
    "0x36": "Distributor Ad",
    "0x10": "Program Start",
    "0x11": "Program End",
    "0x20": "Chapter Start",
    "0x22": "Break Start",
    "0x23": "Break End",
    "provider_ad": "Provider Ad",
    "distributor_ad": "Distributor Ad",
    "program_start": "Program Start",
    "program_end": "Program End",
    "chapter_start": "Chapter Start",
    "break_start": "Break Start",
    "break_end": "Break End"
  }
  
  return typeMap[segType.toLowerCase()] || typeMap[segType]
}

/**
 * Determine if signal indicates an ad break start
 */
export function isAdBreakStart(signal: SCTE35Signal): boolean {
  // Check signal type
  if (signal.type === "splice_insert") {
    return true
  }
  
  // Check segmentation type
  if (signal.segmentationType) {
    return signal.segmentationType === "Provider Ad" ||
           signal.segmentationType === "Distributor Ad" ||
           signal.segmentationType === "Break Start"
  }
  
  // Time signal with duration indicates break start
  if (signal.type === "time_signal" && signal.breakDuration && signal.breakDuration > 0) {
    return true
  }
  
  return false
}

/**
 * Determine if signal indicates return from ad break
 */
export function isAdBreakEnd(signal: SCTE35Signal): boolean {
  // Return signal explicitly indicates end
  if (signal.type === "return_signal") {
    return true
  }
  
  // Check segmentation type
  if (signal.segmentationType === "Break End" || signal.segmentationType === "Program Start") {
    return true
  }
  
  return false
}

/**
 * Get break duration from signal (in seconds)
 */
export function getBreakDuration(signal: SCTE35Signal): number {
  // Prefer explicit break duration
  if (signal.breakDuration) {
    return signal.breakDuration
  }
  
  // Fall back to general duration
  if (signal.duration) {
    return signal.duration
  }
  
  // Default to 30 seconds for ad breaks
  return 30
}

/**
 * Find the most recent ad break signal in a list
 */
export function findActiveBreak(signals: SCTE35Signal[]): SCTE35Signal | null {
  // Filter to only break start signals
  const breakStarts = signals.filter(isAdBreakStart)
  
  if (breakStarts.length === 0) {
    return null
  }
  
  // Return the most recent (last in list)
  return breakStarts[breakStarts.length - 1]
}

/**
 * Check if we're currently in an ad break based on signals
 */
export function isInAdBreak(signals: SCTE35Signal[]): boolean {
  let inBreak = false
  
  // Process signals in order
  for (const signal of signals) {
    if (isAdBreakStart(signal)) {
      inBreak = true
    } else if (isAdBreakEnd(signal)) {
      inBreak = false
    }
  }
  
  return inBreak
}

/**
 * Extract SCTE-35 metadata for logging/debugging
 */
export function extractSCTE35Metadata(signal: SCTE35Signal): Record<string, any> {
  return {
    id: signal.id,
    type: signal.type,
    segmentationType: signal.segmentationType,
    duration: signal.breakDuration || signal.duration,
    upid: signal.upid,
    autoReturn: signal.autoReturn,
    segmentNum: signal.segmentNum,
    segmentsExpected: signal.segmentsExpected
  }
}

/**
 * Validate SCTE-35 signal completeness
 */
export function isValidSCTE35Signal(signal: SCTE35Signal): boolean {
  // Must have an ID
  if (!signal.id) return false
  
  // Must have a type
  if (!signal.type) return false
  
  // Break starts should have duration
  if (isAdBreakStart(signal) && !getBreakDuration(signal)) {
    return false
  }
  
  return true
}

