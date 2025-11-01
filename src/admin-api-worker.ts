// Admin API Worker
// REST API for admin platform with multi-tenant support

import { invalidateChannelConfigCache } from './utils/channel-config'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ADMIN_CORS_ORIGIN?: string
  ALLOWED_ORIGINS?: string // Optional: Comma-separated list of additional allowed origins
  
  // R2 for ad storage
  R2: R2Bucket
  R2_PUBLIC_URL: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ACCOUNT_ID: string
  
  // Queue for transcode jobs
  TRANSCODE_QUEUE: Queue
  
  // KV for channel config caching
  CHANNEL_CONFIG_CACHE?: KVNamespace
}

// Types
type User = {
  id: string
  organization_id: string
  email: string
  name?: string
  role: string
}

type AuthContext = {
  user: User
  organizationId: string
}

// Utilities
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return passwordHash === hash
}

async function generateToken(user: User, secret: string): Promise<string> {
  const payload = {
    userId: user.id,
    organizationId: user.organization_id,
    email: user.email,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
  }
  
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(payload))
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign('HMAC', key, data)
  const base64Payload = btoa(String.fromCharCode(...new Uint8Array(data)))
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
  
  return `${base64Payload}.${base64Signature}`
}

async function verifyToken(token: string, secret: string): Promise<AuthContext | null> {
  try {
    const [payloadB64, signatureB64] = token.split('.')
    if (!payloadB64 || !signatureB64) return null
    
    const payload = JSON.parse(atob(payloadB64))
    
    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    
    // Verify signature
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(payload))
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    
    const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, signature, data)
    
    if (!valid) return null
    
    return {
      user: {
        id: payload.userId,
        organization_id: payload.organizationId,
        email: payload.email,
        role: payload.role
      },
      organizationId: payload.organizationId
    }
  } catch (err) {
    console.error('Token verification error:', err)
    return null
  }
}

// Middleware
async function authenticate(request: Request, env: Env, requestOrigin?: string | null): Promise<AuthContext | Response> {
  const cors = corsHeaders(env, requestOrigin)
  
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...cors }
    })
  }
  
  const token = authHeader.substring(7)
  const auth = await verifyToken(token, env.JWT_SECRET)
  
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...cors }
    })
  }
  
  return auth
}

function corsHeaders(env: Env, requestOrigin?: string | null): Record<string, string> {
  // Allow configured origins (production + development)
  let origin = '*'
  
  // Check if request has an origin header
  if (requestOrigin) {
    // Build allowed origins list from environment variables
    const allowedOrigins = [
      env.ADMIN_CORS_ORIGIN || 'https://ssai-admin.pages.dev',
      // Development localhost origins (always allowed for convenience)
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ]
    
    // Add any additional origins from ALLOWED_ORIGINS environment variable
    if (env.ALLOWED_ORIGINS) {
      const additionalOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      allowedOrigins.push(...additionalOrigins)
    }
    
    // If origin is in allowed list, use it (required for credentials)
    if (allowedOrigins.includes(requestOrigin)) {
      origin = requestOrigin
    }
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': origin !== '*' ? 'true' : 'false',
    'Access-Control-Max-Age': '86400'
  }
}

// API Handlers
class AdminAPI {
  constructor(private env: Env, private requestOrigin?: string | null) {}
  
  private corsHeaders(): Record<string, string> {
    return corsHeaders(this.env, this.requestOrigin)
  }
  
  // ===== AUTH =====
  
  async login(request: Request): Promise<Response> {
    try {
      const { email, password } = await request.json()
      
      console.log('Login attempt:', { email, passwordLength: password?.length })
      
      // Find user
      const user = await this.env.DB.prepare(`
        SELECT u.*, o.status as org_status
        FROM users u
        JOIN organizations o ON u.organization_id = o.id
        WHERE u.email = ?
      `).bind(email).first()
      
      if (!user) {
        console.log('User not found:', email)
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      console.log('User found:', { id: user.id, email: user.email, hasHash: !!user.password_hash })
      
      // Check org status
      if (user.org_status !== 'active') {
        console.log('Org not active:', user.org_status)
        return new Response(JSON.stringify({ error: 'Organization is not active' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Verify password
      const passwordHash = await hashPassword(password)
      console.log('Password verification:', {
        inputHash: passwordHash,
        storedHash: user.password_hash,
        match: passwordHash === user.password_hash
      })
      
      const valid = await verifyPassword(password, user.password_hash)
      if (!valid) {
        console.log('Password verification failed')
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      console.log('Login successful')
      
      // Generate token
      console.log('JWT_SECRET available:', !!this.env.JWT_SECRET)
      let token: string
      try {
        token = await generateToken({
          id: user.id,
          organization_id: user.organization_id,
          email: user.email,
          name: user.name,
          role: user.role
        }, this.env.JWT_SECRET)
        console.log('Token generated successfully')
      } catch (tokenErr) {
        console.error('Token generation error:', tokenErr)
        throw tokenErr
      }
      
      // Update last login
      await this.env.DB.prepare(`
        UPDATE users SET last_login = ? WHERE id = ?
      `).bind(Date.now(), user.id).run()
      
      return new Response(JSON.stringify({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organization_id
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    } catch (err) {
      console.error('Login error:', err)
      return new Response(JSON.stringify({ error: 'Login failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
  }
  
  // ===== CHANNELS =====
  
  async listChannels(auth: AuthContext): Promise<Response> {
    const channels = await this.env.DB.prepare(`
      SELECT * FROM channels
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ channels: channels.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async getChannel(auth: AuthContext, channelId: string): Promise<Response> {
    const channel = await this.env.DB.prepare(`
      SELECT * FROM channels
      WHERE id = ? AND organization_id = ?
    `).bind(channelId, auth.organizationId).first()
    
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    return new Response(JSON.stringify({ channel }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async createChannel(auth: AuthContext, data: any): Promise<Response> {
    const id = generateId('ch')
    const now = Date.now()
    
    await this.env.DB.prepare(`
      INSERT INTO channels (
        id, organization_id, name, slug, origin_url, status, mode,
        scte35_enabled, scte35_auto_insert, vast_enabled, vast_url, default_ad_duration,
        ad_pod_base_url, sign_host, slate_pod_id, time_based_auto_insert,
        segment_cache_max_age, manifest_cache_max_age, settings,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.organizationId,
      data.name,
      data.slug,
      data.origin_url,
      data.status || 'active',
      data.mode || 'auto',
      data.scte35_enabled ?? 1,
      data.scte35_auto_insert ?? 0,
      data.vast_enabled ?? 1,
      data.vast_url || null,
      data.default_ad_duration || 30,
      data.ad_pod_base_url || null,
      data.sign_host || null,
      data.slate_pod_id || 'slate',
      data.time_based_auto_insert ?? 0,
      data.segment_cache_max_age || 60,
      data.manifest_cache_max_age || 4,
      JSON.stringify(data.settings || {}),
      now,
      now,
      auth.user.id
    ).run()
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.created', 'channel', id, null)
    
    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async updateChannel(auth: AuthContext, channelId: string, data: any): Promise<Response> {
    // Check ownership and get slugs for cache invalidation
    const result = await this.env.DB.prepare(`
      SELECT c.*, o.slug as org_slug
      FROM channels c
      JOIN organizations o ON c.organization_id = o.id
      WHERE c.id = ? AND c.organization_id = ?
    `).bind(channelId, auth.organizationId).first<any>()
    
    if (!result) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    const channelSlug = result.slug
    const orgSlug = result.org_slug
    
    // Build update query
    const updates: string[] = []
    const values: any[] = []
    
    const fields = ['name', 'origin_url', 'status', 'mode', 'scte35_enabled', 'scte35_auto_insert',
                    'vast_enabled', 'vast_url', 'default_ad_duration', 'ad_pod_base_url', 'sign_host', 
                    'slate_pod_id', 'time_based_auto_insert', 'segment_cache_max_age', 'manifest_cache_max_age']
    
    for (const field of fields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(data[field])
      }
    }
    
    if (data.settings) {
      updates.push('settings = ?')
      values.push(JSON.stringify(data.settings))
    }
    
    updates.push('updated_at = ?')
    values.push(Date.now())
    
    values.push(channelId, auth.organizationId)
    
    await this.env.DB.prepare(`
      UPDATE channels SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `).bind(...values).run()
    
    // Invalidate channel config cache so changes take effect immediately
    await invalidateChannelConfigCache(this.env, orgSlug, channelSlug)
    console.log(`Cache invalidated for channel: ${orgSlug}/${channelSlug}`)
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.updated', 'channel', channelId, data)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async deleteChannel(auth: AuthContext, channelId: string): Promise<Response> {
    const result = await this.env.DB.prepare(`
      DELETE FROM channels WHERE id = ? AND organization_id = ?
    `).bind(channelId, auth.organizationId).run()
    
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.deleted', 'channel', channelId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // ===== AD PODS =====
  
  async listAdPods(auth: AuthContext): Promise<Response> {
    const pods = await this.env.DB.prepare(`
      SELECT * FROM ad_pods
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ ad_pods: pods.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async createAdPod(auth: AuthContext, data: any): Promise<Response> {
    const id = generateId('pod')
    const now = Date.now()
    
    await this.env.DB.prepare(`
      INSERT INTO ad_pods (
        id, organization_id, name, pod_id, duration_sec, status,
        assets, tracking_impressions, tracking_quartiles, tracking_clicks, tracking_errors,
        vast_ad_id, vast_creative_id, vast_source_url, tags,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.organizationId,
      data.name,
      data.pod_id,
      data.duration_sec || 30,
      data.status || 'active',
      JSON.stringify(data.assets || []),
      JSON.stringify(data.tracking_impressions || []),
      JSON.stringify(data.tracking_quartiles || {}),
      JSON.stringify(data.tracking_clicks || []),
      JSON.stringify(data.tracking_errors || []),
      data.vast_ad_id || null,
      data.vast_creative_id || null,
      data.vast_source_url || null,
      JSON.stringify(data.tags || []),
      now,
      now,
      auth.user.id
    ).run()
    
    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async updateAdPod(auth: AuthContext, podId: string, data: any): Promise<Response> {
    // Check ownership
    const pod = await this.env.DB.prepare(`
      SELECT * FROM ad_pods WHERE id = ? AND organization_id = ?
    `).bind(podId, auth.organizationId).first()
    
    if (!pod) {
      return new Response(JSON.stringify({ error: 'Ad pod not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    const updates: string[] = []
    const values: any[] = []
    
    if (data.name) {
      updates.push('name = ?')
      values.push(data.name)
    }
    
    if (data.duration_sec) {
      updates.push('duration_sec = ?')
      values.push(data.duration_sec)
    }
    
    if (data.status) {
      updates.push('status = ?')
      values.push(data.status)
    }
    
    if (data.assets) {
      updates.push('assets = ?')
      values.push(JSON.stringify(data.assets))
    }
    
    if (data.tracking_impressions) {
      updates.push('tracking_impressions = ?')
      values.push(JSON.stringify(data.tracking_impressions))
    }
    
    if (data.tracking_quartiles) {
      updates.push('tracking_quartiles = ?')
      values.push(JSON.stringify(data.tracking_quartiles))
    }
    
    if (data.tracking_clicks) {
      updates.push('tracking_clicks = ?')
      values.push(JSON.stringify(data.tracking_clicks))
    }
    
    if (data.tracking_errors) {
      updates.push('tracking_errors = ?')
      values.push(JSON.stringify(data.tracking_errors))
    }
    
    if (data.vast_ad_id !== undefined) {
      updates.push('vast_ad_id = ?')
      values.push(data.vast_ad_id)
    }
    
    if (data.vast_creative_id !== undefined) {
      updates.push('vast_creative_id = ?')
      values.push(data.vast_creative_id)
    }
    
    if (data.tags) {
      updates.push('tags = ?')
      values.push(JSON.stringify(data.tags))
    }
    
    updates.push('updated_at = ?')
    values.push(Date.now())
    
    values.push(podId, auth.organizationId)
    
    await this.env.DB.prepare(`
      UPDATE ad_pods SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `).bind(...values).run()
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad_pod.updated', 'ad_pod', podId, data)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async deleteAdPod(auth: AuthContext, podId: string): Promise<Response> {
    const result = await this.env.DB.prepare(`
      DELETE FROM ad_pods WHERE id = ? AND organization_id = ?
    `).bind(podId, auth.organizationId).run()
    
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Ad pod not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad_pod.deleted', 'ad_pod', podId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // ===== ANALYTICS =====
  
  async getAnalytics(auth: AuthContext, params: URLSearchParams): Promise<Response> {
    const channelId = params.get('channel_id')
    const startTime = parseInt(params.get('start_time') || '0')
    const endTime = parseInt(params.get('end_time') || String(Date.now()))
    
    let query = `
      SELECT * FROM analytics_hourly
      WHERE organization_id = ?
      AND hour >= ? AND hour <= ?
    `
    const bindings = [auth.organizationId, Math.floor(startTime / 3600000) * 3600, Math.floor(endTime / 3600000) * 3600]
    
    if (channelId) {
      query += ' AND channel_id = ?'
      bindings.push(channelId)
    }
    
    query += ' ORDER BY hour DESC LIMIT 1000'
    
    const analytics = await this.env.DB.prepare(query).bind(...bindings).all()
    
    return new Response(JSON.stringify({ analytics: analytics.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async getBeaconEvents(auth: AuthContext, params: URLSearchParams): Promise<Response> {
    const channelId = params.get('channel_id')
    const limit = parseInt(params.get('limit') || '100')
    
    let query = `
      SELECT * FROM beacon_events
      WHERE organization_id = ?
    `
    const bindings = [auth.organizationId]
    
    if (channelId) {
      query += ' AND channel_id = ?'
      bindings.push(channelId)
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?'
    bindings.push(limit)
    
    const events = await this.env.DB.prepare(query).bind(...bindings).all()
    
    return new Response(JSON.stringify({ events: events.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // ===== ORGANIZATION =====
  
  async getOrganization(auth: AuthContext): Promise<Response> {
    const org = await this.env.DB.prepare(`
      SELECT * FROM organizations WHERE id = ?
    `).bind(auth.organizationId).first()
    
    return new Response(JSON.stringify({ organization: org }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async updateOrganization(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    const updates: string[] = []
    const values: any[] = []
    
    if (data.name) {
      updates.push('name = ?')
      values.push(data.name)
    }
    
    if (data.settings) {
      updates.push('settings = ?')
      values.push(JSON.stringify(data.settings))
    }
    
    updates.push('updated_at = ?')
    values.push(Date.now())
    
    values.push(auth.organizationId)
    
    await this.env.DB.prepare(`
      UPDATE organizations SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values).run()
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  // ===== USERS =====

  async listUsers(auth: AuthContext): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const users = await this.env.DB.prepare(`
      SELECT id, organization_id, email, name, role, last_login, created_at, updated_at
      FROM users
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ users: users.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async createUser(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    if (!data.email || !data.password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const id = generateId('user')
    const now = Date.now()
    const passwordHash = await hashPassword(data.password)

    try {
      await this.env.DB.prepare(`
        INSERT INTO users (
          id, organization_id, email, name, role, password_hash,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        auth.organizationId,
        data.email,
        data.name || null,
        data.role || 'viewer',
        passwordHash,
        now,
        now
      ).run()

      await this.logEvent(auth.organizationId, auth.user.id, 'user.created', 'user', id, null)

      return new Response(JSON.stringify({ id }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return new Response(JSON.stringify({ error: 'User with this email already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      throw err
    }
  }

  async updateUser(auth: AuthContext, userId: string, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    // Check user exists and belongs to organization
    const user = await this.env.DB.prepare(`
      SELECT * FROM users WHERE id = ? AND organization_id = ?
    `).bind(userId, auth.organizationId).first()

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const updates: string[] = []
    const values: any[] = []

    if (data.name !== undefined) {
      updates.push('name = ?')
      values.push(data.name)
    }

    if (data.role) {
      updates.push('role = ?')
      values.push(data.role)
    }

    if (data.password) {
      updates.push('password_hash = ?')
      values.push(await hashPassword(data.password))
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(userId, auth.organizationId)

    await this.env.DB.prepare(`
      UPDATE users SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `).bind(...values).run()

    await this.logEvent(auth.organizationId, auth.user.id, 'user.updated', 'user', userId, data)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async deleteUser(auth: AuthContext, userId: string): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    // Prevent deleting yourself
    if (userId === auth.user.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete your own user account' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const result = await this.env.DB.prepare(`
      DELETE FROM users WHERE id = ? AND organization_id = ?
    `).bind(userId, auth.organizationId).run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    await this.logEvent(auth.organizationId, auth.user.id, 'user.deleted', 'user', userId, null)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  // ===== API KEYS =====

  async listApiKeys(auth: AuthContext): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const keys = await this.env.DB.prepare(`
      SELECT id, name, permissions, last_used, expires_at, created_at, created_by
      FROM api_keys
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ api_keys: keys.results }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async createApiKey(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    if (!data.name) {
      return new Response(JSON.stringify({ error: 'API key name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const id = generateId('key')
    const now = Date.now()
    
    // Generate API key
    const apiKey = `ssai_${generateId('').substring(4)}_${generateId('').substring(4)}`
    const keyHash = await hashPassword(apiKey)

    // Calculate expiration
    const expiresAt = data.expires_days 
      ? now + (data.expires_days * 24 * 60 * 60 * 1000)
      : null

    await this.env.DB.prepare(`
      INSERT INTO api_keys (
        id, organization_id, name, key_hash, permissions,
        expires_at, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.organizationId,
      data.name,
      keyHash,
      JSON.stringify(data.permissions || {}),
      expiresAt,
      now,
      auth.user.id
    ).run()

    await this.logEvent(auth.organizationId, auth.user.id, 'api_key.created', 'api_key', id, null)

    return new Response(JSON.stringify({ 
      id,
      api_key: apiKey // Return the actual key only once at creation
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }

  async deleteApiKey(auth: AuthContext, keyId: string): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    const result = await this.env.DB.prepare(`
      DELETE FROM api_keys WHERE id = ? AND organization_id = ?
    `).bind(keyId, auth.organizationId).run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'API key not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }

    await this.logEvent(auth.organizationId, auth.user.id, 'api_key.deleted', 'api_key', keyId, null)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // ===== LOGGING =====
  
  private async logEvent(
    organizationId: string,
    userId: string | null,
    eventType: string,
    entityType: string | null,
    entityId: string | null,
    changes: any
  ): Promise<void> {
    const id = generateId('evt')
    
    await this.env.DB.prepare(`
      INSERT INTO system_events (
        id, organization_id, user_id, event_type, entity_type, entity_id,
        changes, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      organizationId,
      userId,
      eventType,
      entityType,
      entityId,
      changes ? JSON.stringify(changes) : null,
      Date.now()
    ).run()
  }
  
  // ============================================================================
  // ADS LIBRARY - Cloudflare Stream Integration
  // ============================================================================
  
  async listAds(auth: AuthContext): Promise<Response> {
    const ads = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE organization_id = ? ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ ads: ads.results || [] }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async getAd(auth: AuthContext, adId: string): Promise<Response> {
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    return new Response(JSON.stringify({ ad }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async uploadAd(auth: AuthContext, request: Request): Promise<Response> {
    console.log('=== UPLOAD AD HANDLER CALLED ===')
    console.log('Auth:', { userId: auth.user.id, orgId: auth.organizationId })
    try {
      console.log('Attempting to parse formData...')
      const formData = await request.formData()
      console.log('FormData parsed successfully')
      const file = formData.get('file') as File
      console.log('File from formData:', file ? `${file.name} (${file.size} bytes)` : 'NO FILE')
      const name = formData.get('name') as string || file?.name
      const description = formData.get('description') as string || ''
      const channelId = formData.get('channel_id') as string || null
      
      if (!file) {
        return new Response(JSON.stringify({ error: 'No file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Validate file type
      if (!file.type.startsWith('video/')) {
        return new Response(JSON.stringify({ error: 'File must be a video' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Get channel bitrate ladder (if channel specified)
      let bitrates = [1000, 2000, 3000] // Default bitrates in kbps
      if (channelId) {
        const channel = await this.env.DB.prepare(`
          SELECT bitrate_ladder FROM channels WHERE id = ? AND organization_id = ?
        `).bind(channelId, auth.organizationId).first<any>()
        
        if (channel?.bitrate_ladder) {
          try {
            const ladder = JSON.parse(channel.bitrate_ladder)
            if (Array.isArray(ladder) && ladder.length > 0) {
              bitrates = ladder
            }
          } catch (e) {
            console.warn('Failed to parse bitrate ladder, using defaults')
          }
        }
      }
      
      // Create ad record
      const adId = generateId('ad')
      const now = Date.now()
      const sourceKey = `source-videos/${adId}/original.mp4`
      
      // Upload source file to R2
      console.log(`Uploading source file to R2: ${sourceKey}`)
      await this.env.R2.put(sourceKey, file.stream(), {
        httpMetadata: {
          contentType: file.type,
        },
        customMetadata: {
          originalFilename: file.name,
          uploadedBy: auth.user.id,
          organizationId: auth.organizationId,
        }
      })
      
      // Create database record
      await this.env.DB.prepare(`
        INSERT INTO ads (
          id, organization_id, name, description, channel_id,
          source_key, transcode_status, file_size, mime_type, 
          original_filename, status, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        adId,
        auth.organizationId,
        name,
        description,
        channelId,
        sourceKey,
        'queued',
        file.size,
        file.type,
        file.name,
        'active',
        now,
        now,
        auth.user.id
      ).run()
      
      // Queue transcode job
      console.log(`Queueing transcode job for ad ${adId} with bitrates:`, bitrates)
      await this.env.TRANSCODE_QUEUE.send({
        adId,
        sourceKey,
        bitrates,
        organizationId: auth.organizationId,
        channelId,
        retryCount: 0,
      })
      
      await this.logEvent(auth.organizationId, auth.user.id, 'ad.uploaded', 'ad', adId, { 
        source_key: sourceKey, 
        bitrates 
      })
      
      return new Response(JSON.stringify({ 
        success: true, 
        ad_id: adId,
        transcode_status: 'queued',
        bitrates
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    } catch (err: any) {
      console.error('Upload error:', err)
      return new Response(JSON.stringify({ error: err.message || 'Upload failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
  }
  
  async updateAd(auth: AuthContext, adId: string, data: any): Promise<Response> {
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    const updates: string[] = []
    const values: any[] = []
    
    const fields = ['name', 'description', 'status', 'tracking_urls']
    for (const field of fields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(field === 'tracking_urls' ? JSON.stringify(data[field]) : data[field])
      }
    }
    
    updates.push('updated_at = ?')
    values.push(Date.now())
    
    values.push(adId, auth.organizationId)
    
    await this.env.DB.prepare(`
      UPDATE ads SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?
    `).bind(...values).run()
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad.updated', 'ad', adId, data)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async deleteAd(auth: AuthContext, adId: string): Promise<Response> {
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first<any>()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Delete source file from R2
    if (ad.source_key) {
      try {
        await this.env.R2.delete(ad.source_key)
        console.log(`Deleted source file: ${ad.source_key}`)
      } catch (err) {
        console.error(`Failed to delete source file ${ad.source_key}:`, err)
      }
    }
    
    // Delete transcoded files from R2 (entire directory)
    const transcodePrefix = `transcoded-ads/${adId}/`
    try {
      const listed = await this.env.R2.list({ prefix: transcodePrefix })
      for (const object of listed.objects) {
        await this.env.R2.delete(object.key)
      }
      console.log(`Deleted transcoded files for ad ${adId}`)
    } catch (err) {
      console.error(`Failed to delete transcoded files for ad ${adId}:`, err)
    }
    
    // Delete from database
    await this.env.DB.prepare(`
      DELETE FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).run()
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad.deleted', 'ad', adId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async refreshAdStatus(auth: AuthContext, adId: string): Promise<Response> {
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first<any>()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Return current status from database
    // (Status is updated by the transcode worker)
    return new Response(JSON.stringify({ 
      success: true, 
      transcode_status: ad.transcode_status,
      duration: ad.duration,
      variants: ad.variants ? JSON.parse(ad.variants) : null,
      master_playlist_url: ad.master_playlist_url,
      error_message: ad.error_message,
      transcoded_at: ad.transcoded_at,
    }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
}

// Router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const api = new AdminAPI(env, origin)
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env, origin)
      })
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', {
        headers: { ...corsHeaders(env, origin) }
      })
    }
    
    // Auth endpoints (no auth required)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return api.login(request)
    }
    
    // All other endpoints require authentication
    const authResult = await authenticate(request, env, origin)
    if (authResult instanceof Response) {
      return authResult
    }
    const auth = authResult as AuthContext
    
    // Route to handlers
    try {
      // Channels
      if (url.pathname === '/api/channels' && request.method === 'GET') {
        return api.listChannels(auth)
      }
      if (url.pathname === '/api/channels' && request.method === 'POST') {
        const data = await request.json()
        return api.createChannel(auth, data)
      }
      if (url.pathname.match(/^\/api\/channels\/[^/]+$/) && request.method === 'GET') {
        const channelId = url.pathname.split('/').pop()!
        return api.getChannel(auth, channelId)
      }
      if (url.pathname.match(/^\/api\/channels\/[^/]+$/) && request.method === 'PUT') {
        const channelId = url.pathname.split('/').pop()!
        const data = await request.json()
        return api.updateChannel(auth, channelId, data)
      }
      if (url.pathname.match(/^\/api\/channels\/[^/]+$/) && request.method === 'DELETE') {
        const channelId = url.pathname.split('/').pop()!
        return api.deleteChannel(auth, channelId)
      }
      
      // Ad Pods
      if (url.pathname === '/api/ad-pods' && request.method === 'GET') {
        return api.listAdPods(auth)
      }
      if (url.pathname === '/api/ad-pods' && request.method === 'POST') {
        const data = await request.json()
        return api.createAdPod(auth, data)
      }
      if (url.pathname.match(/^\/api\/ad-pods\/[^/]+$/) && request.method === 'PUT') {
        const podId = url.pathname.split('/').pop()!
        const data = await request.json()
        return api.updateAdPod(auth, podId, data)
      }
      if (url.pathname.match(/^\/api\/ad-pods\/[^/]+$/) && request.method === 'DELETE') {
        const podId = url.pathname.split('/').pop()!
        return api.deleteAdPod(auth, podId)
      }
      
      // Analytics
      if (url.pathname === '/api/analytics' && request.method === 'GET') {
        return api.getAnalytics(auth, url.searchParams)
      }
      if (url.pathname === '/api/beacon-events' && request.method === 'GET') {
        return api.getBeaconEvents(auth, url.searchParams)
      }
      
      // Organization
      if (url.pathname === '/api/organization' && request.method === 'GET') {
        return api.getOrganization(auth)
      }
      if (url.pathname === '/api/organization' && request.method === 'PUT') {
        const data = await request.json()
        return api.updateOrganization(auth, data)
      }
      
      // Users
      if (url.pathname === '/api/users' && request.method === 'GET') {
        return api.listUsers(auth)
      }
      if (url.pathname === '/api/users' && request.method === 'POST') {
        const data = await request.json()
        return api.createUser(auth, data)
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && request.method === 'PUT') {
        const userId = url.pathname.split('/').pop()!
        const data = await request.json()
        return api.updateUser(auth, userId, data)
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && request.method === 'DELETE') {
        const userId = url.pathname.split('/').pop()!
        return api.deleteUser(auth, userId)
      }
      
      // API Keys
      if (url.pathname === '/api/api-keys' && request.method === 'GET') {
        return api.listApiKeys(auth)
      }
      if (url.pathname === '/api/api-keys' && request.method === 'POST') {
        const data = await request.json()
        return api.createApiKey(auth, data)
      }
      if (url.pathname.match(/^\/api\/api-keys\/[^/]+$/) && request.method === 'DELETE') {
        const keyId = url.pathname.split('/').pop()!
        return api.deleteApiKey(auth, keyId)
      }
      
      // Ads Library
      if (url.pathname === '/api/ads' && request.method === 'GET') {
        return api.listAds(auth)
      }
      if (url.pathname === '/api/ads/upload' && request.method === 'POST') {
        return api.uploadAd(auth, request)
      }
      if (url.pathname.match(/^\/api\/ads\/[^/]+$/) && request.method === 'GET') {
        const adId = url.pathname.split('/').pop()!
        return api.getAd(auth, adId)
      }
      if (url.pathname.match(/^\/api\/ads\/[^/]+$/) && request.method === 'PUT') {
        const adId = url.pathname.split('/').pop()!
        const data = await request.json()
        return api.updateAd(auth, adId, data)
      }
      if (url.pathname.match(/^\/api\/ads\/[^/]+$/) && request.method === 'DELETE') {
        const adId = url.pathname.split('/').pop()!
        return api.deleteAd(auth, adId)
      }
      if (url.pathname.match(/^\/api\/ads\/[^/]+\/refresh$/) && request.method === 'POST') {
        const adId = url.pathname.split('/')[3]
        return api.refreshAdStatus(auth, adId)
      }
      
      
      // Not found
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env, origin) }
      })
    } catch (err) {
      console.error('API error:', err)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env, origin) }
      })
    }
  }
}

