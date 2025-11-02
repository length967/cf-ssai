# Parallel Transcoding Implementation Guide

## Overview

The parallel transcoding system enables **faster ad transcoding** by splitting long videos into segments and processing them across multiple FFmpeg containers simultaneously. This can reduce transcode time from **5x real-time to ~0.5-1x real-time** for 10-container deployments.

## Architecture

### Components

1. **TranscodeCoordinatorDO** (`src/transcode-coordinator-do.ts`)
   - Durable Object for ephemeral job coordination
   - Tracks segment completion/failure status
   - Triggers assembly when all segments complete
   - Auto-cleans up after 1 hour

2. **Transcode Worker** (`src/transcode-worker.ts`)
   - Handles three job types:
     - **Legacy**: Full-video transcode (existing functionality)
     - **SEGMENT**: Parallel segment transcode
     - **ASSEMBLY**: Concatenate completed segments
   - Communicates with coordinator DO for status updates

3. **Admin API** (`src/admin-api-worker.ts`)
   - Creates parallel transcode jobs
   - Initializes coordinator DO
   - Queues segment jobs in batch

### Data Flow

```
Upload Video
    ↓
Admin API: Detect duration (TODO: probe before queuing)
    ↓
If duration > 30s: Create parallel job
    ↓
Initialize TranscodeCoordinatorDO
    ↓
Queue N segment jobs (10s each)
    ↓
10 Transcode Workers process segments in parallel
    ↓
Each worker notifies coordinator on completion/failure
    ↓
Coordinator detects all segments complete
    ↓
Queue ASSEMBLY job
    ↓
Assembly worker concatenates segments
    ↓
Update D1: status = 'ready'
```

## Key Features

### 1. **Segment-Level Failure Handling**

- Each segment can retry independently (max 3 attempts)
- If segment 5 fails but 4 and 6 succeed, only segment 5 retries
- Automatic exponential backoff (30s, 60s, 90s)
- Job fails only if any segment fails permanently

### 2. **Natural Load Balancing**

Cloudflare Queues automatically distribute work:
- Worker 1 finishes segment 0 → picks up segment 10
- Worker 2 finishes segment 1 → picks up segment 11
- Faster workers automatically get more segments

### 3. **No Database Pollution**

All coordination state lives in the Durable Object:
- Segment tracking is in-memory
- Metadata stored in DO storage (for recovery)
- Auto-cleanup after 1 hour via alarm
- No D1 queries during coordination

### 4. **Idempotency**

- Segments can be retried safely
- R2 paths are deterministic
- Duplicate uploads overwrite (safe)

## Configuration

### wrangler-transcode.toml

```toml
# Transcode Coordinator DO
[[durable_objects.bindings]]
name = "TRANSCODE_COORDINATOR"
class_name = "TranscodeCoordinatorDO"

[[migrations]]
tag = "v2"
new_classes = ["TranscodeCoordinatorDO"]

# Container configuration
[[containers]]
class_name = "FFmpegContainer"
max_instances = 10  # Scale up for parallel processing
```

### Environment Variables

No new environment variables required - uses existing R2 and queue configurations.

## Performance Comparison

### Current (Single Container)
- **30s video**: 2.5 minutes (5x real-time)
- **5-minute video**: 25 minutes

### With Parallel Transcoding (10 Containers)
- **30s video**: ~30-40 seconds (overhead for coordination)
- **5-minute video**: ~60-90 seconds (30 segments × 10 containers)

**Speedup**: ~5-10x faster for long videos

## Implementation Status

### ✅ Completed

- [x] Shared TypeScript types (`src/types/transcode.ts`)
- [x] TranscodeCoordinatorDO implementation
- [x] Transcode worker segment/assembly handlers
- [x] Wrangler.toml bindings and migrations
- [x] Failure handling and retry logic

### ⏳ TODO (Next Steps)

1. **FFmpeg Container Endpoints**
   - Implement `/transcode-segment` endpoint
   - Implement `/assemble-segments` endpoint
   - Add segment duration extraction from source

2. **Duration Probing**
   - Add ffprobe call before queueing in admin API
   - Decide parallel vs. single based on duration
   - Threshold: 30 seconds

3. **Admin API Integration**
   - Uncomment parallel job creation code
   - Add duration probe logic
   - Update upload UI to show segment progress

4. **Testing**
   - Unit tests for coordinator DO
   - Integration tests for parallel flow
   - Load testing with 10 concurrent jobs

## FFmpeg Container Changes Needed

### New Endpoint: `/transcode-segment`

```javascript
// Transcode a specific time segment of the source video
async function transcodeSegment({ 
  adId, segmentId, sourceKey, startTime, duration, bitrates, r2Config 
}) {
  const sourceFile = await downloadFromR2(sourceKey);
  
  // FFmpeg: Extract segment first
  const segmentFile = `/tmp/segment-${segmentId}.mp4`;
  await exec(`ffmpeg -ss ${startTime} -t ${duration} -i ${sourceFile} -c copy ${segmentFile}`);
  
  // Transcode segment to HLS
  const outputDir = `/tmp/output-${segmentId}`;
  for (const bitrate of bitrates) {
    await transcodeVariant(segmentFile, outputDir, bitrate);
  }
  
  // Upload to R2: transcoded-ads/${adId}/segment-${segmentId}/
  const r2Path = `transcoded-ads/${adId}/segment-${segmentId}`;
  await uploadDirectory(outputDir, r2Path);
  
  return { success: true, r2Path };
}
```

### New Endpoint: `/assemble-segments`

```javascript
// Concatenate all segments into final HLS playlist
async function assembleSegments({ adId, segmentPaths, bitrates, r2Config }) {
  // For each bitrate, concatenate the segment playlists
  const variants = [];
  
  for (const bitrate of bitrates) {
    const segmentPlaylists = [];
    
    // Download all segment playlists for this bitrate
    for (const segmentPath of segmentPaths) {
      const playlist = await downloadFromR2(`${segmentPath}/${bitrate}k/playlist.m3u8`);
      segmentPlaylists.push(playlist);
    }
    
    // Merge playlists (concatenate #EXTINF and segment URLs)
    const mergedPlaylist = mergeHLSPlaylists(segmentPlaylists);
    
    // Upload merged playlist
    const finalPath = `transcoded-ads/${adId}/${bitrate}k/playlist.m3u8`;
    await uploadToR2(finalPath, mergedPlaylist);
    
    variants.push({ bitrate: bitrate * 1000, url: `${r2Config.publicUrl}/${finalPath}` });
  }
  
  // Create master playlist
  const masterPlaylist = createMasterPlaylist(variants);
  await uploadToR2(`transcoded-ads/${adId}/master.m3u8`, masterPlaylist);
  
  return { success: true, variants, masterUrl: `${r2Config.publicUrl}/transcoded-ads/${adId}/master.m3u8` };
}
```

## Monitoring & Debugging

### Check Coordinator Status

```bash
# Via wrangler (local dev)
curl http://localhost:8787/coordinator-status?jobGroupId=<uuid>

# Or query DO directly
wrangler durable-objects get TranscodeCoordinatorDO <jobGroupId> --local
```

### View Segment Progress

```sql
-- (No database queries needed - state is in DO)
-- Use coordinator status endpoint instead
```

### Common Issues

**Problem**: Segments queued but not processing
- **Cause**: Workers not scaled up
- **Fix**: Increase `max_instances` in wrangler-transcode.toml

**Problem**: Assembly fails with "missing segments"
- **Cause**: R2 eventual consistency
- **Fix**: Add retry logic in assembly endpoint

**Problem**: Coordinator state lost
- **Cause**: DO hibernation without state sync
- **Fix**: Already implemented - see `syncSegmentsToStorage()`

## Cost Comparison

### Traditional Approach
- 10 containers idle most of the time
- Pay for 10 × idle time

### Parallel Approach
- Containers spin up on-demand
- Process segments in parallel
- Scale to zero after completion
- **Cost**: ~same or lower (faster completion = less compute time)

## Migration Path

1. **Phase 1**: Deploy infrastructure (✅ DONE)
   - Types, DO, worker handlers, wrangler configs

2. **Phase 2**: FFmpeg container endpoints
   - Implement segment transcode
   - Implement assembly

3. **Phase 3**: Enable in admin API
   - Add duration probing
   - Uncomment parallel job creation

4. **Phase 4**: Testing & optimization
   - Integration tests
   - Performance benchmarking
   - Tune segment duration (currently 10s)

## Next Steps

To complete the implementation:

```bash
# 1. Implement FFmpeg container endpoints
cd ffmpeg-container
# Add /transcode-segment and /assemble-segments to server.js

# 2. Test locally
npm run dev:transcode
# Upload a long video, verify segments process in parallel

# 3. Deploy
npm run deploy:all

# 4. Monitor
wrangler tail cf-ssai-transcode
```

## References

- **Coordinator DO**: `src/transcode-coordinator-do.ts`
- **Worker Handlers**: `src/transcode-worker.ts` (lines 201-418)
- **Types**: `src/types/transcode.ts`
- **FFmpeg Docs**: `ffmpeg-container/transcode.js` (existing logic)

---

**Status**: Infrastructure complete, FFmpeg container endpoints pending
**Target Speedup**: 5-10x for videos > 30 seconds
**Next PR**: FFmpeg segment/assembly endpoints
