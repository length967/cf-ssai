/**
 * KV Ad Break Utilities
 * 
 * Phase 1: Read ad break state from KV for stateless manifest serving
 */

import type { AdBreakState } from '../types/adbreak-state'
import type { Env } from '../manifest-worker'

/**
 * Get active ad break for a channel from KV
 * Returns the ad break if one is currently active (within start/end time window)
 */
export async function getActiveAdBreak(
  env: Env,
  channelId: string
): Promise<AdBreakState | null> {
  try {
    // List all keys for this channel
    // Format: adbreak:{channelId}:{eventId}
    const prefix = `adbreak:${channelId}:`
    
    // KV list is eventually consistent but good enough for Phase 1
    const list = await env.ADBREAK_STATE.list({ prefix, limit: 10 })
    
    if (!list.keys || list.keys.length === 0) {
      return null
    }
    
    // Check each key to find an active break
    const now = new Date()
    
    for (const key of list.keys) {
      const value = await env.ADBREAK_STATE.get(key.name, 'text')
      if (!value) continue
      
      try {
        const state: AdBreakState = JSON.parse(value)
        
        // Check if this break is currently active
        const startTime = new Date(state.startTime)
        const endTime = new Date(state.endTime)
        
        if (now >= startTime && now <= endTime) {
          console.log(`📖 Phase 1: Found active ad break from KV: ${key.name}`)
          return state
        }
      } catch (parseError) {
        console.warn(`Failed to parse KV ad break: ${key.name}`, parseError)
      }
    }
    
    return null
  } catch (error) {
    console.error('Failed to read ad breaks from KV:', error)
    return null // Fail gracefully - fallback to DO
  }
}

/**
 * Get specific ad break by key
 */
export async function getAdBreakByKey(
  env: Env,
  channelId: string,
  eventId: string
): Promise<AdBreakState | null> {
  try {
    const key = `adbreak:${channelId}:${eventId}`
    const value = await env.ADBREAK_STATE.get(key, 'text')
    
    if (!value) return null
    
    const state: AdBreakState = JSON.parse(value)
    console.log(`📖 Phase 1: Retrieved ad break from KV: ${key}`)
    return state
  } catch (error) {
    console.error(`Failed to read ad break ${eventId} from KV:`, error)
    return null
  }
}
