// SCTE-35 Parser utilities
// Provides both legacy HLS manifest parsing and MPEG-TS transport parsing helpers

import type {
  SCTE35Signal,
  SCTE35SignalType,
  SCTE35SegmentationType,
  Scte35Event,
  Scte35EventCommandType
} from "../types"
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
import type { SegmentationDescriptor, SpliceInsert, TimeSignal } from "./scte35-binary"

const TS_PACKET_SIZE = 188

type SectionAssembler = {
  buffer: number[]
  lastContinuity: number | null
  counters: number[]
}

function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ""
  for (const byte of data) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function mapCommandType(commandType: number): Scte35EventCommandType {
  switch (commandType) {
    case 0x05:
      return "splice_insert"
    case 0x06:
      return "time_signal"
    case 0x07:
      return "bandwidth_reservation"
    case 0x04:
      return "private_command"
    default:
      return "reserved"
  }
}

function normalizeContinuity(counters: number[]): number[] {
  if (counters.length === 0) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const value of counters) {
    if (!seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

function parseProgramAssociationSection(section: Uint8Array): Array<{ programNumber: number; pmtPid: number }> {
  if (section[0] !== 0x00) return []

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2]
  const programLoopEnd = 3 + sectionLength - 4
  const programs: Array<{ programNumber: number; pmtPid: number }> = []

  for (let offset = 8; offset + 4 <= programLoopEnd; offset += 4) {
    const programNumber = (section[offset] << 8) | section[offset + 1]
    const pid = ((section[offset + 2] & 0x1f) << 8) | section[offset + 3]
    if (programNumber === 0) continue // Network PID, skip
    programs.push({ programNumber, pmtPid: pid })
  }

  return programs
}

function parseProgramMapSection(section: Uint8Array): number[] {
  if (section[0] !== 0x02) return []

  const sectionLength = ((section[1] & 0x0f) << 8) | section[2]
  const programInfoLength = ((section[10] & 0x0f) << 8) | section[11]
  const descriptorsEnd = 3 + sectionLength - 4
  const pids: number[] = []

  let offset = 12 + programInfoLength
  while (offset + 5 <= descriptorsEnd) {
    const streamType = section[offset]
    const elementaryPid = ((section[offset + 1] & 0x1f) << 8) | section[offset + 2]
    const esInfoLength = ((section[offset + 3] & 0x0f) << 8) | section[offset + 4]

    if (streamType === 0x86) {
      pids.push(elementaryPid)
    }

    offset += 5 + esInfoLength
  }

  return pids
}

function toPtsSeconds(pts?: number): number | undefined {
  if (pts === undefined) return undefined
  return Number(pts) / 90000
}

function normalizeSegmentationTypeName(name?: string): SCTE35SegmentationType | undefined {
  if (!name) return undefined
  const normalized = name.toLowerCase()

  if (normalized.includes("provider") && normalized.includes("ad")) return "Provider Ad"
  if (normalized.includes("distributor") && normalized.includes("ad")) return "Distributor Ad"
  if (normalized.includes("program") && normalized.includes("start")) return "Program Start"
  if (normalized.includes("program") && normalized.includes("end")) return "Program End"
  if (normalized.includes("chapter") && normalized.includes("start")) return "Chapter Start"
  if (normalized.includes("break") && normalized.includes("start")) return "Break Start"
  if (normalized.includes("break") && normalized.includes("end")) return "Break End"
  if (normalized.includes("unscheduled")) return "Unscheduled Event"

  return undefined
}

function createScte35Event(
  section: Uint8Array,
  pid: number,
  programNumber: number | undefined,
  continuityCounters: number[],
  ingestTimestamp: number
): Scte35Event | null {
  if (section.length === 0) return null

  const rawHex = bytesToHex(section)
  const raw = bytesToBase64(section)
  const parsed = parseSCTE35Binary(raw)

  const commandTypeId = parsed?.spliceCommandType ?? -1
  const commandType = mapCommandType(commandTypeId)

  const event: Scte35Event = {
    programNumber,
    pid,
    eventId: "", // filled below
    commandType,
    commandTypeId,
    continuityCounters: normalizeContinuity(continuityCounters),
    raw,
    rawHex,
    crc32: parsed?.crc32,
    crcValid: parsed?.crcValid,
    encrypted: parsed?.encryptedPacket,
    encryptionAlgorithm: parsed?.encryptionAlgorithm,
    protocolVersion: parsed?.protocolVersion,
    ptsAdjustment: parsed ? Number(parsed.ptsAdjustment) : undefined,
    cwIndex: parsed?.cwIndex,
    tier: parsed?.tier,
    ingestTimestamp
  }

  if (parsed?.spliceCommandType === 0x05 && parsed.spliceCommand) {
    const spliceInsert = parsed.spliceCommand as SpliceInsert
    event.spliceEventId = spliceInsert.spliceEventId
    event.spliceEventCancelIndicator = spliceInsert.spliceEventCancelIndicator
    event.outOfNetworkIndicator = spliceInsert.outOfNetworkIndicator
    event.programSpliceFlag = spliceInsert.programSpliceFlag
    event.durationFlag = spliceInsert.durationFlag
    event.spliceImmediateFlag = spliceInsert.spliceImmediateFlag

    const ptsTime = spliceInsert.spliceTime?.ptsTime
    if (ptsTime !== undefined) {
      const pts = Number(ptsTime)
      event.pts = pts
      event.ptsSeconds = toPtsSeconds(pts)
    }

    if (spliceInsert.breakDuration) {
      event.breakDurationSeconds = spliceInsert.breakDuration.durationSeconds
      event.autoReturn = spliceInsert.breakDuration.autoReturn
    }
  } else if (parsed?.spliceCommandType === 0x06 && parsed.spliceCommand) {
    const timeSignal = parsed.spliceCommand as TimeSignal
    const ptsTime = timeSignal.spliceTime?.ptsTime
    if (ptsTime !== undefined) {
      const pts = Number(ptsTime)
      event.pts = pts
      event.ptsSeconds = toPtsSeconds(pts)
    }
  }

  if (parsed?.descriptors?.length) {
    const segmentationDescriptor = parsed.descriptors.find(
      (descriptor) => descriptor.identifier === "CUEI" && (descriptor.data as SegmentationDescriptor | undefined)?.segmentationEventId !== undefined
    )

    if (segmentationDescriptor) {
      const data = segmentationDescriptor.data as SegmentationDescriptor
      event.segmentationEventId = data.segmentationEventId
      event.segmentationTypeId = data.segmentationTypeId
      event.segmentationTypeName = data.segmentationTypeName
      event.segmentNum = data.segmentNum
      event.segmentsExpected = data.segmentsExpected
      event.subSegmentNum = data.subSegmentNum
      event.subSegmentsExpected = data.subSegmentsExpected
      event.upidType = data.segmentationUpidType
      event.upid = data.segmentationUpid
      event.segmentationDurationSeconds = data.segmentationDurationSeconds
      event.deliveryRestrictions = {
        webAllowed: data.webDeliveryAllowedFlag,
        noRegionalBlackout: data.noRegionalBlackoutFlag,
        archiveAllowed: data.archiveAllowedFlag,
        deviceRestrictions: data.deviceRestrictions
      }
    }
  }

  if (event.breakDurationSeconds === undefined && event.segmentationDurationSeconds !== undefined) {
    event.breakDurationSeconds = event.segmentationDurationSeconds
  }

  if (!event.eventId) {
    if (event.segmentationEventId !== undefined) {
      event.eventId = `seg-${event.segmentationEventId}`
    } else if (event.spliceEventId !== undefined) {
      event.eventId = `splice-${event.spliceEventId}`
    } else {
      event.eventId = `raw-${rawHex}`
    }
  }

  const ccLog = event.continuityCounters.length > 0 ? event.continuityCounters.join(",") : "n/a"
  const preview = rawHex.length > 48 ? `${rawHex.slice(0, 48)}…` : rawHex
  console.log(
    `[SCTE35] Parsed event ${event.eventId} on PID 0x${pid.toString(16)} (program=${programNumber ?? "unknown"}) ` +
      `command=${event.commandType} cc=[${ccLog}] raw=${preview}`
  )

  return event
}

export function parseScte35FromTransportStream(data: ArrayBuffer | Uint8Array): Scte35Event[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const events: Scte35Event[] = []
  const programForPmt = new Map<number, number>()
  const sctePidToProgram = new Map<number, number>()
  const assemblers = new Map<number, SectionAssembler>()
  const ingestTimestamp = Date.now()

  for (let offset = 0; offset + TS_PACKET_SIZE <= bytes.length; offset += TS_PACKET_SIZE) {
    const packet = bytes.subarray(offset, offset + TS_PACKET_SIZE)

    if (packet[0] !== 0x47) {
      console.warn(`[SCTE35] Invalid TS sync byte at packet ${offset / TS_PACKET_SIZE}`)
      continue
    }

    const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0
    const pid = ((packet[1] & 0x1f) << 8) | packet[2]
    const adaptationFieldControl = (packet[3] >> 4) & 0x03
    const continuityCounter = packet[3] & 0x0f

    const hasPayload = adaptationFieldControl === 1 || adaptationFieldControl === 3
    if (!hasPayload) continue

    let assembler = assemblers.get(pid)
    if (!assembler) {
      assembler = { buffer: [], lastContinuity: null, counters: [] }
      assemblers.set(pid, assembler)
    }

    let index = 4
    if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
      const adaptationLength = packet[index]
      index += 1 + adaptationLength
      if (index >= TS_PACKET_SIZE) continue
    }

    let payload = packet.subarray(index, TS_PACKET_SIZE)
    if (payload.length === 0) continue

    if (payloadUnitStartIndicator) {
      const pointerField = payload[0]
      const startOffset = 1 + pointerField
      assembler.buffer = []
      assembler.counters = []
      assembler.lastContinuity = continuityCounter

      if (startOffset >= payload.length) {
        continue
      }
      payload = payload.subarray(startOffset)
    } else if (assembler.lastContinuity !== null) {
      const expected = (assembler.lastContinuity + 1) & 0x0f
      if (expected !== continuityCounter && assembler.buffer.length > 0) {
        console.warn(
          `[SCTE35] Continuity counter jump on PID 0x${pid.toString(16)}: expected ${expected}, got ${continuityCounter}`
        )
        assembler.buffer = []
        assembler.counters = []
      }
      assembler.lastContinuity = continuityCounter
    } else {
      assembler.lastContinuity = continuityCounter
    }

    if (!assembler.counters.includes(continuityCounter)) {
      assembler.counters.push(continuityCounter)
    }

    for (const byte of payload) {
      assembler.buffer.push(byte)
    }

    while (assembler.buffer.length >= 3) {
      const sectionLength = ((assembler.buffer[1] & 0x0f) << 8) | assembler.buffer[2]
      const totalLength = sectionLength + 3
      if (assembler.buffer.length < totalLength) break

      const sectionBytes = assembler.buffer.slice(0, totalLength)
      assembler.buffer = assembler.buffer.slice(totalLength)

      const counters = assembler.counters.slice()
      assembler.counters = assembler.counters.slice(-1)

      const section = Uint8Array.from(sectionBytes)

      if (pid === 0x0000) {
        const programs = parseProgramAssociationSection(section)
        for (const { programNumber, pmtPid } of programs) {
          if (!programForPmt.has(pmtPid)) {
            console.log(`[SCTE35] PAT discovered PMT PID 0x${pmtPid.toString(16)} for program ${programNumber}`)
          }
          programForPmt.set(pmtPid, programNumber)
        }
        continue
      }

      const programNumber = programForPmt.get(pid)
      if (programNumber !== undefined && section[0] === 0x02) {
        const sctePids = parseProgramMapSection(section)
        for (const sctePid of sctePids) {
          if (!sctePidToProgram.has(sctePid)) {
            console.log(`[SCTE35] PMT discovered SCTE-35 PID 0x${sctePid.toString(16)} for program ${programNumber}`)
          }
          sctePidToProgram.set(sctePid, programNumber)
        }
        continue
      }

      const eventProgram = sctePidToProgram.get(pid)
      if (eventProgram !== undefined) {
        const event = createScte35Event(section, pid, eventProgram, counters, ingestTimestamp)
        if (event) {
          events.push(event)
        }
      }
    }
  }

  return events
}

export function eventToSignal(event: Scte35Event): SCTE35Signal | null {
  const parsed = parseSCTE35Binary(event.raw)
  if (!parsed) {
    console.warn(`[SCTE35] Unable to normalize event ${event.eventId}: invalid splice_info_section payload`)
    return null
  }

  let type: SCTE35SignalType = event.commandType === "splice_insert" ? "splice_insert" : "time_signal"
  if (event.segmentationTypeName) {
    const lowered = event.segmentationTypeName.toLowerCase()
    if (lowered.includes("end") || lowered.includes("return")) {
      type = "return_signal"
    }
  }

  const segmentationType = normalizeSegmentationTypeName(event.segmentationTypeName)
  const breakDuration = event.breakDurationSeconds ?? event.segmentationDurationSeconds

  const binaryData: SCTE35Signal["binaryData"] = {
    spliceEventId: event.spliceEventId,
    protocolVersion: parsed.protocolVersion,
    ptsAdjustment: event.ptsAdjustment !== undefined ? BigInt(Math.round(event.ptsAdjustment)) : undefined,
    crcValid: event.crcValid,
    tier: event.tier,
    cwIndex: event.cwIndex,
    encryptedPacket: parsed.encryptedPacket,
    encryptionAlgorithm: parsed.encryptionAlgorithm,
    segmentationDescriptors: parsed.descriptors,
    deliveryRestrictions: event.deliveryRestrictions,
  }

  return {
    id: event.eventId,
    type,
    pts: event.pts,
    duration: breakDuration,
    segmentationType,
    upid: event.upid,
    breakDuration,
    autoReturn: event.autoReturn,
    segmentNum: event.segmentNum,
    segmentsExpected: event.segmentsExpected,
    binaryData,
  }
}

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
  const rawAttributes = { ...attrs }
  
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
      return { ...enhancedSignal, rawAttributes, rawCommand: binaryCmd }
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
    segmentsExpected,
    rawAttributes,
    rawCommand: binaryCmd
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

