# Bitrate Detection UI Integration Guide

This guide describes how to integrate the explicit bitrate detection workflow into the admin GUI.

## Overview

The new workflow allows users to:
1. Enter an origin stream URL when creating/editing a channel
2. Click "Detect Bitrates" to fetch and parse the master manifest
3. Review detected bitrates and optionally edit them before saving
4. Save the channel with explicit bitrate ladder configuration
5. All ads uploaded for that channel will automatically transcode to those exact bitrates

## API Endpoints

### 1. Detect Bitrates

**Endpoint:** `POST /api/channels/detect-bitrates`

**Request:**
```json
{
  "originUrl": "https://origin.example.com/stream/master.m3u8"
}
```

**Response (Success):**
```json
{
  "success": true,
  "bitrates": [800, 1600, 2400, 3600],
  "variants": [
    {
      "bandwidth": 800000,
      "bitrate": 800,
      "resolution": "640x360",
      "uri": "v_800k/index.m3u8"
    },
    {
      "bandwidth": 1600000,
      "bitrate": 1600,
      "resolution": "1280x720",
      "uri": "v_1600k/index.m3u8"
    },
    ...
  ]
}
```

**Response (Error):**
```json
{
  "success": false,
  "bitrates": [],
  "variants": [],
  "error": "HTTP 404: Not Found"
}
```

### 2. Create Channel with Bitrate Ladder

**Endpoint:** `POST /api/channels`

**Request:**
```json
{
  "name": "Sports Channel",
  "slug": "sports",
  "origin_url": "https://origin.example.com/stream/master.m3u8",
  "bitrate_ladder": [800, 1600, 2400, 3600],
  "bitrate_ladder_source": "auto",
  "detected_bitrates": [800, 1600, 2400, 3600],
  "last_bitrate_detection": 1699999999999,
  // ... other channel fields
}
```

**Fields:**
- `bitrate_ladder` (number[]): Array of bitrates in kbps, sorted ascending
- `bitrate_ladder_source` (string): "auto" (detected) or "manual" (user-edited)
- `detected_bitrates` (number[]): Original detected bitrates (for comparison)
- `last_bitrate_detection` (number): Unix timestamp in milliseconds

### 3. Update Channel Bitrate Ladder

**Endpoint:** `PUT /api/channels/:channelId`

**Request:** Same structure as create, only include fields to update

## UI Components

### Channel Create/Edit Form

```tsx
import React, { useState } from 'react'

function ChannelForm() {
  const [originUrl, setOriginUrl] = useState('')
  const [bitrateLadder, setBitrateLadder] = useState<number[]>([])
  const [detectedBitrates, setDetectedBitrates] = useState<number[]>([])
  const [bitrateSource, setBitrateSource] = useState<'auto' | 'manual' | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectionError, setDetectionError] = useState<string | null>(null)

  const handleDetectBitrates = async () => {
    if (!originUrl) {
      alert('Please enter an origin URL first')
      return
    }

    setDetecting(true)
    setDetectionError(null)

    try {
      const response = await fetch('/api/channels/detect-bitrates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ originUrl })
      })

      const result = await response.json()

      if (result.success) {
        setBitrateLadder(result.bitrates)
        setDetectedBitrates(result.bitrates)
        setBitrateSource('auto')
        setDetectionError(null)
      } else {
        setDetectionError(result.error || 'Detection failed')
      }
    } catch (error) {
      setDetectionError(error.message || 'Network error')
    } finally {
      setDetecting(false)
    }
  }

  const handleBitrateChange = (index: number, value: number) => {
    const newLadder = [...bitrateLadder]
    newLadder[index] = value
    setBitrateLadder(newLadder.sort((a, b) => a - b))
    setBitrateSource('manual')
  }

  const handleAddBitrate = () => {
    setBitrateLadder([...bitrateLadder, 0].sort((a, b) => a - b))
    setBitrateSource('manual')
  }

  const handleRemoveBitrate = (index: number) => {
    setBitrateLadder(bitrateLadder.filter((_, i) => i !== index))
    setBitrateSource('manual')
  }

  const handleSave = async () => {
    const channelData = {
      name: formData.name,
      slug: formData.slug,
      origin_url: originUrl,
      bitrate_ladder: bitrateLadder,
      bitrate_ladder_source: bitrateSource,
      detected_bitrates: detectedBitrates,
      last_bitrate_detection: Date.now(),
      // ... other fields
    }

    // POST or PUT to /api/channels
  }

  return (
    <form>
      <div>
        <label>Origin Stream URL</label>
        <input 
          type="url" 
          value={originUrl}
          onChange={(e) => setOriginUrl(e.target.value)}
          placeholder="https://origin.example.com/stream/master.m3u8"
        />
        <button 
          type="button"
          onClick={handleDetectBitrates}
          disabled={detecting || !originUrl}
        >
          {detecting ? 'Detecting...' : '🔍 Detect Bitrates'}
        </button>
      </div>

      {detectionError && (
        <div className="error">
          ❌ {detectionError}
        </div>
      )}

      {bitrateLadder.length > 0 && (
        <div>
          <label>
            Bitrate Ladder 
            <span className="badge">
              {bitrateSource === 'auto' ? '✅ Auto-detected' : '✏️ Manual'}
            </span>
          </label>
          
          {bitrateLadder.map((bitrate, index) => (
            <div key={index} className="bitrate-row">
              <input
                type="number"
                value={bitrate}
                onChange={(e) => handleBitrateChange(index, parseInt(e.target.value))}
                min="0"
                step="100"
              />
              <span>kbps</span>
              <button 
                type="button"
                onClick={() => handleRemoveBitrate(index)}
                disabled={bitrateLadder.length <= 1}
              >
                ✕
              </button>
            </div>
          ))}

          <button type="button" onClick={handleAddBitrate}>
            + Add Bitrate
          </button>
        </div>
      )}

      <button type="submit" onClick={handleSave}>
        Save Channel
      </button>
    </form>
  )
}
```

### Channel Detail View

```tsx
function ChannelDetail({ channelId }: { channelId: string }) {
  const [channel, setChannel] = useState(null)
  const [redetecting, setRedetecting] = useState(false)
  const [retranscoding, setRetranscoding] = useState(false)

  const handleRedetect = async () => {
    if (!channel.origin_url) {
      alert('No origin URL configured')
      return
    }

    setRedetecting(true)

    try {
      // Detect bitrates
      const detectResponse = await fetch('/api/channels/detect-bitrates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ originUrl: channel.origin_url })
      })

      const detectResult = await detectResponse.json()

      if (detectResult.success) {
        // Update channel with new bitrates
        await fetch(`/api/channels/${channelId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            bitrate_ladder: detectResult.bitrates,
            bitrate_ladder_source: 'auto',
            detected_bitrates: detectResult.bitrates,
            last_bitrate_detection: Date.now()
          })
        })

        // Refresh channel data
        await loadChannel()
        alert('Bitrates re-detected successfully')
      } else {
        alert(`Detection failed: ${detectResult.error}`)
      }
    } finally {
      setRedetecting(false)
    }
  }

  const handleRetranscodeAllAds = async () => {
    if (!confirm('Re-transcode all ads for this channel? This will queue transcoding jobs for all associated ads.')) {
      return
    }

    setRetranscoding(true)

    try {
      // Fetch all ads for this channel
      const adsResponse = await fetch(`/api/ads?channel_id=${channelId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const adsData = await adsResponse.json()
      const ads = adsData.ads || []

      // Re-transcode each ad
      for (const ad of ads) {
        await fetch(`/api/ads/${ad.id}/retranscode`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            channel_id: channelId
          })
        })
      }

      alert(`Re-transcode jobs queued for ${ads.length} ads`)
    } catch (error) {
      alert(`Failed to queue re-transcode jobs: ${error.message}`)
    } finally {
      setRetranscoding(false)
    }
  }

  return (
    <div>
      <h2>{channel.name}</h2>
      
      <div className="bitrate-info">
        <h3>Bitrate Configuration</h3>
        <p>
          <strong>Current Ladder:</strong> {channel.bitrate_ladder?.join(', ')} kbps
        </p>
        <p>
          <strong>Source:</strong> {channel.bitrate_ladder_source || 'Not set'}
        </p>
        <p>
          <strong>Last Detected:</strong> {
            channel.last_bitrate_detection 
              ? new Date(channel.last_bitrate_detection).toLocaleString()
              : 'Never'
          }
        </p>

        <div className="actions">
          <button 
            onClick={handleRedetect}
            disabled={redetecting || !channel.origin_url}
          >
            {redetecting ? 'Detecting...' : '🔄 Re-detect Bitrates'}
          </button>

          <button 
            onClick={handleRetranscodeAllAds}
            disabled={retranscoding}
          >
            {retranscoding ? 'Processing...' : '🎬 Re-transcode All Ads'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

## Workflow

### New Channel Creation
1. User enters channel name, slug, and origin URL
2. User clicks "Detect Bitrates" button
3. GUI calls `/api/channels/detect-bitrates` with the origin URL
4. API fetches master manifest and extracts bitrates
5. GUI displays detected bitrates with ability to edit
6. User reviews and optionally adjusts bitrates
7. User saves channel with bitrate ladder

### Edit Existing Channel
1. User navigates to channel detail page
2. GUI displays current bitrate configuration
3. User can click "Re-detect Bitrates" to refresh from origin
4. User can manually edit bitrate ladder
5. User saves changes

### Ad Upload
1. User uploads ad video
2. User selects target channel (optional)
3. Backend automatically uses channel's bitrate ladder for transcoding
4. Ad is transcoded to exact matching bitrates

### Re-transcode Ads
1. User detects new bitrates or changes ladder
2. User clicks "Re-transcode All Ads" for the channel
3. GUI iterates through all ads associated with the channel
4. For each ad, calls `/api/ads/:adId/retranscode` with updated channel_id
5. Backend queues transcoding jobs with channel's current bitrate ladder

## Validation

The backend validates bitrate ladders:
- Must be an array
- Must not be empty
- All values must be positive integers
- Must be in ascending order
- No duplicates

If validation fails, the API returns a 400 error with a descriptive message.

## Error Handling

Common errors and how to handle them:

### Detection Errors
- **Invalid URL**: Show error message, ask user to correct URL format
- **Network timeout**: "Origin stream unreachable - check URL and try again"
- **HTTP errors**: Show HTTP status and message
- **No variants found**: "No playable variants found in manifest"
- **Invalid manifest**: "Not a valid HLS manifest"

### Validation Errors
- **Invalid ladder**: Show specific validation error (e.g., "Bitrates must be in ascending order")
- **Empty ladder**: "At least one bitrate is required"

## Best Practices

1. **Always detect on channel creation**: Encourage users to detect bitrates immediately
2. **Show visual indicators**: Display source (auto/manual) and last detection time
3. **Confirm before re-transcode**: Re-transcoding is expensive, require confirmation
4. **Provide feedback**: Show loading states and success/error messages
5. **Allow manual override**: Users should be able to edit detected bitrates if needed
6. **Show variant details**: Display resolution and bandwidth alongside bitrates for context

## Example CSS

```css
.bitrate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.bitrate-row input[type="number"] {
  width: 120px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-left: 8px;
}

.badge.auto {
  background: #e3f2fd;
  color: #1976d2;
}

.badge.manual {
  background: #fff3e0;
  color: #f57c00;
}

.error {
  color: #d32f2f;
  background: #ffebee;
  padding: 12px;
  border-radius: 4px;
  margin: 12px 0;
}
```

## Testing Checklist

- [ ] Detect bitrates from valid HLS master manifest
- [ ] Handle detection errors gracefully (404, timeout, invalid manifest)
- [ ] Create channel with detected bitrates
- [ ] Edit bitrate ladder manually
- [ ] Save channel with manual ladder (source = "manual")
- [ ] Upload ad for channel → verify transcoding uses channel's bitrates
- [ ] Re-detect bitrates for existing channel
- [ ] Re-transcode all ads after bitrate change
- [ ] Display bitrate ladder source indicator (auto/manual)
- [ ] Show last detection timestamp
