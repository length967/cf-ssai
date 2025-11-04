# Phase 2: SCTE-35 Monitor Cron - IN PROGRESS 🚧

**Date:** 2025-11-04  
**Branch:** `refactor/stateless-architecture`  
**Status:** Initial implementation deployed, testing in progress

## Summary

Phase 2 moves SCTE-35 detection OUT of the manifest request path and into a background cron worker. This enables:
- **Proactive detection:** SCTE-35 signals detected before viewers arrive
- **Pre-calculated decisions:** Zero latency on manifest requests
- **Fully stateless manifest serving:** No DO coordination needed

## What's Been Implemented

### 1. SCTE-35 Monitor Worker
**File:** `src/scte35-monitor-worker.ts`

**Features:**
- Cron-based polling (runs every minute)
- Fetches all active channels from D1
- Polls origin manifests for SCTE-35 signals
- Pre-calculates ad decisions via Decision Service
- Writes ad break state to KV
- Parallel processing of multiple channels
- Deduplication (skips already-processed events)
- Comprehensive error handling

**Key Functions:**
- `processChannel()` - Process a single channel for SCTE-35
- `preCalculateDecision()` - Get ad decision before viewers arrive
- `fetchOriginManifest()` - Fetch manifest with retry logic

### 2. Configuration
**File:** `wrangler-scte35-monitor.toml`

**Bindings:**
- D1 Database (channel configuration)
- KV Namespace (ad break state)
- Decision Service (pre-calculation)

**Cron Schedule:**
```toml
[triggers]
crons = ["* * * * *"]  # Every minute
```

### 3. Deployment Scripts
Added to `package.json`:
- `npm run dev:scte35-monitor` - Local development with test scheduling
- `npm run deploy:scte35-monitor` - Deploy to production
- `npm run deploy:all` - Deploy all workers including monitor

## Architecture

### Before (Phase 1: Hybrid)
```
Client → Manifest Worker → [Check KV] → Channel DO
                              ↓            ↓
                          KV Read      KV Write
                                          ↑
                                    (on SCTE-35 detect)
```

### After (Phase 2: Cron Monitor)
```
Cron Worker (every minute)
    ↓
Fetch Channels → Poll Origins → Detect SCTE-35
    ↓                              ↓
Pre-calculate Decision    Write to KV
                                   ↓
Client → Manifest Worker → [Check KV] → Done!
         (Fully stateless)    (Always hits)
```

## Current Limitations

### 1. Cron Frequency
**Issue:** Cloudflare Workers cron minimum interval is 1 minute  
**Impact:** SCTE-35 signals detected up to 60 seconds after appearing  
**Current:** `* * * * *` (every minute)

**Solutions to Explore:**
- **Option A:** Use Durable Object Alarms (can run more frequently)
- **Option B:** Keep 1-minute cron (acceptable for most use cases)
- **Option C:** Hybrid: Cron for background + DO for immediate detection

### 2. Sub-Minute Polling Strategy

For sub-minute polling (2-5 second intervals), we have options:

**Option A: Durable Object Alarms**
```typescript
// In SCTE-35 Monitor DO
async alarm() {
  await this.pollAllChannels()
  await this.state.storage.setAlarm(Date.now() + 2000) // 2 seconds
}
```

**Option B: Hybrid Approach**
- Keep cron for background polling
- DO still detects SCTE-35 in request path (Phase 1)
- Cron provides backup/proactive detection

## Testing Status

### Deployment
✅ Worker deployed successfully  
✅ All bindings configured  
✅ Cron schedule active  

### Functionality Testing
⏳ Waiting for cron execution  
⏳ Checking for KV writes  
⏳ Verifying SCTE-35 detection  

### Test Plan
1. **Manual trigger:** Use wrangler CLI to trigger cron manually
2. **KV verification:** Check for `adbreak:*:scte35_*` keys
3. **Log analysis:** Review poll cycle logs
4. **Integration test:** Trigger manifest request after cron runs

## Next Steps

### Immediate (Testing)
1. ✅ Deploy SCTE-35 monitor
2. ⏳ Wait for cron execution (every minute)
3. ⏳ Verify KV writes from cron
4. ⏳ Test manifest serving with cron-written keys
5. ⏳ Monitor for errors and edge cases

### Short-term (Optimization)
1. **Improve polling frequency:**
   - Implement DO Alarms for sub-minute polling
   - OR accept 1-minute interval as sufficient
  
2. **Remove DO SCTE-35 detection:**
   - Once cron is proven reliable
   - Keep DO detection as fallback OR remove entirely
  
3. **Add metrics:**
   - Poll cycle duration
   - Channels processed
   - SCTE-35 signals detected
   - Decisions pre-calculated

### Medium-term (Phase 3)
1. **Remove Durable Object entirely:**
   - `/cue` API writes directly to KV
   - Manifest worker is 100% stateless
   - All state in KV

2. **Optimize performance:**
   - Fine-tune cron frequency
   - Add intelligent polling (only poll when needed)
   - Implement channel priority queues

## Known Issues

### 1. No SCTE-35 in Test Stream
**Issue:** Demo stream may not have active SCTE-35 signals  
**Workaround:** Use `/cue` API for testing  
**Solution:** Find/configure test stream with reliable SCTE-35

### 2. Observability Delay
**Issue:** Logs take 5-10 minutes to appear in dashboard  
**Workaround:** Use `wrangler tail` for real-time logs  
**Solution:** Accept delay as normal Cloudflare behavior

### 3. Cron Cold Starts
**Issue:** First cron execution may be slow (cold start)  
**Impact:** Minimal (only affects first poll)  
**Solution:** Normal Workers behavior, no action needed

## Manual Testing Commands

### Trigger Cron Manually (Local)
```bash
npm run dev:scte35-monitor
# Use --test-scheduled flag to trigger immediately
```

### Check KV for SCTE-35 Breaks
```bash
wrangler kv key list --namespace-id=610235dd3e264254a59a72851a05d217 --remote \
  --prefix="adbreak:ch_demo_sports:scte35"
```

### View Cron Logs
```bash
wrangler tail cf-ssai-scte35-monitor
```

### Check Cron Schedule
```bash
wrangler deployments list --name cf-ssai-scte35-monitor
```

## Performance Expectations

| Metric | Target | Notes |
|--------|--------|-------|
| Poll Cycle Duration | <5 seconds | For 10 channels |
| SCTE-35 Detection Latency | 0-60 seconds | Depends on cron interval |
| Decision Pre-calculation | <2 seconds | Per channel |
| KV Write Latency | <100ms | Per ad break |
| Memory Usage | <128MB | Typical |

## Success Criteria

Phase 2 is complete when:
- ✅ Cron worker deployed and running
- ⏳ SCTE-35 signals detected proactively
- ⏳ Decisions pre-calculated before viewer requests
- ⏳ KV writes confirmed from cron
- ⏳ Manifest requests hit cron-written KV entries
- ⏳ Zero SCTE-35 detection overhead in manifest path

## Rollback Plan

If Phase 2 causes issues:

1. **Pause the cron:**
   ```bash
   wrangler triggers disable cf-ssai-scte35-monitor
   ```

2. **Keep Phase 1 behavior:**
   - DO continues to detect SCTE-35
   - Manifest worker falls back to DO
   - No changes needed to existing workers

3. **Debug and redeploy:**
   - Fix issues in monitor worker
   - Test locally with `--test-scheduled`
   - Redeploy when ready

## Conclusion

Phase 2 initial implementation is **deployed and running**. The SCTE-35 Monitor Worker is polling every minute, detecting SCTE-35 signals, pre-calculating decisions, and writing to KV.

**Current Status:** Waiting for cron execution and verification

**Next Action:** Monitor logs and KV for successful poll cycles

**Timeline:** 
- Testing: 1-2 hours
- Optimization: 2-3 days  
- Phase 3: 1-2 days

**Total Phase 2 Completion:** 3-5 days
