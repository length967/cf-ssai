# Slate Management Guide

## Overview

The slate management feature allows you to pad ad breaks with custom "We'll Be Right Back" content when ads are shorter than the SCTE-35 break duration. This prevents jarring cuts back to live content.

## Features

### 1. **Video Upload Slates**
Upload custom slate videos (e.g., branded "We'll Be Right Back" animations)

- Support for any video format (transcoded to HLS automatically)
- Matches channel bitrate ladder
- Stored in R2 and served via CDN

### 2. **Generated Text Slates**
Create simple text-based slates with FFmpeg (no video upload needed)

- **Configurable text**: e.g., "...back soon!", "Please stand by"
- **Background color**: Hex color picker (e.g., `#000000` for black)
- **Text color**: Hex color picker (e.g., `#FFFFFF` for white)
- **Font size**: Adjustable (default: 48px)
- **Duration**: Configurable slate duration (default: 10 seconds)

## Database Schema

```sql
CREATE TABLE slates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Type: 'video' or 'generated'
  slate_type TEXT NOT NULL DEFAULT 'video',
  
  -- For uploaded videos
  source_video_url TEXT,
  source_file_size INTEGER,
  
  -- For generated slates
  text_content TEXT,
  background_color TEXT,
  text_color TEXT,
  font_size INTEGER,
  
  -- Transcoded HLS output
  master_playlist_url TEXT,
  variants TEXT, -- JSON array
  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Add slate reference to channels
ALTER TABLE channels ADD COLUMN slate_id TEXT;
```

## API Endpoints

### List Slates
```bash
GET /api/slates
Authorization: Bearer <token>
```

Response:
```json
{
  "slates": [
    {
      "id": "slate_123",
      "name": "Please Stand By",
      "slate_type": "generated",
      "text_content": "...back soon!",
      "background_color": "#000000",
      "text_color": "#FFFFFF",
      "font_size": 48,
      "duration": 10,
      "status": "ready",
      "variants_parsed": [...]
    }
  ]
}
```

### Upload Video Slate
```bash
POST /api/slates/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <video file>
name: "Branded Slate"
channel_id: "ch_demo_sports" (optional)
```

### Create Generated Slate
```bash
POST /api/slates/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Back Soon Slate",
  "text_content": "...back soon!",
  "background_color": "#1a1a1a",
  "text_color": "#00ff00",
  "font_size": 64,
  "duration": 10,
  "channel_id": "ch_demo_sports"
}
```

### Update Slate
```bash
PUT /api/slates/:id
Authorization: Bearer <token>

{
  "name": "Updated Name"
}
```

### Delete Slate
```bash
DELETE /api/slates/:id
Authorization: Bearer <token>
```

## How It Works

### 1. Ad Break Timing

When an SCTE-35 signal indicates a 38.4-second ad break, but your ad is only 30 seconds:

```
[30s Ad Content] + [8.4s Slate Padding] = 38.4s Total
```

### 2. Slate Assignment

Each channel can have a `slate_id` assigned:

```sql
UPDATE channels SET slate_id = 'slate_123' WHERE id = 'ch_demo_sports';
```

### 3. Automatic Padding Logic

In `channel-do.ts`, the system:

1. Calculates the gap: `gapDuration = scte35Duration - actualAdDuration`
2. Fetches the channel's configured slate
3. Loops slate segments to fill the gap
4. Appends slate segments to the ad playlist

```typescript
// Example: 8.4 second gap, 6-second slate segments
// Result: 2 slate segments (12s), trimmed to fit
```

### 4. Slate Transcoding

**For Uploaded Slates:**
- Standard transcode worker handles it like regular ads
- Matches channel bitrate ladder
- Creates HLS variants

**For Generated Slates:**
- Transcode worker detects `isGenerated: true` flag
- Uses FFmpeg to generate video with:
  ```bash
  ffmpeg -f lavfi -i color=c=#000000:s=1920x1080:d=10 \
         -vf "drawtext=text='...back soon!':fontcolor=#FFFFFF:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" \
         -c:v libx264 -preset fast -r 30 -t 10 output.mp4
  ```
- Then transcodes to HLS with multiple bitrates

## Frontend Integration (TODO)

### Slate Management Page

Create `admin-frontend/src/app/slates/page.tsx`:

```tsx
"use client"

export default function SlatesPage() {
  const [slates, setSlates] = useState([])
  const [mode, setMode] = useState<'upload' | 'generate'>('generate')
  
  // Generated Slate Form
  const [textContent, setTextContent] = useState('...back soon!')
  const [backgroundColor, setBackgroundColor] = useState('#000000')
  const [textColor, setTextColor] = useState('#FFFFFF')
  const [fontSize, setFontSize] = useState(48)
  
  return (
    <div>
      <h1>Slate Management</h1>
      
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList>
          <TabsTrigger value="generate">Generate Text Slate</TabsTrigger>
          <TabsTrigger value="upload">Upload Video</TabsTrigger>
        </TabsList>
        
        {mode === 'generate' && (
          <div>
            <Input 
              placeholder="Message" 
              value={textContent} 
              onChange={(e) => setTextContent(e.target.value)} 
            />
            
            <label>Background Color</label>
            <input 
              type="color" 
              value={backgroundColor} 
              onChange={(e) => setBackgroundColor(e.target.value)} 
            />
            
            <label>Text Color</label>
            <input 
              type="color" 
              value={textColor} 
              onChange={(e) => setTextColor(e.target.value)} 
            />
            
            <label>Font Size: {fontSize}px</label>
            <Slider 
              min={24} 
              max={128} 
              value={[fontSize]} 
              onValueChange={([v]) => setFontSize(v)} 
            />
            
            <Button onClick={createGeneratedSlate}>Generate Slate</Button>
          </div>
        )}
        
        {mode === 'upload' && (
          <input type="file" accept="video/*" onChange={handleUpload} />
        )}
      </Tabs>
      
      <SlateList slates={slates} />
    </div>
  )
}
```

### Assign Slate to Channel

In channel edit form (`admin-frontend/src/app/channels/[id]/edit/page.tsx`):

```tsx
<Select value={channel.slate_id} onValueChange={setSlateId}>
  <SelectTrigger>
    <SelectValue placeholder="Select slate" />
  </SelectTrigger>
  <SelectContent>
    {slates.map(slate => (
      <SelectItem key={slate.id} value={slate.id}>
        {slate.name} ({slate.slate_type})
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

## Deployment Steps

### 1. Run Database Migration

```bash
# Local
wrangler d1 migrations apply ssai-admin --local

# Production
wrangler d1 migrations apply ssai-admin --remote
```

### 2. Deploy Workers

```bash
npm run deploy:manifest  # Contains slate padding logic
npm run deploy:admin-api  # Contains slate APIs
npm run deploy:transcode  # Will need update for FFmpeg generation
```

### 3. Create a Test Slate

```bash
curl -X POST https://admin-api.workers.dev/api/slates/generate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Slate",
    "text_content": "...back soon!",
    "background_color": "#000000",
    "text_color": "#00FF00",
    "font_size": 64,
    "duration": 10
  }'
```

### 4. Assign to Channel

```bash
curl -X PUT https://admin-api.workers.dev/api/channels/ch_demo_sports \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "slate_id": "slate_123456789_abc"
  }'
```

## FFmpeg Generation Command Reference

### Simple Text Slate
```bash
ffmpeg -f lavfi \
  -i color=c=#000000:s=1920x1080:d=10:r=30 \
  -vf "drawtext=text='...back soon!':fontcolor=#FFFFFF:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  -t 10 \
  slate.mp4
```

### With Custom Colors
```bash
ffmpeg -f lavfi \
  -i color=c=#1a1a1a:s=1920x1080:d=10:r=30 \
  -vf "drawtext=text='Please Stand By':fontcolor=#00ff00:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  -t 10 \
  slate.mp4
```

## Troubleshooting

### Slate Not Appearing
1. Check channel has `slate_id` set: `SELECT slate_id FROM channels WHERE id = ?`
2. Verify slate status is `'ready'`: `SELECT status FROM slates WHERE id = ?`
3. Check logs for "No slate configured for channel" or "Slate not ready"

### Generated Slate Transcoding Failed
1. Check transcode worker logs for FFmpeg errors
2. Verify FFmpeg is available in Docker container
3. Check font availability (system fonts required for drawtext)

### Duration Mismatch Still Occurring
1. Verify `totalDuration` uses `totalDuration` (not `stableDuration`) in `replaceSegmentsWithAds` call
2. Check slate segment parsing is working correctly
3. Review logs for "Added X slate segments" message

## Best Practices

1. **Keep slates short**: 5-10 seconds is ideal (will loop to fill gaps)
2. **Use simple designs**: Complex animations increase file size
3. **Test both modes**: Generated slates are faster, uploaded slates are more branded
4. **Match brand colors**: Use organization's color scheme for consistency
5. **Consider accessibility**: Ensure text contrast ratio meets WCAG standards
6. **Set per-channel**: Different channels can have different slates

## Next Steps

- [ ] Complete transcode worker FFmpeg generation logic
- [ ] Build slate management UI in admin frontend
- [ ] Add preview functionality for generated slates
- [ ] Support font selection for generated slates
- [ ] Add slate analytics (how often slates are shown)
