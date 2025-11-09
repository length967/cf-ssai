const DEFAULT_CLOCK_HZ = 90000

export const MPEG_CLOCK_HZ = DEFAULT_CLOCK_HZ

export type IDRSource = "encoder" | "segmenter"

export interface IDRTimestamp {
  pts: number
  timeSeconds: number
  source: IDRSource
  sequence?: number
  raw?: unknown
}

export interface IDRTimeline {
  variant?: string
  updatedAt: number
  values: IDRTimestamp[]
  sourceCounts: Record<IDRSource, number>
}

export interface EncoderIDRMetadata {
  variant?: string
  idrPts?: Array<number | string | bigint>
  idrTimes?: Array<number | string>
  cues?: RawIdrValue[]
  frames?: RawIdrValue[]
  timeline?: { idrs?: RawIdrValue[] }
  [key: string]: unknown
}

export interface SegmenterIDRCallback {
  pts?: number | string | bigint
  ptsTime?: number | string
  timeSeconds?: number | string
  idrPts?: number | string | bigint
  idrTime?: number | string
  sequence?: number | string
  [key: string]: unknown
}

type RawIdrValue = number | string | bigint | Record<string, unknown>

export interface CollectIdrTimestampsOptions {
  existing?: IDRTimeline | null
  variant?: string
  encoder?: EncoderIDRMetadata | EncoderIDRMetadata[]
  segmenter?: SegmenterIDRCallback | SegmenterIDRCallback[]
  maxEntries?: number
  clockRate?: number
}

export function collectIdrTimestamps(options: CollectIdrTimestampsOptions): IDRTimeline {
  const {
    existing = null,
    variant,
    encoder,
    segmenter,
    maxEntries = 512,
    clockRate = DEFAULT_CLOCK_HZ
  } = options

  const normalized: IDRTimestamp[] = []
  const encoderArray = encoder ? (Array.isArray(encoder) ? encoder : [encoder]) : []
  const segmenterArray = segmenter ? (Array.isArray(segmenter) ? segmenter : [segmenter]) : []

  let variantHint = variant || existing?.variant

  for (const meta of encoderArray) {
    if (meta?.variant && !variantHint) {
      variantHint = String(meta.variant)
    }
    normalized.push(...normalizeEncoderMetadata(meta, clockRate))
  }

  for (const callback of segmenterArray) {
    normalized.push(...normalizeSegmenterCallback(callback, clockRate))
  }

  if (!normalized.length && existing) {
    return { ...existing }
  }

  const merged = new Map<number, IDRTimestamp>()

  if (existing?.values?.length) {
    for (const entry of existing.values) {
      merged.set(entry.pts, { ...entry })
    }
  }

  for (const entry of normalized) {
    if (!Number.isFinite(entry.pts)) continue
    const rounded = Math.round(entry.pts)
    const candidate = { ...entry, pts: rounded }
    const current = merged.get(rounded)
    if (!current) {
      merged.set(rounded, candidate)
      continue
    }

    if (current.source === "segmenter" && candidate.source === "encoder") {
      merged.set(rounded, candidate)
    }
  }

  const values = Array.from(merged.values()).sort((a, b) => a.pts - b.pts)
  if (values.length > maxEntries) {
    values.splice(0, values.length - maxEntries)
  }

  const sourceCounts: Record<IDRSource, number> = { encoder: 0, segmenter: 0 }
  for (const entry of values) {
    sourceCounts[entry.source]++
  }

  return {
    variant: variantHint,
    updatedAt: Date.now(),
    values,
    sourceCounts
  }
}

export type SnapReason = "exact" | "future" | "previous" | "none"

export interface SnapOptions {
  lookAheadPts?: number
  fallbackToPrevious?: boolean
}

export interface SnapDecision {
  cuePts: number
  snappedPts: number
  deltaPts: number
  deltaSeconds: number
  reason: SnapReason
  source: IDRSource | "none"
  timelineLength: number
  lookAheadPts: number
  fallbackToPrevious: boolean
}

export function snapCueToIdr(
  timeline: IDRTimeline | IDRTimestamp[] | null | undefined,
  cuePts: number,
  options: SnapOptions = {}
): SnapDecision {
  const lookAheadPts = options.lookAheadPts ?? DEFAULT_CLOCK_HZ * 2
  const fallbackToPrevious = options.fallbackToPrevious !== undefined ? options.fallbackToPrevious : true
  const values = Array.isArray(timeline)
    ? timeline
    : timeline?.values ?? []

  let snapped = cuePts
  let reason: SnapReason = "none"
  let source: IDRSource | "none" = "none"

  if (values.length) {
    const future = values.find(entry => entry.pts >= cuePts)
    if (future && future.pts - cuePts <= lookAheadPts) {
      snapped = future.pts
      source = future.source
      reason = future.pts === cuePts ? "exact" : "future"
    } else if (fallbackToPrevious) {
      const previous = findPrevious(values, cuePts)
      if (previous) {
        snapped = previous.pts
        source = previous.source
        reason = "previous"
      }
    }
  }

  const deltaPts = snapped - cuePts
  const deltaSeconds = deltaPts / DEFAULT_CLOCK_HZ

  return {
    cuePts,
    snappedPts: snapped,
    deltaPts,
    deltaSeconds,
    reason,
    source,
    timelineLength: values.length,
    lookAheadPts,
    fallbackToPrevious
  }
}

export interface ValidateBoundaryOptions {
  tolerancePts?: number
}

export interface BoundaryValidation {
  withinTolerance: boolean
  tolerancePts: number
  toleranceSeconds: number
  errorPts: number
  errorSeconds: number
  absoluteErrorPts: number
  absoluteErrorSeconds: number
  snappedAhead: boolean
}

export function validateBoundaryError(
  decision: SnapDecision,
  options: ValidateBoundaryOptions = {}
): BoundaryValidation {
  const tolerancePts = options.tolerancePts ?? Math.round(DEFAULT_CLOCK_HZ / 2)
  const toleranceSeconds = tolerancePts / DEFAULT_CLOCK_HZ
  const errorPts = decision.deltaPts
  const errorSeconds = errorPts / DEFAULT_CLOCK_HZ
  const absoluteErrorPts = Math.abs(errorPts)
  const absoluteErrorSeconds = absoluteErrorPts / DEFAULT_CLOCK_HZ

  return {
    withinTolerance: absoluteErrorPts <= tolerancePts,
    tolerancePts,
    toleranceSeconds,
    errorPts,
    errorSeconds,
    absoluteErrorPts,
    absoluteErrorSeconds,
    snappedAhead: errorPts >= 0
  }
}

export interface BoundaryDecisionRecord {
  decision: SnapDecision
  validation: BoundaryValidation
}

export class BoundaryDecisionRecorder {
  private records: BoundaryDecisionRecord[] = []

  record(decision: SnapDecision, validation: BoundaryValidation): void {
    this.records.push({ decision, validation })
  }

  list(): BoundaryDecisionRecord[] {
    return [...this.records]
  }

  clear(): void {
    this.records = []
  }
}

function normalizeEncoderMetadata(meta: EncoderIDRMetadata, clockRate: number): IDRTimestamp[] {
  const results: IDRTimestamp[] = []
  if (!meta) return results

  const rawValues: RawIdrValue[] = []

  if (Array.isArray(meta.idrPts)) {
    rawValues.push(...meta.idrPts)
  }
  if (Array.isArray(meta.idrTimes)) {
    for (const seconds of meta.idrTimes) {
      rawValues.push({ seconds })
    }
  }
  if (Array.isArray(meta.cues)) {
    rawValues.push(...meta.cues)
  }
  if (Array.isArray(meta.frames)) {
    rawValues.push(...meta.frames)
  }
  if (meta.timeline && Array.isArray(meta.timeline.idrs)) {
    rawValues.push(...meta.timeline.idrs)
  }

  if (!rawValues.length) {
    rawValues.push(meta as RawIdrValue)
  }

  for (const value of rawValues) {
    const entry = createTimestamp(value, "encoder", clockRate)
    if (entry) {
      results.push(entry)
    }
  }

  return results
}

function normalizeSegmenterCallback(callback: SegmenterIDRCallback, clockRate: number): IDRTimestamp[] {
  if (!callback) return []
  const rawValues: RawIdrValue[] = []

  const possible: RawIdrValue[] = []
  if (callback.idrPts !== undefined) possible.push(callback.idrPts)
  if (callback.pts !== undefined) possible.push(callback.pts)
  if (callback.ptsTime !== undefined) possible.push({ seconds: callback.ptsTime })
  if (callback.timeSeconds !== undefined) possible.push({ seconds: callback.timeSeconds })
  if (callback.idrTime !== undefined) possible.push({ seconds: callback.idrTime })

  rawValues.push(...possible)
  if (!rawValues.length) {
    rawValues.push(callback as RawIdrValue)
  }

  const results: IDRTimestamp[] = []
  for (const value of rawValues) {
    const entry = createTimestamp(value, "segmenter", clockRate)
    if (!entry) continue
    if (callback.sequence !== undefined) {
      const seqNumber = Number(callback.sequence)
      if (Number.isFinite(seqNumber)) {
        entry.sequence = seqNumber
      }
    }
    if (entry.raw === undefined) {
      entry.raw = callback
    }
    results.push(entry)
  }
  return results
}

function createTimestamp(value: RawIdrValue, source: IDRSource, clockRate: number): IDRTimestamp | null {
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    const coalesced = coerceNumeric(value, clockRate)
    if (!coalesced) return null
    return { ...coalesced, source }
  }

  if (value && typeof value === "object") {
    const objectEntry = coerceFromObject(value, clockRate)
    if (!objectEntry) return null
    return { ...objectEntry, source, raw: value }
  }

  return null
}

function coerceNumeric(value: number | string | bigint, clockRate: number): { pts: number; timeSeconds: number } | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const pts = Math.round(value)
    return { pts, timeSeconds: pts / clockRate }
  }

  if (typeof value === "bigint") {
    const pts = Number(value)
    if (!Number.isFinite(pts)) return null
    return { pts, timeSeconds: pts / clockRate }
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    const num = Number(trimmed)
    if (!Number.isFinite(num)) return null
    const pts = Math.round(num)
    return { pts, timeSeconds: pts / clockRate }
  }

  return null
}

function coerceFromObject(value: Record<string, unknown>, clockRate: number): IDRTimestamp | null {
  const ptsCandidate =
    value.pts ??
    value.pts90k ??
    value.timestamp90k ??
    value.timecode ??
    value.timecode90k ??
    value.position ??
    value.idrPts

  let numeric = ptsCandidate !== undefined ? coerceNumeric(ptsCandidate as number | string | bigint, clockRate) : null

  if (!numeric) {
    const secondsCandidate =
      value.seconds ??
      value.timeSeconds ??
      value.time ??
      value.timestampSeconds ??
      value.idrTime

    if (secondsCandidate !== undefined) {
      const seconds = Number(secondsCandidate)
      if (Number.isFinite(seconds)) {
        numeric = {
          pts: Math.round(seconds * clockRate),
          timeSeconds: seconds
        }
      }
    }
  }

  if (!numeric) return null

  let sequence: number | undefined
  const sequenceCandidate = value.sequence ?? value.segmentId ?? value.index ?? value.mediaSequence
  if (sequenceCandidate !== undefined) {
    const seqNumber = Number(sequenceCandidate)
    if (Number.isFinite(seqNumber)) {
      sequence = seqNumber
    }
  }

  return {
    pts: numeric.pts,
    timeSeconds: numeric.timeSeconds,
    source: "encoder",
    sequence,
    raw: value
  }
}

function findPrevious(values: IDRTimestamp[], cuePts: number): IDRTimestamp | null {
  let candidate: IDRTimestamp | null = null
  for (const entry of values) {
    if (entry.pts < cuePts) {
      if (!candidate || entry.pts > candidate.pts) {
        candidate = entry
      }
    }
  }
  return candidate
}
