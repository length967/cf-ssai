/**
 * Channel Configuration Utilities
 * Fetches per-channel configuration from D1 database with optional KV caching
 */

export interface ChannelConfig {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  
  // URL Configuration (per-tenant)
  originUrl: string;
  adPodBaseUrl: string;
  signHost: string;
  
  // SCTE-35 Configuration
  scte35Enabled: boolean;
  scte35FallbackSchedule?: {
    intervalMinutes: number;
    durationSec: number;
  };
  scte35AutoInsert: boolean; // Auto-insert ads on SCTE-35 signals
  
  // VAST Configuration
  vastEnabled: boolean;
  vastUrl?: string;
  vastTimeoutMs: number;
  
  // Ad Configuration
  defaultAdDuration: number;
  slatePodId: string;
  timeBasedAutoInsert: boolean; // Auto-insert ads on time schedule
  
  // Cache Configuration
  segmentCacheMaxAge: number; // Segment cache TTL in seconds
  manifestCacheMaxAge: number; // Manifest cache TTL in seconds
  
  // Status
  status: 'active' | 'paused' | 'archived';
  mode: 'auto' | 'sgai' | 'ssai';
}

interface ChannelConfigEnv {
  DB?: D1Database;
  CHANNEL_CONFIG_CACHE?: KVNamespace;
}

// CONSISTENCY FIX: Reduced from 300s (5 min) to 60s (1 min) for faster config propagation
// This ensures live config changes (via Admin API) are visible within 60 seconds
// Trade-off: Slightly more D1 reads, but much better consistency
const CACHE_TTL_SECONDS = 60; // 1 minute (was 300s)

/**
 * Fetch channel configuration by organization slug and channel slug
 * Uses KV cache if available, falls back to D1 query
 */
export async function getChannelConfig(
  env: ChannelConfigEnv,
  orgSlug: string,
  channelSlug: string
): Promise<ChannelConfig | null> {
  const cacheKey = `channel:${orgSlug}:${channelSlug}`;
  
  // Try KV cache first (if available)
  if (env.CHANNEL_CONFIG_CACHE) {
    const cached = await env.CHANNEL_CONFIG_CACHE.get(cacheKey, 'json');
    if (cached) {
      return cached as ChannelConfig;
    }
  }
  
  // Query D1 database
  if (!env.DB) {
    throw new Error('D1 database binding not configured');
  }
  
  const result = await env.DB
    .prepare(`
      SELECT 
        c.id,
        c.organization_id as organizationId,
        c.name,
        c.slug,
        c.origin_url as originUrl,
        c.ad_pod_base_url as adPodBaseUrl,
        c.sign_host as signHost,
        c.scte35_enabled as scte35Enabled,
        c.scte35_fallback_schedule as scte35FallbackSchedule,
        c.scte35_auto_insert as scte35AutoInsert,
        c.vast_enabled as vastEnabled,
        c.vast_url as vastUrl,
        c.vast_timeout_ms as vastTimeoutMs,
        c.default_ad_duration as defaultAdDuration,
        c.slate_pod_id as slatePodId,
        c.time_based_auto_insert as timeBasedAutoInsert,
        c.segment_cache_max_age as segmentCacheMaxAge,
        c.manifest_cache_max_age as manifestCacheMaxAge,
        c.status,
        c.mode
      FROM channels c
      JOIN organizations o ON c.organization_id = o.id
      WHERE o.slug = ? AND c.slug = ? AND c.status = 'active'
    `)
    .bind(orgSlug, channelSlug)
    .first<any>();
  
  if (!result) {
    return null;
  }
  
  // Parse JSON fields
  const config: ChannelConfig = {
    ...result,
    scte35Enabled: Boolean(result.scte35Enabled),
    scte35FallbackSchedule: result.scte35FallbackSchedule 
      ? JSON.parse(result.scte35FallbackSchedule)
      : undefined,
    scte35AutoInsert: Boolean(result.scte35AutoInsert),
    vastEnabled: Boolean(result.vastEnabled),
    vastTimeoutMs: result.vastTimeoutMs || 2000,
    defaultAdDuration: result.defaultAdDuration || 30,
    // slatePodId removed - use slateId instead
    timeBasedAutoInsert: Boolean(result.timeBasedAutoInsert),
    segmentCacheMaxAge: result.segmentCacheMaxAge || 60,
    manifestCacheMaxAge: result.manifestCacheMaxAge || 4,
  };
  
  // Cache in KV for next time (if available and TTL > 0)
  if (env.CHANNEL_CONFIG_CACHE && CACHE_TTL_SECONDS > 0) {
    await env.CHANNEL_CONFIG_CACHE.put(
      cacheKey,
      JSON.stringify(config),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  }
  
  return config;
}

/**
 * Fetch channel configuration by channel ID (for /cue API)
 * Uses KV cache if available, falls back to D1 query
 */
export async function getChannelConfigById(
  env: ChannelConfigEnv,
  channelId: string
): Promise<ChannelConfig | null> {
  const cacheKey = `channel:id:${channelId}`;
  
  // Try KV cache first (if available)
  if (env.CHANNEL_CONFIG_CACHE) {
    const cached = await env.CHANNEL_CONFIG_CACHE.get(cacheKey, 'json');
    if (cached) {
      return cached as ChannelConfig;
    }
  }
  
  // Query D1 database by channel ID
  if (!env.DB) {
    throw new Error('D1 database binding not configured');
  }
  
  const result = await env.DB
    .prepare(`
      SELECT 
        c.id,
        c.organization_id as organizationId,
        c.name,
        c.slug,
        c.origin_url as originUrl,
        c.ad_pod_base_url as adPodBaseUrl,
        c.sign_host as signHost,
        c.scte35_enabled as scte35Enabled,
        c.scte35_fallback_schedule as scte35FallbackSchedule,
        c.scte35_auto_insert as scte35AutoInsert,
        c.vast_enabled as vastEnabled,
        c.vast_url as vastUrl,
        c.vast_timeout_ms as vastTimeoutMs,
        c.default_ad_duration as defaultAdDuration,
        c.slate_pod_id as slatePodId,
        c.time_based_auto_insert as timeBasedAutoInsert,
        c.segment_cache_max_age as segmentCacheMaxAge,
        c.manifest_cache_max_age as manifestCacheMaxAge,
        c.status,
        c.mode
      FROM channels c
      WHERE c.id = ?
    `)
    .bind(channelId)
    .first<any>();
  
  if (!result) {
    return null;
  }
  
  // Parse JSON fields
  const config: ChannelConfig = {
    ...result,
    scte35Enabled: Boolean(result.scte35Enabled),
    scte35FallbackSchedule: result.scte35FallbackSchedule 
      ? JSON.parse(result.scte35FallbackSchedule)
      : undefined,
    scte35AutoInsert: Boolean(result.scte35AutoInsert),
    vastEnabled: Boolean(result.vastEnabled),
    vastTimeoutMs: result.vastTimeoutMs || 2000,
    defaultAdDuration: result.defaultAdDuration || 30,
    timeBasedAutoInsert: Boolean(result.timeBasedAutoInsert),
    segmentCacheMaxAge: result.segmentCacheMaxAge || 60,
    manifestCacheMaxAge: result.manifestCacheMaxAge || 4,
  };
  
  // Cache in KV for next time (if available and TTL > 0)
  if (env.CHANNEL_CONFIG_CACHE && CACHE_TTL_SECONDS > 0) {
    await env.CHANNEL_CONFIG_CACHE.put(
      cacheKey,
      JSON.stringify(config),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  }
  
  return config;
}

/**
 * Invalidate channel config cache
 * Call this after updating channel configuration
 */
export async function invalidateChannelConfigCache(
  env: ChannelConfigEnv,
  orgSlug: string,
  channelSlug: string
): Promise<void> {
  if (env.CHANNEL_CONFIG_CACHE) {
    const cacheKey = `channel:${orgSlug}:${channelSlug}`;
    await env.CHANNEL_CONFIG_CACHE.delete(cacheKey);
  }
}

/**
 * Get configuration with fallback to global defaults
 */
export function getConfigWithDefaults(
  channelConfig: ChannelConfig | null,
  globalDefaults: {
    originVariantBase?: string;
    adPodBase?: string;
    signHost?: string;
  }
): {
  originUrl: string;
  adPodBaseUrl: string;
  signHost: string;
} {
  return {
    originUrl: channelConfig?.originUrl || globalDefaults.originVariantBase || '',
    adPodBaseUrl: channelConfig?.adPodBaseUrl || globalDefaults.adPodBase || '',
    signHost: channelConfig?.signHost || globalDefaults.signHost || '',
  };
}

