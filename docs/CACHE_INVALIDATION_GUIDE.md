# Cache Invalidation Guide

## Overview

The SSAI platform uses a multi-layer caching architecture for performance:
- **KV Cache**: 60-second TTL for channel configs (was 5 minutes)
- **DO Durable Storage**: Persistent ad break state
- **Edge Cache**: 2-second bucketed manifest cache

## Problem: Stale Configs

Without proactive invalidation, config changes can take up to 60 seconds to propagate due to KV caching. For live operations, this is too slow.

## Solution: Instant Cache Invalidation

### In Admin API Worker

When updating channel configuration, invalidate the cache immediately:

```typescript
import { invalidateChannelConfigCache, warmChannelConfigCache } from '../utils/cache-invalidation';

// In your channel update handler
async function updateChannel(env: Env, orgSlug: string, channelSlug: string, updates: any) {
  // 1. Update database
  await env.DB.prepare(`
    UPDATE channels 
    SET origin_url = ?, updated_at = ?
    WHERE organization_id = (SELECT id FROM organizations WHERE slug = ?)
      AND slug = ?
  `).bind(updates.originUrl, Date.now(), orgSlug, channelSlug).run();
  
  // 2. Invalidate cache IMMEDIATELY (don't wait for 60s TTL)
  const channel = await getChannelBySlug(env, orgSlug, channelSlug);
  await invalidateChannelConfigCache(env, orgSlug, channelSlug, channel.id);
  
  // 3. (Optional) Warm cache to prevent stampede
  await warmChannelConfigCache(env, orgSlug, channelSlug);
  
  return { success: true, message: 'Cache invalidated, changes live immediately' };
}
```

### Usage Patterns

#### 1. Single Channel Update
```typescript
// After updating channel config
await invalidateChannelConfigCache(env, 'demo', 'sports1', 'ch_abc123');
```

#### 2. Organization-Wide Update
```typescript
// When changing org-level settings that affect all channels
const channels = await getOrgChannels(env, 'demo');
const slugs = channels.map(c => c.slug);
await invalidateOrgConfigCache(env, 'demo', slugs);
```

#### 3. Bulk Update with Cache Warming
```typescript
// Update multiple channels and warm cache to prevent D1 stampede
for (const channel of channels) {
  await updateChannel(env, orgSlug, channel.slug, updates);
  await invalidateChannelConfigCache(env, orgSlug, channel.slug, channel.id);
  // Fire-and-forget cache warming
  warmChannelConfigCache(env, orgSlug, channel.slug).catch(console.error);
}
```

## Admin API Integration Points

Add cache invalidation to these endpoints:

### 1. `PUT /channels/:channelId` - Update Channel
```typescript
// After successful update
await invalidateChannelConfigCache(env, orgSlug, channelSlug, channelId);
```

### 2. `POST /channels` - Create Channel
```typescript
// Warm cache immediately after creation
await warmChannelConfigCache(env, orgSlug, newChannel.slug);
```

### 3. `DELETE /channels/:channelId` - Delete Channel
```typescript
// Clean up cache
await invalidateChannelConfigCache(env, orgSlug, channelSlug, channelId);
```

### 4. `PUT /organizations/:orgId` - Update Organization Defaults
```typescript
// Invalidate all channels in org
const channels = await listChannels(env, orgSlug);
await invalidateOrgConfigCache(env, orgSlug, channels.map(c => c.slug));
```

## Cache TTL Settings

Current configuration in `src/utils/channel-config.ts`:

```typescript
const CACHE_TTL_SECONDS = 60; // 1 minute (down from 5 minutes)
```

### Trade-offs

**Before (300s TTL):**
- ✅ Fewer D1 reads (~1 per 5 minutes per channel)
- ❌ Config changes take up to 5 minutes to propagate
- ❌ Stale configs cause viewer issues

**After (60s TTL + Invalidation):**
- ✅ Config changes propagate instantly with invalidation
- ✅ Graceful degradation if invalidation fails (60s max)
- ⚠️ Slightly more D1 reads (5x more, but still minimal)
- ✅ Can warm cache to prevent stampedes

## Monitoring

Add logging to track cache effectiveness:

```typescript
console.log(`📊 Cache stats: hit=${hit}, miss=${miss}, invalidations=${invalidations}`);
```

## Best Practices

1. **Always invalidate after config updates** - Don't rely on TTL
2. **Use cache warming for bulk operations** - Prevents D1 overload
3. **Fire-and-forget warming** - Don't block responses
4. **Log all invalidations** - Track cache churn
5. **Batch operations** - Group updates, then invalidate once

## Testing

```bash
# Test cache invalidation
curl -X PUT "http://localhost:8791/admin/channels/ch_demo_sports1" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"originUrl":"https://new-origin.com/stream.m3u8"}'

# Verify cache cleared (should fetch from D1)
curl "http://localhost:8787/demo/sports1/master.m3u8"

# Check logs for invalidation message
wrangler tail cf-ssai-admin --format pretty | grep "🗑️"
```

## Troubleshooting

### Issue: Config changes not visible
**Check:**
1. Is `CHANNEL_CONFIG_CACHE` KV binding configured?
2. Did Admin API call invalidation function?
3. Check logs for "Cache invalidated" message
4. Verify DO location hints match (colo prefix)

### Issue: D1 overload after bulk updates
**Solution:**
- Add delays between updates: `await sleep(100)`
- Use cache warming after invalidation
- Batch updates in Admin API, not client-side

### Issue: Cache invalidation fails silently
**Check:**
- KV binding exists in `wrangler.toml`
- Error handling in invalidation function
- Network connectivity to KV

## Performance Impact

Estimated D1 read increases:
- **Before**: ~12 reads/hour per channel (300s TTL)
- **After**: ~60 reads/hour per channel (60s TTL)
- **Cost**: Negligible (<$0.01/month for 100 channels)

Benefits far outweigh costs:
- Instant config updates
- Better viewer experience
- Reduced support burden
- Strong consistency guarantees

## Future Enhancements

1. **DO Alarms**: Schedule cache invalidation from DO
2. **Event-driven**: Trigger invalidation via Queue/Pub-Sub
3. **Selective warming**: Only warm high-traffic channels
4. **Cache hit tracking**: Monitor cache effectiveness
