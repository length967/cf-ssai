# ✅ Production Deployment Checklist

**Date**: November 1, 2025  
**Status**: Configuration Updated - Ready for Secret Setup & Deployment

---

## 🎯 Configuration Updates Applied

### ✅ **Fixed: wrangler.toml**
- Updated `ORIGIN_VARIANT_BASE` → `https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/origin`
- Updated `AD_POD_BASE` → `https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads`
- Updated `SIGN_HOST` → `pub-24423d0273094578a7f498bd462c2e20.r2.dev`
- Updated `R2_PUBLIC_URL` → `https://pub-24423d0273094578a7f498bd462c2e20.r2.dev`

### ✅ **Fixed: wrangler-transcode.toml**
- Updated `R2_PUBLIC_URL` → `https://pub-24423d0273094578a7f498bd462c2e20.r2.dev`

### ✅ **Fixed: .dev.vars**
- Updated all URLs to use real R2 public bucket URL

### ✅ **Created: admin-frontend/.env.production**
- Set `NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.mediamasters.workers.dev`

---

## 🔐 Production Secrets Setup

### **Secrets Already Set** ✅

#### Admin API Worker (`cf-ssai-admin-api`)
- ✅ R2_ACCOUNT_ID
- ✅ R2_ACCESS_KEY_ID
- ✅ R2_SECRET_ACCESS_KEY

#### Transcode Worker (`cf-ssai-transcode`)
- ✅ R2_ACCOUNT_ID
- ✅ R2_ACCESS_KEY_ID
- ✅ R2_SECRET_ACCESS_KEY

---

### **Secrets Still Needed** ⚠️

Run these commands to set production secrets:

```bash
# 1. Set JWT Secret for Admin API (for user authentication)
echo "YOUR_SECURE_JWT_SECRET" | npx wrangler secret put JWT_SECRET --name cf-ssai-admin-api

# 2. Set JWT Public Key for Manifest Worker (for viewer authentication)
echo "YOUR_JWT_PUBLIC_KEY" | npx wrangler secret put JWT_PUBLIC_KEY --name cf-ssai

# 3. Set Segment Secret for URL signing (prevents URL tampering)
echo "YOUR_SECURE_SEGMENT_SECRET" | npx wrangler secret put SEGMENT_SECRET --name cf-ssai

# 4. Set R2 credentials for Manifest Worker (for ad delivery)
echo "a872c8de0c1a9e713c7f4f92b3221f92" | npx wrangler secret put R2_ACCOUNT_ID --name cf-ssai
echo "071448000d71b85f07f222466df20072" | npx wrangler secret put R2_ACCESS_KEY_ID --name cf-ssai
echo "6eecf40bb593ec0cbe271dc9be4aa15e70fd4db40917d0506bf8a6904b04206c" | npx wrangler secret put R2_SECRET_ACCESS_KEY --name cf-ssai
```

**Generate secure secrets**:
```bash
# Generate a secure JWT secret (256-bit)
openssl rand -base64 32

# Generate a secure segment secret (256-bit)
openssl rand -base64 32
```

---

## 🚀 Deployment Commands

### **1. Deploy Backend Workers** (with updated config)

```bash
# Deploy manifest worker with new configuration
npx wrangler deploy

# Redeploy admin API (already deployed, but update with new config)
npx wrangler deploy --config wrangler.admin.toml

# Redeploy transcode worker (already deployed, but update with new config)
npx wrangler deploy --config wrangler-transcode.toml
```

### **2. Deploy Frontend** (with production API URL)

```bash
cd admin-frontend

# Build with production environment variables
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy out --project-name=ssai-admin
```

---

## 📋 Post-Deployment Verification

### **Test 1: Frontend API Connection**
```bash
# Visit your admin frontend
open https://ssai-admin.pages.dev

# Try logging in - should connect to production API
# Check browser console for API URL
```

### **Test 2: Upload Test Ad**
```bash
# Via GUI:
# 1. Go to Ads Library
# 2. Upload a test video
# 3. Verify transcode status updates
# 4. Check R2 for transcoded files
```

### **Test 3: Create Test Channel**
```bash
# Via GUI:
# 1. Go to Channels
# 2. Create a channel with your origin URL
# 3. Set ad_pod_base_url to: https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads
# 4. Test manifest request
```

### **Test 4: Verify R2 URLs**
```bash
# Check that ads are accessible via public URL
curl -I "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/transcoded-ads/[AD_ID]/master.m3u8"
```

---

## 🔍 Configuration Validation

### **Environment Variables - Manifest Worker**

| Variable | Current Value | Status |
|----------|--------------|--------|
| ORIGIN_VARIANT_BASE | `https://pub-24423d...r2.dev/origin` | ✅ Fixed |
| AD_POD_BASE | `https://pub-24423d...r2.dev/transcoded-ads` | ✅ Fixed |
| SIGN_HOST | `pub-24423d0273094578a7f498bd462c2e20.r2.dev` | ✅ Fixed |
| R2_PUBLIC_URL | `https://pub-24423d...r2.dev` | ✅ Fixed |
| JWT_PUBLIC_KEY | - | ⚠️ Needs secret |
| SEGMENT_SECRET | - | ⚠️ Needs secret |
| R2_ACCOUNT_ID | - | ⚠️ Needs secret |
| R2_ACCESS_KEY_ID | - | ⚠️ Needs secret |
| R2_SECRET_ACCESS_KEY | - | ⚠️ Needs secret |

### **Environment Variables - Admin API Worker**

| Variable | Current Value | Status |
|----------|--------------|--------|
| ADMIN_CORS_ORIGIN | `https://ssai-admin.pages.dev` | ✅ Set |
| R2_PUBLIC_URL | `https://pub-24423d...r2.dev` | ✅ Set |
| R2_ACCOUNT_ID | - | ✅ Secret set |
| R2_ACCESS_KEY_ID | - | ✅ Secret set |
| R2_SECRET_ACCESS_KEY | - | ✅ Secret set |
| JWT_SECRET | - | ⚠️ Needs secret |

### **Environment Variables - Transcode Worker**

| Variable | Current Value | Status |
|----------|--------------|--------|
| R2_PUBLIC_URL | `https://pub-24423d...r2.dev` | ✅ Fixed |
| R2_ACCOUNT_ID | - | ✅ Secret set |
| R2_ACCESS_KEY_ID | - | ✅ Secret set |
| R2_SECRET_ACCESS_KEY | - | ✅ Secret set |

### **Environment Variables - Frontend**

| Variable | Current Value | Status |
|----------|--------------|--------|
| NEXT_PUBLIC_API_URL | `https://cf-ssai-admin-api.mediamasters.workers.dev` | ✅ Fixed |

---

## 🎯 Summary

### **What's Fixed** ✅
1. All placeholder URLs replaced with real R2 URLs
2. Frontend configured with production API URL
3. Local development environment (.dev.vars) updated
4. All wrangler.toml files have correct R2 public URL

### **What's Needed** ⚠️
1. Set JWT secrets for authentication
2. Set segment signing secret
3. Set R2 credentials for manifest worker
4. Redeploy all workers with updated config
5. Rebuild and redeploy frontend

### **What's Already Working** ✅
1. Database schema ✅
2. R2 bucket and permissions ✅
3. Transcode queue ✅
4. FFmpeg containers (7/7 healthy) ✅
5. API endpoints (no mocks) ✅
6. Per-channel configuration system ✅

---

## 📊 Architecture Notes

### **Configuration Flow**
```
Frontend (.env.production)
    ↓ NEXT_PUBLIC_API_URL
Admin API Worker (wrangler.admin.toml)
    ↓ Stores in D1
Manifest Worker (wrangler.toml)
    ↓ Reads from D1 (with KV cache)
    ↓ Falls back to wrangler.toml vars if not set
Channel Durable Object
    ↓ Uses per-channel config via headers
Ad Insertion
```

### **URL Hierarchy** (Priority: High → Low)
1. **Per-channel configuration** (in D1 database) - Highest priority
2. **Request headers** (set by manifest worker)
3. **Global defaults** (in wrangler.toml) - Fallback only

This means once you create a channel via GUI with specific URLs, those URLs will be used, not the wrangler.toml defaults!

---

## 🎉 Ready for Production!

After setting the required secrets and deploying, your system will be fully production-ready with:

- ✅ Real R2 URLs (no placeholders)
- ✅ Production API endpoints
- ✅ Secure authentication
- ✅ Per-channel configuration
- ✅ FFmpeg transcoding
- ✅ HLS ad insertion

**Next Steps**:
1. Set the secrets (JWT, SEGMENT)
2. Run deployment commands
3. Test ad upload and transcoding
4. Create first production channel
5. 🎬 **Go live!**

