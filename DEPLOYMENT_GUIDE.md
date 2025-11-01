# 🚀 Production Deployment Guide - FFmpeg + R2 SSAI

This guide walks you through deploying the production-ready SSAI ad management system using FFmpeg in Cloudflare Containers and R2 for storage.

---

## 📋 **Prerequisites**

Before you begin, ensure you have:

- ✅ Cloudflare account with **Workers Paid plan** ($5/month)
- ✅ Docker installed locally (for building container images)
- ✅ Wrangler CLI installed (`npm install -g wrangler`)
- ✅ Node.js 18+ installed
- ✅ Access to your Cloudflare dashboard

---

## 🗄️ **Step 1: Database Migration**

Apply the new database schema to remove Cloudflare Stream references and add R2 fields:

```bash
cd /Users/markjohns/Development/cf-ssai

# Apply migration to local D1
npx wrangler d1 execute ssai-admin --local --file=./migrations/004_remove_stream_add_r2.sql

# Apply migration to production D1
npx wrangler d1 execute ssai-admin --remote --file=./migrations/004_remove_stream_add_r2.sql
```

**Verify the migration:**

```bash
# Local
npx wrangler d1 execute ssai-admin --local --command="SELECT * FROM ads LIMIT 1"

# Production
npx wrangler d1 execute ssai-admin --remote --command="SELECT * FROM ads LIMIT 1"
```

**Expected new columns:**
- `source_key` (TEXT)
- `transcode_status` (TEXT)
- `master_playlist_url` (TEXT)
- `error_message` (TEXT)
- `transcoded_at` (INTEGER)
- `channel_id` (TEXT)

**Removed columns:**
- `stream_id`
- `stream_status`
- `stream_thumbnail_url`

---

## 📦 **Step 2: Create R2 Bucket**

Create the R2 bucket for ad storage:

```bash
# Create the R2 bucket
npx wrangler r2 bucket create ssai-ads

# Enable public access (optional, for direct HLS playback)
# Recommended: Use a custom domain with public access
```

**Configure Public Access (Recommended):**

1. Go to Cloudflare Dashboard → R2
2. Select `ssai-ads` bucket
3. Settings → Public Access → Enable
4. Configure custom domain (e.g., `ads.example.com`)
5. Update `R2_PUBLIC_URL` in your configuration

---

## 🔐 **Step 3: Generate R2 API Credentials**

Create API tokens for R2 access:

1. **Cloudflare Dashboard** → R2 → **Manage R2 API Tokens**
2. **Create API Token**
3. **Permissions:**
   - Object Read & Write
4. **R2 Bucket:** `ssai-ads`
5. Click **Create API Token**
6. **Save these values:**
   - Access Key ID
   - Secret Access Key
   - Account ID

**Update `.dev.vars` for local development:**

```bash
# Edit .dev.vars
R2_ACCOUNT_ID=your_account_id_here
R2_ACCESS_KEY_ID=your_access_key_id_here
R2_SECRET_ACCESS_KEY=your_secret_access_key_here
R2_PUBLIC_URL=https://pub-XXXXX.r2.dev  # Or your custom domain
```

**Set production secrets:**

```bash
# Set R2 credentials as secrets
npx wrangler secret put R2_ACCOUNT_ID
# Paste your account ID and press Enter

npx wrangler secret put R2_ACCESS_KEY_ID
# Paste your access key ID and press Enter

npx wrangler secret put R2_SECRET_ACCESS_KEY
# Paste your secret access key and press Enter
```

---

## 📬 **Step 4: Create Queue**

Create the transcode queue:

```bash
# Create the transcode queue
npx wrangler queues create transcode-queue

# Create dead-letter queue for failed jobs
npx wrangler queues create transcode-dlq
```

**Verify:**

```bash
npx wrangler queues list
```

You should see:
- `transcode-queue`
- `transcode-dlq`

---

## 🐳 **Step 5: Build and Deploy FFmpeg Container**

### **5.1: Ensure Docker is Running**

```bash
# Check Docker is running
docker info

# If not running, start Docker Desktop
```

### **5.2: Test Container Locally (Optional)**

```bash
cd ffmpeg-container

# Build locally
docker build -t ffmpeg-transcode .

# Test run
docker run -p 8080:8080 -e PORT=8080 ffmpeg-transcode

# In another terminal, test health endpoint
curl http://localhost:8080/health
```

### **5.3: Deploy Transcode Worker with Container**

```bash
cd /Users/markjohns/Development/cf-ssai

# Deploy the transcode worker (this builds and uploads the container)
npx wrangler deploy --config wrangler-transcode.toml

# This will:
# 1. Build the Docker image from ffmpeg-container/Dockerfile
# 2. Push the image to Cloudflare's Container Registry
# 3. Deploy the transcode worker
# 4. Configure the queue consumer
```

**⚠️ First Deployment Note:**

After the first deployment, **wait 3-5 minutes** for the container image to be provisioned across Cloudflare's network before it can accept requests.

**Check deployment status:**

```bash
# List containers
npx wrangler containers list

# List deployed images
npx wrangler containers images list

# Check transcode worker status
npx wrangler deployments list --name cf-ssai-transcode
```

---

## 🌐 **Step 6: Deploy Admin API Worker**

Update and deploy the Admin API Worker:

```bash
cd /Users/markjohns/Development/cf-ssai

# Deploy Admin API Worker
# (This should be deployed as a separate worker or service)
# Adjust the wrangler.toml if needed

npx wrangler deploy --config wrangler-admin-api.toml
# OR if it's the main worker:
npx wrangler deploy
```

**Ensure the Admin API Worker has:**
- ✅ R2 binding (`R2`)
- ✅ Queue producer binding (`TRANSCODE_QUEUE`)
- ✅ D1 binding (`DB`)

---

## 🎨 **Step 7: Deploy Admin Frontend**

Build and deploy the Next.js admin frontend:

```bash
cd admin-frontend

# Install dependencies
npm install

# Build for production
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy .next --project-name=cf-ssai-admin

# Or use the Cloudflare Dashboard to connect your Git repository
```

**Environment Variables for Pages:**

Set these in Cloudflare Dashboard → Pages → Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://your-admin-api.workers.dev
```

---

## ✅ **Step 8: Verify Deployment**

### **8.1: Check All Services**

```bash
# Check transcode worker
npx wrangler tail cf-ssai-transcode

# Check admin API
npx wrangler tail cf-ssai-admin

# Check containers
npx wrangler containers list
```

### **8.2: Test End-to-End Workflow**

1. **Login to Admin GUI**
   - Navigate to your Pages deployment URL
   - Login with your credentials

2. **Upload a Test Video**
   - Go to "Ads Library"
   - Click "Upload Ad"
   - Select a short test video (30 seconds recommended)
   - Upload and watch status

3. **Monitor Transcode Progress**
   - Status should change: `queued` → `processing` → `ready`
   - Check logs: `npx wrangler tail cf-ssai-transcode`
   - Should take 30-60 seconds for a 30-second video

4. **Create an Ad Pod**
   - Go to "Ad Pods"
   - Click "Create Ad Pod"
   - Click "Browse Ads Library"
   - Select your transcoded ad
   - Bitrate variants should auto-populate
   - Save the Ad Pod

5. **Verify R2 Files**

```bash
# List files in R2
npx wrangler r2 object list ssai-ads --prefix="source-videos/"
npx wrangler r2 object list ssai-ads --prefix="transcoded-ads/"
```

### **8.3: Test HLS Playback**

```bash
# Get the master playlist URL from the ad
# Test with VLC or curl

curl -I "https://pub-XXXXX.r2.dev/transcoded-ads/ad_XXX/master.m3u8"
```

Should return `200 OK` with content type `application/x-mpegURL`.

---

## 🔍 **Troubleshooting**

### **Container Not Starting**

```bash
# Check container status
npx wrangler containers list

# Check if image was deployed
npx wrangler containers images list

# View transcode worker logs
npx wrangler tail cf-ssai-transcode --format=pretty
```

**Common issues:**
- ❌ **Docker not running**: Start Docker Desktop
- ❌ **Image build failed**: Check `ffmpeg-container/Dockerfile` syntax
- ❌ **Container not provisioned**: Wait 3-5 minutes after first deployment

### **Transcode Jobs Failing**

```bash
# Check queue status
npx wrangler queues consumer list transcode-queue

# View dead-letter queue
npx wrangler queues consumer list transcode-dlq

# Check R2 permissions
npx wrangler r2 object list ssai-ads
```

**Common issues:**
- ❌ **R2 permissions**: Verify API token has read/write access
- ❌ **FFmpeg error**: Check container logs for FFmpeg errors
- ❌ **Out of memory**: Upgrade instance type to `standard-3` or `standard-4`

### **Upload Fails**

```bash
# Check Admin API logs
npx wrangler tail cf-ssai-admin --format=pretty

# Check R2 bucket exists
npx wrangler r2 bucket list
```

**Common issues:**
- ❌ **R2 bucket not created**: Run `npx wrangler r2 bucket create ssai-ads`
- ❌ **Queue not created**: Run `npx wrangler queues create transcode-queue`
- ❌ **Missing secrets**: Run `npx wrangler secret put R2_ACCESS_KEY_ID` etc.

### **Frontend Not Connecting to API**

- ✅ Check `NEXT_PUBLIC_API_URL` environment variable in Pages settings
- ✅ Check CORS settings in Admin API Worker
- ✅ Check JWT_SECRET is set in both API and frontend

---

## 💰 **Cost Estimate**

### **Monthly Costs (100 Ads)**

| Service | Usage | Cost |
|---------|-------|------|
| Workers Paid Plan | Base | $5.00 |
| Container Compute | ~10 minutes | ~$0.01 |
| R2 Storage | ~1 GB | ~$0.02 |
| R2 Operations | ~10,000 | ~$0.05 |
| Queue Messages | ~200 | ~$0.00 |
| **Total** | | **~$5.08/month** |

### **Per-Ad Cost**

- Transcode (30s video): ~$0.001
- Storage (10 MB): ~$0.0002/month
- **Total per ad**: ~$0.0012

**Comparison to Cloudflare Stream:**
- Stream: $1/1000 min delivered + $5/1000 min stored
- FFmpeg + R2: ~$5/month flat (for 100 ads)
- **Savings**: ~$100-500/month (depending on volume)

---

## 📊 **Monitoring**

### **Cloudflare Dashboard**

- **Workers → Analytics**: View request volume, errors
- **R2 → Metrics**: View storage usage, bandwidth
- **Queues → Dashboard**: View queue depth, processing rate

### **Logs**

```bash
# Real-time logs
npx wrangler tail cf-ssai-transcode --format=pretty
npx wrangler tail cf-ssai-admin --format=pretty

# Filter for errors
npx wrangler tail cf-ssai-transcode --format=pretty | grep ERROR
```

### **Alerts (Optional)**

Set up alerts in Cloudflare Dashboard for:
- ⚠️ Queue depth > 10
- ⚠️ Worker error rate > 5%
- ⚠️ R2 storage > 90% of quota

---

## 🔄 **Updates and Rollbacks**

### **Deploy New Code**

```bash
# Deploy transcode worker
npx wrangler deploy --config wrangler-transcode.toml

# Deploy admin API
npx wrangler deploy --config wrangler-admin-api.toml
```

### **Rollback**

```bash
# List recent deployments
npx wrangler deployments list --name cf-ssai-transcode

# Rollback to specific version
npx wrangler rollback --name cf-ssai-transcode --version-id=XXXXXXXX
```

---

## 🎉 **You're Live!**

Your production FFmpeg + R2 SSAI system is now deployed!

**Next Steps:**
1. Upload your first commercial
2. Create ad pods with bitrate matching
3. Test SSAI insertion
4. Monitor logs and metrics
5. Scale as needed

**Need Help?**
- Check logs: `npx wrangler tail <worker-name>`
- Review architecture: `/Users/markjohns/Development/cf-ssai/PRODUCTION_ARCHITECTURE.md`
- Bitrate matching guide: `/Users/markjohns/Development/cf-ssai/BITRATE_MATCHING_GUIDE.md`

---

**Production System Status:** ✅ Fully Deployed  
**Cloudflare Stream:** ❌ Removed  
**FFmpeg + R2:** ✅ Active  
**Exact Bitrate Control:** ✅ Enabled  
**Cost-Effective:** ✅ $5-10/month
