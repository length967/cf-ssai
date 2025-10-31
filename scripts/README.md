# Testing Scripts

## `cue.sh` - Ad Break Control Script

A convenient helper script to trigger and control live ad breaks via the `/cue` API.

### Quick Start

```bash
# Start a 30s ad break on the default channel (sports1)
./scripts/cue.sh start

# Stop the current ad break
./scripts/cue.sh stop

# Check the manifest (with SGAI forced)
./scripts/cue.sh status
```

### Advanced Usage

```bash
# Start a 60s ad break on a specific channel
./scripts/cue.sh start --channel live1 --duration 60

# Start ad break with custom pod
./scripts/cue.sh start --pod-id premium-ad --duration 45

# Use custom pod URL
./scripts/cue.sh start --pod-url "https://cdn.example.com/ads/special/v_1600k/playlist.m3u8"

# Connect to a different server
BASE_URL=https://ssai.example.com ./scripts/cue.sh start
```

### Environment Variables

- `BASE_URL` - Base URL of the SSAI service (default: `http://127.0.0.1:8787`)
- `CHANNEL` - Default channel name (default: `sports1`)
- `AUTH_TOKEN` - JWT bearer token for authentication (default: dev token)

### Examples

#### Test SGAI Interstitial

```bash
# Start a 30s ad break
./scripts/cue.sh start --duration 30 --pod-id example-pod

# Immediately fetch manifest to see DATERANGE tag
./scripts/cue.sh status

# Look for: #EXT-X-DATERANGE:ID="example-pod",CLASS="com.apple.hls.interstitial"...
```

#### Test SSAI Splice

```bash
# Start ad break
./scripts/cue.sh start --duration 30

# Fetch with SSAI forced
curl "http://127.0.0.1:8787?channel=sports1&variant=v_1600k.m3u8&force=ssai"

# Look for: #EXT-X-DISCONTINUITY
```

#### Test Auto-Expiry

```bash
# Start a short 10s ad break
./scripts/cue.sh start --duration 10

# Check manifest immediately - should see ad break
./scripts/cue.sh status | grep -i daterange

# Wait 15 seconds
sleep 15

# Check again - ad break should be gone
./scripts/cue.sh status | grep -i daterange || echo "Ad break expired as expected"
```

#### Production Use

```bash
# Set production credentials
export BASE_URL="https://ssai.example.com"
export AUTH_TOKEN="your-real-jwt-token"

# Trigger live ad
./scripts/cue.sh start --channel live-sports --duration 60 --pod-id campaign-123
```

### Response Examples

**Success Response:**
```json
{
  "ok": true,
  "state": {
    "active": true,
    "podId": "example-pod",
    "podUrl": "https://ads.example.com/pods/example-pod/v_1600k/playlist.m3u8",
    "startedAt": 1730379600000,
    "endsAt": 1730379630000,
    "durationSec": 30
  }
}
```

**Stop Response:**
```json
{
  "ok": true,
  "cleared": true
}
```

### Troubleshooting

**403 Forbidden:**
- Ensure `DEV_ALLOW_NO_AUTH=1` is set in `.dev.vars` for local testing
- Or provide a valid JWT token via `AUTH_TOKEN` environment variable

**Connection Refused:**
- Make sure the dev server is running: `npm run dev:manifest`
- Check the `BASE_URL` is correct

**No ad break in manifest:**
- Check the response from `./scripts/cue.sh start` - did it succeed?
- Verify the ad hasn't expired (check timestamps in response)
- Try `./scripts/cue.sh status` to see the current manifest

### Integration with CI/CD

```bash
# In your GitHub Actions / CI pipeline
- name: Test Ad Insertion
  run: |
    npm run dev:manifest &
    sleep 5
    ./scripts/cue.sh start --channel test --duration 30
    curl -f "http://127.0.0.1:8787?channel=test" | grep -q DATERANGE
    ./scripts/cue.sh stop
```

