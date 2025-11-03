# Ad Re-Transcoding Guide

## Overview

The re-transcode feature allows you to regenerate HLS variants for an ad with different bitrate profiles, without re-uploading the original source video.

## Use Cases

1. **Wrong bitrates detected**: Initial upload used incorrect bitrate ladder
2. **Channel bitrates changed**: Origin stream now uses different bitrates
3. **Manual override needed**: Want specific custom bitrates
4. **Failed transcode**: Original transcode had errors, try again

## API Endpoint

### POST `/api/ads/:adId/retranscode`

Re-transcode an existing ad with new bitrate settings.

#### Request

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (Option A - Auto-detect from channel):**
```json
{
  "channel_id": "ch_demo_sports"
}
```

**Body (Option B - Manual bitrates):**
```json
{
  "bitrates": [136, 146, 1196]
}
```

**Body (Option C - Auto-detect from organization):**
```json
{}
```

#### Response

**Success (200):**
```json
{
  "success": true,
  "message": "Re-transcode job queued",
  "bitrates": [136, 146, 1196]
}
```

**Error (404):**
```json
{
  "error": "Ad not found"
}
```

**Error (400):**
```json
{
  "error": "Ad has no source video to re-transcode"
}
```

## How It Works

### 1. Bitrate Selection Priority

When you call the re-transcode endpoint:

1. **Manual bitrates** (if provided in request body)
2. **Specified channel** (from `channel_id` in request)
3. **Original channel** (from ad's `channel_id` in database)
4. **Organization default** (first active channel's bitrates)
5. **System default** (`[400, 800, 1200, 2000, 3000]`)

### 2. Process Flow

```
User triggers re-transcode
    ↓
Reset ad status to "queued"
    ↓
Clear any previous error messages
    ↓
Get bitrates (auto or manual)
    ↓
Queue transcode job(s)
    ↓
Transcode worker processes
    ↓
Status updates to "ready"
    ↓
New HLS variants available
```

### 3. Source Video

The system uses the original source video stored in R2:
- Location: `source-videos/{adId}/original.mp4`
- This is why re-uploading isn't needed

### 4. Parallel vs Traditional

The system automatically chooses:
- **Parallel transcoding**: For videos > 30 seconds (configurable)
- **Traditional transcoding**: For shorter videos

## Examples

### Example 1: Auto-detect from Channel

Re-transcode ad to match a specific channel:

```bash
curl -X POST https://admin-api.workers.dev/api/ads/ad_123/retranscode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": "ch_demo_sports"}'
```

This will:
1. Get `ch_demo_sports` bitrate ladder: `[136, 146, 1196]`
2. Re-transcode ad with those bitrates
3. Update HLS variants in R2

### Example 2: Manual Bitrates

Force specific bitrates:

```bash
curl -X POST https://admin-api.workers.dev/api/ads/ad_123/retranscode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bitrates": [500, 1000, 2000, 4000]}'
```

### Example 3: Use Organization Default

Let system auto-detect from any organization channel:

```bash
curl -X POST https://admin-api.workers.dev/api/ads/ad_123/retranscode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## GUI Integration

### Button Placement

Add a "Re-Transcode" button in the ad details view:

```tsx
// admin-frontend/src/app/ads/[id]/page.tsx
export default function AdDetailsPage({ params }: { params: { id: string } }) {
  const [ad, setAd] = useState<Ad | null>(null)
  const [isRetranscoding, setIsRetranscoding] = useState(false)
  
  const handleRetranscode = async () => {
    if (!confirm('Re-transcode this ad? This will regenerate all HLS variants.')) {
      return
    }
    
    setIsRetranscoding(true)
    
    try {
      const response = await fetch(`/api/ads/${params.id}/retranscode`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel_id: ad.channel_id // Use ad's original channel
        })
      })
      
      if (!response.ok) throw new Error('Retranscode failed')
      
      const result = await response.json()
      
      toast.success(`Re-transcode queued with bitrates: ${result.bitrates.join(', ')}`)
      
      // Poll for status updates
      pollTranscodeStatus(params.id)
      
    } catch (error) {
      toast.error('Failed to queue re-transcode')
    } finally {
      setIsRetranscoding(false)
    }
  }
  
  return (
    <div>
      <h1>{ad.name}</h1>
      
      <div className="flex gap-2">
        <Badge variant={ad.transcode_status === 'ready' ? 'success' : 'warning'}>
          {ad.transcode_status}
        </Badge>
        
        <Button 
          onClick={handleRetranscode}
          disabled={isRetranscoding || !ad.source_key}
          variant="outline"
        >
          {isRetranscoding ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Re-transcoding...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-Transcode
            </>
          )}
        </Button>
      </div>
      
      {/* Show current variants */}
      <div className="mt-4">
        <h3>Current Variants</h3>
        {ad.variants_parsed?.map(v => (
          <div key={v.bitrate}>
            {(v.bitrate / 1000).toFixed(0)}k - {v.resolution}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Advanced: Manual Bitrate Selector

Add option to manually specify bitrates:

```tsx
const [showManualBitrates, setShowManualBitrates] = useState(false)
const [manualBitrates, setManualBitrates] = useState('')

const handleRetranscode = async () => {
  const body: any = {}
  
  if (showManualBitrates && manualBitrates) {
    // Parse comma-separated bitrates
    body.bitrates = manualBitrates.split(',').map(b => parseInt(b.trim()))
  } else if (ad.channel_id) {
    body.channel_id = ad.channel_id
  }
  
  const response = await fetch(`/api/ads/${params.id}/retranscode`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  
  // ... handle response
}

return (
  <>
    <Button onClick={handleRetranscode}>Re-Transcode</Button>
    
    <Collapsible open={showManualBitrates} onOpenChange={setShowManualBitrates}>
      <CollapsibleTrigger>
        <Button variant="ghost" size="sm">
          {showManualBitrates ? 'Use Auto-Detect' : 'Manual Bitrates'}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <Input
          placeholder="e.g., 400, 800, 1600, 2400"
          value={manualBitrates}
          onChange={(e) => setManualBitrates(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Enter bitrates in kbps, comma-separated
        </p>
      </CollapsibleContent>
    </Collapsible>
  </>
)
```

### Bulk Re-Transcode

Re-transcode multiple ads at once:

```tsx
const [selectedAds, setSelectedAds] = useState<string[]>([])

const handleBulkRetranscode = async () => {
  if (!confirm(`Re-transcode ${selectedAds.length} ads?`)) return
  
  const promises = selectedAds.map(adId =>
    fetch(`/api/ads/${adId}/retranscode`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({}) // Use org defaults
    })
  )
  
  const results = await Promise.allSettled(promises)
  
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  toast.success(`${succeeded} / ${selectedAds.length} ads queued for re-transcode`)
}
```

## Monitoring

### Check Status

```bash
curl https://admin-api.workers.dev/api/ads/ad_123/refresh \
  -H "Authorization: Bearer <token>" \
  -X POST
```

Returns:
```json
{
  "success": true,
  "transcode_status": "transcoding",
  "duration": null,
  "variants": null,
  "master_playlist_url": null
}
```

### Watch Logs

```bash
wrangler tail cf-ssai-transcode
```

Look for:
```
Re-transcoding ad ad_123 with auto-detected bitrates: [136, 146, 1196]
Re-queueing transcode job for ad ad_123
Queued 3 parallel transcode jobs for ad ad_123
```

## Common Scenarios

### Scenario 1: Channel Bitrates Changed

**Problem**: Your channel used to be `[800, 1600, 2400]` but now it's `[400, 800, 1200]`

**Solution**:
1. Update channel bitrate ladder (or let auto-detection do it)
2. Re-transcode all ads assigned to that channel
3. Use bulk re-transcode feature in GUI

### Scenario 2: Ad Has Wrong Bitrates

**Problem**: Ad has `[1000, 2000, 3000]` but should be `[136, 146, 1196]`

**Solution**:
```bash
curl -X POST /api/ads/ad_123/retranscode \
  -d '{"channel_id": "ch_demo_sports"}'
```

### Scenario 3: Want Custom Bitrates

**Problem**: Need specific bitrates for special use case

**Solution**:
```bash
curl -X POST /api/ads/ad_123/retranscode \
  -d '{"bitrates": [300, 600, 1200, 2500, 5000]}'
```

## Limitations

1. **Source video required**: Ad must have original source in R2
2. **No partial re-transcode**: All variants are regenerated
3. **Old variants deleted**: Previous HLS files are overwritten
4. **Queue based**: May take time depending on queue length

## Best Practices

1. **Test first**: Re-transcode one ad before bulk operations
2. **Use channel_id**: More reliable than organization defaults
3. **Monitor status**: Check logs to ensure success
4. **Schedule off-peak**: Bulk re-transcodes during low-traffic times
5. **Keep source videos**: Never delete source videos from R2

## Troubleshooting

### Re-transcode fails immediately

**Check:**
1. Does ad have `source_key` in database?
2. Is source video still in R2?
3. Are bitrates valid (positive integers)?

### Transcode stuck in "queued"

**Check:**
1. Is transcode worker running?
2. Check queue depth: `wrangler queues list`
3. View worker logs for errors

### Wrong bitrates still used

**Check:**
1. What bitrates were passed to API?
2. Check logs for "Re-transcoding ad X with bitrates: Y"
3. Verify channel bitrate ladder in database

## Database Impact

Re-transcoding updates:
- `transcode_status` → `'queued'`
- `error_message` → `NULL`
- `updated_at` → current timestamp
- After completion: `variants`, `master_playlist_url`, `duration`

## API Integration Test

```bash
#!/bin/bash

AD_ID="ad_1762091472274_yaqfua2ch"
TOKEN="your_token_here"

echo "Re-transcoding ad..."
curl -X POST "https://admin-api.workers.dev/api/ads/${AD_ID}/retranscode" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": "ch_demo_sports"}' | jq

echo "\nWaiting 5 seconds..."
sleep 5

echo "\nChecking status..."
curl -X POST "https://admin-api.workers.dev/api/ads/${AD_ID}/refresh" \
  -H "Authorization: Bearer ${TOKEN}" | jq
```
