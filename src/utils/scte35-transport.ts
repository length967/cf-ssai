import { parseSCTE35Binary, type SegmentationDescriptor, type SpliceInsert, type TimeSignal } from "./scte35-binary"
import type { Scte35Event, Scte35SpliceType } from "../types"

const TS_PACKET_SIZE = 188
const SYNC_BYTE = 0x47
const PAT_PID = 0x0000
const STREAM_TYPE_SCTE35 = 0x86

interface SectionAssembler {
  buffer: Uint8Array
  expectedLength?: number
  startContinuity?: number
}

export interface TransportStreamState {
  programNumber?: number
  pmtPid?: number
  sctePid?: number
  continuityCounters: Map<number, number>
  assembler: SectionAssembler
}

export function createTransportStreamState(): TransportStreamState {
  return {
    continuityCounters: new Map(),
    assembler: { buffer: new Uint8Array(0) }
  }
}

export function ingestTransportStreamSegment(
  segment: Uint8Array | ArrayBuffer,
  state: TransportStreamState
): { events: Scte35Event[] } {
  const data = segment instanceof Uint8Array ? segment : new Uint8Array(segment)
  const events: Scte35Event[] = []

  for (let offset = 0; offset + TS_PACKET_SIZE <= data.length; offset += TS_PACKET_SIZE) {
    const packet = data.subarray(offset, offset + TS_PACKET_SIZE)
    if (packet[0] !== SYNC_BYTE) {
      console.warn(`SCTE-35 ingest: invalid sync byte 0x${packet[0].toString(16)} at offset ${offset}`)
      continue
    }

    const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0
    const pid = ((packet[1] & 0x1f) << 8) | packet[2]
    const adaptationFieldControl = (packet[3] >> 4) & 0x03
    const continuityCounter = packet[3] & 0x0f

    trackContinuity(state, pid, continuityCounter, (adaptationFieldControl & 0x01) !== 0)

    const payload = extractPayload(packet, adaptationFieldControl)
    if (!payload || payload.length === 0) {
      continue
    }

    if (pid === PAT_PID) {
      parsePat(payload, payloadUnitStartIndicator, state)
      continue
    }

    if (pid === state.pmtPid) {
      parsePmt(payload, payloadUnitStartIndicator, state)
      continue
    }

    if (state.sctePid !== undefined && pid === state.sctePid) {
      const newEvents = parseSctePayload(payload, payloadUnitStartIndicator, continuityCounter, state)
      events.push(...newEvents)
    }
  }

  return { events }
}

function extractPayload(packet: Uint8Array, adaptationFieldControl: number): Uint8Array | null {
  if ((adaptationFieldControl & 0x01) === 0) {
    return null
  }

  let offset = 4
  if (adaptationFieldControl === 2) {
    return null
  }

  if (adaptationFieldControl === 3) {
    const adaptationLength = packet[offset]
    offset += 1 + adaptationLength
  }

  if (offset >= packet.length) {
    return null
  }

  return packet.subarray(offset)
}

function parsePat(payload: Uint8Array, payloadUnitStartIndicator: boolean, state: TransportStreamState): void {
  let offset = 0

  if (payloadUnitStartIndicator) {
    const pointerField = payload[offset]
    offset += 1 + pointerField
  }

  if (offset + 8 > payload.length) return

  const tableId = payload[offset]
  if (tableId !== 0x00) return

  const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2]
  const sectionEnd = offset + 3 + sectionLength
  if (sectionEnd > payload.length) return

  offset += 8 // skip table header (transport_stream_id, version, section numbers)

  while (offset + 4 <= sectionEnd - 4) {
    const programNumber = (payload[offset] << 8) | payload[offset + 1]
    const programMapPid = ((payload[offset + 2] & 0x1f) << 8) | payload[offset + 3]
    offset += 4

    if (programNumber !== 0) {
      if (state.pmtPid !== programMapPid) {
        console.log(`SCTE-35 ingest: PMT PID discovered -> 0x${programMapPid.toString(16)}`)
      }
      state.programNumber = programNumber
      state.pmtPid = programMapPid
      break
    }
  }
}

function parsePmt(payload: Uint8Array, payloadUnitStartIndicator: boolean, state: TransportStreamState): void {
  let offset = 0

  if (payloadUnitStartIndicator) {
    const pointerField = payload[offset]
    offset += 1 + pointerField
  }

  if (offset + 12 > payload.length) return

  const tableId = payload[offset]
  if (tableId !== 0x02) return

  const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2]
  const sectionEnd = offset + 3 + sectionLength
  if (sectionEnd > payload.length) return

  offset += 10 // program_number, version, section numbers, PCR PID

  const programInfoLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1]
  offset += 2 + programInfoLength

  while (offset + 5 <= sectionEnd - 4) {
    const streamType = payload[offset]
    const elementaryPid = ((payload[offset + 1] & 0x1f) << 8) | payload[offset + 2]
    const esInfoLength = ((payload[offset + 3] & 0x0f) << 8) | payload[offset + 4]
    offset += 5 + esInfoLength

    if (streamType === STREAM_TYPE_SCTE35) {
      if (state.sctePid !== elementaryPid) {
        console.log(`SCTE-35 ingest: SCTE PID discovered -> 0x${elementaryPid.toString(16)}`)
      }
      state.sctePid = elementaryPid
    }
  }
}

function parseSctePayload(
  payload: Uint8Array,
  payloadUnitStartIndicator: boolean,
  continuityCounter: number,
  state: TransportStreamState
): Scte35Event[] {
  const assembler = state.assembler

  if (payloadUnitStartIndicator) {
    assembler.buffer = new Uint8Array(0)
    assembler.expectedLength = undefined
    assembler.startContinuity = continuityCounter
    payload = stripPesHeader(payload)
  }

  if (payload.length === 0) {
    return []
  }

  assembler.buffer = concatBuffers(assembler.buffer, payload)

  if (assembler.expectedLength === undefined && assembler.buffer.length >= 3) {
    const sectionLength = ((assembler.buffer[1] & 0x0f) << 8) | assembler.buffer[2]
    assembler.expectedLength = sectionLength + 3
  }

  const events: Scte35Event[] = []

  while (assembler.expectedLength && assembler.buffer.length >= assembler.expectedLength) {
    const section = assembler.buffer.subarray(0, assembler.expectedLength)
    assembler.buffer = assembler.buffer.subarray(assembler.expectedLength)
    const nextLength = assembler.buffer.length >= 3
      ? (((assembler.buffer[1] & 0x0f) << 8) | assembler.buffer[2]) + 3
      : undefined
    assembler.expectedLength = nextLength

    const event = buildEventFromSection(section, assembler.startContinuity ?? continuityCounter)
    if (event) {
      console.log(`SCTE-35 ingest: event ${event.id} type=${event.type} pts=${event.pts90k} cc=${event.continuityCounter} crc=${event.crcValid}`)
      events.push(event)
    }

    assembler.startContinuity = undefined
  }

  return events
}

function stripPesHeader(payload: Uint8Array): Uint8Array {
  if (payload.length >= 3 && payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x01) {
    if (payload.length < 9) {
      return new Uint8Array(0)
    }
    const pesHeaderLength = payload[8]
    const start = 9 + pesHeaderLength
    if (start >= payload.length) {
      return new Uint8Array(0)
    }
    return payload.subarray(start)
  }

  if (payload.length === 0) return payload

  const pointerField = payload[0]
  const start = 1 + pointerField
  if (start >= payload.length) {
    return new Uint8Array(0)
  }
  return payload.subarray(start)
}

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function buildEventFromSection(section: Uint8Array, continuityCounter: number): Scte35Event | null {
  if (section.length < 3) return null
  const tableId = section[0]
  if (tableId !== 0xFC) {
    console.warn(`SCTE-35 ingest: unexpected table_id 0x${tableId.toString(16)}`)
    return null
  }

  if (!validateSectionCrc(section)) {
    console.warn("SCTE-35 ingest: CRC validation failed, dropping cue")
    return null
  }

  const parsed = parseSCTE35Binary(uint8ArrayToBase64(section))
  if (!parsed || !parsed.valid) {
    console.warn("SCTE-35 ingest: binary parser rejected section")
    return null
  }

  const segmentationDescriptor = parsed.descriptors.find(d => d.tag === 0x02)
  const sd = segmentationDescriptor ? (segmentationDescriptor.data as SegmentationDescriptor) : undefined

  const spliceInsert = parsed.spliceCommandType === 0x05 ? parsed.spliceCommand as SpliceInsert : undefined
  const timeSignal = parsed.spliceCommandType === 0x06 ? parsed.spliceCommand as TimeSignal : undefined

  const pts90k = extractPts(spliceInsert, timeSignal)
  const breakDuration90k = extractBreakDuration(spliceInsert, sd)

  const classification = classifyEvent(spliceInsert, sd)
  if (!classification) {
    return null
  }

  const id = deriveEventId(spliceInsert, sd, classification.type)

  return {
    id,
    type: classification.type,
    pts90k,
    breakDuration90k,
    rawHex: `0x${uint8ArrayToHex(section)}`,
    continuityCounter,
    crcValid: parsed.crcValid ?? true,
    recvAtMs: Date.now(),
    tier: parsed.tier,
    segmentationTypeId: sd?.segmentationTypeId,
    segmentationTypeName: sd?.segmentationTypeName,
    spliceEventId: spliceInsert?.spliceEventId,
    segmentationEventId: sd?.segmentationEventId,
  }
}

function extractPts(spliceInsert: SpliceInsert | undefined, timeSignal: TimeSignal | undefined): number {
  if (spliceInsert?.spliceTime?.ptsTime !== undefined) {
    return Number(spliceInsert.spliceTime.ptsTime)
  }
  if (timeSignal?.spliceTime?.ptsTime !== undefined) {
    return Number(timeSignal.spliceTime.ptsTime)
  }
  return 0
}

function extractBreakDuration(spliceInsert: SpliceInsert | undefined, sd: SegmentationDescriptor | undefined): number | undefined {
  if (spliceInsert?.breakDuration?.duration !== undefined) {
    return Number(spliceInsert.breakDuration.duration)
  }
  if (sd?.segmentationDuration !== undefined) {
    return Number(sd.segmentationDuration)
  }
  if (sd?.segmentationDurationSeconds !== undefined) {
    return Math.round(sd.segmentationDurationSeconds * 90000)
  }
  return undefined
}

function deriveEventId(
  spliceInsert: SpliceInsert | undefined,
  sd: SegmentationDescriptor | undefined,
  type: Scte35SpliceType
): string {
  if (sd?.segmentationEventId !== undefined) {
    return String(sd.segmentationEventId)
  }
  if (spliceInsert?.spliceEventId !== undefined) {
    return String(spliceInsert.spliceEventId)
  }
  return `${type}-${Date.now()}`
}

function classifyEvent(
  spliceInsert: SpliceInsert | undefined,
  sd: SegmentationDescriptor | undefined
): { type: Scte35SpliceType } | null {
  if (sd?.segmentationTypeId !== undefined) {
    const mapped = mapSegmentationType(sd.segmentationTypeId)
    if (mapped) {
      return { type: mapped }
    }
  }

  if (spliceInsert) {
    if (spliceInsert.outOfNetworkIndicator) {
      return { type: "OUT" }
    }
    if (spliceInsert.outOfNetworkIndicator === false) {
      return { type: "IN" }
    }
  }

  return null
}

function mapSegmentationType(segmentationTypeId: number): Scte35SpliceType | null {
  const outTypes = new Set([0x10, 0x14, 0x22, 0x30, 0x34, 0x36])
  const inTypes = new Set([0x11, 0x15, 0x23, 0x31, 0x35, 0x37])

  if (outTypes.has(segmentationTypeId)) return "OUT"
  if (inTypes.has(segmentationTypeId)) return "IN"
  return null
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

function validateSectionCrc(section: Uint8Array): boolean {
  if (section.length < 4) return false
  const data = section.subarray(0, section.length - 4)
  const expectedCrc =
    (section[section.length - 4] << 24) |
    (section[section.length - 3] << 16) |
    (section[section.length - 2] << 8) |
    section[section.length - 1]
  const actual = calculateCrc32(data)
  return (expectedCrc >>> 0) === actual
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 24
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x80000000) !== 0) {
        crc = (crc << 1) ^ 0x04c11db7
      } else {
        crc <<= 1
      }
    }
  }

  return (crc >>> 0)
}

function trackContinuity(state: TransportStreamState, pid: number, counter: number, hasPayload: boolean): void {
  if (!hasPayload) {
    state.continuityCounters.set(pid, counter)
    return
  }

  const previous = state.continuityCounters.get(pid)
  if (previous !== undefined) {
    const expected = (previous + 1) & 0x0f
    if (counter !== expected && counter !== previous) {
      console.warn(`SCTE-35 ingest: continuity jump on PID 0x${pid.toString(16)} expected=${expected} actual=${counter}`)
    }
  }
  state.continuityCounters.set(pid, counter)
}
