/**
 * SCTE-35 Monitor Worker
 * 
 * Phase 2: Cron-based SCTE-35 detection for proactive ad break management
 * 
 * Runs every 1-2 seconds to:
 * 1. Fetch all active channels from D1
 * 2. Poll origin manifests for SCTE-35 signals
 * 3. Pre-calculate ad decisions
 * 4. Write ad break state to KV
 * 
 * This moves SCTE-35 detection OUT of the request path, enabling
 * fully stateless manifest serving with pre-calculated ad decisions.
 */

import { parseSCTE35FromManifest, findActiveBreak, getBreakDuration } from './utils/scte35'
import { getAdBreakKey, getAdBreakTTL } from './types/adbreak-state'
import type { AdBreakState } from './types/adbreak-state'
import type { SCTE35Signal } from './types'

export interface Env {
  // Database for channel configuration
  DB: D1Database
  
  // KV for ad break state
  ADBREAK_STATE: KVNamespace
  
  // Service binding to decision worker
  DECISION?: Fetcher
  
  // Configuration
  DECISION_TIMEOUT_MS: string
}

interface ChannelInfo {
  id: string
  slug: string
  organizationId: string
  originUrl: string
  scte35Enabled: boolean
  scte35AutoInsert: boolean
  vastEnabled: boolean
  vastUrl: string
  defaultAdDuration: number
}

/**
 * Fetch a manifest from the origin with retry logic
 */
async function fetchOriginManifest(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      cf: { cacheTtl: 0 } // Don't cache - we want fresh data
    })
    
    if (!response.ok) {
      console.warn(`Failed to fetch origin manifest: ${url} (${response.status})`)
      return null
    }
    
    return await response.text()
  } catch (error) {
    console.error(`Error fetching origin manifest ${url}:`, error)
    return null
  }
}

/**
 * Pre-calculate ad decision for a detected SCTE-35 break
 */
async function preCalculateDecision(
  env: Env,
  channelId: string,
  duration: number
): Promise<any> {
  if (!env.DECISION) {
    console.warn('Decision service not available for pre-calculation')
    return { pod: { podId: 'no-decision', items: [], durationSec: duration } }
  }
  
  try {
    const timeoutMs = parseInt(env.DECISION_TIMEOUT_MS || '2000', 10)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    
    const response = await env.DECISION.fetch('https://decision/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: channelId,
        durationSec: duration
      }),
      signal: controller.signal
    })
    
    clearTimeout(timeout)
    
    if (response.ok) {
      return await response.json()
    }
    
    console.warn(`Decision service returned ${response.status}`)
    return { pod: { podId: 'decision-error', items: [], durationSec: duration } }
  } catch (error) {
    console.error('Decision pre-calculation failed:', error)
    return { pod: { podId: 'decision-timeout', items: [], durationSec: duration } }
  }
}

/**
 * Process a single channel for SCTE-35 signals
 */
async function processChannel(env: Env, channel: ChannelInfo): Promise<void> {
  // Skip if SCTE-35 is disabled
  if (!channel.scte35Enabled || !channel.scte35AutoInsert) {
    return
  }
  
  // Fetch the master manifest
  const manifest = await fetchOriginManifest(channel.originUrl)
  if (!manifest) {
    return
  }
  
  // Parse SCTE-35 signals
  const signals = parseSCTE35FromManifest(manifest)
  if (signals.length === 0) {
    return
  }
  
  console.log(`📡 Found ${signals.length} SCTE-35 signal(s) in channel ${channel.id}`)
  
  // Find active break
  const activeBreak = findActiveBreak(signals)
  if (!activeBreak) {
    return
  }
  
  // Check if we've already processed this event
  const eventId = activeBreak.binaryData?.spliceEventId?.toString() || activeBreak.id
  const kvKey = getAdBreakKey(channel.id, `scte35_${channel.id}_${eventId}`)
  
  const existing = await env.ADBREAK_STATE.get(kvKey)
  if (existing) {
    console.log(`✓ Ad break already exists for event ${eventId}, skipping`)
    return
  }
  
  // New SCTE-35 signal detected!
  const duration = getBreakDuration(activeBreak)
  const startTime = activeBreak.programDateTime || new Date().toISOString()
  
  console.log(`🆕 New SCTE-35 ad break detected: channel=${channel.id}, event=${eventId}, duration=${duration}s`)
  
  // Pre-calculate ad decision
  console.log(`⏳ Pre-calculating decision for channel ${channel.id}...`)
  const decision = await preCalculateDecision(env, channel.id, duration)
  console.log(`✅ Decision ready: ${decision.pod?.items?.length || 0} ad(s)`)
  
  // Build ad break state
  const adBreakState: AdBreakState = {
    channelId: channel.id,
    eventId: `scte35_${channel.id}_${eventId}`,
    source: 'scte35',
    startTime: startTime,
    duration: duration,
    endTime: new Date(new Date(startTime).getTime() + duration * 1000).toISOString(),
    decision: {
      podId: decision.pod?.podId || 'unknown',
      items: decision.pod?.items?.map((item: any) => ({
        id: item.adId || item.podId,
        duration: item.durationSec,
        variants: {} // Will be filled by decision service
      })) || []
    },
    createdAt: new Date().toISOString(),
    scte35Data: {
      pdt: activeBreak.programDateTime || startTime,
      signalType: activeBreak.signalType || 'unknown',
      eventId: eventId
    }
  }
  
  // Write to KV with TTL
  const ttl = getAdBreakTTL(duration)
  await env.ADBREAK_STATE.put(kvKey, JSON.stringify(adBreakState), {
    expirationTtl: ttl
  })
  
  console.log(`📝 Phase 2: Wrote SCTE-35 ad break to KV: ${kvKey} (TTL: ${ttl}s)`)
}

/**
 * Main cron handler - polls all active channels
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now()
    console.log('🔄 SCTE-35 Monitor: Starting poll cycle')
    
    try {
      // Fetch all active channels with SCTE-35 enabled
      const channels = await env.DB.prepare(`
        SELECT 
          id,
          slug,
          organization_id as organizationId,
          origin_url as originUrl,
          scte35_enabled as scte35Enabled,
          scte35_auto_insert as scte35AutoInsert,
          vast_enabled as vastEnabled,
          vast_url as vastUrl,
          default_ad_duration as defaultAdDuration
        FROM channels
        WHERE status = 'active'
          AND scte35_enabled = 1
          AND scte35_auto_insert = 1
      `).all<ChannelInfo>()
      
      if (!channels.results || channels.results.length === 0) {
        console.log('No active channels with SCTE-35 enabled')
        return
      }
      
      console.log(`📺 Processing ${channels.results.length} channel(s)`)
      
      // Process all channels in parallel
      const promises = channels.results.map(channel => 
        processChannel(env, channel).catch(error => {
          console.error(`Error processing channel ${channel.id}:`, error)
        })
      )
      
      await Promise.all(promises)
      
      const duration = Date.now() - startTime
      console.log(`✅ SCTE-35 Monitor: Poll cycle complete (${duration}ms)`)
      
    } catch (error) {
      console.error('SCTE-35 Monitor: Fatal error:', error)
    }
  }
}
