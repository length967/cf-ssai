# Security Guide - Multi-Tenant SSAI Platform

## Overview

This platform implements **defense-in-depth** multi-tenant security with organization-scoped data isolation at every layer.

## Architecture

```
User Request
    ↓
[Next.js Middleware] ← Token validation, expiry check
    ↓
[Frontend API Client] ← Bearer token in Authorization header
    ↓
[Admin API Worker] ← JWT verification, organization extraction
    ↓
[Database Queries] ← WHERE organization_id = ? (mandatory)
```

## Security Layers

### 1. **Frontend Middleware** (`admin-frontend/src/middleware.ts`)

**Purpose**: First line of defense - prevents unauthorized access to routes

**Features**:
- ✅ Token presence validation
- ✅ Token structure validation (base64 decode check)
- ✅ Expiration check (client-side)
- ✅ Automatic redirect to login on failure
- ✅ Injects user metadata into request headers (`x-organization-id`, `x-user-id`, `x-user-role`)

**Public Routes** (no auth required):
- `/login`
- `/signup`
- `/forgot-password`

**Protected Routes** (all others):
- Requires valid JWT token in `auth_token` cookie
- Redirects to `/login?redirect=/original-path` on failure

### 2. **Backend Authentication** (`src/admin-api-worker.ts`)

**Purpose**: Server-side JWT verification and organization extraction

**Token Structure**:
```typescript
{
  userId: string        // User UUID
  organizationId: string // Organization UUID
  email: string
  role: 'admin' | 'member'
  iat: number           // Issued at (Unix timestamp)
  exp: number           // Expires at (Unix timestamp, 7 days)
}
```

**Token Generation** (`generateToken()`):
- HMAC-SHA256 signature
- 7-day expiration
- Includes organization ID in payload

**Token Verification** (`verifyToken()`):
- Signature validation using WebCrypto
- Expiration check
- Returns `AuthContext` with user and organization ID

**Middleware** (`authenticate()`):
- Extracts `Authorization: Bearer <token>` header
- Calls `verifyToken()` to validate
- Returns 401 if missing/invalid
- Provides `AuthContext` to all handlers

### 3. **Database-Level Isolation**

**Critical Rule**: **EVERY query MUST include `organization_id` filter**

#### Examples

**✅ CORRECT** - Organization-scoped:
```typescript
// List channels for organization
await env.DB.prepare(`
  SELECT * FROM channels 
  WHERE organization_id = ?
`).bind(auth.organizationId).all()

// Get specific channel with organization check
await env.DB.prepare(`
  SELECT * FROM channels 
  WHERE id = ? AND organization_id = ?
`).bind(channelId, auth.organizationId).first()

// Create with organization_id
await env.DB.prepare(`
  INSERT INTO channels (id, organization_id, name, ...)
  VALUES (?, ?, ?, ...)
`).bind(id, auth.organizationId, name, ...).run()
```

**❌ INCORRECT** - Missing organization filter:
```typescript
// SECURITY VULNERABILITY - Cross-tenant data leak!
await env.DB.prepare(`
  SELECT * FROM channels WHERE id = ?
`).bind(channelId).first()
```

### 4. **API Route Protection**

All API handlers follow this pattern:

```typescript
async handleRequest(request: Request): Promise<Response> {
  const auth = await authenticate(request, env, requestOrigin)
  
  // Auth returns Response on failure (401)
  if (auth instanceof Response) {
    return auth
  }
  
  // auth is now AuthContext
  // auth.organizationId is guaranteed valid
  // auth.user contains user info
  
  return await this.someHandler(auth, ...)
}
```

### 5. **Role-Based Access Control (RBAC)**

**Roles**:
- `admin`: Full access to organization settings, users, API keys
- `member`: Access to channels, ads, analytics (no user management)

**Enforcement**:
```typescript
async deleteUser(auth: AuthContext, userId: string): Promise<Response> {
  // Admin-only action
  if (auth.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // Still organization-scoped even for admins
  await this.env.DB.prepare(`
    DELETE FROM users 
    WHERE id = ? AND organization_id = ?
  `).bind(userId, auth.organizationId).run()
  
  // ...
}
```

## Database Schema

### Organizations Table
```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active', -- active, suspended, deleted
  plan TEXT DEFAULT 'free',     -- free, pro, enterprise
  settings TEXT,                -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Users Table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,  -- Foreign key
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'member',     -- admin, member
  status TEXT DEFAULT 'active',   -- active, suspended
  last_login INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
```

### Channels Table
```sql
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,  -- Multi-tenant isolation
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  origin_url TEXT NOT NULL,
  -- ... channel config fields ...
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,                -- User ID
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
```

### Ads Table
```sql
CREATE TABLE ads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,  -- Multi-tenant isolation
  name TEXT NOT NULL,
  description TEXT,
  source_key TEXT NOT NULL,       -- R2 path
  transcode_status TEXT DEFAULT 'pending',
  variants TEXT,                  -- JSON array
  channel_id TEXT,                -- Optional: channel-specific ad
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,                -- User ID
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);
```

## R2 Storage Isolation

**Structure**:
```
ssai-ads/
├── org_<org_id>/
│   ├── source-videos/
│   │   └── ad_<id>/original.mp4
│   └── transcoded-ads/
│       └── ad_<id>/
│           ├── master.m3u8
│           ├── v_800k/
│           ├── v_1600k/
│           └── v_2400k/
```

**Access Control**:
- R2 bucket is **private** (no public listing)
- Presigned URLs for authenticated access
- Organization ID embedded in object keys
- Custom metadata includes `organizationId` for audit trail

**Upload Handler**:
```typescript
// Upload with organization metadata
await this.env.R2.put(sourceKey, file.stream(), {
  httpMetadata: {
    contentType: file.type,
  },
  customMetadata: {
    originalFilename: file.name,
    uploadedBy: auth.user.id,
    organizationId: auth.organizationId,  // Audit trail
  }
})
```

## CORS Configuration

**Production**:
```typescript
// wrangler.toml
[env.production.vars]
ADMIN_CORS_ORIGIN = "https://ssai-admin.pages.dev"
ALLOWED_ORIGINS = "https://custom-domain.com,https://other-domain.com"
```

**Development**:
```typescript
// Automatically allows localhost:3000, localhost:3001
const allowedOrigins = [
  env.ADMIN_CORS_ORIGIN || 'https://ssai-admin.pages.dev',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
]
```

## API Client (`admin-frontend/src/lib/api.ts`)

**Token Storage**:
- Stored in `localStorage` as `token`
- Sent in `Authorization: Bearer <token>` header
- Cleared on 401 response (auto-redirect to login)

**Usage**:
```typescript
// Login
await api.login(email, password)
// Token automatically stored and added to future requests

// Make authenticated request
const channels = await api.getChannels()
// Authorization header added automatically

// 401 handling
// User auto-redirected to /login
// Token cleared from localStorage
```

## Security Best Practices

### ✅ DO

1. **Always scope queries by organization**
   ```typescript
   WHERE organization_id = ? AND id = ?
   ```

2. **Validate ownership before updates/deletes**
   ```typescript
   const channel = await db.prepare(`
     SELECT * FROM channels 
     WHERE id = ? AND organization_id = ?
   `).bind(id, auth.organizationId).first()
   
   if (!channel) {
     return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
   }
   ```

3. **Use role checks for admin actions**
   ```typescript
   if (auth.user.role !== 'admin') {
     return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
   }
   ```

4. **Log security events**
   ```typescript
   await this.logEvent(
     auth.organizationId,
     auth.user.id,
     'user.deleted',
     'user',
     userId,
     null
   )
   ```

5. **Hash passwords with SHA-256** (or better: bcrypt/argon2)
   ```typescript
   const hash = await hashPassword(password)
   ```

6. **Use secure token expiration** (7 days max)
   ```typescript
   exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
   ```

### ❌ DON'T

1. **Never query without organization_id**
   ```typescript
   // WRONG
   SELECT * FROM channels WHERE id = ?
   ```

2. **Never trust client-provided organization ID**
   ```typescript
   // WRONG
   const orgId = request.body.organization_id
   
   // CORRECT
   const orgId = auth.organizationId // From JWT
   ```

3. **Never expose sensitive fields in API responses**
   ```typescript
   // WRONG
   return { user: { ...dbUser } } // Includes password_hash!
   
   // CORRECT
   return {
     user: {
       id: dbUser.id,
       email: dbUser.email,
       name: dbUser.name,
       role: dbUser.role
       // password_hash excluded
     }
   }
   ```

4. **Never use wildcard CORS in production**
   ```typescript
   // WRONG in production
   'Access-Control-Allow-Origin': '*'
   
   // CORRECT
   'Access-Control-Allow-Origin': env.ADMIN_CORS_ORIGIN
   ```

## Testing Security

### Test Cases

1. **Cross-tenant access attempt**
   ```bash
   # User A tries to access User B's channel
   curl -H "Authorization: Bearer <user_a_token>" \
        https://api.example.com/api/channels/<user_b_channel_id>
   
   # Expected: 404 Not Found (not 403, to avoid leaking existence)
   ```

2. **Expired token**
   ```bash
   # Use token with exp < current time
   curl -H "Authorization: Bearer <expired_token>" \
        https://api.example.com/api/channels
   
   # Expected: 401 Unauthorized
   ```

3. **Missing token**
   ```bash
   curl https://api.example.com/api/channels
   
   # Expected: 401 Unauthorized
   ```

4. **Role escalation attempt**
   ```bash
   # Member tries to delete user (admin-only)
   curl -X DELETE \
        -H "Authorization: Bearer <member_token>" \
        https://api.example.com/api/users/<user_id>
   
   # Expected: 403 Forbidden
   ```

## Incident Response

### Suspected Token Compromise

1. **Rotate JWT_SECRET**:
   ```bash
   wrangler secret put JWT_SECRET --env production
   # Enter new secret
   ```
   
2. **All users must re-login** (old tokens invalid)

3. **Audit system_events table**:
   ```sql
   SELECT * FROM system_events 
   WHERE user_id = '<compromised_user_id>' 
   ORDER BY timestamp DESC 
   LIMIT 100;
   ```

### Cross-Tenant Data Access

1. **Immediately suspend organization**:
   ```sql
   UPDATE organizations 
   SET status = 'suspended' 
   WHERE id = '<org_id>';
   ```

2. **Audit all queries for missing organization_id filters**:
   ```bash
   grep -r "SELECT.*FROM.*WHERE" src/ | grep -v "organization_id"
   ```

3. **Review system_events for suspicious activity**:
   ```sql
   SELECT * FROM system_events 
   WHERE organization_id = '<affected_org>' 
   AND timestamp > <incident_timestamp>
   ORDER BY timestamp DESC;
   ```

## Compliance

### GDPR

- ✅ User data scoped by organization
- ✅ Delete user cascade implemented
- ✅ Audit trail in `system_events`
- ✅ Password hashing (SHA-256, consider upgrading to bcrypt)

### SOC 2

- ✅ Multi-tenant data isolation (database + R2)
- ✅ Role-based access control
- ✅ Audit logging
- ✅ Token expiration enforcement
- ✅ CORS restrictions

## Future Enhancements

### High Priority

1. **Rate Limiting**
   - Per-organization API rate limits
   - Cloudflare Workers Rate Limiting API

2. **Password Policy**
   - Minimum length (12+ characters)
   - Complexity requirements
   - Upgrade to bcrypt/argon2

3. **2FA/MFA**
   - TOTP-based 2FA for admin users
   - WebAuthn for passwordless auth

4. **API Key Scoping**
   - Per-channel API keys
   - Read-only vs write permissions

### Medium Priority

1. **Audit Log UI**
   - Admin dashboard for system_events
   - Filterable, exportable

2. **Session Management**
   - Active session tracking
   - Remote logout capability

3. **IP Allowlisting**
   - Per-organization IP restrictions
   - VPN/corporate network enforcement

## Questions?

For security concerns or to report vulnerabilities, contact: security@example.com
