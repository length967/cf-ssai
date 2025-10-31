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
  
  // VAST Configuration
  vastEnabled: boolean;
  vastUrl?: string;
  vastTimeoutMs: number;
  
  // Ad Configuration
  defaultAdDuration: number;
  slatePodId: string;
  
  // Status
  status: 'active' | 'paused' | 'archived';
  mode: 'auto' | 'sgai' | 'ssai';
}

interface ChannelConfigEnv {
  DB?: D1Database;
  CHANNEL_CONFIG_CACHE?: KVNamespace;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes

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
        c.vast_enabled as vastEnabled,
        c.vast_url as vastUrl,
        c.vast_timeout_ms as vastTimeoutMs,
        c.default_ad_duration as defaultAdDuration,
        c.slate_pod_id as slatePodId,
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
    vastEnabled: Boolean(result.vastEnabled),
    vastTimeoutMs: result.vastTimeoutMs || 2000,
    defaultAdDuration: result.defaultAdDuration || 30,
    slatePodId: result.slatePodId || 'slate',
  };
  
  // Cache in KV for next time (if available)
  if (env.CHANNEL_CONFIG_CACHE) {
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

