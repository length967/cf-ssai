// Admin API Worker
// REST API for admin platform with multi-tenant support

import { invalidateChannelConfigCache } from './utils/channel-config'
import { detectBitratesFromOrigin, validateBitrateLadder } from './utils/bitrate-detection'

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
  
  // Coordinator DO for parallel transcoding
  TRANSCODE_COORDINATOR: DurableObjectNamespace
  
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
  
  /**
   * Get bitrate ladder with smart fallbacks
   * Priority: specified channel → org channels → sensible defaults
   * 
   * This method prioritizes explicitly configured bitrate_ladder (from detection or manual override)
   * over legacy detected_bitrates for maximum reliability.
   */
  private async getBitrateLadder(
    organizationId: string,
    channelId?: string | null
  ): Promise<number[]> {
    // Priority 1: Use specified channel's explicit bitrate ladder
    if (channelId) {
      const channel = await this.env.DB.prepare(`
        SELECT bitrate_ladder, bitrate_ladder_source, detected_bitrates FROM channels 
        WHERE id = ? AND organization_id = ?
      `).bind(channelId, organizationId).first<any>()
      
      if (channel) {
        // Always prioritize bitrate_ladder if configured (manual or auto-detected)
        if (channel.bitrate_ladder) {
          try {
            const ladder = JSON.parse(channel.bitrate_ladder)
            if (Array.isArray(ladder) && ladder.length > 0) {
              const source = channel.bitrate_ladder_source || 'unknown'
              console.log(`✅ Using channel bitrate ladder (${source}): ${ladder.join(', ')} kbps`)
              return ladder
            }
          } catch (e) {
            console.warn('Failed to parse bitrate_ladder, falling back')
          }
        }
        
        // Legacy fallback: detected_bitrates (for channels not yet migrated to explicit workflow)
        if (channel.detected_bitrates) {
          try {
            const detected = JSON.parse(channel.detected_bitrates)
            if (Array.isArray(detected) && detected.length > 0) {
              console.log(`⚠️  Using legacy detected bitrates: ${detected.join(', ')} kbps (consider re-detecting)`)
              return detected
            }
          } catch (e) {
            console.warn('Failed to parse detected_bitrates')
          }
        }
      }
    }
    
    // Priority 2: Use first active channel's bitrates from same organization
    console.log('No channel bitrates found, checking organization channels')
    const orgChannel = await this.env.DB.prepare(`
      SELECT bitrate_ladder, bitrate_ladder_source, detected_bitrates FROM channels 
      WHERE organization_id = ? AND status = 'active' AND bitrate_ladder IS NOT NULL
      ORDER BY last_bitrate_detection DESC, created_at DESC
      LIMIT 1
    `).bind(organizationId).first<any>()
    
    if (orgChannel?.bitrate_ladder) {
      try {
        const ladder = JSON.parse(orgChannel.bitrate_ladder)
        if (Array.isArray(ladder) && ladder.length > 0) {
          const source = orgChannel.bitrate_ladder_source || 'unknown'
          console.log(`ℹ️  Using org channel bitrate ladder (${source}): ${ladder.join(', ')} kbps`)
          return ladder
        }
      } catch (e) {
        console.warn('Failed to parse org channel bitrate_ladder')
      }
    }
    
    // Priority 3: Fallback to sensible defaults for common streaming
    console.log('⚠️  Using default bitrate ladder (no channel-specific configuration found)')
    return [800, 1600, 2400, 3600] // Balanced ladder covering mobile to 4K
  }
  
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
    
    // Validate bitrate ladder if provided
    if (data.bitrate_ladder) {
      const validation = validateBitrateLadder(data.bitrate_ladder)
      if (!validation.valid) {
        return new Response(JSON.stringify({ 
          error: `Invalid bitrate ladder: ${validation.error}` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
    }
    
    await this.env.DB.prepare(`
      INSERT INTO channels (
        id, organization_id, name, slug, origin_url, status, mode,
        scte35_enabled, scte35_auto_insert, vast_enabled, vast_url, default_ad_duration,
        ad_pod_base_url, sign_host, slate_pod_id, time_based_auto_insert,
        segment_cache_max_age, manifest_cache_max_age, tier, settings,
        bitrate_ladder, bitrate_ladder_source, detected_bitrates, last_bitrate_detection,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.tier ?? 0,  // Default: no tier restrictions
      JSON.stringify(data.settings || {}),
      data.bitrate_ladder ? JSON.stringify(data.bitrate_ladder) : null,
      data.bitrate_ladder_source || null,
      data.detected_bitrates ? JSON.stringify(data.detected_bitrates) : null,
      data.last_bitrate_detection || null,
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
                    'slate_pod_id', 'time_based_auto_insert', 'segment_cache_max_age', 'manifest_cache_max_age', 'tier']
    
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
    
    // Handle bitrate ladder updates
    if (data.bitrate_ladder !== undefined) {
      // Validate if provided
      if (data.bitrate_ladder !== null) {
        const validation = validateBitrateLadder(data.bitrate_ladder)
        if (!validation.valid) {
          return new Response(JSON.stringify({ 
            error: `Invalid bitrate ladder: ${validation.error}` 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
          })
        }
      }
      updates.push('bitrate_ladder = ?')
      values.push(data.bitrate_ladder ? JSON.stringify(data.bitrate_ladder) : null)
    }
    
    if (data.bitrate_ladder_source !== undefined) {
      updates.push('bitrate_ladder_source = ?')
      values.push(data.bitrate_ladder_source)
    }
    
    if (data.detected_bitrates !== undefined) {
      updates.push('detected_bitrates = ?')
      values.push(data.detected_bitrates ? JSON.stringify(data.detected_bitrates) : null)
    }
    
    if (data.last_bitrate_detection !== undefined) {
      updates.push('last_bitrate_detection = ?')
      values.push(data.last_bitrate_detection)
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
  
  /**
   * Detect bitrates from origin stream URL
   * POST body: { originUrl: string }
   * Returns: { success, bitrates, variants, error? }
   */
  async detectBitrates(auth: AuthContext, data: any): Promise<Response> {
    if (!data.originUrl) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'originUrl is required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    console.log(`🔍 Detecting bitrates from: ${data.originUrl}`)
    
    // Call bitrate detection utility
    const result = await detectBitratesFromOrigin(data.originUrl, 15000) // 15s timeout
    
    if (!result.success) {
      console.error(`❌ Bitrate detection failed: ${result.error}`)
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    console.log(`✅ Detected ${result.bitrates.length} bitrates: ${result.bitrates.join(', ')} kbps`)
    
    // Log event
    await this.logEvent(
      auth.organizationId, 
      auth.user.id, 
      'bitrates.detected', 
      'origin', 
      data.originUrl, 
      { bitrates: result.bitrates, variants: result.variants }
    )
    
    return new Response(JSON.stringify(result), {
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
    
    // Parallel transcoding settings
    if (data.parallel_transcode_enabled !== undefined) {
      updates.push('parallel_transcode_enabled = ?')
      values.push(data.parallel_transcode_enabled ? 1 : 0)
    }
    
    if (data.parallel_transcode_threshold !== undefined) {
      updates.push('parallel_transcode_threshold = ?')
      values.push(data.parallel_transcode_threshold)
    }
    
    if (data.parallel_segment_duration !== undefined) {
      updates.push('parallel_segment_duration = ?')
      values.push(data.parallel_segment_duration)
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
  // SLATES - "We'll Be Right Back" Videos
  // ============================================================================
  
  async listSlates(auth: AuthContext): Promise<Response> {
    const slates = await this.env.DB.prepare(`
      SELECT * FROM slates WHERE organization_id = ? ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    const formattedSlates = (slates.results || []).map((slate: any) => {
      const formatted = { ...slate }
      
      if (slate.variants) {
        try {
          const variants = JSON.parse(slate.variants)
          formatted.variants_parsed = variants
          formatted.variant_count = variants.length
        } catch (e) {
          formatted.variants_parsed = []
          formatted.variant_count = 0
        }
      }
      
      return formatted
    })
    
    return new Response(JSON.stringify({ slates: formattedSlates }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async getSlate(auth: AuthContext, slateId: string): Promise<Response> {
    const slate = await this.env.DB.prepare(`
      SELECT * FROM slates WHERE id = ? AND organization_id = ?
    `).bind(slateId, auth.organizationId).first<any>()
    
    if (!slate) {
      return new Response(JSON.stringify({ error: 'Slate not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    return new Response(JSON.stringify({ slate }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async createGeneratedSlate(auth: AuthContext, data: any): Promise<Response> {
    try {
      const { name, text_content, background_color, text_color, font_size, duration, channel_id } = data
      
      if (!name || !text_content) {
        return new Response(JSON.stringify({ error: 'Name and text content are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Get bitrate ladder
      const bitrates = await this.getBitrateLadder(auth.organizationId, channel_id)
      
      // Create slate record
      const slateId = generateId('slate')
      const now = Date.now()
      const slateDuration = duration || 10 // Default 10 seconds
      
      // Create database record for generated slate
      await this.env.DB.prepare(`
        INSERT INTO slates (
          id, organization_id, name, duration, status, slate_type,
          text_content, background_color, text_color, font_size,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slateId,
        auth.organizationId,
        name,
        slateDuration,
        'pending',
        'generated',
        text_content,
        background_color || '#000000',
        text_color || '#FFFFFF',
        font_size || 48,
        now,
        now
      ).run()
      
      // Queue generation job (transcode worker will handle FFmpeg generation)
      // No sourceKey needed for generated slates - FFmpeg will create from scratch
      await this.env.TRANSCODE_QUEUE.send({
        adId: slateId,
        sourceKey: null, // Generated slates don't have a source
        bitrates: bitrates,
        organizationId: auth.organizationId,
        channelId: channel_id || undefined,
        isSlate: true,
        isGenerated: true,
        slateConfig: {
          text: text_content,
          backgroundColor: background_color || '#000000',
          textColor: text_color || '#FFFFFF',
          fontSize: font_size || 48,
          duration: slateDuration
        }
      })
      
      await this.logEvent(auth.organizationId, auth.user.id, 'slate.created', 'slate', slateId, { name, type: 'generated' })
      
      return new Response(JSON.stringify({ success: true, slate_id: slateId }), {
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    } catch (err) {
      console.error('Generated slate creation error:', err)
      return new Response(JSON.stringify({ error: 'Failed to create generated slate' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
  }
  
  async uploadSlate(auth: AuthContext, request: Request): Promise<Response> {
    try {
      const formData = await request.formData()
      const file = formData.get('file') as File
      const name = formData.get('name') as string || file?.name
      const channelId = formData.get('channel_id') as string || null
      
      if (!file) {
        return new Response(JSON.stringify({ error: 'No file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Validate file type
      if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
        return new Response(JSON.stringify({ error: 'File must be a video or image' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
        })
      }
      
      // Get bitrate ladder with smart defaults
      const bitrates = await this.getBitrateLadder(auth.organizationId, channelId)
      
      // Create slate record
      const slateId = generateId('slate')
      const now = Date.now()
      const sourceKey = `source-videos/${slateId}/original${file.type.startsWith('image/') ? '.jpg' : '.mp4'}`
      
      // Upload to R2
      await this.env.R2.put(sourceKey, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: {
          originalFilename: file.name,
          uploadedBy: auth.user.id,
          organizationId: auth.organizationId,
        }
      })
      
      const sourceVideoUrl = `${this.env.R2_PUBLIC_URL}/${sourceKey}`
      
      // Create database record
      await this.env.DB.prepare(`
        INSERT INTO slates (
          id, organization_id, name, duration, status,
          source_video_url, source_file_size, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        slateId,
        auth.organizationId,
        name,
        10, // Default duration, will be updated after probe
        'pending',
        sourceVideoUrl,
        file.size,
        now,
        now
      ).run()
      
      // Queue transcoding job
      await this.env.TRANSCODE_QUEUE.send({
        adId: slateId,
        sourceKey: sourceKey, // R2 key for the uploaded video
        bitrates: bitrates,
        organizationId: auth.organizationId,
        channelId: channelId || undefined,
        isSlate: true, // Mark as slate for special handling
      })
      
      await this.logEvent(auth.organizationId, auth.user.id, 'slate.created', 'slate', slateId, { name })
      
      return new Response(JSON.stringify({ success: true, slate_id: slateId }), {
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    } catch (err) {
      console.error('Slate upload error:', err)
      return new Response(JSON.stringify({ error: 'Failed to upload slate' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
  }
  
  async updateSlate(auth: AuthContext, slateId: string, data: any): Promise<Response> {
    // Verify ownership
    const slate = await this.env.DB.prepare(`
      SELECT * FROM slates WHERE id = ? AND organization_id = ?
    `).bind(slateId, auth.organizationId).first<any>()
    
    if (!slate) {
      return new Response(JSON.stringify({ error: 'Slate not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Update slate
    await this.env.DB.prepare(`
      UPDATE slates SET name = ?, updated_at = ? WHERE id = ?
    `).bind(data.name || slate.name, Date.now(), slateId).run()
    
    await this.logEvent(auth.organizationId, auth.user.id, 'slate.updated', 'slate', slateId, data)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async deleteSlate(auth: AuthContext, slateId: string): Promise<Response> {
    const slate = await this.env.DB.prepare(`
      SELECT * FROM slates WHERE id = ? AND organization_id = ?
    `).bind(slateId, auth.organizationId).first<any>()
    
    if (!slate) {
      return new Response(JSON.stringify({ error: 'Slate not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Check if slate is in use by any channels
    const channelsUsingSlate = await this.env.DB.prepare(`
      SELECT COUNT(*) as count FROM channels WHERE slate_id = ?
    `).bind(slateId).first<any>()
    
    if (channelsUsingSlate && channelsUsingSlate.count > 0) {
      return new Response(JSON.stringify({ 
        error: 'Cannot delete slate: it is currently assigned to one or more channels' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Delete from database
    await this.env.DB.prepare(`
      DELETE FROM slates WHERE id = ?
    `).bind(slateId).run()
    
    // Delete from R2 (best effort, non-blocking)
    // The source video and transcoded files should be cleaned up
    
    await this.logEvent(auth.organizationId, auth.user.id, 'slate.deleted', 'slate', slateId, null)
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  // ============================================================================
  // ADS LIBRARY - Cloudflare Stream Integration
  // ============================================================================
  
  async listAds(auth: AuthContext): Promise<Response> {
    const ads = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE organization_id = ? ORDER BY created_at DESC
    `).bind(auth.organizationId).all()
    
    // Parse and format variants for each ad
    const formattedAds = (ads.results || []).map((ad: any) => {
      const formatted = { ...ad }
      
      // Parse variants JSON if present
      if (ad.variants) {
        try {
          const variants = JSON.parse(ad.variants)
          formatted.variants_parsed = variants
          formatted.variant_count = variants.length
          formatted.variant_bitrates = variants.map((v: any) => v.bitrate).sort((a: number, b: number) => a - b)
        } catch (e) {
          formatted.variants_parsed = []
          formatted.variant_count = 0
          formatted.variant_bitrates = []
        }
      } else {
        formatted.variants_parsed = []
        formatted.variant_count = 0
        formatted.variant_bitrates = []
      }
      
      return formatted
    })
    
    return new Response(JSON.stringify({ ads: formattedAds }), {
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
    })
  }
  
  async getAd(auth: AuthContext, adId: string): Promise<Response> {
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first<any>()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Parse and format variants
    const formatted = { ...ad }
    if (ad.variants) {
      try {
        const variants = JSON.parse(ad.variants)
        formatted.variants_parsed = variants
        formatted.variant_count = variants.length
        formatted.variant_bitrates = variants.map((v: any) => v.bitrate).sort((a: number, b: number) => a - b)
        
        // Add detailed variant info with human-readable bitrates
        formatted.variants_detailed = variants.map((v: any) => ({
          bitrate: v.bitrate,
          bitrate_kbps: Math.round(v.bitrate / 1000),
          bitrate_mbps: (v.bitrate / 1000000).toFixed(2),
          url: v.url,
          resolution: v.resolution || 'unknown'
        }))
      } catch (e) {
        formatted.variants_parsed = []
        formatted.variant_count = 0
        formatted.variant_bitrates = []
        formatted.variants_detailed = []
      }
    } else {
      formatted.variants_parsed = []
      formatted.variant_count = 0
      formatted.variant_bitrates = []
      formatted.variants_detailed = []
    }
    
    return new Response(JSON.stringify({ ad: formatted }), {
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
      
      // Get bitrate ladder with smart defaults
      const bitrates = await this.getBitrateLadder(auth.organizationId, channelId)
      
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
      
      // Get organization settings for parallel transcoding
      const org = await this.env.DB.prepare(`
        SELECT parallel_transcode_enabled, parallel_transcode_threshold, parallel_segment_duration
        FROM organizations
        WHERE id = ?
      `).bind(auth.organizationId).first<{
        parallel_transcode_enabled: number;
        parallel_transcode_threshold: number;
        parallel_segment_duration: number;
      }>();
      
      const parallelEnabled = org?.parallel_transcode_enabled === 1;
      const thresholdSeconds = org?.parallel_transcode_threshold || 30;
      const segmentDuration = org?.parallel_segment_duration || 10;
      
      // For now, we estimate duration based on file size or use a simple heuristic
      // TODO: Add proper duration probing with ffprobe
      // Assume if file is > 10MB, it's likely > 30 seconds
      const estimatedDuration = file.size > 10 * 1024 * 1024 ? 60 : 20; // rough estimate
      const useParallel = parallelEnabled && estimatedDuration > thresholdSeconds;
      
      console.log(`Queueing transcode job for ad ${adId}:`, {
        parallelEnabled,
        thresholdSeconds,
        estimatedDuration,
        useParallel,
        bitrates
      });
      
      if (useParallel) {
        try {
          // PARALLEL TRANSCODING: Split into segments
          const jobGroupId = crypto.randomUUID();
          const segmentCount = Math.ceil(estimatedDuration / segmentDuration);
          
          console.log(`Creating parallel transcode job: ${segmentCount} segments`);
          
          // Initialize coordinator DO
          const doId = this.env.TRANSCODE_COORDINATOR.idFromName(jobGroupId);
          const coordinator = this.env.TRANSCODE_COORDINATOR.get(doId);
          
          try {
            const initRequest = new Request('http://coordinator/init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                adId,
                segmentCount,
                bitrates,
                organizationId: auth.organizationId,
                channelId,
                sourceKey
              })
            });
            
            const coordResponse = await coordinator.fetch(initRequest);
            if (!coordResponse.ok) {
              throw new Error(`Coordinator init failed: ${await coordResponse.text()}`);
            }
            console.log('Coordinator initialized successfully');
          } catch (coordError: any) {
            console.error('Coordinator initialization error:', coordError);
            throw new Error(`Failed to initialize coordinator: ${coordError.message}`);
          }
          
          // Queue all segment jobs
          const segmentJobs = [];
          for (let i = 0; i < segmentCount; i++) {
            segmentJobs.push({
              type: 'SEGMENT',
              adId,
              segmentId: i,
              startTime: i * segmentDuration,
              duration: segmentDuration,
              sourceKey,
              bitrates,
              organizationId: auth.organizationId,
              channelId,
              jobGroupId
            });
          }
          
          console.log('Sending segment jobs to queue:', segmentJobs.length);
          await this.env.TRANSCODE_QUEUE.sendBatch(segmentJobs);
          console.log(`Queued ${segmentJobs.length} parallel segment jobs`);
        } catch (parallelError: any) {
          console.error('Parallel transcode setup failed:', parallelError);
          console.log('Falling back to traditional transcode');
          // Fall back to traditional transcode
          await this.env.TRANSCODE_QUEUE.send({
            adId,
            sourceKey,
            bitrates,
            organizationId: auth.organizationId,
            channelId,
            retryCount: 0,
          });
        }
      } else {
        // TRADITIONAL TRANSCODING: Single full-video job
        console.log('Using traditional single-container transcode');
        await this.env.TRANSCODE_QUEUE.send({
          adId,
          sourceKey,
          bitrates,
          organizationId: auth.organizationId,
          channelId,
          retryCount: 0,
        });
      }
      
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
  
  async retranscodeAd(auth: AuthContext, adId: string, data: any): Promise<Response> {
    // Get ad details
    const ad = await this.env.DB.prepare(`
      SELECT * FROM ads WHERE id = ? AND organization_id = ?
    `).bind(adId, auth.organizationId).first<any>()
    
    if (!ad) {
      return new Response(JSON.stringify({ error: 'Ad not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    if (!ad.source_key) {
      return new Response(JSON.stringify({ error: 'Ad has no source video to re-transcode' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...this.corsHeaders() }
      })
    }
    
    // Get bitrates (either from request body or auto-detect from channel)
    let bitrates: number[]
    
    if (data.bitrates && Array.isArray(data.bitrates) && data.bitrates.length > 0) {
      // Manual bitrates specified
      bitrates = data.bitrates
      console.log(`Re-transcoding ad ${adId} with manual bitrates: ${bitrates}`)
    } else {
      // Auto-detect from channel
      const channelId = data.channel_id || ad.channel_id
      bitrates = await this.getBitrateLadder(auth.organizationId, channelId)
      console.log(`Re-transcoding ad ${adId} with auto-detected bitrates: ${bitrates}`)
    }
    
    // Construct source URL
    const sourceUrl = ad.source_key.startsWith('http') 
      ? ad.source_key 
      : `${this.env.R2_PUBLIC_URL}/${ad.source_key}`
    
    // Reset transcode status
    await this.env.DB.prepare(`
      UPDATE ads 
      SET transcode_status = 'queued',
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
    `).bind(Date.now(), adId).run()
    
    // Get organization settings for parallel transcoding
    const org = await this.env.DB.prepare(`
      SELECT parallel_transcode_enabled, parallel_transcode_threshold, parallel_segment_duration
      FROM organizations
      WHERE id = ?
    `).bind(auth.organizationId).first<{
      parallel_transcode_enabled: number;
      parallel_transcode_threshold: number;
      parallel_segment_duration: number;
    }>()
    
    const parallelEnabled = org?.parallel_transcode_enabled === 1
    const thresholdSeconds = org?.parallel_transcode_threshold || 30
    const segmentDuration = org?.parallel_segment_duration || 10
    
    // Use stored duration if available, otherwise estimate
    const estimatedDuration = ad.duration || (ad.file_size > 10 * 1024 * 1024 ? 60 : 20)
    const useParallel = parallelEnabled && estimatedDuration > thresholdSeconds
    
    console.log(`Re-queueing transcode job for ad ${adId}:`, {
      parallelEnabled,
      thresholdSeconds,
      estimatedDuration,
      useParallel,
      bitrates
    })
    
    if (useParallel) {
      try {
        // PARALLEL TRANSCODING
        const jobGroupId = crypto.randomUUID()
        const segmentCount = Math.ceil(estimatedDuration / segmentDuration)
        
        const doId = this.env.TRANSCODE_COORDINATOR.idFromName(jobGroupId)
        const coordinator = this.env.TRANSCODE_COORDINATOR.get(doId)
        
        const initRequest = new Request('http://coordinator/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adId,
            segmentCount,
            bitrates,
            organizationId: auth.organizationId
          })
        })
        
        await coordinator.fetch(initRequest)
        
        // Queue segment jobs
        for (let i = 0; i < segmentCount; i++) {
          await this.env.TRANSCODE_QUEUE.send({
            adId,
            sourceUrl,
            bitrates,
            organizationId: auth.organizationId,
            channelId: ad.channel_id || undefined,
            isParallel: true,
            segmentIndex: i,
            segmentDuration,
            jobGroupId
          })
        }
        
        console.log(`Queued ${segmentCount} parallel transcode jobs for ad ${adId}`)
      } catch (err) {
        console.error('Failed to setup parallel transcode, falling back to traditional:', err)
        // Fallback to traditional
        await this.env.TRANSCODE_QUEUE.send({
          adId,
          sourceUrl,
          bitrates,
          organizationId: auth.organizationId,
          channelId: ad.channel_id || undefined
        })
      }
    } else {
      // TRADITIONAL TRANSCODING
      await this.env.TRANSCODE_QUEUE.send({
        adId,
        sourceUrl,
        bitrates,
        organizationId: auth.organizationId,
        channelId: ad.channel_id || undefined
      })
    }
    
    await this.logEvent(auth.organizationId, auth.user.id, 'ad.retranscode', 'ad', adId, { bitrates })
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Re-transcode job queued',
      bitrates 
    }), {
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
      
      // Bitrate Detection
      if (url.pathname === '/api/channels/detect-bitrates' && request.method === 'POST') {
        const data = await request.json()
        return api.detectBitrates(auth, data)
      }
      
      // Slates
      if (url.pathname === '/api/slates' && request.method === 'GET') {
        return api.listSlates(auth)
      }
      if (url.pathname === '/api/slates/upload' && request.method === 'POST') {
        return api.uploadSlate(auth, request)
      }
      if (url.pathname === '/api/slates/generate' && request.method === 'POST') {
        const data = await request.json()
        return api.createGeneratedSlate(auth, data)
      }
      if (url.pathname.match(/^\/api\/slates\/[^/]+$/) && request.method === 'GET') {
        const slateId = url.pathname.split('/').pop()!
        return api.getSlate(auth, slateId)
      }
      if (url.pathname.match(/^\/api\/slates\/[^/]+$/) && request.method === 'PUT') {
        const slateId = url.pathname.split('/').pop()!
        const data = await request.json()
        return api.updateSlate(auth, slateId, data)
      }
      if (url.pathname.match(/^\/api\/slates\/[^/]+$/) && request.method === 'DELETE') {
        const slateId = url.pathname.split('/').pop()!
        return api.deleteSlate(auth, slateId)
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
      if (url.pathname.match(/^\/api\/ads\/[^/]+\/retranscode$/) && request.method === 'POST') {
        const adId = url.pathname.split('/')[3]
        const data = await request.json()
        return api.retranscodeAd(auth, adId, data)
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

