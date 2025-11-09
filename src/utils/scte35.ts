// SCTE-35 Parser for HLS Manifests
// Parses SCTE-35 markers from #EXT-X-DATERANGE tags in HLS manifests
// Enhanced with binary SCTE-35 command parsing for frame-accurate insertion

import type { SCTE35Signal, SCTE35SignalType, SCTE35SegmentationType } from "../types"
import {
  parseSCTE35Binary,
  createEnhancedSignal,
  extractPrecisePTS,
  getBreakDurationFromBinary,
  hasAutoReturn,
  getSegmentationDescriptors,
  ticksToSeconds,
  isSCTE35Encrypted,
  validateCRC32
} from "./scte35-binary"

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
 * Enhanced with binary parsing for frame-accurate timing
 */
function parseDateRangeSCTE35(line: string): SCTE35Signal | null {
  // Parse attributes from DATERANGE tag
  const attrs = parseDateRangeAttributes(line)
  
  // Check if this is an SCTE-35 signal
  // SCTE-35 signals typically have SCTE35-CMD or SCTE35-OUT/SCTE35-IN attributes
  const scte35Cmd = attrs["SCTE35-CMD"]
  const scte35Out = attrs["SCTE35-OUT"]
  const scte35In = attrs["SCTE35-IN"]
  const hasSegmentationHints =
    !!attrs["X-SEGMENTATION-TYPE"] ||
    !!attrs["X-BREAK-DURATION"] ||
    (attrs["CLASS"]?.toLowerCase().includes("scte35") ?? false)

  if (!scte35Cmd && !scte35Out && !scte35In && !hasSegmentationHints) {
    return null  // Not an SCTE-35 signal
  }
  
  const id = attrs["ID"] || `scte35-${Date.now()}`
  
  // Try binary parsing first for enhanced metadata
  const binaryCmd = scte35Cmd || scte35Out
  if (binaryCmd && !isSCTE35Encrypted(binaryCmd)) {
    const enhancedSignal = createEnhancedSignal(id, binaryCmd, attrs)
    if (enhancedSignal) {
      console.log(`SCTE-35 binary parsing successful: Event ID ${enhancedSignal.binaryData?.spliceEventId}, CRC valid: ${enhancedSignal.binaryData?.crcValid}`)
      return enhancedSignal
    } else {
      console.warn(`SCTE-35 binary parsing failed for ${id}, falling back to attribute parsing`)
    }
  } else if (binaryCmd && isSCTE35Encrypted(binaryCmd)) {
    console.log(`SCTE-35 command is encrypted for ${id}, using attribute parsing`)
  }
  
  // Fall back to attribute-based parsing
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
  // Prefer explicit break duration (must check !== undefined for falsy 0 value)
  if (signal.breakDuration !== undefined && signal.breakDuration !== null) {
    return signal.breakDuration
  }
  
  // Fall back to general duration
  if (signal.duration !== undefined && signal.duration !== null) {
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
 * Validation result with detailed error information
 */
export interface SCTE35ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Comprehensive SCTE-35 signal validation
 * Prevents crashes from malformed signals and provides detailed diagnostics
 *
 * @param signal - SCTE-35 signal to validate
 * @param pdt - Optional PDT timestamp for temporal validation
 * @returns Validation result with errors and warnings
 */
export function validateSCTE35Signal(signal: SCTE35Signal, pdt?: string): SCTE35ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // ========================================
  // CRITICAL VALIDATIONS (will reject signal)
  // ========================================

  // 1. ID validation
  if (!signal.id || typeof signal.id !== 'string' || signal.id.trim().length === 0) {
    errors.push('Missing or invalid signal ID')
  }

  // 2. Type validation
  const validTypes: SCTE35SignalType[] = ['splice_insert', 'time_signal', 'return_signal']
  if (!signal.type || !validTypes.includes(signal.type)) {
    errors.push(`Invalid signal type: ${signal.type}. Must be one of: ${validTypes.join(', ')}`)
  }

  // 3. Duration validation for ad break starts
  if (isAdBreakStart(signal)) {
    // CRITICAL: Check if duration fields exist (before getBreakDuration applies default)
    const hasDurationField = (signal.breakDuration !== undefined && signal.breakDuration !== null) || 
                             (signal.duration !== undefined && signal.duration !== null)
    
    const duration = getBreakDuration(signal)

    if (!hasDurationField) {
      warnings.push('Ad break start missing explicit duration; defaulting to 30 seconds')
    }

    if (duration <= 0) {
      errors.push(`Invalid ad break duration: ${duration}s (must be > 0)`)
    }
    else if (duration < 0.1 || duration > 300) {
      errors.push(`Unrealistic ad break duration: ${duration}s (must be 0.1-300 seconds)`)
    }
    else if (duration < 5) {
      warnings.push(`Very short ad break: ${duration}s (typical minimum is 5-10s)`)
    } else if (duration > 180) {
      warnings.push(`Very long ad break: ${duration}s (typical maximum is 120-180s)`)
    }
  }

  // 4. PDT temporal validation (if provided)
  if (pdt) {
    try {
      const pdtDate = new Date(pdt)

      // PDT must be valid ISO 8601 timestamp
      if (isNaN(pdtDate.getTime())) {
        errors.push(`Invalid PDT timestamp format: ${pdt} (must be ISO 8601)`)
      } else {
        const now = Date.now()
        const pdtTime = pdtDate.getTime()
        const deltaMs = Math.abs(now - pdtTime)
        const deltaMinutes = deltaMs / 60000

        // PDT must be within reasonable time range
        // Allow up to 10 minutes in past (for buffering/delays) and 5 minutes in future (for pre-roll)
        if (deltaMinutes > 10 && pdtTime < now) {
          errors.push(`PDT timestamp too far in past: ${pdt} (${deltaMinutes.toFixed(1)} minutes ago)`)
        } else if (deltaMinutes > 5 && pdtTime > now) {
          errors.push(`PDT timestamp too far in future: ${pdt} (${deltaMinutes.toFixed(1)} minutes ahead)`)
        }
        // Warn about old signals (but not reject)
        else if (deltaMinutes > 2 && pdtTime < now) {
          warnings.push(`PDT timestamp is ${deltaMinutes.toFixed(1)} minutes old (signal may be stale)`)
        }
      }
    } catch (e) {
      errors.push(`PDT timestamp parse error: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  // 5. PTS validation (if present)
  if (signal.pts !== undefined) {
    // PTS must be non-negative integer
    if (!Number.isInteger(signal.pts) || signal.pts < 0) {
      errors.push(`Invalid PTS value: ${signal.pts} (must be non-negative integer)`)
    }
    // PTS must be reasonable (< 2^32 for 90kHz clock = ~13 hours)
    else if (signal.pts > 4294967295) {
      warnings.push(`Unusually large PTS value: ${signal.pts} (may indicate wrap-around)`)
    }
  }

  // 6. Segment numbering validation (for multi-segment pods)
  if (signal.segmentNum !== undefined || signal.segmentsExpected !== undefined) {
    if (signal.segmentNum === undefined) {
      warnings.push('segmentsExpected specified without segmentNum')
    } else if (signal.segmentsExpected === undefined) {
      warnings.push('segmentNum specified without segmentsExpected')
    } else {
      // Both present - validate consistency
      if (signal.segmentNum < 0 || signal.segmentsExpected < 1) {
        errors.push(`Invalid segment numbering: ${signal.segmentNum}/${signal.segmentsExpected}`)
      } else if (signal.segmentNum >= signal.segmentsExpected) {
        errors.push(`Segment number ${signal.segmentNum} >= expected count ${signal.segmentsExpected}`)
      }
    }
  }

  // ========================================
  // WARNINGS (informational, won't reject)
  // ========================================

  // 7. Auto-return validation
  if (signal.autoReturn === false && signal.type === 'splice_insert') {
    warnings.push('Ad break without auto-return requires manual return signal (may cause timing issues)')
  }

  // 8. UPID validation (if present)
  // BUG FIX: Check !== undefined instead of truthy check, since empty string "" is falsy but valid
  if (signal.upid !== undefined && signal.upid !== null && typeof signal.upid === 'string') {
    if (signal.upid.trim().length === 0) {
      warnings.push('UPID present but empty')
    } else if (signal.upid.length > 256) {
      warnings.push(`Unusually long UPID: ${signal.upid.length} characters`)
    }
  }

  // 9. Binary data validation (if present)
  if (signal.binaryData) {
    if (signal.binaryData.crcValid === false) {
      warnings.push('SCTE-35 binary data failed CRC validation (data may be corrupted)')
    }
    if (signal.binaryData.encrypted) {
      warnings.push('SCTE-35 binary data is encrypted (limited metadata available)')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Legacy validation function (for backward compatibility)
 * @deprecated Use validateSCTE35Signal() for detailed validation
 */
export function isValidSCTE35Signal(signal: SCTE35Signal): boolean {
  const result = validateSCTE35Signal(signal)
  return result.valid
}

// ============================================================================
// RE-EXPORT BINARY PARSING UTILITIES
// ============================================================================

/**
 * Re-export binary parsing functions for convenience
 */
export {
  parseSCTE35Binary,
  extractPrecisePTS,
  getBreakDurationFromBinary,
  hasAutoReturn as hasAutoReturnBinary,
  getSegmentationDescriptors,
  ticksToSeconds,
  isSCTE35Encrypted,
  validateCRC32,
  type SCTE35BinaryData,
  type SpliceInsert,
  type TimeSignal,
  type SegmentationDescriptor,
  UPIDType,
  SEGMENTATION_TYPE_NAMES
} from "./scte35-binary"

