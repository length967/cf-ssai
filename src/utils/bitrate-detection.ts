// Bitrate detection utility for origin stream manifests
import { extractBitrates, parseVariant } from './hls'

export type BitrateDetectionResult = {
  success: boolean
  bitrates: number[]  // Sorted array of bitrates in kbps
  variants: Array<{
    bandwidth: number  // in bps
    bitrate: number    // in kbps (rounded)
    resolution?: string
    uri: string
  }>
  error?: string
}

/**
 * Fetch master manifest from origin URL and detect available bitrates
 * Returns sorted array of bitrates suitable for transcoding ladder
 * 
 * @param originUrl - URL to HLS master manifest (e.g., https://origin.example.com/stream/master.m3u8)
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 */
export async function detectBitratesFromOrigin(
  originUrl: string,
  timeoutMs = 10000
): Promise<BitrateDetectionResult> {
  try {
    // Validate URL format
    let url: URL
    try {
      url = new URL(originUrl)
    } catch {
      return {
        success: false,
        bitrates: [],
        variants: [],
        error: 'Invalid URL format'
      }
    }

    // Fetch manifest with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(originUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'CF-SSAI-BitrateDetector/1.0',
          'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*'
        }
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      return {
        success: false,
        bitrates: [],
        variants: [],
        error: `HTTP ${response.status}: ${response.statusText}`
      }
    }

    // Parse manifest
    const manifestText = await response.text()
    
    // Validate it's actually an HLS manifest
    if (!manifestText.includes('#EXTM3U')) {
      return {
        success: false,
        bitrates: [],
        variants: [],
        error: 'Not a valid HLS manifest (missing #EXTM3U)'
      }
    }

    // Extract bitrates using existing utility
    const bitrates = extractBitrates(manifestText)
    
    if (bitrates.length === 0) {
      return {
        success: false,
        bitrates: [],
        variants: [],
        error: 'No playable variants found in manifest'
      }
    }

    // Parse full variant details
    const lines = manifestText.split('\n')
    const variantInfos = parseVariant(lines)
    
    // Build detailed variant list
    const variants = variantInfos
      .filter(v => v.bandwidth !== undefined)
      .map(v => ({
        bandwidth: v.bandwidth!,
        bitrate: Math.round(v.bandwidth! / 1000),
        resolution: v.resolution,
        uri: v.uri
      }))
      .sort((a, b) => a.bandwidth - b.bandwidth)

    console.log(`✅ Detected ${bitrates.length} bitrates from ${originUrl}: ${bitrates.join(', ')} kbps`)

    return {
      success: true,
      bitrates,
      variants
    }

  } catch (error: any) {
    // Handle fetch errors (network, timeout, etc.)
    const errorMessage = error.name === 'AbortError' 
      ? 'Request timeout - origin stream unreachable'
      : error.message || 'Unknown error during bitrate detection'

    console.error(`❌ Bitrate detection failed for ${originUrl}:`, errorMessage)

    return {
      success: false,
      bitrates: [],
      variants: [],
      error: errorMessage
    }
  }
}

/**
 * Validate a bitrate ladder array
 * Ensures all values are positive integers in ascending order
 */
export function validateBitrateLadder(bitrates: number[]): { valid: boolean; error?: string } {
  if (!Array.isArray(bitrates)) {
    return { valid: false, error: 'Bitrate ladder must be an array' }
  }

  if (bitrates.length === 0) {
    return { valid: false, error: 'Bitrate ladder cannot be empty' }
  }

  for (let i = 0; i < bitrates.length; i++) {
    const bitrate = bitrates[i]
    
    if (!Number.isInteger(bitrate) || bitrate <= 0) {
      return { valid: false, error: `Invalid bitrate at index ${i}: ${bitrate}` }
    }

    if (i > 0 && bitrate <= bitrates[i - 1]) {
      return { valid: false, error: `Bitrates must be in ascending order (${bitrates[i - 1]} >= ${bitrate})` }
    }
  }

  return { valid: true }
}

/**
 * Get a sensible default bitrate ladder for fallback scenarios
 * Covers low (mobile), medium (720p), and high (1080p+) quality
 */
export function getDefaultBitrateLadder(): number[] {
  return [800, 1600, 2400, 3600]
}
