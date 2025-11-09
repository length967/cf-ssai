type Sample = { pts90k: number; pdtMs: number }

export interface PtsPdtMapping {
  slopeMsPerTick: number
  interceptMs: number
  samples: Sample[]
  lastUpdatedMs: number
  lastDriftMs?: number
}

const DEFAULT_SLOPE = 1000 / 90000
const MAX_SAMPLES = 24
const MAX_DRIFT_WARN_MS = 250

function isFiniteNumber(value: number): value is number {
  return Number.isFinite(value)
}

export function addPtsPdtSample(mapping: PtsPdtMapping | undefined, sample: Sample): PtsPdtMapping {
  const previousPrediction = mapping ? predictPtsToMs(mapping, sample.pts90k) : undefined

  const samples = mapping ? [...mapping.samples] : []
  const existingIndex = samples.findIndex(s => Math.abs(s.pts90k - sample.pts90k) < 1)
  if (existingIndex >= 0) {
    samples[existingIndex] = sample
  } else {
    samples.push(sample)
    samples.sort((a, b) => a.pts90k - b.pts90k)
    if (samples.length > MAX_SAMPLES) {
      samples.shift()
    }
  }

  let slope = DEFAULT_SLOPE
  let intercept = sample.pdtMs - slope * sample.pts90k

  if (samples.length >= 2) {
    const stats = computeLeastSquares(samples)
    if (stats) {
      slope = stats.slope
      intercept = stats.intercept
    }
  }

  const drift = previousPrediction !== undefined ? sample.pdtMs - previousPrediction : undefined

  if (drift !== undefined && Math.abs(drift) > MAX_DRIFT_WARN_MS) {
    console.warn(`PTS↔PDT drift exceeded ${MAX_DRIFT_WARN_MS}ms: drift=${drift.toFixed(2)}ms`)
  }

  return {
    slopeMsPerTick: slope,
    interceptMs: intercept,
    samples,
    lastUpdatedMs: Date.now(),
    lastDriftMs: drift,
  }
}

export function resetPtsPdtMapping(): undefined {
  return undefined
}

export function predictPtsToMs(mapping: PtsPdtMapping, pts90k: number): number | undefined {
  if (!mapping) return undefined
  const value = mapping.slopeMsPerTick * pts90k + mapping.interceptMs
  return isFiniteNumber(value) ? value : undefined
}

export function predictPtsToIso(mapping: PtsPdtMapping | undefined, pts90k: number): string | undefined {
  if (!mapping) return undefined
  const ms = predictPtsToMs(mapping, pts90k)
  if (ms === undefined) return undefined
  return new Date(ms).toISOString()
}

function computeLeastSquares(samples: Sample[]): { slope: number; intercept: number } | null {
  const n = samples.length
  if (n < 2) return null

  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0

  for (const { pts90k, pdtMs } of samples) {
    sumX += pts90k
    sumY += pdtMs
    sumXX += pts90k * pts90k
    sumXY += pts90k * pdtMs
  }

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) {
    return null
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  if (!isFiniteNumber(slope) || slope <= 0) {
    return null
  }

  const intercept = (sumY - slope * sumX) / n
  if (!isFiniteNumber(intercept)) {
    return null
  }

  return { slope, intercept }
}
