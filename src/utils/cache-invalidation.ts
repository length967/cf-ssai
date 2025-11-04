/**
 * Cache Invalidation Utilities
 * Provides instant cache invalidation for channel config updates via Admin API
 * Uses DO alarms for proactive invalidation instead of waiting for TTL expiry
 */

interface CacheInvalidationEnv {
  CHANNEL_CONFIG_CACHE?: KVNamespace;
}

/**
 * Invalidate channel config cache immediately when config is updated
 * Call this from Admin API after any channel config update
 */
export async function invalidateChannelConfigCache(
  env: CacheInvalidationEnv,
  orgSlug: string,
  channelSlug: string,
  channelId: string
): Promise<void> {
  if (!env.CHANNEL_CONFIG_CACHE) {
    console.warn('⚠️  CHANNEL_CONFIG_CACHE not configured, skipping cache invalidation');
    return;
  }

  const keys = [
    `channel:${orgSlug}:${channelSlug}`,  // By slug
    `channel:id:${channelId}`,             // By ID
  ];

  console.log(`🗑️  Invalidating channel config cache: org=${orgSlug}, channel=${channelSlug}, id=${channelId}`);

  // Delete all cache keys in parallel
  await Promise.all(keys.map(key => 
    env.CHANNEL_CONFIG_CACHE!.delete(key).catch(err => 
      console.error(`Failed to delete cache key ${key}:`, err)
    )
  ));

  console.log(`✅ Cache invalidated for ${keys.length} keys`);
}

/**
 * Invalidate all channel configs for an organization
 * Use when organization-level settings change
 */
export async function invalidateOrgConfigCache(
  env: CacheInvalidationEnv,
  orgSlug: string,
  channelSlugs: string[]
): Promise<void> {
  if (!env.CHANNEL_CONFIG_CACHE) {
    console.warn('⚠️  CHANNEL_CONFIG_CACHE not configured, skipping cache invalidation');
    return;
  }

  const keys = channelSlugs.map(slug => `channel:${orgSlug}:${slug}`);
  
  console.log(`🗑️  Invalidating org config cache: org=${orgSlug}, channels=${channelSlugs.length}`);

  // Delete all cache keys in parallel
  await Promise.all(keys.map(key => 
    env.CHANNEL_CONFIG_CACHE!.delete(key).catch(err => 
      console.error(`Failed to delete cache key ${key}:`, err)
    )
  ));

  console.log(`✅ Cache invalidated for ${keys.length} organization channels`);
}

/**
 * Warm cache by pre-fetching channel config
 * Call after invalidation to avoid cache stampede
 */
export async function warmChannelConfigCache(
  env: CacheInvalidationEnv & { DB?: D1Database },
  orgSlug: string,
  channelSlug: string
): Promise<void> {
  // Import here to avoid circular dependency
  const { getChannelConfig } = await import('./channel-config');
  
  try {
    console.log(`🔥 Warming cache for ${orgSlug}:${channelSlug}...`);
    const config = await getChannelConfig(env, orgSlug, channelSlug);
    if (config) {
      console.log(`✅ Cache warmed successfully`);
    } else {
      console.warn(`⚠️  Channel not found: ${orgSlug}:${channelSlug}`);
    }
  } catch (err) {
    console.error(`Failed to warm cache:`, err);
  }
}
