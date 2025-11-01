# 🔍 Debug Instructions - Ad Upload Issue

## 🚨 **Current Problem**

The ads page is stuck on "Loading ads..." because:
1. **You're not logged in** (no JWT token in browser)
2. API returns 401 Unauthorized
3. The error is caught but redirect doesn't work properly

---

## ✅ **Quick Fix - Login First!**

### **Step 1: Open Login Page**
```
https://f1c3a209.ssai-admin.pages.dev/login
```

### **Step 2: Login with Demo Credentials**
- **Email:** `admin@demo.com`
- **Password:** `demo123`

### **Step 3: Check You're Logged In**
Open browser console (F12) and run:
```javascript
localStorage.getItem('token')
```

You should see a JWT token string. If `null`, you're not logged in!

---

## 📊 **View All Logs in One Place**

### **Option 1: Unified Log Viewer (Recommended)**

Run this command to see all worker logs in one terminal:

```bash
cd /Users/markjohns/Development/cf-ssai

# View all logs with prefixes
npx wrangler tail cf-ssai-admin-api --format=pretty | sed 's/^/[ADMIN-API] /' &
npx wrangler tail cf-ssai --format=pretty | sed 's/^/[MANIFEST] /' &
npx wrangler tail cf-ssai-transcode --format=pretty | sed 's/^/[TRANSCODE] /' &

# To stop: killall wrangler
```

### **Option 2: Use Cloudflare Dashboard**

1. Go to **Cloudflare Dashboard** → **Workers & Pages**
2. Click on **cf-ssai-admin-api**
3. Click **"Logs"** tab
4. You'll see real-time logs for all requests

Open multiple browser tabs for each worker:
- https://dash.cloudflare.com → Workers → cf-ssai-admin-api → Logs
- https://dash.cloudflare.com → Workers → cf-ssai → Logs
- https://dash.cloudflare.com → Workers → cf-ssai-transcode → Logs

### **Option 3: Use Logpush (if configured)**

Check if you have logpush configured:
```bash
npx wrangler queues list
```

---

## 🔍 **What to Look For in Logs**

### **When You Login:**
```
[ADMIN-API] POST /api/auth/login - 200 OK
[ADMIN-API] User admin@demo.com logged in
```

### **When You Load Ads:**
```
[ADMIN-API] GET /api/ads - 200 OK
[ADMIN-API] Returned 0 ads for org org_demo
```

### **When You Upload:**
```
[ADMIN-API] POST /api/ads/upload - 200 OK
[ADMIN-API] Uploaded to R2: source-videos/ad_XXX/original.mp4
[ADMIN-API] Queued transcode job for ad_XXX
[TRANSCODE] Processing transcode job for ad ad_XXX
[TRANSCODE] FFmpeg container invoked for ad_XXX
```

---

## 🛠️ **Manual API Test**

Test the API is working:

```bash
# 1. Login and get token
TOKEN=$(curl -s -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}' | jq -r '.token')

echo "Token: $TOKEN"

# 2. List ads with token
curl -H "Authorization: Bearer $TOKEN" \
  https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads | jq

# 3. Upload a test file
curl -X POST https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/your/video.mp4" \
  -F "name=Test Ad" | jq
```

---

## 🔧 **Check Browser State**

Open browser console (F12) on the ads page and run:

```javascript
// Check if logged in
console.log('Token:', localStorage.getItem('token'))

// Check API URL
console.log('API URL:', process.env.NEXT_PUBLIC_API_URL)

// Test API call manually
fetch('https://cf-ssai-admin-api.mediamasters.workers.dev/api/ads', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

---

## 🚨 **Common Issues**

### **Issue 1: Not Logged In**
**Symptom:** Stuck on "Loading ads...", 401 errors  
**Fix:** Go to `/login` and login with `admin@demo.com` / `demo123`

### **Issue 2: Token Expired**
**Symptom:** Was working, now getting 401  
**Fix:** Logout and login again

### **Issue 3: Wrong API URL**
**Symptom:** Network errors, CORS errors  
**Fix:** Check `.env.production` has correct URL

### **Issue 4: CORS Errors**
**Symptom:** "Access-Control-Allow-Origin" errors in console  
**Fix:** Already fixed - CORS set to "*"

---

## 📋 **Checklist**

Before uploading an ad, verify:

- [ ] You can access: https://f1c3a209.ssai-admin.pages.dev
- [ ] You navigated to: https://f1c3a209.ssai-admin.pages.dev/login
- [ ] You logged in with: `admin@demo.com` / `demo123`
- [ ] Browser console shows token: `localStorage.getItem('token')` returns string
- [ ] Ads page loads (no "Loading ads..." forever)
- [ ] You can click "Upload Ad" button
- [ ] Logs are running: `npx wrangler tail cf-ssai-admin-api --format=pretty`

---

## 🎯 **Expected Flow**

1. **Login** → JWT token saved to localStorage
2. **Navigate to Ads** → API called with Authorization header
3. **Click Upload** → File sent to `/api/ads/upload`
4. **Backend** → Uploads to R2, queues transcode job
5. **Transcode Worker** → Picks up job from queue
6. **FFmpeg Container** → Transcodes video
7. **Status Updates** → `queued` → `processing` → `ready`
8. **Auto-refresh** → GUI updates every 10 seconds

---

## 📞 **Still Stuck?**

Run this diagnostic:

```bash
cd /Users/markjohns/Development/cf-ssai

# Check all services are healthy
echo "=== WORKERS STATUS ==="
curl -s -o /dev/null -w "Admin API: %{http_code}\n" https://cf-ssai-admin-api.mediamasters.workers.dev/health
curl -s -o /dev/null -w "Manifest: %{http_code}\n" https://cf-ssai.mediamasters.workers.dev/

# Check containers
echo -e "\n=== CONTAINERS ==="
npx wrangler containers list | grep cf-ssai-transcode-ffmpegcontainer

# Check queue
echo -e "\n=== QUEUE ==="
npx wrangler queues list | grep transcode-queue

# Check database
echo -e "\n=== DATABASE ==="
npx wrangler d1 execute ssai-admin --remote --command="SELECT COUNT(*) as user_count FROM users;"
npx wrangler d1 execute ssai-admin --remote --command="SELECT COUNT(*) as ad_count FROM ads;"
```

All should return healthy status!

---

**The most likely issue: You need to login at `/login` first!** 🔑

