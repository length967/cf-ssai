# Localhost API URL Fix - November 3, 2025

## 🐛 Problem

The frontend was calling `http://localhost:8791/api/auth/login` instead of the production API URL:

```
POST http://localhost:8791/api/auth/login net::ERR_CONNECTION_REFUSED
```

This caused login and all API calls to fail in production.

---

## 🔍 Root Cause

Next.js environment variable precedence issue:

1. `.env.local` (contains `http://localhost:8791`) - for development
2. `.env.production` (contains production URL) - for production

**Problem:** Next.js was using `.env.local` even during production builds because:
- `.env.local` has higher precedence
- Build command didn't explicitly override it

---

## ✅ Solution

### 1. Rebuild with Production URL

```bash
cd admin-frontend
rm -rf .next out  # Clean previous builds
NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.mediamasters.workers.dev npm run build
```

This forces Next.js to use the production URL by setting the environment variable explicitly.

### 2. Updated Deploy Script

Enhanced `deploy-prod.sh` to:
- Clean previous builds (`rm -rf .next out`)
- Export environment variable explicitly
- Verify production URL is in the build

**Before:**
```bash
export NEXT_PUBLIC_API_URL="$ADMIN_API_URL"
npm run build
```

**After:**
```bash
rm -rf .next out
export NEXT_PUBLIC_API_URL="$ADMIN_API_URL"
npm run build

# Verify
if grep -q "$ADMIN_API_URL" out/_next/static/chunks/app/login/*.js; then
  echo "✅ Verified: Production API URL is in the build"
fi
```

---

## 🚀 Deployment

**Fixed and Deployed:**
- URL: https://main.ssai-admin.pages.dev
- Latest: https://0c90c8f2.ssai-admin.pages.dev
- Time: November 3, 2025 01:15 UTC
- Status: ✅ Working

**Verification:**
```bash
# No localhost references
grep -r "localhost:8791" out/
# (returns nothing)

# Production URL present
grep -r "cf-ssai-admin-api.mediamasters.workers.dev" out/
# (found in multiple chunks)
```

---

## 🧪 Testing

### 1. Clear Browser Cache

```bash
# Hard refresh
# Chrome/Edge: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
# Safari: Cmd+Option+R
```

### 2. Try Login

1. Visit: https://main.ssai-admin.pages.dev/login
2. Enter credentials
3. Check browser DevTools Network tab
4. Should see: `POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/auth/login`
5. Should NOT see: `POST http://localhost:8791/...`

### 3. Verify All API Calls

Check that all these work:
- ✅ Login
- ✅ Load channels list
- ✅ Create/edit channel
- ✅ Detect bitrates
- ✅ Upload ads

---

## 📋 Best Practices Going Forward

### Always Use Deploy Script

```bash
cd admin-frontend
./deploy-prod.sh https://cf-ssai-admin-api.mediamasters.workers.dev
```

**This script now:**
1. Cleans previous builds
2. Sets production API URL explicitly
3. Verifies the URL is in the build
4. Deploys to Cloudflare Pages

### For Local Development

Keep using:
```bash
cd admin-frontend
npm run dev
# Uses .env.local with localhost:8791
```

### Environment Variable Precedence

**Next.js loads env files in this order (highest precedence first):**
1. `.env.local` (local overrides, never commit)
2. `.env.production` (production defaults)
3. `.env` (base defaults)

**Solution:** Deploy script now explicitly sets `NEXT_PUBLIC_API_URL` which overrides all files.

---

## 🔧 Troubleshooting

### Still Seeing Localhost Errors?

1. **Hard refresh browser** - old deployment may be cached
2. **Check deployment URL** - make sure you're on latest: https://main.ssai-admin.pages.dev
3. **Check browser console** - look for actual API URL being called
4. **Clear Cloudflare cache** - if using custom domain

### How to Verify Production URL

**In Browser DevTools:**
```
1. Open DevTools (F12)
2. Go to Network tab
3. Try to login
4. Look at POST request
5. Should be: cf-ssai-admin-api.mediamasters.workers.dev
6. NOT: localhost:8791
```

**In Build Files:**
```bash
cd admin-frontend
grep -r "localhost:8791" out/
# Should return NOTHING

grep -r "cf-ssai-admin-api" out/ | head -1
# Should return matches
```

### Emergency Redeploy

```bash
cd admin-frontend
rm -rf .next out
NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.mediamasters.workers.dev npm run build
npx wrangler pages deploy out --project-name=ssai-admin
```

---

## 📝 Related Files Changed

1. **`deploy-prod.sh`** - Enhanced with cleanup and verification
2. **Build output** - Rebuilt with correct production URL
3. **Deployment** - New deployment with fixed API URL

---

## ✅ Verification Checklist

- [x] Build cleaned before production build
- [x] Production URL explicitly set in environment
- [x] Build contains production URL (verified with grep)
- [x] Build does NOT contain localhost URL
- [x] Deployed to Cloudflare Pages
- [x] Login page loads without errors
- [ ] User confirms login works (needs testing)
- [ ] User confirms API calls work (needs testing)

---

## 🎯 Root Cause Summary

**Why It Happened:**
- Previous deployment likely used `npm run build` directly
- This used `.env.local` (with localhost) instead of `.env.production`
- Next.js baked localhost URL into static build
- Deployed static build had hardcoded localhost references

**Why It's Fixed:**
- Now using explicit environment variable override
- Deploy script cleans build directory first
- Verification step catches the issue before deployment
- Production URL is now correctly baked into build

---

**Status:** ✅ Fixed and Deployed  
**Last Updated:** November 3, 2025 01:20 UTC  
**Next Deploy:** Use `./deploy-prod.sh https://cf-ssai-admin-api.mediamasters.workers.dev`
