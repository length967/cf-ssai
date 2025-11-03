# Bitrate Detection Improvements

## Problem

When uploading ads, the system was using hardcoded default bitrates `[1000, 2000, 3000]` kbps, which didn't match the actual stream bitrates. This caused:

- **Buffer stalls**: Player switches to a bitrate variant that doesn't have a matching ad
- **Playback errors**: "levelEmptyError" or "Loaded level contains no fragments"
- **Poor user experience**: Ads don't play smoothly across all quality levels

### Example Issue

**Origin stream bitrates**: 136k, 146k, 1196k  
**Ad bitrates**: 800k, 1600k, 2400k  
**Result**: No overlap → player can't find matching ad variants

## Solution

Implemented a **smart bitrate detection system** with 3-tier fallback:

### Priority 1: Specified Channel
If `channel_id` is provided during upload, use that channel's:
1. `bitrate_ladder` (manual or auto-configured)
2. `detected_bitrates` (auto-detected from origin stream)

### Priority 2: Organization Channels
If no channel specified or channel has no bitrates:
- Query the organization's most recently active channel
- Use its bitrate ladder or detected bitrates

### Priority 3: Sensible Defaults
Fallback to: `[400, 800, 1200, 2000, 3000]` kbps
- Covers low-end mobile to high-end desktop
- Better than previous `[1000, 2000, 3000]`

## How It Works

### Automatic Bitrate Detection

When the manifest worker serves a master manifest:

```typescript
// In channel-do.ts
if (channelIdHeader) {
  detectAndStoreBitrates(this.env, channelIdHeader, origin).catch(err => 
    console.error('Bitrate detection failed:', err)
  )
}
```

This:
1. Parses `#EXT-X-STREAM-INF` tags from master manifest
2. Extracts `BANDWIDTH` values
3. Stores in database:
   - `detected_bitrates`: Auto-detected values
   - `bitrate_ladder`: Used for transcoding (can be manual or auto)
   - `bitrate_ladder_source`: Tracks if ladder is `'manual'` or `'auto'`

### Ad Upload with Smart Bitrate Selection

```typescript
// In admin-api-worker.ts
async uploadAd(auth: AuthContext, request: Request) {
  const channelId = formData.get('channel_id')
  
  // Smart bitrate detection
  const bitrates = await this.getBitrateLadder(auth.organizationId, channelId)
  
  // Queue transcode with detected bitrates
  await env.TRANSCODE_QUEUE.send({
    adId, sourceUrl, bitrates, organizationId, channelId
  })
}
```

## Database Schema

Relevant columns in `channels` table:

```sql
CREATE TABLE channels (
  ...
  bitrate_ladder TEXT,            -- JSON array: [136, 146, 1196]
  bitrate_ladder_source TEXT,     -- 'auto' or 'manual'
  detected_bitrates TEXT,         -- JSON array: auto-detected values
  last_bitrate_detection INTEGER  -- Timestamp of last detection
);
```

## Usage

### For Ad Uploads

**Option A: Specify channel (recommended)**
```bash
curl -X POST /api/ads/upload \
  -F "file=@ad.mp4" \
  -F "name=My Ad" \
  -F "channel_id=ch_demo_sports"
```
→ Uses `ch_demo_sports` bitrates

**Option B: No channel specified**
```bash
curl -X POST /api/ads/upload \
  -F "file=@ad.mp4" \
  -F "name=My Ad"
```
→ Uses organization's first active channel bitrates

### For Slate Generation

Same logic applies:

```bash
curl -X POST /api/slates/generate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Back Soon",
    "text_content": "...back soon!",
    "channel_id": "ch_demo_sports"
  }'
```

## Manual Override

If you want to manually set bitrates for a channel:

```sql
UPDATE channels 
SET bitrate_ladder = '[400, 800, 1600]',
    bitrate_ladder_source = 'manual'
WHERE id = 'ch_demo_sports';
```

This prevents auto-detection from overwriting your custom ladder.

## Verification

### Check Detected Bitrates

```bash
wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, bitrate_ladder, detected_bitrates, bitrate_ladder_source \
   FROM channels WHERE id = 'ch_demo_sports'"
```

### Check Ad Variants

```bash
wrangler d1 execute ssai-admin --remote --command \
  "SELECT id, name, variants FROM ads WHERE id = 'ad_xyz'"
```

The `variants` field should contain bitrates matching the channel.

## Logs

When uploading ads, you'll see logs like:

```
Using channel bitrate ladder: [136,146,1196]
```

or

```
No channel bitrates found, checking organization channels
Using org channel detected bitrates: [136,146,1196]
```

or

```
Using default bitrate ladder: [400,800,1200,2000,3000]
```

## Best Practices

1. **Always specify channel_id**: Ensures ads match the target channel's bitrates
2. **Monitor detection**: Check `last_bitrate_detection` to ensure recent detection
3. **Manual override when needed**: For special cases, manually set `bitrate_ladder`
4. **Re-upload ads**: If channel bitrates change, re-upload ads to match

## Troubleshooting

### "Buffer stalled" errors persist

1. Check channel has bitrates configured:
   ```sql
   SELECT bitrate_ladder, detected_bitrates FROM channels WHERE id = ?
   ```

2. Check ad has matching variants:
   ```sql
   SELECT variants FROM ads WHERE id = ?
   ```

3. Compare the two - they should have overlapping bitrates

### Bitrates not auto-detecting

1. Verify master manifest is being served:
   ```bash
   curl "https://your-worker.dev/org/channel/master.m3u8"
   ```

2. Check for `#EXT-X-STREAM-INF` tags in response

3. Check logs for "Detected bitrates for channel"

### Want to force re-detection

```sql
UPDATE channels 
SET bitrate_ladder = NULL,
    bitrate_ladder_source = 'auto',
    last_bitrate_detection = NULL
WHERE id = 'ch_demo_sports';
```

Then request the master manifest again to trigger detection.

## Performance Impact

- **Negligible**: Detection runs fire-and-forget (doesn't block response)
- **Cached**: Results stored in database, not recalculated on every request
- **Smart**: Only updates if `bitrate_ladder_source = 'auto'`

## Future Enhancements

- [ ] Add GUI for viewing/editing bitrate ladders
- [ ] Detect bitrate changes and notify admin
- [ ] Support for custom bitrate profiles per organization
- [ ] Batch re-encode existing ads when channel bitrates change
