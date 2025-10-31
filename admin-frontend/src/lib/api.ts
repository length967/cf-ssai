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
      ...(options.headers as Record<string, string>)
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
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
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

  async updateAdPod(id: string, data: any) {
    return this.request(`/api/ad-pods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteAdPod(id: string) {
    return this.request(`/api/ad-pods/${id}`, {
      method: 'DELETE'
    })
  }

  // Users
  async getUsers() {
    return this.request('/api/users')
  }

  async createUser(data: any) {
    return this.request('/api/users', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateUser(id: string, data: any) {
    return this.request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteUser(id: string) {
    return this.request(`/api/users/${id}`, {
      method: 'DELETE'
    })
  }

  // API Keys
  async getApiKeys() {
    return this.request('/api/api-keys')
  }

  async createApiKey(data: any) {
    return this.request('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async deleteApiKey(id: string) {
    return this.request(`/api/api-keys/${id}`, {
      method: 'DELETE'
    })
  }
}

export const api = new APIClient()

