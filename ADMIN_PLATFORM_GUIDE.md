# 🎨 **Admin Platform Setup Guide**

## 📋 **Overview**

This guide will help you set up the comprehensive admin platform for the Cloudflare SSAI system with:
- **Multi-tenancy** support (organizations/customers)
- **Channel management** (CRUD operations)
- **Beacon analytics dashboard** (real-time metrics)
- **VAST/SCTE-35 configuration**
- **Modern UI** with ShadCN components

---

## 🏗️ **Architecture**

```
┌────────────────────────────────────────────────────────┐
│  Next.js Frontend (Cloudflare Pages)                   │
│  - Channel Management                                  │
│  - Analytics Dashboard                                 │
│  - Organization Settings                               │
│  - User Management                                     │
└───────────────────┬────────────────────────────────────┘
                    │ REST API
                    ▼
┌────────────────────────────────────────────────────────┐
│  Admin API Worker                                      │
│  - JWT Authentication                                  │
│  - Multi-tenant Data Isolation                         │
│  - CRUD Operations                                     │
└───────────────────┬────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│  Cloudflare D1 (SQLite)                                │
│  - organizations, users, channels                      │
│  - ad_pods, beacon_events, analytics                   │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 **Quick Start**

### **1. Create D1 Database**

```bash
cd /Users/markjohns/Development/cf-ssai

# Create D1 database
wrangler d1 create ssai-admin

# Note the database_id from output, update wrangler.admin.toml

# Initialize schema (remote)
wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml --remote

# Or for local development database:
wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml
```

### **2. Deploy Admin API**

```bash
# Set JWT secret
wrangler secret put JWT_SECRET --config wrangler.admin.toml
# Enter a strong random string (e.g., openssl rand -hex 32)

# Deploy
wrangler deploy --config wrangler.admin.toml
```

### **3. Setup Frontend**

```bash
cd admin-frontend

# Install dependencies
npm install

# Create .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8791" > .env.local

# For production, use your deployed API URL:
# echo "NEXT_PUBLIC_API_URL=https://cf-ssai-admin-api.your-account.workers.dev" > .env.local

# Start development server
npm run dev
```

### **4. Access the Platform**

```
URL: http://localhost:3000
Email: admin@demo.com
Password: demo123
```

---

## 📁 **Frontend File Structure**

```
admin-frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with auth
│   │   ├── page.tsx            # Dashboard home
│   │   ├── login/
│   │   │   └── page.tsx        # Login page
│   │   ├── channels/
│   │   │   ├── page.tsx        # Channel list
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx    # Channel detail/edit
│   │   │   └── new/
│   │   │       └── page.tsx    # Create channel
│   │   ├── analytics/
│   │   │   └── page.tsx        # Analytics dashboard
│   │   ├── ad-pods/
│   │   │   ├── page.tsx        # Ad pod list
│   │   │   └── new/
│   │   │       └── page.tsx    # Create ad pod
│   │   └── settings/
│   │       └── page.tsx        # Organization settings
│   ├── components/
│   │   ├── ui/                 # ShadCN components
│   │   ├── ChannelForm.tsx
│   │   ├── AnalyticsChart.tsx
│   │   ├── BeaconTable.tsx
│   │   └── Navbar.tsx
│   └── lib/
│       ├── api.ts              # API client
│       ├── auth.ts             # Auth utilities
│       └── utils.ts            # Helpers
├── public/
└── package.json
```

---

## 🎨 **ShadCN Components to Install**

```bash
cd admin-frontend

# Install ShadCN CLI
npx shadcn-ui@latest init

# Select options:
# - TypeScript: Yes
# - Style: Default
# - Base color: Slate
# - CSS variables: Yes

# Install components
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add form
npx shadcn-ui@latest add input
npx shadcn-ui@latest add label
npx shadcn-ui@latest add select
npx shadcn-ui@latest add switch
npx shadcn-ui@latest add table
npx shadcn-ui@latest add tabs
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add dropdown-menu
npx shadcn-ui@latest add toast
npx shadcn-ui@latest add separator
npx shadcn-ui@latest add badge
npx shadcn-ui@latest add alert
```

---

## 💻 **Key Implementation Files**

### **1. API Client** (`src/lib/api.ts`)

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8791'

class APIClient {
  private token: string | null = null

  setToken(token: string) {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token)
    }
  }

  getToken(): string | null {
    if (typeof window !== 'undefined' && !this.token) {
      this.token = localStorage.getItem('token')
    }
    return this.token
  }

  clearToken() {
    this.token = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
    }
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    })

    if (response.status === 401) {
      this.clearToken()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
    }

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  // Auth
  async login(email: string, password: string) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    this.setToken(data.token)
    return data
  }

  // Channels
  async getChannels() {
    return this.request('/api/channels')
  }

  async getChannel(id: string) {
    return this.request(`/api/channels/${id}`)
  }

  async createChannel(data: any) {
    return this.request('/api/channels', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateChannel(id: string, data: any) {
    return this.request(`/api/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteChannel(id: string) {
    return this.request(`/api/channels/${id}`, {
      method: 'DELETE'
    })
  }

  // Analytics
  async getAnalytics(params: { channel_id?: string; start_time?: number; end_time?: number }) {
    const query = new URLSearchParams()
    if (params.channel_id) query.set('channel_id', params.channel_id)
    if (params.start_time) query.set('start_time', params.start_time.toString())
    if (params.end_time) query.set('end_time', params.end_time.toString())
    
    return this.request(`/api/analytics?${query}`)
  }

  async getBeaconEvents(params: { channel_id?: string; limit?: number }) {
    const query = new URLSearchParams()
    if (params.channel_id) query.set('channel_id', params.channel_id)
    if (params.limit) query.set('limit', params.limit.toString())
    
    return this.request(`/api/beacon-events?${query}`)
  }

  // Organization
  async getOrganization() {
    return this.request('/api/organization')
  }

  async updateOrganization(data: any) {
    return this.request('/api/organization', {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  // Ad Pods
  async getAdPods() {
    return this.request('/api/ad-pods')
  }

  async createAdPod(data: any) {
    return this.request('/api/ad-pods', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
}

export const api = new APIClient()
```

### **2. Login Page** (`src/app/login/page.tsx`)

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      await api.login(email, password)
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>SSAI Admin Platform</CardTitle>
          <CardDescription>Sign in to manage your channels and view analytics</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-sm text-red-600">{error}</div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

### **3. Channels List** (`src/app/channels/page.tsx`)

```typescript
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { Plus, Edit, Trash2 } from 'lucide-react'

export default function ChannelsPage() {
  const [channels, setChannels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadChannels()
  }, [])

  const loadChannels = async () => {
    try {
      const data = await api.getChannels()
      setChannels(data.channels)
    } catch (err) {
      console.error('Failed to load channels:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this channel?')) return

    try {
      await api.deleteChannel(id)
      await loadChannels()
    } catch (err) {
      alert('Failed to delete channel')
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Channels</h1>
          <p className="text-gray-600">Manage your live stream channels</p>
        </div>
        <Link href="/channels/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Channel
          </Button>
        </Link>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-600">No channels yet. Create your first channel to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <Card key={channel.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{channel.name}</CardTitle>
                    <CardDescription>{channel.slug}</CardDescription>
                  </div>
                  <Badge variant={channel.status === 'active' ? 'default' : 'secondary'}>
                    {channel.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Mode:</span>
                    <span className="font-medium">{channel.mode.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">SCTE-35:</span>
                    <Badge variant={channel.scte35_enabled ? 'default' : 'secondary'}>
                      {channel.scte35_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">VAST:</span>
                    <Badge variant={channel.vast_enabled ? 'default' : 'secondary'}>
                      {channel.vast_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Link href={`/channels/${channel.id}`} className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(channel.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

## 📊 **Analytics Dashboard Features**

### **Key Metrics Cards**
- Total Impressions (24h)
- Completion Rate (%)
- VAST Fill Rate (%)
- Active Channels

### **Charts**
- **Impressions Over Time** (Line chart with Recharts)
- **Completion Rate Trend** (Area chart)
- **VAST Success/Failure** (Bar chart)
- **SCTE-35 Detection Rate** (Pie chart)

### **Recent Beacon Events Table**
- Event type, Ad ID, Channel, Timestamp
- Filterable by channel
- Exportable to CSV

---

## 🔐 **Security Features**

### **Authentication**
- JWT-based authentication
- 7-day token expiration
- Secure password hashing (SHA-256)
- Automatic logout on token expiration

### **Authorization**
- Role-based access control (admin, editor, viewer)
- Multi-tenant data isolation
- API key management for programmatic access

### **Audit Logging**
- All changes logged to `system_events` table
- Tracks user, timestamp, entity, changes
- Filterable audit log in UI

---

## 🚀 **Deployment**

### **Deploy Admin API**

```bash
# From project root
wrangler deploy --config wrangler.admin.toml
```

### **Deploy Frontend to Cloudflare Pages**

```bash
cd admin-frontend

# Build
npm run build

# Deploy
npx wrangler pages deploy .next --project-name=ssai-admin
```

### **Configure Production**

1. Update `ADMIN_CORS_ORIGIN` in `wrangler.admin.toml`
2. Update `NEXT_PUBLIC_API_URL` in frontend `.env`
3. Create production D1 database
4. Set production `JWT_SECRET`

---

## 📈 **Features Summary**

### ✅ **Implemented**
- Multi-tenant database schema
- Admin API with JWT auth
- Channel CRUD operations
- Ad pod management
- Analytics aggregation
- Beacon event tracking
- Audit logging
- Next.js frontend setup
- ShadCN UI components

### 🔜 **To Implement** (In Frontend)
- Analytics dashboard with charts
- Real-time beacon monitoring
- User management UI
- API key management
- Bulk operations
- Export/import functionality
- Webhooks configuration

---

## 🎓 **Next Steps**

1. **Initialize Frontend**:
   ```bash
   cd admin-frontend
   npm install
   npx shadcn-ui@latest init
   # Install all components listed above
   ```

2. **Start Development**:
   ```bash
   # Terminal 1: Admin API
   wrangler dev --config wrangler.admin.toml --port 8791
   
   # Terminal 2: Frontend
   cd admin-frontend
   npm run dev
   ```

3. **Access Platform**:
   - URL: http://localhost:3000
   - Login: admin@demo.com / demo123

4. **Build Features**:
   - Start with login page
   - Add channel list/create/edit
   - Add analytics dashboard
   - Add beacon monitoring

---

## 📚 **Additional Resources**

- [Next.js Documentation](https://nextjs.org/docs)
- [ShadCN UI Components](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

---

**Status**: Admin platform infrastructure complete ✅

**Ready to**: Initialize frontend and start building UI components

**Deployment**: `wrangler deploy --config wrangler.admin.toml`

