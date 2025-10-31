export const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * Window bucketing for live cache keys.
 * Workers do not expose process.env; pass stride explicitly from env.
 */
export function windowBucket(seconds: number, strideSec: number = 2) {
  const stride = Number.isFinite(strideSec) && strideSec > 0 ? Math.floor(strideSec) : 2
  return Math.floor(seconds / stride)
}