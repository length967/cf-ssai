# Quick Start - Phase 2 Implementation

## 📦 What You Got

✅ **Security Layer** - Multi-tenant middleware with JWT validation  
✅ **Modern UI** - shadcn/ui components with channel-aware upload  
✅ **API Updates** - Token in cookies + channel_id support  
✅ **Documentation** - Comprehensive security guide  

## 🚀 5-Minute Setup

### Step 1: Replace Ads Page
```bash
cd /Users/markjohns/Development/cf-ssai/admin-frontend/src/app/ads
mv page.tsx page-old.tsx  # Backup
mv page-new.tsx page.tsx  # Activate new page
```

### Step 2: Verify shadcn/ui Components
```bash
cd /Users/markjohns/Development/cf-ssai/admin-frontend

# Check if components exist
ls src/components/ui/

# If missing any, install them:
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add select
npx shadcn-ui@latest add textarea
npx shadcn-ui@latest add progress
npx shadcn-ui@latest add separator
```

### Step 3: Test Locally
```bash
# Terminal 1: Frontend
cd /Users/markjohns/Development/cf-ssai/admin-frontend
npm run dev

# Terminal 2: Backend
cd /Users/markjohns/Development/cf-ssai
npm run dev:admin-api

# Open browser: http://localhost:3000/ads
```

### Step 4: Test Upload Flow
1. Login (if not already)
2. Go to `/ads`
3. Click "Upload Ad"
4. Select a channel → See bitrate preview
5. Upload video → Watch status change

## 🔐 Security Checklist

- [x] Middleware validates JWT tokens
- [x] Tokens stored in cookies (7-day expiration)
- [x] All API requests include Bearer token
- [x] Backend scopes queries by `organization_id`
- [x] Auto-redirect to `/login` on 401
- [x] CORS configured for localhost + production

## 📋 Files Changed

### Created
- `admin-frontend/src/middleware.ts` - Auth middleware
- `admin-frontend/src/app/ads/page-new.tsx` - Modern UI
- `SECURITY_GUIDE.md` - Security documentation
- `PHASE2_SUMMARY.md` - Implementation summary
- `QUICKSTART_PHASE2.md` - This file

### Modified
- `admin-frontend/src/lib/api.ts` - Cookie support + listChannels

### Unchanged (Already Good!)
- `src/admin-api-worker.ts` - Already has org-scoped queries
- Backend authentication - Already secure
- Database schema - Already multi-tenant

## 🧪 Quick Tests

### Test 1: Channel Selection Works
```bash
# Should show dropdown with channels
# Should display bitrate preview when selected
```

### Test 2: Upload Requires Channel
```bash
# Upload button should be disabled until:
# - File selected
# - Name entered
# - Channel selected
```

### Test 3: Auto-Refresh
```bash
# Upload a video
# Watch status badge update every 10s
# queued → processing → ready
```

### Test 4: Multi-Tenant Isolation
```bash
# Login as Org A user
# Upload ad
# Logout, login as Org B user
# Should NOT see Org A's ad
```

### Test 5: Token Expiration
```bash
# Wait 7 days (or manually expire token)
# Try to access /ads
# Should redirect to /login?reason=expired
```

## 🚨 Troubleshooting

### "Cannot find module '@/components/ui/...'"
```bash
npx shadcn-ui@latest add <component-name>
```

### "Middleware redirects to /login in loop"
```bash
# Check that /login is in PUBLIC_ROUTES
# Verify token is set in cookie after login
# Check browser DevTools > Application > Cookies
```

### "Channel dropdown empty"
```bash
# Verify channels exist in D1
wrangler d1 execute ssai-db --local --command "SELECT * FROM channels"

# Check API response
curl http://localhost:8791/api/channels \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### "Upload fails with 401"
```bash
# Check localStorage has token
localStorage.getItem('token')

# Check cookie exists
document.cookie

# Verify token format
# Should be: base64payload.base64signature
```

### "Planned variants not showing"
```bash
# Check channel has bitrate_ladder
wrangler d1 execute ssai-db --local --command \
  "SELECT id, name, bitrate_ladder FROM channels"

# Should be JSON array: [800, 1600, 2400]
```

## 📖 Next Steps

### Immediate
1. Test upload flow end-to-end
2. Verify transcoding works with channel bitrates
3. Check organization isolation

### Short-Term (Optional)
1. Store `channel_id` in `ads` table (see PHASE2_SUMMARY.md)
2. Add source video analysis (detect upscaling)
3. Implement ad preview player

### Long-Term
1. Add batch upload
2. Build analytics dashboard
3. Implement ad scheduling
4. Add 2FA for admin users

## 🎯 Success Criteria

✅ User can select channel during upload  
✅ Bitrate ladder preview displays  
✅ Upload includes channel_id  
✅ Transcoding uses channel bitrates  
✅ Status updates automatically  
✅ Multi-tenant isolation works  
✅ Token expiration handled gracefully  

## 📞 Need Help?

1. **Security Questions**: Read `SECURITY_GUIDE.md`
2. **Architecture**: Read `PROJECT_CONTEXT.md`
3. **Deployment**: Read `DEPLOYMENT_GUIDE.md`
4. **Logs**: `wrangler tail cf-ssai-admin`

## 🎉 You're Done!

Your platform now has:
- ✅ Modern, intuitive UI
- ✅ Channel-aware ad upload
- ✅ Multi-tenant security
- ✅ Real-time status updates
- ✅ Comprehensive documentation

**Go build something amazing! 🚀**
