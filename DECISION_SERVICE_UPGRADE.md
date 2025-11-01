# Decision Service Upgrade - Database-Driven Configuration

## 🎯 Problem Solved

**Before**: The decision service had **fixed configuration** in `wrangler.decision.toml`:
- ❌ Hardcoded `AD_POD_BASE` URL
- ❌ Hardcoded pod mappings (`sports → sports-pod-premium`)
- ❌ No database integration
- ❌ Couldn't use ads uploaded via Admin GUI

**After**: The decision service is now **fully database-driven**:
- ✅ Queries channel-specific `ad_pod_base_url` from D1
- ✅ Queries actual ad pods from database
- ✅ Uses real transcoded ads uploaded via GUI
- ✅ Per-channel VAST configuration
- ✅ Per-channel slate pod configuration

---

## 🏗️ Architecture Changes

### Database Integration

The decision service now queries **3 key tables** from D1:

1. **`channels`** - Get channel configuration:
   ```sql
   SELECT ad_pod_base_url, vast_url, vast_enabled, slate_pod_id
   FROM channels 
   WHERE id = ? AND status = 'active'
   ```

2. **`ad_pods`** - Get available ad pods:
   ```sql
   SELECT id, name, ads
   FROM ad_pods
   WHERE (channel_id = ? OR channel_id IS NULL) 
     AND organization_id = ?
   ```

3. **`ads`** - Get transcoded ad details:
   ```sql
   SELECT id, name, variants, duration
   FROM ads
   WHERE id IN (?) AND transcode_status = 'ready'
   ```

### Ad Waterfall Priority

The decision service now follows this priority:

1. **VAST Ads** (if channel has `vast_enabled = 1` and `vast_url` configured)
2. **Database Ad Pods** (uploaded and transcoded via GUI)
3. **Slate Fallback** (channel-specific or global)

---

## 🔧 Configuration Now Works Like This

### Per-Channel Settings

Each channel in the database can configure:

| Setting | Description | Fallback |
|---------|-------------|----------|
| `ad_pod_base_url` | Base URL for transcoded ads | `env.AD_POD_BASE` |
| `vast_url` | Channel-specific VAST server | `env.VAST_URL` |
| `vast_enabled` | Enable/disable VAST for this channel | `false` |
| `slate_pod_id` | Channel-specific slate/filler | `env.SLATE_POD_ID` |

### Environment Variables (Global Defaults)

`wrangler.decision.toml` now contains **defaults** that are overridden by channel config:

```toml
[vars]
AD_POD_BASE = "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads"
DECISION_TIMEOUT_MS = "2000"
CACHE_DECISION_TTL = "60"
SLATE_POD_ID = "slate"
```

---

## 📊 Data Flow

### When an Ad Break Happens:

```mermaid
Manifest Worker → Decision Service:
  - channel: "ch_demo_sports"
  - durationSec: 30

Decision Service:
  1. Query channel config from D1
  2. Check VAST if enabled
  3. Query ad pods from D1
  4. Get transcoded ads with variants
  5. Build response with actual HLS URLs

Response → Manifest Worker:
  {
    pod: {
      podId: "pod_123",
      items: [
        { bitrate: 1000000, playlistUrl: "https://r2.../ad_123/1000k/playlist.m3u8" },
        { bitrate: 2000000, playlistUrl: "https://r2.../ad_123/2000k/playlist.m3u8" },
        { bitrate: 3000000, playlistUrl: "https://r2.../ad_123/3000k/playlist.m3u8" }
      ]
    }
  }
```

---

## 🚀 Benefits

1. **Multi-Tenancy**: Different organizations can have different ad sources
2. **Flexibility**: Configure ads per-channel, not globally
3. **GUI Integration**: Uses ads you upload via the Admin GUI
4. **No Code Changes**: Update configuration via database/GUI, not code deployments
5. **Exact Bitrate Matching**: Uses transcoded variants that match your stream

---

## ✅ What You Need to Do

### 1. Deploy the Updated Decision Service

```bash
cd /Users/markjohns/Development/cf-ssai
npx wrangler deploy --config wrangler.decision.toml
```

### 2. Create an Ad Pod via Admin GUI

1. Go to `https://main.ssai-admin.pages.dev`
2. Navigate to **Ad Pods**
3. Click **+ New Ad Pod**
4. Select your transcoded ad
5. Save

### 3. (Optional) Configure Channel-Specific Settings

In the Admin GUI, when editing a channel, you can now set:
- Ad Pod Base URL (defaults to R2 public URL)
- VAST URL (for programmatic ads)
- Enable/Disable VAST
- Slate Pod ID (for fallback)

---

## 🔍 Debugging

### Check if the decision service can query the database:

```bash
npx wrangler tail cf-ssai-decision --format=pretty
```

Look for these log messages:
- ✅ `Channel config loaded: ch_demo_sports (org: org_demo)`
- ✅ `Selected ad pod from DB: pod_123 (My Test Pod)`
- ✅ `Using database pod: pod_123 with 1 ads (3 variants)`

### Common Issues:

| Issue | Cause | Solution |
|-------|-------|----------|
| "No channel config found" | Channel ID mismatch | Verify channel ID in request matches DB |
| "No ad pods found" | No pods created | Create an ad pod via GUI |
| "Pod has no ready ads" | Ads still transcoding | Wait for transcode to complete |
| "Falling back to slate" | All above failed | Normal - slate is the final fallback |

---

## 🎓 Summary

**The decision service is now a true multi-tenant, database-driven ad decisioning engine!**

- ✅ No more hardcoded URLs
- ✅ No more hardcoded pod mappings  
- ✅ Fully configurable per-channel
- ✅ Uses real ads from your GUI
- ✅ Exact bitrate matching
- ✅ Production-ready architecture

**Deploy it and test your stream - your uploaded ads will now be inserted automatically! 🎉**

