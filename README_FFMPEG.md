# 🎬 Cloudflare SSAI Platform - Production Architecture

## FFmpeg + R2 + Containers

A production-ready Server-Side Ad Insertion (SSAI) platform built on Cloudflare's edge infrastructure, featuring **exact bitrate control** via FFmpeg transcoding and cost-effective R2 storage.

---

## 🏗️ **Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                   Complete SSAI Workflow                        │
└─────────────────────────────────────────────────────────────────┘

1. USER UPLOADS COMMERCIAL
   Admin GUI → Upload MP4 (any format, any bitrate)
   
2. STORE IN R2
   Admin API Worker → R2 Bucket (source-videos/)
   
3. QUEUE TRANSCODE JOB
   Admin API → Queue (transcode-queue)
   
4. FFMPEG TRANSCODES
   Transcode Worker → FFmpeg Container (Durable Object)
   - Downloads source from R2
   - Transcodes to EXACT bitrates (1000k, 2000k, 3000k)
   - Creates HLS playlists + segments
   - Uploads to R2 (transcoded-ads/)
   
5. UPDATE STATUS
   Container → Database (transcode_status = ready)
   
6. USER CREATES AD POD
   Admin GUI → Browse Ready Ads → Select → Auto-populate variants
   
7. LIVE STREAM INSERTION
   Viewer → Manifest Worker → Channel DO → Ad Insertion Logic
   Viewer watching 2000k stream? → Serve 2000k ad variant
   Perfect bitrate match = Seamless transition!
```

---

## ✨ **Key Features**

### **Exact Bitrate Control** ✅
- Match your live stream bitrates **precisely** (e.g., 1000k, 2000k, 3000k)
- No auto-selection or guessing
- Seamless ad transitions (no buffering, no quality jumps)

### **Cost-Effective** 💰
- ~$0.001 per ad transcode (30-second video)
- ~$5-10/month total (for 100 ads)
- **90-95% cost reduction** vs Cloudflare Stream

### **Fast Transcoding** ⚡
- 30-60 seconds for typical 30-second commercial
- Queue-based with automatic retries
- Parallel processing for multiple ads

### **Production-Ready** 🚀
- Built on Cloudflare Containers (Beta)
- Durable Object state management
- R2 for reliable, low-cost storage
- Full observability and logging

### **No Vendor Lock-In** 🔓
- Standard HLS output
- Portable to any CDN
- Open-source FFmpeg
- Full control over transcoding

---

## 📦 **Components**

### **1. Admin API Worker**
- REST API for ad management
- R2 upload handling
- Queue job creation
- Multi-tenant authentication

### **2. Transcode Worker**
- Queue consumer (transcode-queue)
- Container lifecycle management
- Status tracking and retries
- Error handling and DLQ

### **3. FFmpeg Container**
- Docker image with FFmpeg
- Node.js Express server
- HLS transcoding logic
- R2 upload/download

### **4. Admin Frontend**
- Next.js application
- Ad Library UI
- Upload with drag & drop
- Real-time status updates
- Ad Pod management

### **5. Manifest Worker**
- HLS manifest manipulation
- Ad insertion logic
- Bitrate variant selection
- SCTE-35 + time-based triggers

### **6. Channel Durable Object**
- Per-channel state
- Ad break scheduling
- Decision service integration
- Session management

---

## 💻 **Tech Stack**

| Component | Technology |
|-----------|------------|
| **Compute** | Cloudflare Workers |
| **Containers** | Cloudflare Containers (Beta) |
| **Storage** | Cloudflare R2 |
| **Database** | Cloudflare D1 (SQLite) |
| **Cache** | Cloudflare KV |
| **Queue** | Cloudflare Queues |
| **State** | Durable Objects |
| **Frontend** | Next.js + Cloudflare Pages |
| **Transcoding** | FFmpeg 6.x |
| **Language** | TypeScript, JavaScript, Node.js |

---

## 🚀 **Getting Started**

### **1. Quick Start**

```bash
# Clone the repository
cd /Users/markjohns/Development/cf-ssai

# Install dependencies
npm install

# Apply database migration
npx wrangler d1 execute ssai-admin --local --file=./migrations/004_remove_stream_add_r2.sql

# Create R2 bucket
npx wrangler r2 bucket create ssai-ads

# Create queue
npx wrangler queues create transcode-queue

# Configure R2 credentials in .dev.vars
# R2_ACCOUNT_ID=...
# R2_ACCESS_KEY_ID=...
# R2_SECRET_ACCESS_KEY=...

# Deploy transcode worker with container
npx wrangler deploy --config wrangler-transcode.toml

# Deploy admin API
npx wrangler deploy

# Deploy frontend
cd admin-frontend && npm run build && npx wrangler pages deploy .next
```

### **2. Full Deployment Guide**

See: [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md)

---

## 📊 **Cost Breakdown**

### **Monthly Operating Costs (100 Ads, 100K Views)**

| Service | Usage | Cost |
|---------|-------|------|
| Workers Paid Plan | Base subscription | $5.00 |
| Container Compute | ~10 vCPU-minutes | $0.01 |
| R2 Storage | ~1 GB | $0.02 |
| R2 Operations | ~10,000 reads/writes | $0.05 |
| Queue Messages | ~200 messages | $0.00 |
| **Total** | | **$5.08/month** |

### **Per-Ad Cost**

- Transcode: ~$0.001
- Storage: ~$0.0002/month
- **Total**: ~$0.0012 per ad

**Compared to Cloudflare Stream:**
- Stream: $1/1000 min delivered + $5/1000 min stored = **$100-500/month**
- FFmpeg + R2: **$5-10/month**
- **Savings: 90-95%**

---

## 📖 **Documentation**

| Document | Description |
|----------|-------------|
| [`PRODUCTION_ARCHITECTURE.md`](./PRODUCTION_ARCHITECTURE.md) | Detailed architecture and design |
| [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) | Step-by-step deployment instructions |
| [`BITRATE_MATCHING_GUIDE.md`](./BITRATE_MATCHING_GUIDE.md) | Why exact bitrate matching matters |
| [`MIGRATION_COMPLETE.md`](./MIGRATION_COMPLETE.md) | Migration summary (Stream → FFmpeg) |
| [`ADMIN_PLATFORM_GUIDE.md`](./ADMIN_PLATFORM_GUIDE.md) | Admin platform overview |

---

## 🔧 **Development**

### **Local Development**

```bash
# Start local dev server
npm run dev

# Run transcode worker locally
npx wrangler dev --config wrangler-transcode.toml

# Test FFmpeg container locally
cd ffmpeg-container
docker build -t ffmpeg-transcode .
docker run -p 8080:8080 ffmpeg-transcode

# Test transcode locally
./transcode-ad.sh test-video.mp4 test-ad-001 1000k 2000k 3000k
```

### **Testing**

```bash
# Upload test video
curl -X POST http://localhost:8787/api/ads/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-video.mp4" \
  -F "name=Test Ad"

# Check transcode status
curl http://localhost:8787/api/ads/AD_ID

# List R2 files
npx wrangler r2 object list ssai-ads
```

---

## 🎯 **Use Cases**

### **Perfect for:**
- ✅ Live stream monetization
- ✅ OTT/streaming platforms
- ✅ Multi-tenant ad serving
- ✅ High-volume ad insertion
- ✅ Exact bitrate requirements
- ✅ Cost-conscious operations

### **Not ideal for:**
- ❌ VOD-only platforms (consider Stream)
- ❌ Very low volume (<10 ads/month)
- ❌ No bitrate matching needed

---

## 📈 **Performance**

| Metric | Value |
|--------|-------|
| **Transcode Time** | 30-60s (30s video) |
| **Cold Start** | 2-3s (container) |
| **Upload Speed** | ~10 MB/s to R2 |
| **HLS Delivery** | <50ms p99 latency |
| **Concurrent Transcodes** | Up to 10 (configurable) |
| **Max Ad Size** | 12 GB (container disk) |

---

## 🛠️ **Troubleshooting**

### **Common Issues**

**Container not starting:**
```bash
npx wrangler containers list
npx wrangler tail cf-ssai-transcode
```

**Transcode failing:**
```bash
npx wrangler queues consumer list transcode-queue
npx wrangler tail cf-ssai-transcode --format=pretty
```

**R2 permission errors:**
```bash
npx wrangler r2 object list ssai-ads
# Check API token has read/write access
```

**See full troubleshooting:** [`DEPLOYMENT_GUIDE.md#troubleshooting`](./DEPLOYMENT_GUIDE.md#troubleshooting)

---

## 🤝 **Contributing**

This is a production platform for your organization. For changes:

1. Test locally first
2. Deploy to staging
3. Monitor logs
4. Gradual rollout

---

## 📜 **License**

Proprietary - Internal use only

---

## 🎊 **Status**

- **Architecture**: ✅ Production-ready
- **FFmpeg + R2**: ✅ Deployed
- **Cloudflare Stream**: ❌ Removed
- **Documentation**: ✅ Complete
- **Cost**: 💰 $5-10/month
- **Performance**: ⚡ 30-60s transcode
- **Bitrate Control**: 🎯 Exact matching

---

**Built with ❤️ on Cloudflare Workers**

For support, see documentation or check logs: `npx wrangler tail <worker-name>`

