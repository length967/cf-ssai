// Dedicated beacon consumer worker
// Processes ad tracking beacons from the queue with retry logic and error handling

import type { BeaconMessage } from "./types"

export interface Env {
  BEACON_QUEUE: Queue
  // Optional: KV for deduplication
  BEACON_KV?: KVNamespace
  // Config
  BEACON_RETRY_ATTEMPTS?: string
  BEACON_TIMEOUT_MS?: string
}

interface BeaconStats {
  totalProcessed: number
  successCount: number
  failureCount: number
  retryCount: number
}

/**
 * Fire a single tracking URL with timeout and retry logic
 */
async function fireBeacon(
  url: string,
  timeoutMs: number,
  attempt: number = 1
): Promise<{ success: boolean; status?: number; error?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Cloudflare-SSAI-Beacon/1.0",
      },
      cf: {
        cacheTtl: 0, // Don't cache beacon calls
      },
    })

    clearTimeout(timeout)

    // Accept 2xx or 3xx as success
    if (response.status >= 200 && response.status < 400) {
      return { success: true, status: response.status }
    }

    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}`,
    }
  } catch (err) {
    clearTimeout(timeout)
    const error = err instanceof Error ? err.message : "Unknown error"
    return { success: false, error }
  }
}

/**
 * Check if beacon was already processed (deduplication)
 */
async function isBeaconProcessed(
  kv: KVNamespace | undefined,
  beaconId: string
): Promise<boolean> {
  if (!kv) return false
  const key = `beacon:${beaconId}`
  const exists = await kv.get(key)
  return exists !== null
}

/**
 * Mark beacon as processed
 */
async function markBeaconProcessed(
  kv: KVNamespace | undefined,
  beaconId: string
): Promise<void> {
  if (!kv) return
  const key = `beacon:${beaconId}`
  // Store for 24 hours to dedupe retries
  await kv.put(key, "1", { expirationTtl: 86400 })
}

/**
 * Process a single beacon message
 */
async function processBeacon(
  beacon: BeaconMessage,
  env: Env,
  stats: BeaconStats
): Promise<void> {
  const timeoutMs = parseInt(env.BEACON_TIMEOUT_MS || "5000", 10)
  const maxRetries = parseInt(env.BEACON_RETRY_ATTEMPTS || "2", 10)

  // Generate beacon ID for deduplication
  const beaconId = `${beacon.event}-${beacon.adId}-${beacon.ts}`

  // Check if already processed
  if (await isBeaconProcessed(env.BEACON_KV, beaconId)) {
    console.log(`Beacon already processed: ${beaconId}`)
    stats.totalProcessed++
    stats.successCount++
    return
  }

  // Collect all URLs to fire (standard + VAST tracking)
  const allUrls: string[] = [...beacon.trackerUrls]
  
  // Add VAST error tracking URLs if this is an error event
  if (beacon.event === "error" && beacon.tracking?.errorTracking) {
    allUrls.push(...beacon.tracking.errorTracking.filter(url => url && url.startsWith("http")))
  }
  
  // Log VAST metadata if present
  if (beacon.metadata?.vastAdId) {
    console.log(`VAST beacon: adId=${beacon.metadata.vastAdId}, creativeId=${beacon.metadata.creativeId}, event=${beacon.event}`)
  }
  
  // Log click-through URL (not fired automatically)
  if (beacon.tracking?.clickThrough) {
    console.log(`Click-through available: ${beacon.tracking.clickThrough}`)
  }

  // Process all tracker URLs in parallel
  const results = await Promise.allSettled(
    allUrls.map(async (url) => {
      if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return { success: false, error: "Invalid URL" }
      }

      // Try with retries
      let lastResult
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        lastResult = await fireBeacon(url, timeoutMs, attempt)
        
        if (lastResult.success) {
          if (attempt > 1) stats.retryCount++
          return lastResult
        }

        // Exponential backoff for retries
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 100))
        }
      }

      return lastResult
    })
  )

  // Count successes and failures
  let urlSuccessCount = 0
  let urlFailureCount = 0

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.success) {
      urlSuccessCount++
    } else {
      urlFailureCount++
      // Log failures for monitoring
      const error = result.status === "rejected" 
        ? result.reason 
        : (result.value as any).error
      console.error(`Beacon failed: ${beacon.event}/${beacon.adId} - ${error}`)
    }
  }

  stats.totalProcessed++
  if (urlFailureCount === 0) {
    stats.successCount++
    // Mark as processed to avoid duplicates
    await markBeaconProcessed(env.BEACON_KV, beaconId)
  } else {
    stats.failureCount++
  }

  // Log for analytics
  console.log(
    `Beacon processed: ${beacon.event}/${beacon.adId} - ${urlSuccessCount}/${beacon.trackerUrls.length} URLs succeeded`
  )
}

export default {
  /**
   * HTTP handler for health checks
   */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 })
    }
    
    return new Response(JSON.stringify({ 
      service: "beacon-consumer",
      message: "This worker processes queue messages. No HTTP endpoints available."
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  },

  /**
   * Queue consumer: Process beacon messages in batches
   */
  async queue(
    batch: MessageBatch<BeaconMessage>,
    env: Env,
    ctx: ExecutionContext
  ) {
    const startTime = Date.now()
    const stats: BeaconStats = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
    }

    console.log(`Processing beacon batch: ${batch.messages.length} messages`)

    // Process all beacons in parallel for speed
    await Promise.allSettled(
      batch.messages.map((msg) => processBeacon(msg.body, env, stats))
    )

    const duration = Date.now() - startTime

    console.log(
      `Batch complete: ${stats.totalProcessed} processed, ${stats.successCount} succeeded, ${stats.failureCount} failed, ${stats.retryCount} retries (${duration}ms)`
    )

    // Ack all messages (even failures - we don't want infinite retries)
    batch.ackAll()
  },
}

