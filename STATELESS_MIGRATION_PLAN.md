# Stateless Architecture Migration Plan

## Overview

Migrate from Durable Object-based architecture to stateless, KV-backed architecture to solve:
- Stream stopping after ad breaks (manifest window depletion)
- DO coordination overhead (50-200ms)
- Late joiner problems
- Single point of failure per channel

## Architecture Comparison

### Current (DO-Based)
```
Client → Manifest Worker → Channel DO → Origin
                              ↓
                         Decision Service
```

**Problems:**
- Single DO instance per channel (bottleneck)
- State coordination overhead
- Manifest window tracking issues
- Segment depletion on late joins

### Target (Stateless + KV)
```
Client → Manifest Worker (stateless) → Origin
              ↓
         KV (ad break state)
              ↑
    SCTE-35 Monitor (cron)
```

**Benefits:**
- Stateless manifest serving (edge caching works)
- No coordination overhead
- Each viewer independent
- Infinite horizontal scaling

## Migration Phases

### Phase 1: Hybrid Architecture ✅ COMPLETE

**Goal:** Keep DO but add KV caching layer

**Changes:**
1. Add KV namespace for ad break state
2. DO writes to KV when detecting SCTE-35
3. Manifest worker reads from KV (fallback to DO)
4. Test with existing channels

**Implementation:**
- [x] Add KV binding to wrangler.toml
- [x] Create KV store: `wrangler kv namespace create ADBREAK_STATE`
- [x] Add KV write logic to Channel DO
- [x] Add KV read logic to Manifest Worker
- [x] Fix channelId consistency between /cue and manifest paths
- [x] Test end-to-end (writes + reads working!)

**Results:**
- ✅ KV writes working from DO (both /cue and SCTE-35 paths)
- ✅ KV reads working from Manifest Worker
- ✅ Proper TTL-based expiration (duration + 60s)
- ✅ Complete AdBreakState data structure
- ✅ ChannelId consistency resolved

**Rollback:** Remove KV reads, keep DO logic

---

### Phase 2: Cron-Based SCTE-35 Detection

**Goal:** Move SCTE-35 detection out of request path

**Changes:**
1. Create new worker: `scte35-monitor-worker.ts`
2. Cron polls origin manifests every 1-2 seconds
3. Detect SCTE-35 → pre-calculate decision → store in KV
4. Manifest worker reads only from KV
5. DO handles only `/cue` API (manual triggers)

**Implementation:**
- [ ] Create `scte35-monitor-worker.ts`
- [ ] Add scheduled event handler
- [ ] Implement manifest polling logic
- [ ] Store results in KV with TTL
- [ ] Remove SCTE-35 detection from Channel DO
- [ ] Update manifest worker to read KV only

**Rollback:** Disable cron, re-enable DO detection

---

### Phase 3: Full Stateless (Remove DO)

**Goal:** Eliminate DO entirely

**Changes:**
1. `/cue` API writes directly to KV
2. Remove all DO code
3. Manifest worker fully stateless
4. All state in KV with TTLs

**Implementation:**
- [ ] Move `/cue` API to manifest worker
- [ ] Remove Channel DO binding
- [ ] Remove `channel-do.ts`
- [ ] Update all references
- [ ] Clean up wrangler.toml

**Rollback:** Revert to Phase 2

---

## KV Schema Design

### Key Pattern
```
adbreak:{channelId}:{eventId}
```

### Value Structure
```typescript
interface AdBreakState {
  channelId: string;
  eventId: string;
  source: 'scte35' | 'manual' | 'scheduled';
  
  // Timing
  startTime: string; // ISO-8601
  duration: number; // seconds
  endTime: string; // ISO-8601
  
  // Ad Decision (pre-calculated)
  decision: {
    podId: string;
    items: Array<{
      id: string;
      duration: number;
      variants: Record<string, string>; // bitrate → playlist URL
    }>;
  };
  
  // Metadata
  createdAt: string;
  scte35Data?: {
    pdt: string;
    signalType: string;
    eventId: string;
  };
}
```

### TTL Strategy
```
expirationTtl = duration + 60 seconds
```

### Example
```json
{
  "channelId": "ch_demo_sports",
  "eventId": "14568690-1762228742",
  "source": "scte35",
  "startTime": "2025-11-04T03:59:02.400Z",
  "duration": 38.4,
  "endTime": "2025-11-04T03:59:40.800Z",
  "decision": {
    "podId": "pod_1762204521580_op2y0ofh0",
    "items": [{
      "id": "ad_1762133848408_56kq0c9r2",
      "duration": 30,
      "variants": {
        "1316000": "https://r2.../ad_xxx/1316k/playlist.m3u8",
        "2000000": "https://r2.../ad_xxx/2000k/playlist.m3u8"
      }
    }]
  },
  "createdAt": "2025-11-04T03:59:02.000Z",
  "scte35Data": {
    "pdt": "2025-11-04T03:59:02.400000Z",
    "signalType": "splice_insert",
    "eventId": "14568690"
  }
}
```

## Manifest Worker Logic (Stateless)

```typescript
// Pseudo-code
async function handleManifestRequest(request, env) {
  const { channel, variant } = parseRequest(request);
  
  // 1. Fetch origin manifest (always fresh)
  const origin = await fetch(originUrl);
  const manifest = await origin.text();
  
  // 2. Get channel config
  const config = await getChannelConfig(channel, env);
  
  // 3. Check for active ad break
  const now = new Date();
  const adBreak = await env.KV_ADBREAK_STATE.get(
    `adbreak:${channel}:*`, // List keys
    { type: 'json' }
  );
  
  // 4. Filter active breaks
  const activeBreak = adBreak?.filter(b => 
    new Date(b.startTime) <= now && 
    new Date(b.endTime) >= now
  )[0];
  
  if (!activeBreak) {
    // No ad break, return origin manifest
    return new Response(manifest, {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
    });
  }
  
  // 5. Calculate viewer position
  const elapsedSinceBreak = (now - new Date(activeBreak.startTime)) / 1000;
  
  // 6. Insert ads based on mode and position
  const mode = detectMode(request);
  const modified = mode === 'sgai'
    ? insertSGAI(manifest, activeBreak, elapsedSinceBreak)
    : insertSSAI(manifest, activeBreak, elapsedSinceBreak);
  
  return new Response(modified, {
    headers: { 
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'public, max-age=2'
    }
  });
}
```

## SCTE-35 Monitor Worker (Cron)

```typescript
export default {
  async scheduled(event, env, ctx) {
    // Get all active channels
    const channels = await env.DB.prepare(
      `SELECT id, slug, origin_url, scte35_enabled 
       FROM channels 
       WHERE status = 'active' AND scte35_enabled = 1`
    ).all();
    
    for (const channel of channels.results) {
      // Fetch master manifest
      const manifest = await fetch(channel.origin_url);
      const text = await manifest.text();
      
      // Detect SCTE-35 signals
      const signals = detectSCTE35(text);
      
      for (const signal of signals) {
        const key = `adbreak:${channel.id}:${signal.eventId}`;
        
        // Check if already processed
        const existing = await env.KV_ADBREAK_STATE.get(key);
        if (existing) continue;
        
        // Pre-calculate decision
        const decision = await env.DECISION_SERVICE.fetch(
          new Request('http://decision/decision', {
            method: 'POST',
            body: JSON.stringify({
              channel: channel.id,
              durationSec: signal.duration
            })
          })
        );
        
        // Store in KV
        const state: AdBreakState = {
          channelId: channel.id,
          eventId: signal.eventId,
          source: 'scte35',
          startTime: signal.startTime,
          duration: signal.duration,
          endTime: new Date(
            new Date(signal.startTime).getTime() + 
            signal.duration * 1000
          ).toISOString(),
          decision: await decision.json(),
          createdAt: new Date().toISOString(),
          scte35Data: signal
        };
        
        await env.KV_ADBREAK_STATE.put(
          key,
          JSON.stringify(state),
          { expirationTtl: signal.duration + 60 }
        );
        
        console.log(`✨ Created ad break: ${key}`);
      }
    }
  }
};
```

## Testing Strategy

### Phase 1 Tests
- [ ] DO writes to KV correctly
- [ ] Manifest worker reads from KV
- [ ] Fallback to DO on KV miss
- [ ] TTL expiration works
- [ ] Performance: KV read vs DO call

### Phase 2 Tests
- [ ] Cron detects SCTE-35 accurately
- [ ] Pre-calculation works
- [ ] KV state is consistent
- [ ] No duplicate ad breaks
- [ ] Manual `/cue` still works

### Phase 3 Tests
- [ ] Full stateless operation
- [ ] Late joiners work correctly
- [ ] Edge caching works
- [ ] Performance benchmarks
- [ ] Load testing (1000+ concurrent viewers)

## Performance Targets

| Metric | Current (DO) | Target (Stateless) |
|--------|-------------|-------------------|
| Manifest latency | 150-300ms | 50-100ms |
| Cache hit rate | 50-70% | 80-95% |
| Late joiner success | 60% | 99%+ |
| Segment depletion | Common | Never |

## Rollback Plan

Each phase has independent rollback:
1. **Phase 1:** Remove KV reads, revert to DO
2. **Phase 2:** Disable cron, re-enable DO detection
3. **Phase 3:** Restore Phase 2 code

## Timeline

- **Phase 1:** 2-3 days (implementation + testing)
- **Phase 2:** 3-4 days (cron worker + migration)
- **Phase 3:** 2-3 days (cleanup + final testing)

**Total:** ~2 weeks

## Success Metrics

- ✅ No stream stopping after ad breaks
- ✅ Manifest latency < 100ms P95
- ✅ Late joiner success rate > 99%
- ✅ Edge cache hit rate > 80%
- ✅ Zero segment depletion errors
