# Per-Channel Configuration Guide

## Overview

Your cf-ssai platform now supports **per-channel, multi-tenant URL configuration**. Each channel can have its own:
- Origin URL (`origin_url`)
- Ad Pod Base URL (`ad_pod_base_url`)  
- Signing Host (`sign_host`)

This allows different organizations/clients to use their own CDNs, ad servers, and signing domains while sharing the same Workers infrastructure.

---

## Architecture

```
┌─────────────┐
│ Admin GUI   │  Configure channel settings
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Admin API   │  Store in D1 database
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ D1 Database │  Per-channel config
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  KV Cache   │  5-minute TTL (optional)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Workers   │  Fetch config per request
└─────────────┘
```

---

## Database Schema

The `channels` table now includes:

```sql
CREATE TABLE channels (
    -- ... other fields ...
    origin_url TEXT NOT NULL,           -- Per-channel origin URL
    ad_pod_base_url TEXT,               -- Per-channel ad base URL
    sign_host TEXT,                     -- Per-channel signing host
    -- ... other fields ...
);
```

Migration file: `migrations/002_add_channel_sign_host.sql`

---

## Configuring Channels via Admin GUI

### 1. Access the Channels Page

Navigate to: `https://your-admin.pages.dev/channels`

### 2. Create or Edit a Channel

Click **"+ New Channel"** or **"Edit"** on an existing channel.

### 3. Configure Multi-Tenant URLs

**Basic Information Section:**
- **Origin URL**: `https://cdn.client-a.com/hls/sports`
  - The base URL of the client's origin HLS stream

**Ad Configuration Section:**
- **Ad Pod Base URL**: `https://ads.client-a.com/pods`
  - The base URL for this client's ad assets
  - Leave empty to use global default from `wrangler.toml`

- **Sign Host**: `media.client-a.com`
  - Host used for URL signing (for segment URLs)
  - Leave empty to use global default from `wrangler.toml`

### 4. Save Configuration

Click **"Create Channel"** or **"Update Channel"**.

The configuration is immediately available to workers (with 5-minute KV cache).

---

## Using Per-Channel Config in Workers

### Step 1: Add D1 and KV Bindings

Update `wrangler.toml` (manifest worker):

```toml
# D1 Database for channel config
[[d1_databases]]
binding = "DB"
database_name = "ssai-admin"
database_id = "0302f8ab-e592-4fa6-8bbf-7371759da6ed"

# Optional: KV for caching channel config (recommended for performance)
[[kv_namespaces]]
binding = "CHANNEL_CONFIG_CACHE"
id = "your_kv_namespace_id"  # Create via: wrangler kv:namespace create "CHANNEL_CONFIG_CACHE"
```

### Step 2: Import the Channel Config Utility

```typescript
import { getChannelConfig, getConfigWithDefaults } from './utils/channel-config'
```

### Step 3: Fetch Channel Config in Your Worker

Example for the **Manifest Worker**:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    
    // Parse channel identifier from URL
    // Format: /:orgSlug/:channelSlug/variant.m3u8
    const pathParts = url.pathname.split('/').filter(Boolean)
    const [orgSlug, channelSlug] = pathParts
    
    if (!orgSlug || !channelSlug) {
      return new Response('Invalid channel path', { status: 400 })
    }
    
    // Fetch per-channel configuration from D1 (with KV caching)
    const channelConfig = await getChannelConfig(env, orgSlug, channelSlug)
    
    if (!channelConfig) {
      return new Response('Channel not found', { status: 404 })
    }
    
    // Get URLs with fallback to global defaults
    const config = getConfigWithDefaults(channelConfig, {
      originVariantBase: env.ORIGIN_VARIANT_BASE,
      adPodBase: env.AD_POD_BASE,
      signHost: env.SIGN_HOST,
    })
    
    console.log('Channel config:', {
      channel: channelConfig.name,
      originUrl: config.originUrl,
      adPodBaseUrl: config.adPodBaseUrl,
      signHost: config.signHost,
    })
    
    // Use channel-specific URLs for manifest manipulation
    const originManifest = await fetch(`${config.originUrl}/variant.m3u8`)
    // ... rest of your logic
  }
}
```

### Step 4: Update Durable Object (ChannelDO)

Pass channel config to the Durable Object:

```typescript
// In your manifest worker
const doId = env.CHANNEL_DO.idFromName(`${orgSlug}:${channelSlug}`)
const stub = env.CHANNEL_DO.get(doId)

// Initialize DO with channel config
await stub.initialize({
  channelId: channelConfig.id,
  originUrl: config.originUrl,
  adPodBaseUrl: config.adPodBaseUrl,
  signHost: config.signHost,
  // ... other config
})
```

---

## Example: Complete Manifest Worker Integration

```typescript
import { DurableObject } from 'cloudflare:workers'
import { getChannelConfig, getConfigWithDefaults } from './utils/channel-config'
import { ChannelDO } from './channel-do'

export { ChannelDO }

interface Env {
  CHANNEL_DO: DurableObjectNamespace<ChannelDO>
  DB: D1Database
  CHANNEL_CONFIG_CACHE?: KVNamespace
  BEACON_QUEUE: Queue
  DECISION: Fetcher
  ADS_BUCKET: R2Bucket
  
  // Global defaults (fallback)
  ORIGIN_VARIANT_BASE: string
  AD_POD_BASE: string
  SIGN_HOST: string
  JWT_PUBLIC_KEY: string
  SEGMENT_SECRET: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      
      // Parse multi-tenant path: /:orgSlug/:channelSlug/variant.m3u8
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(.+)$/)
      if (!match) {
        return new Response('Invalid path format. Use: /:org/:channel/variant.m3u8', { 
          status: 400 
        })
      }
      
      const [, orgSlug, channelSlug, manifestPath] = match
      
      // Fetch channel configuration (cached in KV for 5 minutes)
      const channelConfig = await getChannelConfig(env, orgSlug, channelSlug)
      
      if (!channelConfig) {
        return new Response(JSON.stringify({ 
          error: 'Channel not found',
          org: orgSlug,
          channel: channelSlug 
        }), { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      
      // Check channel status
      if (channelConfig.status !== 'active') {
        return new Response('Channel is not active', { status: 503 })
      }
      
      // Get configuration with fallbacks
      const config = getConfigWithDefaults(channelConfig, {
        originVariantBase: env.ORIGIN_VARIANT_BASE,
        adPodBase: env.AD_POD_BASE,
        signHost: env.SIGN_HOST,
      })
      
      // Get or create Durable Object for this channel
      const doId = env.CHANNEL_DO.idFromName(`${orgSlug}:${channelSlug}`)
      const stub = env.CHANNEL_DO.get(doId)
      
      // Forward request to DO with channel config
      const doRequest = new Request(request.url, request)
      doRequest.headers.set('X-Channel-Id', channelConfig.id)
      doRequest.headers.set('X-Origin-Url', config.originUrl)
      doRequest.headers.set('X-Ad-Pod-Base', config.adPodBaseUrl)
      doRequest.headers.set('X-Sign-Host', config.signHost)
      
      return await stub.fetch(doRequest)
      
    } catch (error) {
      console.error('Manifest worker error:', error)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
}
```

---

## Updating the Channel Durable Object

Modify `src/channel-do.ts` to accept per-channel config:

```typescript
export class ChannelDO extends DurableObject {
  private channelId?: string
  private originUrl?: string
  private adPodBaseUrl?: string
  private signHost?: string
  
  async fetch(request: Request): Promise<Response> {
    // Extract channel config from headers
    this.channelId = request.headers.get('X-Channel-Id') || undefined
    this.originUrl = request.headers.get('X-Origin-Url') || undefined
    this.adPodBaseUrl = request.headers.get('X-Ad-Pod-Base') || undefined
    this.signHost = request.headers.get('X-Sign-Host') || undefined
    
    // Use channel-specific config
    const url = new URL(request.url)
    const manifestPath = url.pathname.split('/').pop()
    
    // Fetch from channel-specific origin
    const originResponse = await fetch(`${this.originUrl}/${manifestPath}`)
    
    // ... rest of your logic using this.adPodBaseUrl, this.signHost, etc.
  }
}
```

---

## URL Routing Patterns

### Recommended URL Structure

```
https://your-worker.dev/:orgSlug/:channelSlug/variant.m3u8
```

**Examples:**
- `https://ssai.workers.dev/acme-corp/sports/v_1600k.m3u8`
- `https://ssai.workers.dev/demo/news/v_800k.m3u8`

### Benefits
- ✅ Clear multi-tenant isolation
- ✅ Easy channel identification
- ✅ SEO-friendly slugs
- ✅ Supports multiple clients on same infrastructure

---

## Cache Invalidation

When a channel's configuration is updated via the Admin GUI, the cache is automatically invalidated.

**Manual cache invalidation** (if needed):

```typescript
import { invalidateChannelConfigCache } from './utils/channel-config'

await invalidateChannelConfigCache(env, 'acme-corp', 'sports')
```

---

## Migration Guide

### Step 1: Apply Database Migration

```bash
# Apply the migration
wrangler d1 execute ssai-admin --file=./migrations/002_add_channel_sign_host.sql --config wrangler.admin.toml

# Or apply the full schema (for fresh setup)
wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml
```

### Step 2: Update Existing Channels

Via SQL:
```sql
UPDATE channels 
SET 
  origin_url = 'https://origin.example.com/hls',
  ad_pod_base_url = 'https://ads.example.com/pods',
  sign_host = 'media.example.com'
WHERE id = 'ch_demo_sports';
```

Or via Admin GUI:
1. Navigate to Channels page
2. Click "Edit" on each channel
3. Fill in the new fields
4. Click "Update Channel"

### Step 3: Update Worker Bindings

Add D1 binding to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ssai-admin"
database_id = "0302f8ab-e592-4fa6-8bbf-7371759da6ed"
```

### Step 4: Deploy Updated Workers

```bash
wrangler deploy --config wrangler.toml
wrangler deploy --config wrangler.admin.toml
```

---

## Testing Multi-Tenant Configuration

### Test Case 1: Different Origins

**Channel A (Acme Corp):**
- Origin: `https://cdn-acme.com/live`
- Ad Base: `https://ads-acme.com/pods`
- Sign Host: `media-acme.com`

**Channel B (Demo Org):**
- Origin: `https://cdn-demo.com/streams`
- Ad Base: `https://ads-demo.com/creative`
- Sign Host: `media-demo.com`

### Test Requests

```bash
# Request from Channel A
curl https://your-worker.dev/acme-corp/sports/v_1600k.m3u8

# Request from Channel B
curl https://your-worker.dev/demo/news/v_800k.m3u8
```

### Verify Configuration

Check logs to confirm each channel uses its own configuration:

```typescript
console.log('Channel config:', {
  channel: channelConfig.name,
  originUrl: config.originUrl,      // Should differ per channel
  adPodBaseUrl: config.adPodBaseUrl, // Should differ per channel
  signHost: config.signHost,         // Should differ per channel
})
```

---

## Performance Considerations

### KV Caching (Recommended)

- **Cache TTL**: 5 minutes (300 seconds)
- **Benefits**: Reduces D1 queries, faster response times
- **Invalidation**: Automatic on channel update

### Without KV Caching

- Every request queries D1 directly
- Still performant for most use cases
- Suitable for development/low-traffic scenarios

### Recommended Setup

```toml
# Production: Enable KV caching
[[kv_namespaces]]
binding = "CHANNEL_CONFIG_CACHE"
id = "your_kv_namespace_id"
```

---

## Security Considerations

1. **Organization Isolation**: Channels are isolated by `organization_id` in database queries
2. **Slug-Based Access**: Public access uses safe slugs (not internal IDs)
3. **Admin API Authentication**: JWT-protected endpoints for configuration changes
4. **Cache Invalidation**: Automatic cleanup prevents stale data

---

## Troubleshooting

### Channel Not Found

**Error**: `Channel not found`

**Solutions**:
1. Verify channel exists in database:
   ```sql
   SELECT * FROM channels WHERE slug = 'sports';
   ```
2. Check organization slug is correct
3. Ensure channel status is 'active'

### Using Global Defaults

If `origin_url`, `ad_pod_base_url`, or `sign_host` are empty in the database, the system falls back to global defaults from `wrangler.toml`.

**View effective config**:
```typescript
const config = getConfigWithDefaults(channelConfig, {
  originVariantBase: env.ORIGIN_VARIANT_BASE,
  adPodBase: env.AD_POD_BASE,
  signHost: env.SIGN_HOST,
})

console.log('Effective config:', config)
```

### KV Cache Not Working

1. Verify KV namespace binding exists
2. Check namespace ID is correct in `wrangler.toml`
3. Manually invalidate cache if needed

---

## Summary

✅ **Per-channel URLs** configurable via Admin GUI  
✅ **Multi-tenant support** with organization/channel slugs  
✅ **D1 database** stores configuration  
✅ **KV caching** for performance (optional)  
✅ **Fallback to global defaults** if channel config is empty  
✅ **Admin API** automatically updated to support new fields  
✅ **Frontend forms** include all configuration fields  

Your cf-ssai platform is now fully multi-tenant ready! 🎉

