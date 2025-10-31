// Admin API Worker
// REST API for admin platform with multi-tenant support

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ADMIN_CORS_ORIGIN?: string
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
async function authenticate(request: Request, env: Env): Promise<AuthContext | Response> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  const token = authHeader.substring(7)
  const auth = await verifyToken(token, env.JWT_SECRET)
  
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  
  return auth
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ADMIN_CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  }
}

// API Handlers
class AdminAPI {
  constructor(private env: Env) {}
  
  // ===== AUTH =====
  
  async login(request: Request): Promise<Response> {
    try {
      const { email, password } = await request.json()
      
      // Find user
      const user = await this.env.DB.prepare(`
        SELECT u.*, o.status as org_status
        FROM users u
        JOIN organizations o ON u.organization_id = o.id
        WHERE u.email = ?
      `).bind(email).first()
      
      if (!user) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
        })
      }
      
      // Check org status
      if (user.org_status !== 'active') {
        return new Response(JSON.stringify({ error: 'Organization is not active' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
        })
      }
      
      // Verify password
      const valid = await verifyPassword(password, user.password_hash)
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
        })
      }
      
      // Generate token
      const token = await generateToken({
        id: user.id,
        organization_id: user.organization_id,
        email: user.email,
        name: user.name,
        role: user.role
      }, this.env.JWT_SECRET)
      
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Login failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }
    
    return new Response(JSON.stringify({ channel }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }
  
  async createChannel(auth: AuthContext, data: any): Promise<Response> {
    const id = generateId('ch')
    const now = Date.now()
    
    await this.env.DB.prepare(`
      INSERT INTO channels (
        id, organization_id, name, slug, origin_url, status, mode,
        scte35_enabled, vast_enabled, vast_url, default_ad_duration,
        ad_pod_base_url, sign_host, slate_pod_id, settings,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.organizationId,
      data.name,
      data.slug,
      data.origin_url,
      data.status || 'active',
      data.mode || 'auto',
      data.scte35_enabled ?? 1,
      data.vast_enabled ?? 1,
      data.vast_url || null,
      data.default_ad_duration || 30,
      data.ad_pod_base_url || null,
      data.sign_host || null,
      data.slate_pod_id || 'slate',
      JSON.stringify(data.settings || {}),
      now,
      now,
      auth.user.id
    ).run()
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.created', 'channel', id, null)
    
    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }
  
  async updateChannel(auth: AuthContext, channelId: string, data: any): Promise<Response> {
    // Check ownership
    const channel = await this.env.DB.prepare(`
      SELECT * FROM channels WHERE id = ? AND organization_id = ?
    `).bind(channelId, auth.organizationId).first()
    
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }
    
    // Build update query
    const updates: string[] = []
    const values: any[] = []
    
    const fields = ['name', 'origin_url', 'status', 'mode', 'scte35_enabled', 'vast_enabled', 
                    'vast_url', 'default_ad_duration', 'ad_pod_base_url', 'sign_host', 'slate_pod_id']
    
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
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.updated', 'channel', channelId, data)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }
  
  async deleteChannel(auth: AuthContext, channelId: string): Promise<Response> {
    const result = await this.env.DB.prepare(`
      DELETE FROM channels WHERE id = ? AND organization_id = ?
    `).bind(channelId, auth.organizationId).run()
    
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }
    
    // Log event
    await this.logEvent(auth.organizationId, auth.user.id, 'channel.deleted', 'channel', channelId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  async deleteAdPod(auth: AuthContext, podId: string): Promise<Response> {
    const result = await this.env.DB.prepare(`
      DELETE FROM ad_pods WHERE id = ? AND organization_id = ?
    `).bind(podId, auth.organizationId).run()
    
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Ad pod not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad_pod.deleted', 'ad_pod', podId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }
  
  // ===== ORGANIZATION =====
  
  async getOrganization(auth: AuthContext): Promise<Response> {
    const org = await this.env.DB.prepare(`
      SELECT * FROM organizations WHERE id = ?
    `).bind(auth.organizationId).first()
    
    return new Response(JSON.stringify({ organization: org }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }
  
  async updateOrganization(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  // ===== USERS =====

  async listUsers(auth: AuthContext): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    const users = await this.env.DB.prepare(`
      SELECT id, organization_id, email, name, role, last_login, created_at, updated_at
      FROM users
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ users: users.results }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  async createUser(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    if (!data.email || !data.password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return new Response(JSON.stringify({ error: 'User with this email already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
        })
      }
      throw err
    }
  }

  async updateUser(auth: AuthContext, userId: string, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    // Check user exists and belongs to organization
    const user = await this.env.DB.prepare(`
      SELECT * FROM users WHERE id = ? AND organization_id = ?
    `).bind(userId, auth.organizationId).first()

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  async deleteUser(auth: AuthContext, userId: string): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    // Prevent deleting yourself
    if (userId === auth.user.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete your own user account' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    const result = await this.env.DB.prepare(`
      DELETE FROM users WHERE id = ? AND organization_id = ?
    `).bind(userId, auth.organizationId).run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    await this.logEvent(auth.organizationId, auth.user.id, 'user.deleted', 'user', userId, null)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  // ===== API KEYS =====

  async listApiKeys(auth: AuthContext): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    const keys = await this.env.DB.prepare(`
      SELECT id, name, permissions, last_used, expires_at, created_at, created_by
      FROM api_keys
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    return new Response(JSON.stringify({ api_keys: keys.results }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  async createApiKey(auth: AuthContext, data: any): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    if (!data.name) {
      return new Response(JSON.stringify({ error: 'API key name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
    })
  }

  async deleteApiKey(auth: AuthContext, keyId: string): Promise<Response> {
    if (auth.user.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    const result = await this.env.DB.prepare(`
      DELETE FROM api_keys WHERE id = ? AND organization_id = ?
    `).bind(keyId, auth.organizationId).run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'API key not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
      })
    }

    await this.logEvent(auth.organizationId, auth.user.id, 'api_key.deleted', 'api_key', keyId, null)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(this.env) }
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
}

// Router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const api = new AdminAPI(env)
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env)
      })
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', {
        headers: { ...corsHeaders(env) }
      })
    }
    
    // Auth endpoints (no auth required)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return api.login(request)
    }
    
    // All other endpoints require authentication
    const authResult = await authenticate(request, env)
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
      
      // Not found
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) }
      })
    } catch (err) {
      console.error('API error:', err)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env) }
      })
    }
  }
}

