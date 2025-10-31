# 🚀 Cloudflare Deployment Guide

## Complete deployment of SSAI Admin Platform to Cloudflare

---

## 📋 Prerequisites

- Cloudflare account
- Wrangler CLI installed and authenticated
- D1 database created and initialized
- All workers tested locally

---

## 🗄️ Step 1: Deploy Admin API (Cloudflare Workers)

### **1.1 Set Production JWT Secret**

```bash
# Generate a secure random secret
openssl rand -hex 32

# Set it as a secret
wrangler secret put JWT_SECRET --config wrangler.admin.toml
# Paste the generated secret when prompted
```

### **1.2 Update Production CORS (Optional)**

If you know your production frontend URL:

```toml
# In wrangler.admin.toml
[vars]
ADMIN_CORS_ORIGIN = "https://ssai-admin.pages.dev"  # Your Pages URL
```

### **1.3 Deploy Admin API**

```bash
npm run deploy:admin-api
```

✅ **Result**: Admin API deployed to Cloudflare Workers
- URL will be something like: `https://cf-ssai-admin-api.your-account.workers.dev`
- Note this URL - you'll need it for the frontend

---

## 🎨 Step 2: Deploy Frontend (Cloudflare Pages)

### **2.1 Update Frontend Environment**

Update the API URL for production:

```bash
cd admin-frontend

# Create production .env file (optional, can set in Pages dashboard)
echo "NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.your-account.workers.dev" > .env.production
```

### **2.2 Build the Frontend**

```bash
npm run build
```

### **2.3 Deploy to Cloudflare Pages**

#### **Option A: Using Wrangler (Recommended)**

```bash
# Deploy the static build
npx wrangler pages deploy .next --project-name=ssai-admin

# Follow prompts to create the project
```

#### **Option B: Using Cloudflare Dashboard**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Pages**
3. Click **Create a project**
4. Choose **Direct Upload**
5. Upload the `.next` folder
6. Set environment variable:
   - Key: `NEXT_PUBLIC_API_URL`
   - Value: `https://cf-ssai-admin-api.your-account.workers.dev`

#### **Option C: GitHub Integration**

1. Push your code to GitHub
2. Connect repository in Cloudflare Pages
3. Build settings:
   - **Framework preset**: Next.js (Static HTML Export)
   - **Build command**: `npm run build`
   - **Build output directory**: `.next`
4. Add environment variable:
   - `NEXT_PUBLIC_API_URL`: Your API URL

✅ **Result**: Frontend deployed to Cloudflare Pages
- URL will be: `https://ssai-admin.pages.dev` (or custom domain)

---

## 🔄 Step 3: Update CORS After Deployment

Once you have your Pages URL, update the API's CORS:

```bash
# Edit wrangler.admin.toml
[vars]
ADMIN_CORS_ORIGIN = "https://ssai-admin.pages.dev"

# Redeploy
npm run deploy:admin-api
```

---

## 🚀 Step 4: Deploy All SSAI Workers

Deploy the complete SSAI system:

```bash
# From project root
npm run deploy:all
```

This deploys:
- ✅ Manifest Worker
- ✅ Decision Service
- ✅ Beacon Consumer
- ✅ VAST Parser
- ✅ Admin API

---

## ✅ Step 5: Verify Deployment

### **Admin API Health Check**

```bash
curl https://cf-ssai-admin-api.your-account.workers.dev/health
```

Expected: `OK`

### **Frontend Access**

Visit: `https://ssai-admin.pages.dev`

Login with:
- Email: `admin@demo.com`
- Password: `demo123`

### **Test Full Flow**

1. Login to admin platform
2. Create a test channel
3. View analytics (if any beacon data exists)

---

## 🔐 Security Checklist

- [ ] JWT_SECRET is set to a secure random value
- [ ] CORS is configured for your production domain only
- [ ] D1 database is in production (not local)
- [ ] Password for demo account changed or disabled
- [ ] All secrets are set (not in code)

---

## 📊 Production URLs Summary

After deployment, you'll have:

```
Frontend:  https://ssai-admin.pages.dev
API:       https://cf-ssai-admin-api.your-account.workers.dev
Manifest:  https://cf-ssai.your-account.workers.dev
Decision:  https://cf-ssai-decision.your-account.workers.dev
Beacon:    https://cf-ssai-beacon-consumer.your-account.workers.dev
VAST:      https://cf-ssai-vast-parser.your-account.workers.dev
```

---

## 🔧 Troubleshooting

### **Issue: CORS Error in Browser**

**Solution**: Update `ADMIN_CORS_ORIGIN` in `wrangler.admin.toml` to match your Pages URL, then redeploy.

### **Issue: Login Returns 401**

**Possible causes**:
1. JWT_SECRET not set → Run `wrangler secret put JWT_SECRET --config wrangler.admin.toml`
2. Database not initialized → Run `npm run db:init`
3. Wrong API URL → Check `NEXT_PUBLIC_API_URL` in Pages environment variables

### **Issue: Build Fails**

**Solution**: Ensure all dependencies are installed:
```bash
cd admin-frontend
rm -rf node_modules
npm install
npm run build
```

---

## 🔄 Update Process

### **Update Admin API**

```bash
# Make changes to src/admin-api-worker.ts
npm run deploy:admin-api
```

### **Update Frontend**

```bash
cd admin-frontend
# Make changes
npm run build
npx wrangler pages deploy .next --project-name=ssai-admin
```

### **Update Database Schema**

```bash
# Edit schema.sql
wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml --remote
```

⚠️ **Warning**: This will reset the database. For production, use migrations.

---

## 💰 Cost Estimate

### **Free Tier Limits**

- **Workers**: 100,000 requests/day
- **Pages**: Unlimited requests
- **D1**: 5GB storage, 5M reads/day, 100K writes/day

### **Estimated Monthly Cost**

For small to medium deployments:
- Workers: **$0** (within free tier)
- Pages: **$0** (always free)
- D1: **$0** (within free tier)

**Total: $0/month** for most use cases! 🎉

For large deployments, costs scale affordably:
- Workers: $0.50 per million requests
- D1: $0.75 per million reads

---

## 🎯 Custom Domain (Optional)

### **Add Custom Domain to Pages**

1. Go to Pages project settings
2. Click **Custom domains**
3. Add your domain (e.g., `admin.yourdomain.com`)
4. Update DNS records as instructed
5. Update CORS in `wrangler.admin.toml`

### **Add Custom Domain to Workers**

1. Go to Workers project settings
2. Add custom domain (e.g., `api.yourdomain.com`)
3. Update `NEXT_PUBLIC_API_URL` in Pages environment variables

---

## 📚 Next Steps

1. ✅ Deploy admin platform
2. ✅ Test with production data
3. ✅ Change default passwords
4. ✅ Configure custom domains
5. ✅ Set up monitoring/alerts
6. ✅ Create additional admin users

---

## 🆘 Support

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)

---

**Ready to deploy!** 🚀

Run: `npm run deploy:admin-api && cd admin-frontend && npm run build && npx wrangler pages deploy .next --project-name=ssai-admin`

