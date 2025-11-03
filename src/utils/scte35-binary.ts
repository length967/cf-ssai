// SCTE-35 Binary Parser - Industry-Standard Implementation
// Parses base64-encoded SCTE-35 binary splice commands per SCTE 35 2023 specification
// Provides frame-accurate timing (90kHz precision) and complete metadata extraction

import type { SCTE35Signal } from "../types"

// ============================================================================
// WORKERS-COMPATIBLE BASE64 DECODING (No Node.js Buffer)
// ============================================================================

/**
 * Decode base64 string to Uint8Array (Workers-compatible)
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Remove whitespace and padding
  const cleanBase64 = base64.trim().replace(/=/g, '')
  
  // Decode using atob (available in Workers)
  const binaryString = atob(cleanBase64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  
  return bytes
}

/**
 * DataView wrapper for Uint8Array (provides Buffer-like read methods)
 */
class BufferReader {
  private view: DataView
  private array: Uint8Array
  
  constructor(buffer: Uint8Array) {
    this.array = buffer
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }
  
  get length(): number {
    return this.array.length
  }
  
  readUInt8(offset: number): number {
    return this.view.getUint8(offset)
  }
  
  readUInt16BE(offset: number): number {
    return this.view.getUint16(offset, false)
  }
  
  readUInt32BE(offset: number): number {
    return this.view.getUint32(offset, false)
  }
  
  readBigUInt64BE(offset: number): bigint {
    return this.view.getBigUint64(offset, false)
  }
  
  slice(start: number, end?: number): Uint8Array {
    return this.array.slice(start, end)
  }
  
  toString(encoding: string, start?: number, end?: number): string {
    const slice = this.array.slice(start, end)
    if (encoding === 'ascii' || encoding === 'utf8') {
      return String.fromCharCode(...slice)
    } else if (encoding === 'hex') {
      return Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join('')
    }
    return ''
  }
}

// ============================================================================
// CORE TYPES
// ============================================================================

export interface SCTE35BinaryData {
  valid: boolean
  tableId: number
  sectionLength: number
  protocolVersion: number
  encryptedPacket: boolean
  encryptionAlgorithm?: number
  ptsAdjustment: bigint
  cwIndex?: number
  tier: number
  spliceCommandLength: number
  spliceCommandType: number
  spliceCommand?: SpliceInsert | TimeSignal | BandwidthReservation
  descriptorLoopLength: number
  descriptors: SpliceDescriptor[]
  crc32: number
  crcValid: boolean
}

export interface SpliceInsert {
  spliceEventId: number
  spliceEventCancelIndicator: boolean
  outOfNetworkIndicator?: boolean
  programSpliceFlag?: boolean
  durationFlag?: boolean
  spliceImmediateFlag?: boolean
  eventIdComplianceFlag?: boolean
  spliceTime?: SpliceTime
  componentSplices?: ComponentSplice[]
  breakDuration?: BreakDuration
  uniqueProgramId: number
  availNum: number
  availsExpected: number
}

export interface TimeSignal {
  spliceTime?: SpliceTime
}

export interface BandwidthReservation {
  // Empty - just reserves bandwidth
}

export interface SpliceTime {
  timeSpecified: boolean
  ptsTime?: bigint
}

export interface ComponentSplice {
  componentTag: number
  spliceTime?: SpliceTime
}

export interface BreakDuration {
  autoReturn: boolean
  reserved: number
  duration: bigint  // In 90kHz ticks
  durationSeconds: number  // Converted to seconds
}

export interface SpliceDescriptor {
  tag: number
  length: number
  identifier: string
  data: SegmentationDescriptor | AvailDescriptor | DTMFDescriptor | TimeDescriptor | unknown
}

export interface SegmentationDescriptor {
  segmentationEventId: number
  segmentationEventCancelIndicator: boolean
  programSegmentationFlag?: boolean
  segmentationDurationFlag?: boolean
  deliveryNotRestrictedFlag?: boolean
  webDeliveryAllowedFlag?: boolean
  noRegionalBlackoutFlag?: boolean
  archiveAllowedFlag?: boolean
  deviceRestrictions?: number
  segmentationDuration?: bigint
  segmentationDurationSeconds?: number
  segmentationUpidType: number
  segmentationUpidLength: number
  segmentationUpid: string
  segmentationTypeId: number
  segmentationTypeName: string
  segmentNum?: number
  segmentsExpected?: number
  subSegmentNum?: number
  subSegmentsExpected?: number
}

export interface AvailDescriptor {
  providerAvailId: number
}

export interface DTMFDescriptor {
  preroll: number
  dtmfChars: string
}

export interface TimeDescriptor {
  taiSeconds: bigint
  taiNanoseconds: number
  utcOffset: number
}

// UPID Type Enum (Section 10.3.3.1)
export enum UPIDType {
  NOT_USED = 0x00,
  USER_DEFINED = 0x01,
  ISCI = 0x02,
  AD_ID = 0x03,
  UMID = 0x04,
  ISAN_DEPRECATED = 0x05,
  ISAN = 0x06,
  TID = 0x07,
  TI = 0x08,
  ADI = 0x09,
  EIDR = 0x0A,
  ATSC_CONTENT_ID = 0x0B,
  MPU = 0x0C,
  MID = 0x0D,
  ADS_INFO = 0x0E,
  URI = 0x0F
}

// Segmentation Type IDs (Section 10.3.3.1)
export const SEGMENTATION_TYPE_NAMES: Record<number, string> = {
  0x00: "Not Indicated",
  0x01: "Content Identification",
  0x10: "Program Start",
  0x11: "Program End",
  0x12: "Program Early Termination",
  0x13: "Program Breakaway",
  0x14: "Program Resumption",
  0x15: "Program Runover Planned",
  0x16: "Program Runover Unplanned",
  0x17: "Program Overlap Start",
  0x18: "Program Blackout Override",
  0x19: "Program Start - In Progress",
  0x20: "Chapter Start",
  0x21: "Chapter End",
  0x22: "Break Start",
  0x23: "Break End",
  0x24: "Opening Credit Start",
  0x25: "Opening Credit End",
  0x26: "Closing Credit Start",
  0x27: "Closing Credit End",
  0x30: "Provider Advertisement Start",
  0x31: "Provider Advertisement End",
  0x32: "Distributor Advertisement Start",
  0x33: "Distributor Advertisement End",
  0x34: "Provider Placement Opportunity Start",
  0x35: "Provider Placement Opportunity End",
  0x36: "Distributor Placement Opportunity Start",
  0x37: "Distributor Placement Opportunity End",
  0x38: "Provider Overlay Placement Opportunity Start",
  0x39: "Provider Overlay Placement Opportunity End",
  0x3A: "Distributor Overlay Placement Opportunity Start",
  0x3B: "Distributor Overlay Placement Opportunity End",
  0x3C: "Provider Promo Start",
  0x3D: "Provider Promo End",
  0x3E: "Distributor Promo Start",
  0x3F: "Distributor Promo End",
  0x40: "Unscheduled Event Start",
  0x41: "Unscheduled Event End",
  0x42: "Alternate Content Opportunity Start",
  0x43: "Alternate Content Opportunity End",
  0x44: "Provider Ad Block Start",
  0x45: "Provider Ad Block End",
  0x46: "Distributor Ad Block Start",
  0x47: "Distributor Ad Block End",
  0x50: "Network Start",
  0x51: "Network End"
}

// ============================================================================
// PTS ADJUSTMENT UTILITY
// ============================================================================

/**
 * Apply PTS adjustment to splice commands (SCTE-35 spec section 9.2)
 * Adds pts_adjustment to all PTS times and wraps at 33 bits (2^33)
 */
function applySCTE35PTSAdjustment(
  spliceCommand: SpliceInsert | TimeSignal | BandwidthReservation,
  ptsAdjustment: bigint
): void {
  if (ptsAdjustment === 0n) return
  
  // Apply to splice_insert command
  if ('spliceEventId' in spliceCommand) {
    const si = spliceCommand as SpliceInsert
    if (si.spliceTime?.ptsTime) {
      const adjusted = (si.spliceTime.ptsTime + ptsAdjustment) & 0x1FFFFFFFFn
      console.log(`Applied PTS adjustment to splice_insert: ${ptsAdjustment} ticks (${ticksToSeconds(ptsAdjustment).toFixed(3)}s)`)
      console.log(`  Original PTS: ${si.spliceTime.ptsTime} (${ticksToSeconds(si.spliceTime.ptsTime).toFixed(3)}s)`)
      console.log(`  Adjusted PTS: ${adjusted} (${ticksToSeconds(adjusted).toFixed(3)}s)`)
      si.spliceTime.ptsTime = adjusted
    }
  }
  
  // Apply to time_signal command
  if ('spliceTime' in spliceCommand && !('spliceEventId' in spliceCommand)) {
    const ts = spliceCommand as TimeSignal
    if (ts.spliceTime?.ptsTime) {
      const adjusted = (ts.spliceTime.ptsTime + ptsAdjustment) & 0x1FFFFFFFFn
      console.log(`Applied PTS adjustment to time_signal: ${ptsAdjustment} ticks (${ticksToSeconds(ptsAdjustment).toFixed(3)}s)`)
      console.log(`  Original PTS: ${ts.spliceTime.ptsTime} (${ticksToSeconds(ts.spliceTime.ptsTime).toFixed(3)}s)`)
      console.log(`  Adjusted PTS: ${adjusted} (${ticksToSeconds(adjusted).toFixed(3)}s)`)
      ts.spliceTime.ptsTime = adjusted
    }
  }
}

// ============================================================================
// MAIN PARSING FUNCTION
// ============================================================================

/**
 * Parse base64-encoded SCTE-35 binary command
 * Returns complete binary data with frame-accurate timing
 * Uses Workers-compatible base64 decoding (no Node.js Buffer)
 */
export function parseSCTE35Binary(base64Cmd: string): SCTE35BinaryData | null {
  try {
    // Decode base64 using Workers-compatible API
    const rawBuffer = base64ToUint8Array(base64Cmd)
    let buffer = new BufferReader(rawBuffer)
    
    // Validate minimum length
    if (buffer.length < 14) {
      console.error('SCTE-35 binary too short')
      return null
    }
    
    // Parse splice info section (Section 9.2)
    let tableId = buffer.readUInt8(0)
    let offset = 0
    
    // CRITICAL FIX: Handle wrapped/offset SCTE-35 data
    // Some encoders wrap SCTE-35 in extra bytes - scan for 0xFC table_id
    if (tableId !== 0xFC) {
      console.warn(`Invalid table_id at offset 0: ${tableId} (0x${tableId.toString(16)}), scanning for 0xFC...`)
      
      // Scan up to first 16 bytes for the 0xFC marker
      let found = false
      for (let i = 1; i < Math.min(16, buffer.length - 14); i++) {
        if (buffer.readUInt8(i) === 0xFC) {
          console.log(`Found 0xFC table_id at offset ${i}, using adjusted buffer`)
          offset = i
          buffer = new BufferReader(rawBuffer.slice(i))
          tableId = 0xFC
          found = true
          break
        }
      }
      
      if (!found) {
        console.error(`No valid SCTE-35 table_id (0xFC) found in first 16 bytes, falling back to attribute parsing`)
        return null
      }
    }
    
    const sectionSyntaxIndicator = (buffer.readUInt8(1) & 0x80) !== 0
    const privateIndicator = (buffer.readUInt8(1) & 0x40) !== 0
    const sectionLength = buffer.readUInt16BE(1) & 0x0FFF
    
    const protocolVersion = buffer.readUInt8(3)
    const encryptedPacket = (buffer.readUInt8(4) & 0x80) !== 0
    const encryptionAlgorithm = encryptedPacket ? (buffer.readUInt8(4) & 0x7E) >> 1 : undefined
    
    // PTS adjustment (33 bits)
    const ptsAdjustment = readUInt40BE(buffer, 4) & 0x1FFFFFFFFn
    
    const cwIndex = buffer.readUInt8(9)
    const tier = (buffer.readUInt16BE(10) & 0x0FFF)
    
    const spliceCommandLength = buffer.readUInt16BE(12) & 0x0FFF
    const spliceCommandType = buffer.readUInt8(14)
    
    // Parse splice command
    let spliceCommand: SpliceInsert | TimeSignal | BandwidthReservation | undefined
    let commandEndOffset = 15
    
    if (spliceCommandLength > 0) {
      const commandData = buffer.slice(15, 15 + spliceCommandLength)
      
      switch (spliceCommandType) {
        case 0x05:  // splice_insert
          spliceCommand = parseSpliceInsert(commandData)
          break
        case 0x06:  // time_signal
          spliceCommand = parseTimeSignal(commandData)
          break
        case 0x07:  // bandwidth_reservation
          spliceCommand = {} as BandwidthReservation
          break
        default:
          console.warn(`Unknown splice_command_type: ${spliceCommandType}`)
      }
      
      commandEndOffset = 15 + spliceCommandLength
    } else {
      // Length 0xFFF means parse until descriptors
      commandEndOffset = 15
      // Would need to parse based on command type structure
    }
    
    // Parse descriptors
    const descriptorLoopLength = buffer.readUInt16BE(commandEndOffset)
    const descriptors: SpliceDescriptor[] = []
    
    let descriptorOffset = commandEndOffset + 2
    const descriptorEnd = descriptorOffset + descriptorLoopLength
    
    while (descriptorOffset < descriptorEnd && descriptorOffset < buffer.length - 4) {
      const descriptor = parseDescriptor(buffer, descriptorOffset)
      if (descriptor) {
        descriptors.push(descriptor)
        descriptorOffset += 2 + descriptor.length
      } else {
        break
      }
    }
    
    // Parse CRC
    const crcOffset = commandEndOffset + 2 + descriptorLoopLength
    const crc32 = buffer.readUInt32BE(crcOffset)
    
    // Validate CRC
    const crcValid = validateCRC32(buffer, crcOffset)
    
    // Apply PTS adjustment to splice commands (SCTE-35 spec section 9.2)
    if (ptsAdjustment > 0n && spliceCommand) {
      applySCTE35PTSAdjustment(spliceCommand, ptsAdjustment)
    }
    
    return {
      valid: true,
      tableId,
      sectionLength,
      protocolVersion,
      encryptedPacket,
      encryptionAlgorithm,
      ptsAdjustment,
      cwIndex,
      tier,
      spliceCommandLength,
      spliceCommandType,
      spliceCommand,
      descriptorLoopLength,
      descriptors,
      crc32,
      crcValid
    }
    
  } catch (error) {
    console.error('Failed to parse SCTE-35 binary:', error)
    return null
  }
}

// ============================================================================
// SPLICE COMMAND PARSERS
// ============================================================================

/**
 * Parse splice_insert command (Section 9.3.3)
 */
function parseSpliceInsert(buffer: BufferReader): SpliceInsert {
  const spliceEventId = buffer.readUInt32BE(0)
  const flags = buffer.readUInt8(4)
  
  const spliceEventCancelIndicator = (flags & 0x80) !== 0
  
  let offset = 5
  
  if (spliceEventCancelIndicator) {
    // Event is cancelled, no more data
    return {
      spliceEventId,
      spliceEventCancelIndicator: true,
      uniqueProgramId: 0,
      availNum: 0,
      availsExpected: 0
    }
  }
  
  const outOfNetworkIndicator = (flags & 0x40) !== 0
  const programSpliceFlag = (flags & 0x20) !== 0
  const durationFlag = (flags & 0x10) !== 0
  const spliceImmediateFlag = (flags & 0x08) !== 0
  const eventIdComplianceFlag = (flags & 0x04) !== 0
  
  // Parse splice time or component splices
  let spliceTime: SpliceTime | undefined
  let componentSplices: ComponentSplice[] | undefined
  
  if (programSpliceFlag && !spliceImmediateFlag) {
    const result = parseSpliceTime(buffer, offset)
    spliceTime = result.spliceTime
    offset = result.offset
  } else if (!programSpliceFlag) {
    const componentCount = buffer.readUInt8(offset)
    offset++
    
    componentSplices = []
    for (let i = 0; i < componentCount; i++) {
      const componentTag = buffer.readUInt8(offset)
      offset++
      
      if (spliceImmediateFlag) {
        componentSplices.push({ componentTag })
      } else {
        const result = parseSpliceTime(buffer, offset)
        componentSplices.push({
          componentTag,
          spliceTime: result.spliceTime
        })
        offset = result.offset
      }
    }
  }
  
  // Parse break duration
  let breakDuration: BreakDuration | undefined
  if (durationFlag) {
    const autoReturn = (buffer.readUInt8(offset) & 0x80) !== 0
    const reserved = (buffer.readUInt8(offset) & 0x7E) >> 1
    const duration = readUInt40BE(buffer, offset) & 0x1FFFFFFFFn
    
    breakDuration = {
      autoReturn,
      reserved,
      duration,
      durationSeconds: ticksToSeconds(duration)
    }
    
    offset += 5
  }
  
  const uniqueProgramId = buffer.readUInt16BE(offset)
  const availNum = buffer.readUInt8(offset + 2)
  const availsExpected = buffer.readUInt8(offset + 3)
  
  return {
    spliceEventId,
    spliceEventCancelIndicator: false,
    outOfNetworkIndicator,
    programSpliceFlag,
    durationFlag,
    spliceImmediateFlag,
    eventIdComplianceFlag,
    spliceTime,
    componentSplices,
    breakDuration,
    uniqueProgramId,
    availNum,
    availsExpected
  }
}

/**
 * Parse time_signal command (Section 9.3.4)
 */
function parseTimeSignal(buffer: BufferReader): TimeSignal {
  const result = parseSpliceTime(buffer, 0)
  return { spliceTime: result.spliceTime }
}

/**
 * Parse splice_time structure (Section 9.4.1)
 */
function parseSpliceTime(buffer: BufferReader, offset: number): { spliceTime: SpliceTime, offset: number } {
  const timeSpecifiedFlag = (buffer.readUInt8(offset) & 0x80) !== 0
  
  if (!timeSpecifiedFlag) {
    return {
      spliceTime: { timeSpecified: false },
      offset: offset + 1
    }
  }
  
  // Read 33-bit PTS time
  const ptsTime = readUInt40BE(buffer, offset) & 0x1FFFFFFFFn
  
  return {
    spliceTime: {
      timeSpecified: true,
      ptsTime
    },
    offset: offset + 5
  }
}

// ============================================================================
// DESCRIPTOR PARSERS
// ============================================================================

/**
 * Parse splice descriptor (Section 10)
 */
function parseDescriptor(buffer: BufferReader, offset: number): SpliceDescriptor | null {
  if (offset + 2 > buffer.length) return null
  
  const tag = buffer.readUInt8(offset)
  const length = buffer.readUInt8(offset + 1)
  
  if (offset + 2 + length > buffer.length) return null
  
  const descriptorSlice = buffer.slice(offset + 2, offset + 2 + length)
  const descriptorData = new BufferReader(descriptorSlice)
  
  // Check for SCTE-35 identifier "CUEI" (0x43554549)
  let data: any = descriptorData
  let identifier = ''
  
  if (length >= 4) {
    identifier = descriptorData.toString('ascii', 0, 4)
    
    if (identifier === 'CUEI') {
      // Parse specific descriptor types
      switch (tag) {
        case 0x00:  // avail_descriptor
          data = parseAvailDescriptor(descriptorData)
          break
        case 0x01:  // DTMF_descriptor
          data = parseDTMFDescriptor(descriptorData)
          break
        case 0x02:  // segmentation_descriptor
          data = parseSegmentationDescriptor(descriptorData)
          break
        case 0x03:  // time_descriptor
          data = parseTimeDescriptor(descriptorData)
          break
        default:
          // Unknown CUEI descriptor
          break
      }
    }
  }
  
  return {
    tag,
    length,
    identifier,
    data
  }
}

/**
 * Parse avail_descriptor (Section 10.3.1)
 */
function parseAvailDescriptor(buffer: BufferReader): AvailDescriptor {
  // Skip identifier "CUEI" (4 bytes)
  const providerAvailId = buffer.readUInt32BE(4)
  
  return { providerAvailId }
}

/**
 * Parse DTMF_descriptor (Section 10.3.2)
 */
function parseDTMFDescriptor(buffer: BufferReader): DTMFDescriptor {
  // Skip identifier "CUEI" (4 bytes)
  const preroll = buffer.readUInt8(4)
  const dtmfCount = (buffer.readUInt8(5) & 0xE0) >> 5
  
  const dtmfChars = buffer.toString('ascii', 6, 6 + dtmfCount)
  
  return { preroll, dtmfChars }
}

/**
 * Parse segmentation_descriptor (Section 10.3.3)
 * Most important descriptor for ad insertion
 */
function parseSegmentationDescriptor(buffer: BufferReader): SegmentationDescriptor {
  // Skip identifier "CUEI" (4 bytes)
  let offset = 4
  
  const segmentationEventId = buffer.readUInt32BE(offset)
  offset += 4
  
  const flags = buffer.readUInt8(offset)
  const segmentationEventCancelIndicator = (flags & 0x80) !== 0
  offset++
  
  if (segmentationEventCancelIndicator) {
    return {
      segmentationEventId,
      segmentationEventCancelIndicator: true,
      segmentationUpidType: 0,
      segmentationUpidLength: 0,
      segmentationUpid: '',
      segmentationTypeId: 0,
      segmentationTypeName: 'Event Cancelled'
    }
  }
  
  const programSegmentationFlag = (flags & 0x40) !== 0
  const segmentationDurationFlag = (flags & 0x20) !== 0
  const deliveryNotRestrictedFlag = (flags & 0x10) !== 0
  
  let webDeliveryAllowedFlag: boolean | undefined
  let noRegionalBlackoutFlag: boolean | undefined
  let archiveAllowedFlag: boolean | undefined
  let deviceRestrictions: number | undefined
  
  if (!deliveryNotRestrictedFlag) {
    const restrictionFlags = buffer.readUInt8(offset)
    webDeliveryAllowedFlag = (restrictionFlags & 0x80) !== 0
    noRegionalBlackoutFlag = (restrictionFlags & 0x40) !== 0
    archiveAllowedFlag = (restrictionFlags & 0x20) !== 0
    deviceRestrictions = (restrictionFlags & 0x18) >> 3
    offset++
  }
  
  // Component count (if not program-level)
  if (!programSegmentationFlag) {
    const componentCount = buffer.readUInt8(offset)
    offset++
    // Skip component tags (6 bytes each)
    offset += componentCount * 6
  }
  
  // Segmentation duration
  let segmentationDuration: bigint | undefined
  let segmentationDurationSeconds: number | undefined
  
  if (segmentationDurationFlag) {
    segmentationDuration = readUInt40BE(buffer, offset)
    segmentationDurationSeconds = ticksToSeconds(segmentationDuration)
    offset += 5
  }
  
  // UPID
  const segmentationUpidType = buffer.readUInt8(offset)
  offset++
  
  const segmentationUpidLength = buffer.readUInt8(offset)
  offset++
  
  const segmentationUpid = parseUPID(buffer, offset, segmentationUpidType, segmentationUpidLength)
  offset += segmentationUpidLength
  
  // Segmentation type
  const segmentationTypeId = buffer.readUInt8(offset)
  const segmentationTypeName = SEGMENTATION_TYPE_NAMES[segmentationTypeId] || `Unknown (0x${segmentationTypeId.toString(16)})`
  offset++
  
  // Segment number
  const segmentNum = buffer.readUInt8(offset)
  const segmentsExpected = buffer.readUInt8(offset + 1)
  offset += 2
  
  // Sub-segment (optional, check if data remains)
  let subSegmentNum: number | undefined
  let subSegmentsExpected: number | undefined
  
  if (offset + 1 < buffer.length) {
    subSegmentNum = buffer.readUInt8(offset)
    subSegmentsExpected = buffer.readUInt8(offset + 1)
  }
  
  return {
    segmentationEventId,
    segmentationEventCancelIndicator: false,
    programSegmentationFlag,
    segmentationDurationFlag,
    deliveryNotRestrictedFlag,
    webDeliveryAllowedFlag,
    noRegionalBlackoutFlag,
    archiveAllowedFlag,
    deviceRestrictions,
    segmentationDuration,
    segmentationDurationSeconds,
    segmentationUpidType,
    segmentationUpidLength,
    segmentationUpid,
    segmentationTypeId,
    segmentationTypeName,
    segmentNum: segmentNum || undefined,
    segmentsExpected: segmentsExpected || undefined,
    subSegmentNum,
    subSegmentsExpected
  }
}

/**
 * Parse time_descriptor (Section 10.3.4)
 */
function parseTimeDescriptor(buffer: BufferReader): TimeDescriptor {
  // Skip identifier "CUEI" (4 bytes)
  const taiSeconds = buffer.readBigUInt64BE(4) & 0xFFFFFFFFFFn  // 48 bits
  const taiNanoseconds = buffer.readUInt32BE(10)
  const utcOffset = buffer.readUInt16BE(14)
  
  return { taiSeconds, taiNanoseconds, utcOffset }
}

// ============================================================================
// UPID PARSERS (Section 10.3.3.1)
// ============================================================================

/**
 * Parse UPID (Unique Program Identifier) based on type
 * Supports all 16 UPID types
 */
function parseUPID(buffer: BufferReader, offset: number, type: number, length: number): string {
  const upidData = buffer.slice(offset, offset + length)
  
  switch (type) {
    case UPIDType.NOT_USED:
      return ''
    
    case UPIDType.USER_DEFINED:
    case UPIDType.URI:
      return upidData.toString('utf8')
    
    case UPIDType.ISCI:
      // ISCI code (Industry Standard Commercial Identifier)
      return upidData.toString('ascii')
    
    case UPIDType.AD_ID:
      // Ad-ID (advertising industry standard)
      return upidData.toString('ascii')
    
    case UPIDType.UMID:
      // SMPTE UMID (32 or 64 bytes)
      return upidData.toString('hex')
    
    case UPIDType.ISAN:
    case UPIDType.ISAN_DEPRECATED:
      // ISAN (International Standard Audiovisual Number)
      return upidData.toString('hex')
    
    case UPIDType.TID:
      // TID (Deprecated)
      return upidData.toString('ascii')
    
    case UPIDType.TI:
      // TI (Tribune Media Systems Program identifier)
      return upidData.toString('ascii')
    
    case UPIDType.ADI:
      // ADI (CableLabs ADI identifier)
      return upidData.toString('ascii')
    
    case UPIDType.EIDR:
      // EIDR (Entertainment Identifier Registry)
      return upidData.toString('hex')
    
    case UPIDType.ATSC_CONTENT_ID:
      // ATSC Content Identifier
      return upidData.toString('hex')
    
    case UPIDType.MPU:
      // MPU (Managed Private UPID)
      return upidData.toString('hex')
    
    case UPIDType.MID:
      // MID (Multiple UPID types)
      return upidData.toString('hex')
    
    case UPIDType.ADS_INFO:
      // ADS Information
      return upidData.toString('hex')
    
    default:
      // Unknown type - return hex
      return upidData.toString('hex')
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Read 40-bit (5 byte) big-endian unsigned integer
 */
function readUInt40BE(buffer: BufferReader, offset: number): bigint {
  const byte0 = BigInt(buffer.readUInt8(offset))
  const byte1 = BigInt(buffer.readUInt8(offset + 1))
  const byte2 = BigInt(buffer.readUInt8(offset + 2))
  const byte3 = BigInt(buffer.readUInt8(offset + 3))
  const byte4 = BigInt(buffer.readUInt8(offset + 4))
  
  return (byte0 << 32n) | (byte1 << 24n) | (byte2 << 16n) | (byte3 << 8n) | byte4
}

/**
 * Convert 90kHz ticks to seconds
 * SCTE-35 uses 90kHz clock (same as MPEG-2 PTS)
 */
export function ticksToSeconds(ticks: bigint): number {
  return Number(ticks) / 90000
}

/**
 * Convert seconds to 90kHz ticks
 */
export function secondsToTicks(seconds: number): bigint {
  return BigInt(Math.round(seconds * 90000))
}

/**
 * Validate CRC-32 checksum (Section 9.2)
 */
export function validateCRC32(buffer: BufferReader, crcOffset: number): boolean {
  // CRC-32 covers from start to end of descriptor loop
  const dataToCheck = buffer.slice(0, crcOffset)
  const receivedCRC = buffer.readUInt32BE(crcOffset)
  
  // Calculate CRC-32 (MPEG-2 polynomial)
  const calculatedCRC = calculateCRC32(dataToCheck)
  
  return receivedCRC === calculatedCRC
}

/**
 * Calculate CRC-32 using MPEG-2 polynomial
 */
function calculateCRC32(buffer: Uint8Array): number {
  let crc = 0xFFFFFFFF
  
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i] << 24
    
    for (let j = 0; j < 8; j++) {
      if (crc & 0x80000000) {
        crc = (crc << 1) ^ 0x04C11DB7
      } else {
        crc = crc << 1
      }
    }
  }
  
  return crc >>> 0  // Ensure unsigned 32-bit
}

/**
 * Check if SCTE-35 command is encrypted
 */
export function isSCTE35Encrypted(base64Cmd: string): boolean {
  try {
    const rawBuffer = base64ToUint8Array(base64Cmd)
    const buffer = new BufferReader(rawBuffer)
    if (buffer.length < 5) return false
    return (buffer.readUInt8(4) & 0x80) !== 0
  } catch {
    return false
  }
}

/**
 * Get UPID type name
 */
export function getUPIDTypeName(type: number): string {
  return UPIDType[type] || `Unknown (${type})`
}

// ============================================================================
// HIGH-LEVEL HELPER FUNCTIONS
// ============================================================================

/**
 * Extract precise PTS from SCTE-35 command (Quick Win function)
 */
export function extractPrecisePTS(base64Cmd: string): bigint | null {
  const parsed = parseSCTE35Binary(base64Cmd)
  if (!parsed || !parsed.valid) return null
  
  if (parsed.spliceCommandType === 0x05 && parsed.spliceCommand) {
    // splice_insert
    const si = parsed.spliceCommand as SpliceInsert
    return si.spliceTime?.ptsTime || null
  } else if (parsed.spliceCommandType === 0x06 && parsed.spliceCommand) {
    // time_signal
    const ts = parsed.spliceCommand as TimeSignal
    return ts.spliceTime?.ptsTime || null
  }
  
  return null
}

/**
 * Get break duration from splice command (in seconds)
 */
export function getBreakDurationFromBinary(base64Cmd: string): number | null {
  const parsed = parseSCTE35Binary(base64Cmd)
  if (!parsed || !parsed.valid || parsed.spliceCommandType !== 0x05) return null
  
  const si = parsed.spliceCommand as SpliceInsert
  return si.breakDuration?.durationSeconds || null
}

/**
 * Check if auto-return is set
 */
export function hasAutoReturn(base64Cmd: string): boolean {
  const parsed = parseSCTE35Binary(base64Cmd)
  if (!parsed || !parsed.valid || parsed.spliceCommandType !== 0x05) return false
  
  const si = parsed.spliceCommand as SpliceInsert
  return si.breakDuration?.autoReturn || false
}

/**
 * Extract all segmentation descriptors
 */
export function getSegmentationDescriptors(base64Cmd: string): SegmentationDescriptor[] {
  const parsed = parseSCTE35Binary(base64Cmd)
  if (!parsed || !parsed.valid) return []
  
  return parsed.descriptors
    .filter(d => d.tag === 0x02)
    .map(d => d.data as SegmentationDescriptor)
    .filter(d => d !== undefined)
}

/**
 * Create enhanced SCTE35Signal from binary data
 * Combines binary parsing with existing signal structure
 */
export function createEnhancedSignal(
  id: string,
  base64Cmd: string,
  fallbackAttrs?: Record<string, string>
): SCTE35Signal | null {
  const parsed = parseSCTE35Binary(base64Cmd)
  
  if (!parsed || !parsed.valid) {
    // Fall back to attribute-based parsing
    return null
  }
  
  // Extract primary metadata
  let duration: number | undefined
  let breakDuration: number | undefined
  let autoReturn = false
  let pts: bigint | undefined
  let spliceEventId: number | undefined
  
  if (parsed.spliceCommandType === 0x05) {
    const si = parsed.spliceCommand as SpliceInsert
    duration = si.breakDuration?.durationSeconds
    breakDuration = duration
    autoReturn = si.breakDuration?.autoReturn || false
    pts = si.spliceTime?.ptsTime
    spliceEventId = si.spliceEventId
  } else if (parsed.spliceCommandType === 0x06) {
    const ts = parsed.spliceCommand as TimeSignal
    pts = ts.spliceTime?.ptsTime
    
    // Duration from segmentation descriptor
    const segDesc = parsed.descriptors.find(d => d.tag === 0x02)
    if (segDesc) {
      const sd = segDesc.data as SegmentationDescriptor
      duration = sd.segmentationDurationSeconds
      breakDuration = duration
    }
  }
  
  // Extract segmentation info
  const segmentationDescriptor = parsed.descriptors.find(d => d.tag === 0x02)
  let segmentationType: string | undefined
  let upid: string | undefined
  let segmentNum: number | undefined
  let segmentsExpected: number | undefined
  
  if (segmentationDescriptor) {
    const sd = segmentationDescriptor.data as SegmentationDescriptor
    segmentationType = sd.segmentationTypeName
    upid = sd.segmentationUpid || undefined
    segmentNum = sd.segmentNum
    segmentsExpected = sd.segmentsExpected
  }
  
  // Determine signal type
  let type: "splice_insert" | "time_signal" | "return_signal" = "time_signal"
  if (parsed.spliceCommandType === 0x05) {
    type = "splice_insert"
  }
  
  // Extract delivery restrictions if available
  let deliveryRestrictions: any = undefined
  if (segmentationDescriptor) {
    const sd = segmentationDescriptor.data as SegmentationDescriptor
    if (sd.deliveryNotRestrictedFlag === false) {
      deliveryRestrictions = {
        webAllowed: sd.webDeliveryAllowedFlag,
        noRegionalBlackout: sd.noRegionalBlackoutFlag,
        archiveAllowed: sd.archiveAllowedFlag,
        deviceRestrictions: sd.deviceRestrictions
      }
    }
  }
  
  return {
    id,
    type,
    pts: pts ? Number(pts) : undefined,
    duration,
    segmentationType: segmentationType as any,
    upid,
    breakDuration,
    autoReturn,
    segmentNum,
    segmentsExpected,
    // Enhanced binary data
    binaryData: {
      spliceEventId,
      protocolVersion: parsed.protocolVersion,
      ptsAdjustment: parsed.ptsAdjustment,
      crcValid: parsed.crcValid,
      segmentationDescriptors: parsed.descriptors
        .filter(d => d.tag === 0x02)
        .map(d => d.data),
      deliveryRestrictions
    }
  }
}

