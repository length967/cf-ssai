export const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * Window bucketing for live cache keys.
 * Workers do not expose process.env; pass stride explicitly from env.
 */
export function windowBucket(seconds: number, strideSec: number = 2) {
  const stride = Number.isFinite(strideSec) && strideSec > 0 ? Math.floor(strideSec) : 2
  return Math.floor(seconds / stride)
}

const PTS_WRAP = 1n << 33n
const TICKS_PER_SECOND = 90000n

type CalibrationPoint = {
  rawPts: bigint
  unwrappedPts: bigint
  pdtMs: number
}

/**
 * Maintains a mapping between MPEG-TS presentation timestamps (PTS) and
 * EXT-X-PROGRAM-DATE-TIME (PDT) values. Segments that expose both values are
 * used as calibration points so future cues can be aligned precisely even when
 * only PTS is available (common for SCTE-35 driven interstitials).
 */
export class PtsPdtMap {
  private calibrations: CalibrationPoint[] = []
  private offset: bigint = 0n
  private lastRawPts: bigint | null = null
  private readonly maxPoints: number

  constructor(maxPoints = 32) {
    this.maxPoints = Math.max(1, maxPoints)
  }

  /** Reset accumulated calibration state (e.g., after #EXT-X-DISCONTINUITY). */
  reset() {
    this.calibrations = []
    this.offset = 0n
    this.lastRawPts = null
  }

  /** Number of calibration points currently retained. */
  get calibrationCount(): number {
    return this.calibrations.length
  }

  /** Latest calibration point (if any). */
  get latest(): CalibrationPoint | null {
    return this.calibrations.length > 0 ? this.calibrations[this.calibrations.length - 1] : null
  }

  /**
   * Add a calibration sample.
   *
   * @param pts  MPEG-TS presentation timestamp (90kHz ticks)
   * @param pdtIso ISO 8601 timestamp for the same segment boundary
   * @returns true if the sample was stored, false if invalid input
   */
  ingest(pts: bigint | number, pdtIso: string | Date): boolean {
    if (pts === null || pts === undefined || pdtIso === null || pdtIso === undefined) return false

    const rawPts = typeof pts === 'bigint' ? pts : BigInt(Math.floor(pts))
    const iso = typeof pdtIso === 'string' ? pdtIso : pdtIso.toISOString()
    const pdtMs = Date.parse(iso)

    if (!Number.isFinite(pdtMs)) return false

    const unwrappedPts = this.unwrap(rawPts)

    this.calibrations.push({ rawPts, unwrappedPts, pdtMs })
    if (this.calibrations.length > this.maxPoints) {
      this.calibrations.shift()
    }

    return true
  }

  /** Estimate wall-clock time for a given PTS using stored calibration points. */
  estimate(pts: bigint | number): { ms: number, iso: string } | null {
    if (this.calibrations.length === 0) return null

    const raw = typeof pts === 'bigint' ? pts : BigInt(Math.floor(pts))
    const reference = this.calibrations[0]
    const last = this.calibrations[this.calibrations.length - 1]

    // Align raw PTS with the most recent continuity window.
    let unwrapped = raw + (last.unwrappedPts - last.rawPts)
    const halfWrap = PTS_WRAP / 2n

    if (unwrapped < last.unwrappedPts - halfWrap) {
      const diff = (last.unwrappedPts - unwrapped + PTS_WRAP - 1n) / PTS_WRAP
      unwrapped += diff * PTS_WRAP
    } else if (unwrapped > last.unwrappedPts + halfWrap) {
      const diff = (unwrapped - last.unwrappedPts + PTS_WRAP - 1n) / PTS_WRAP
      unwrapped -= diff * PTS_WRAP
    }

    const deltaTicks = Number(unwrapped - reference.unwrappedPts)
    const seconds = deltaTicks / Number(TICKS_PER_SECOND)
    const predictedMs = reference.pdtMs + seconds * 1000

    return { ms: predictedMs, iso: new Date(predictedMs).toISOString() }
  }

  /** Internal helper to unwrap 33-bit PTS values across continuity boundaries. */
  private unwrap(raw: bigint): bigint {
    if (this.lastRawPts !== null) {
      if (raw < this.lastRawPts && this.lastRawPts - raw > PTS_WRAP / 2n) {
        this.offset += PTS_WRAP
      } else if (raw > this.lastRawPts && raw - this.lastRawPts > PTS_WRAP / 2n && this.offset >= PTS_WRAP) {
        this.offset -= PTS_WRAP
      }
    }

    this.lastRawPts = raw
    return raw + this.offset
  }
}