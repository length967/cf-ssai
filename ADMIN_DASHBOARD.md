# Admin Dashboard Guide

The CF-SSAI Admin Dashboard is a Next.js application deployed to Cloudflare Pages.

## 🌐 Access

**Production URL**: https://ssai-admin.pages.dev

Alternative URLs:
- Deployment: https://61d8e2d6.ssai-admin.pages.dev
- Branch Alias: https://main.ssai-admin.pages.dev

## 📱 Features

The admin dashboard provides a complete management interface for your SSAI system:

### Channel Management
- Create and configure channels
- Set origin URLs for HLS streams
- Configure SCTE-35 detection settings
- Enable/disable SGAI vs SSAI modes
- Manage channel-specific settings

### Organization Management
- Multi-tenant organization support
- Org-level configuration and defaults
- User and permission management (when JWT auth enabled)

### Ad Pod Management
- Create ad pods with multiple creatives
- Configure bitrate ladder matching
- Set duration and scheduling
- VAST integration configuration

### Ad Creative Management
- Upload ad creatives to R2
- Configure per-rendition URLs
- Set tracking pixels and beacons
- Preview and validate creatives

### Slate Configuration
- Upload default slate content
- Configure per-channel slates
- Preview slate segments
- Set slate loop behavior

### Analytics Dashboard
- View real-time metrics
- Monitor ad insertion events
- Track SCTE-35 cue detection
- Analyze beacon events

## 🔐 Authentication

### Current Status (Development Mode)
- **DEV_ALLOW_NO_AUTH = "1"** in the API worker
- Authentication is currently **disabled**
- Anyone can access the dashboard without login

### Enabling Production Authentication

1. **Generate JWT Keys**:
   ```bash
   # Generate private key
   openssl genrsa -out private.pem 2048

   # Extract public key
   openssl rsa -in private.pem -pubout -out public.pem
   ```

2. **Set the JWT Public Key**:
   ```bash
   # Copy public key content
   cat public.pem

   # Set as Cloudflare secret
   wrangler secret put JWT_PUBLIC_KEY --config wrangler.admin.toml
   # Paste the public key when prompted (include BEGIN/END lines)
   ```

3. **Enable Authentication**:
   ```bash
   # Edit wrangler.toml
   # Change: DEV_ALLOW_NO_AUTH = "0"

   # Redeploy
   npm run deploy:manifest
   npm run deploy:admin-api
   ```

4. **Issue JWT Tokens**:

   Use your private key to sign JWT tokens for users:

   ```javascript
   // Example using jsonwebtoken library
   const jwt = require('jsonwebtoken');
   const fs = require('fs');

   const privateKey = fs.readFileSync('private.pem');

   const token = jwt.sign({
     sub: 'user@example.com',
     org: 'my-org',
     role: 'admin',
     exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30) // 30 days
   }, privateKey, { algorithm: 'RS256' });

   console.log(token);
   ```

5. **Login to Dashboard**:
   - Navigate to: https://ssai-admin.pages.dev/login
   - Enter the JWT token
   - Click "Login"

## 🛠️ Configuration

### API Connection

The dashboard is pre-configured to connect to your deployed Admin API:

**API URL**: https://cf-ssai-admin-api.mediamasters.workers.dev

This is set in `admin-frontend/.env.production`:
```bash
NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.mediamasters.workers.dev
```

### Updating the API URL

If you redeploy the admin API to a different URL:

1. Edit `admin-frontend/.env.production`
2. Update `NEXT_PUBLIC_API_URL`
3. Rebuild and redeploy:
   ```bash
   cd admin-frontend
   ./deploy-prod.sh https://new-api-url.workers.dev
   ```

## 📦 Local Development

To run the dashboard locally:

```bash
cd admin-frontend

# Install dependencies
npm install

# Create .env.local with your API URL
echo "NEXT_PUBLIC_API_URL=http://localhost:8791" > .env.local

# Start dev server
npm run dev

# Open http://localhost:3000
```

## 🚀 Deployment

### Manual Deployment

```bash
cd admin-frontend

# Deploy with production API URL
./deploy-prod.sh https://cf-ssai-admin-api.mediamasters.workers.dev
```

### Automatic Deployment (Cloudflare Pages)

You can configure automatic deployments from your Git repository:

1. Go to Cloudflare Dashboard → Pages
2. Select `ssai-admin` project
3. Settings → Builds & deployments
4. Connect your Git repository
5. Set build command: `npm run build`
6. Set build output directory: `out`
7. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = `https://cf-ssai-admin-api.mediamasters.workers.dev`

Now every push to `main` branch will automatically deploy the dashboard.

## 🎨 Customization

### Branding

The dashboard uses Tailwind CSS and Radix UI components. To customize:

1. Edit `admin-frontend/tailwind.config.ts` for colors and theme
2. Update components in `admin-frontend/src/components/`
3. Modify layouts in `admin-frontend/src/app/`

### Navigation

Edit `admin-frontend/src/components/sidebar.tsx` to:
- Add/remove navigation items
- Change icons (using lucide-react)
- Modify organization structure

## 🔧 Troubleshooting

### Dashboard Shows "Failed to Connect"

**Cause**: API worker is not responding or CORS is blocking requests

**Fix**:
```bash
# Check API health
curl https://cf-ssai-admin-api.mediamasters.workers.dev/health

# Verify CORS is enabled in wrangler.admin.toml
# Should have: ADMIN_CORS_ORIGIN = "*"
```

### 401 Unauthorized Errors

**Cause**: JWT authentication is enabled but token is invalid/expired

**Fix**:
- Generate a new JWT token using your private key
- Ensure JWT public key is set correctly: `wrangler secret list --config wrangler.admin.toml`
- Check token expiration (`exp` claim)

### Pages Showing 404

**Cause**: Next.js build failed or pages not exported

**Fix**:
```bash
cd admin-frontend

# Clean build
rm -rf .next out

# Rebuild
npm run build

# Check for errors in build output
```

### API Calls Timing Out

**Cause**: Admin API worker CPU time exceeded or database slow

**Fix**:
- Check worker logs: `wrangler tail --config wrangler.admin.toml`
- Optimize database queries
- Check D1 database is initialized: `npm run db:init`

## 📊 Analytics & Monitoring

### Cloudflare Pages Analytics

View dashboard performance metrics:
1. Cloudflare Dashboard → Pages
2. Select `ssai-admin` project
3. Click "Analytics" tab

Metrics include:
- Requests per second
- Geographic distribution
- Performance insights

### API Worker Logs

Monitor API calls from the dashboard:
```bash
wrangler tail --config wrangler.admin.toml
```

Filter for specific operations:
```bash
wrangler tail --config wrangler.admin.toml | grep "POST /channels"
```

## 🎯 Next Steps

1. ✅ **Dashboard Deployed**: https://ssai-admin.pages.dev
2. **Initialize Database**: `npm run db:init`
3. **Create First Organization**: Use dashboard or API
4. **Add Test Channel**: Configure via dashboard
5. **Upload Slate**: Set default slate for fallback
6. **Enable Authentication**: Follow steps above for production
7. **Configure Custom Domain**: (Optional) Add custom domain in Pages settings

## 📚 Additional Resources

- **Next.js Documentation**: https://nextjs.org/docs
- **Cloudflare Pages**: https://developers.cloudflare.com/pages/
- **Radix UI Components**: https://www.radix-ui.com/
- **Tailwind CSS**: https://tailwindcss.com/

---

**Your admin dashboard is now live and ready to manage your SSAI system!** 🎉
