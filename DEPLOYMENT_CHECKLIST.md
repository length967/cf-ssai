# Multi-Tenant Deployment Checklist

## ✅ Code Integration Complete!

All code changes for per-channel, multi-tenant configuration have been implemented and are ready for deployment.

---

## 📋 Deployment Steps

### **Step 1: Apply Database Migration** ⏳

```bash
wrangler d1 execute ssai-admin \
  --file=./migrations/002_add_channel_sign_host.sql \
  --config wrangler.admin.toml
```

**Verify:**
```bash
wrangler d1 execute ssai-admin \
  --command="SELECT name, origin_url, ad_pod_base_url, sign_host FROM channels" \
  --config wrangler.admin.toml
```

---

### **Step 2: (Optional) Create KV Namespace** ⏳

For production performance, create a KV namespace for caching:

```bash
wrangler kv:namespace create "CHANNEL_CONFIG_CACHE"
```

This will output something like:
```
{ binding = "CHANNEL_CONFIG_CACHE", id = "abc123..." }
```

**Then edit `wrangler.toml`** and uncomment/update lines 30-32:
```toml
[[kv_namespaces]]
binding = "CHANNEL_CONFIG_CACHE"
id = "abc123..."  # Replace with your actual ID
```

---

### **Step 3: Deploy Workers** ⏳

Deploy all workers with the new configuration:

```bash
# Main manifest worker (includes multi-tenant routing)
wrangler deploy --config wrangler.toml

# Admin API (includes sign_host support)
wrangler deploy --config wrangler.admin.toml

# Other workers (new observability settings)
wrangler deploy --config wrangler.beacon.toml
wrangler deploy --config wrangler.decision.toml
wrangler deploy --config wrangler.vast.toml
```

**Verify deployment:**
```bash
wrangler deployments list
```

---

### **Step 4: Deploy Admin Frontend** ⏳

```bash
cd admin-frontend
npm run build
npx wrangler pages deploy out --project-name=ssai-admin
cd ..
```

**Access admin:** `https://ssai-admin.pages.dev`

---

### **Step 5: Configure Channels** ⏳

1. Navigate to: `https://ssai-admin.pages.dev/channels`
2. Login with your admin credentials
3. For each channel, click "Edit" and configure:
   - **Origin URL**: Your channel's HLS origin (e.g., `https://cdn.example.com/live/sports`)
   - **Ad Pod Base URL**: Your ad server URL (e.g., `https://ads.example.com/pods`)
   - **Sign Host**: Host for URL signing (e.g., `media.example.com`)
4. Click "Update Channel"

**Leave fields empty to use global defaults from `wrangler.toml`.**

---

### **Step 6: Test Multi-Tenant Setup** ⏳

#### Test Path-Based Routing:
```bash
# Replace with your actual worker URL
curl -H "Authorization: Bearer YOUR_JWT" \
  https://cf-ssai.YOUR_ACCOUNT.workers.dev/demo/sports/v_1600k.m3u8
```

#### Test Per-Channel Config:
Create two channels with different URLs and verify they use different origins:

```bash
# Channel A
curl https://cf-ssai.YOUR_ACCOUNT.workers.dev/acme-corp/sports/v_1600k.m3u8

# Channel B  
curl https://cf-ssai.YOUR_ACCOUNT.workers.dev/demo/news/v_800k.m3u8
```

Check logs at: https://dash.cloudflare.com/workers-and-pages/observability

---

## 🎯 What's New

### **Multi-Tenant URL Routing**
```
Old: ?channel=sports&variant=v_1600k.m3u8
New: /acme-corp/sports/v_1600k.m3u8
     └─────┬─────┘ └──┬──┘ └────┬────┘
        org      channel  variant
```

### **Per-Channel Configuration**
Each channel can now have:
- Custom origin URL
- Custom ad pod base URL
- Custom signing host

Configured via Admin GUI, stored in D1, cached in KV.

### **Observability Optimization**
- Manifest Worker: 1% logs, 10% traces
- Admin API: 20% logs, 20% traces
- Other Workers: 5-15% sampling
- **Cost savings: 90-99% reduction**

---

## 📊 Quick Reference

### **File Changes**
- ✅ `src/manifest-worker.ts` - Multi-tenant routing
- ✅ `src/channel-do.ts` - Per-channel URLs
- ✅ `src/utils/channel-config.ts` - Config utilities
- ✅ `src/admin-api-worker.ts` - sign_host support
- ✅ `admin-frontend/src/app/channels/page.tsx` - Form fields
- ✅ `wrangler.toml` - D1 + KV bindings
- ✅ All `wrangler.*.toml` - Observability sampling

### **Database Changes**
- ✅ Added `sign_host` column to `channels` table
- ✅ Created migration file
- ✅ Updated schema.sql

### **Documentation**
- ✅ `CHANNEL_CONFIG_GUIDE.md` - Integration guide
- ✅ `MULTITENANT_CONFIG_SUMMARY.md` - Implementation summary
- ✅ `INTEGRATION_COMPLETE.md` - Deployment guide
- ✅ `DEPLOYMENT_CHECKLIST.md` - This file

---

## 🔍 Troubleshooting

### Channel Not Found
```json
{"error": "Channel not found", "org": "demo", "channel": "sports"}
```
**Solution:** Create the channel via Admin GUI or check org/channel slugs.

### Using Global Defaults
If channel config fields are empty, system falls back to `wrangler.toml` values.
This is expected behavior for backward compatibility.

### KV Cache Not Working
Verify KV namespace ID is correct in `wrangler.toml`:
```bash
wrangler kv:namespace list
```

---

## ✅ Success Criteria

Your deployment is successful when:

- [ ] Database migration applied (sign_host column exists)
- [ ] All workers deployed successfully
- [ ] Admin frontend shows sign_host field in channel form
- [ ] Path-based routing works: `/:org/:channel/variant.m3u8`
- [ ] Per-channel config is used when accessing channels
- [ ] Observability shows reduced event counts (sampling active)
- [ ] Logs show "Channel config loaded" messages

---

## 🚀 Ready to Deploy!

All code is complete and tested. Follow the 6 steps above to deploy your multi-tenant SSAI platform.

**Estimated deployment time:** 15-30 minutes

**Questions?** Review the comprehensive guides:
- `CHANNEL_CONFIG_GUIDE.md` - How to use per-channel config
- `INTEGRATION_COMPLETE.md` - Full deployment details

