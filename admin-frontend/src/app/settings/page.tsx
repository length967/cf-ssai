'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, XCircle } from 'lucide-react'

type Tab = 'organization' | 'workers' | 'users' | 'api-keys'

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('organization')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Organization settings
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [orgPlan, setOrgPlan] = useState('')
  const [orgStatus, setOrgStatus] = useState('')
  const [orgSettings, setOrgSettings] = useState({
    default_vast_url: '',
    default_vast_timeout_ms: 2000,
    default_ad_duration: 30,
    scte35_detection_enabled: true,
    vast_waterfall_enabled: true,
    beacon_tracking_enabled: true,
    cache_decision_ttl: 60,
    max_wrapper_depth: 5,
  })
  
  // Parallel transcoding settings
  const [parallelTranscodeEnabled, setParallelTranscodeEnabled] = useState(true)
  const [parallelThreshold, setParallelThreshold] = useState(30)
  const [segmentDuration, setSegmentDuration] = useState(10)

  // Worker configuration
  const [workerConfig, setWorkerConfig] = useState({
    decision_timeout_ms: 2000,
    vast_timeout_ms: 2000,
    vast_max_wrapper_depth: 5,
    cache_decision_ttl: 60,
    beacon_timeout_ms: 5000,
    beacon_retry_attempts: 2,
    window_bucket_secs: 2,
  })

  // Users management
  const [users, setUsers] = useState<any[]>([])
  const [newUser, setNewUser] = useState({
    email: '',
    name: '',
    role: 'viewer',
    password: '',
  })

  // API Keys management
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [newApiKey, setNewApiKey] = useState({
    name: '',
    permissions: {
      channels: ['read'] as string[],
      analytics: ['read'] as string[],
      ad_pods: [] as string[],
    },
    expires_days: 90,
  })

  useEffect(() => {
    loadData()
  }, [activeTab])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'organization') {
        const { organization } = await api.getOrganization()
        setOrgName(organization.name)
        setOrgSlug(organization.slug)
        setOrgPlan(organization.plan)
        setOrgStatus(organization.status)
        
        const settings = organization.settings ? JSON.parse(organization.settings) : {}
        setOrgSettings({
          default_vast_url: settings.default_vast_url || '',
          default_vast_timeout_ms: settings.default_vast_timeout_ms || 2000,
          default_ad_duration: settings.default_ad_duration || 30,
          scte35_detection_enabled: settings.scte35_detection_enabled ?? true,
          vast_waterfall_enabled: settings.vast_waterfall_enabled ?? true,
          beacon_tracking_enabled: settings.beacon_tracking_enabled ?? true,
          cache_decision_ttl: settings.cache_decision_ttl || 60,
          max_wrapper_depth: settings.max_wrapper_depth || 5,
        })
        
        // Load parallel transcoding settings
        setParallelTranscodeEnabled(organization.parallel_transcode_enabled === 1)
        setParallelThreshold(organization.parallel_transcode_threshold || 30)
        setSegmentDuration(organization.parallel_segment_duration || 10)
      } else if (activeTab === 'users') {
        const { users: usersList } = await api.getUsers()
        setUsers(usersList)
      } else if (activeTab === 'api-keys') {
        const { api_keys } = await api.getApiKeys()
        setApiKeys(api_keys)
      }
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const saveOrganizationSettings = async () => {
    setSaving(true)
    try {
      await api.updateOrganization({
        name: orgName,
        settings: orgSettings,
        parallel_transcode_enabled: parallelTranscodeEnabled,
        parallel_transcode_threshold: parallelThreshold,
        parallel_segment_duration: segmentDuration,
      })
      showMessage('success', 'Organization settings saved successfully')
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const saveWorkerConfig = async () => {
    setSaving(true)
    try {
      await api.updateOrganization({
        settings: {
          ...orgSettings,
          worker_config: workerConfig,
        },
      })
      showMessage('success', 'Worker configuration saved successfully')
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  const createUser = async () => {
    if (!newUser.email || !newUser.password) {
      showMessage('error', 'Email and password are required')
      return
    }
    
    setSaving(true)
    try {
      await api.createUser(newUser)
      showMessage('success', 'User created successfully')
      setNewUser({ email: '', name: '', role: 'viewer', password: '' })
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  const deleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return
    
    try {
      await api.deleteUser(userId)
      showMessage('success', 'User deleted successfully')
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete user')
    }
  }

  const createApiKey = async () => {
    if (!newApiKey.name) {
      showMessage('error', 'API key name is required')
      return
    }
    
    setSaving(true)
    try {
      const result = await api.createApiKey(newApiKey)
      showMessage('success', `API key created: ${result.api_key}`)
      setNewApiKey({
        name: '',
        permissions: { channels: ['read'], analytics: ['read'], ad_pods: [] },
        expires_days: 90,
      })
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to create API key')
    } finally {
      setSaving(false)
    }
  }

  const deleteApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key?')) return
    
    try {
      await api.deleteApiKey(keyId)
      showMessage('success', 'API key deleted successfully')
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete API key')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/')}
                className="text-xl font-bold text-blue-600 hover:text-blue-800"
              >
                SSAI Admin
              </button>
              <nav className="ml-8 flex space-x-4">
                <a href="/" className="text-gray-600 hover:text-gray-900 px-3 py-2">Dashboard</a>
                <a href="/channels" className="text-gray-600 hover:text-gray-900 px-3 py-2">Channels</a>
                <a href="/analytics" className="text-gray-600 hover:text-gray-900 px-3 py-2">Analytics</a>
                <a href="/settings" className="text-blue-600 font-medium px-3 py-2">Settings</a>
              </nav>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => {
                  api.clearToken()
                  router.push('/login')
                }}
                className="text-sm text-gray-700 hover:text-gray-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            <p className="mt-2 text-gray-600">Configure your SSAI platform settings</p>
          </div>

          {/* Message banner */}
          {message && (
            <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-500 bg-green-50 mb-6' : 'mb-6'}>
              {message.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
              <AlertDescription className={message.type === 'success' ? 'text-green-600' : ''}>
                {message.text}
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('organization')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'organization'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Organization
              </button>
              <button
                onClick={() => setActiveTab('workers')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'workers'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Worker Configuration
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'users'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Users
              </button>
              <button
                onClick={() => setActiveTab('api-keys')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'api-keys'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                API Keys
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Organization Tab */}
              {activeTab === 'organization' && (
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-6">Organization Settings</h2>
                  
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="org-name">Organization Name</Label>
                        <Input
                          id="org-name"
                          type="text"
                          value={orgName}
                          onChange={(e) => setOrgName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="org-slug">Slug</Label>
                        <Input
                          id="org-slug"
                          type="text"
                          value={orgSlug}
                          disabled
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="org-plan">Plan</Label>
                        <Input
                          id="org-plan"
                          type="text"
                          value={orgPlan}
                          disabled
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="org-status">Status</Label>
                        <Input
                          id="org-status"
                          type="text"
                          value={orgStatus}
                          disabled
                        />
                      </div>
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">Default Settings</h3>

                    <div className="space-y-2">
                      <Label htmlFor="vast-url">Default VAST URL</Label>
                      <Input
                        id="vast-url"
                        type="text"
                        value={orgSettings.default_vast_url}
                        onChange={(e) => setOrgSettings({ ...orgSettings, default_vast_url: e.target.value })}
                        placeholder="https://example.com/vast.xml"
                      />
                      <p className="text-sm text-muted-foreground">Default VAST server URL for new channels</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="vast-timeout">VAST Timeout (ms)</Label>
                        <Input
                          id="vast-timeout"
                          type="number"
                          value={orgSettings.default_vast_timeout_ms}
                          onChange={(e) => setOrgSettings({ ...orgSettings, default_vast_timeout_ms: parseInt(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ad-duration">Default Ad Duration (sec)</Label>
                        <Input
                          id="ad-duration"
                          type="number"
                          value={orgSettings.default_ad_duration}
                          onChange={(e) => setOrgSettings({ ...orgSettings, default_ad_duration: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cache Decision TTL (sec)
                        </label>
                        <input
                          type="number"
                          value={orgSettings.cache_decision_ttl}
                          onChange={(e) => setOrgSettings({ ...orgSettings, cache_decision_ttl: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Max VAST Wrapper Depth
                        </label>
                        <input
                          type="number"
                          value={orgSettings.max_wrapper_depth}
                          onChange={(e) => setOrgSettings({ ...orgSettings, max_wrapper_depth: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">Transcoding Settings</h3>
                    
                    <div className="space-y-6">
                      <div className="flex items-start">
                        <div className="flex items-center h-5">
                          <input
                            type="checkbox"
                            checked={parallelTranscodeEnabled}
                            onChange={(e) => setParallelTranscodeEnabled(e.target.checked)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                        </div>
                        <div className="ml-3">
                          <label className="font-medium text-gray-700">Enable Parallel Transcoding</label>
                          <p className="text-sm text-gray-500">Process videos in parallel for 5-15x faster transcoding</p>
                        </div>
                      </div>
                      
                      {parallelTranscodeEnabled && (
                        <div className="ml-7 space-y-4 pl-4 border-l-2 border-blue-200">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Video Duration Threshold: {parallelThreshold} seconds
                            </label>
                            <input
                              type="range"
                              min="15"
                              max="120"
                              step="5"
                              value={parallelThreshold}
                              onChange={(e) => setParallelThreshold(parseInt(e.target.value))}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                              <span>15s</span>
                              <span>120s</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">
                              Videos longer than this will use parallel transcoding
                            </p>
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Segment Duration: {segmentDuration} seconds
                            </label>
                            <input
                              type="range"
                              min="5"
                              max="30"
                              step="5"
                              value={segmentDuration}
                              onChange={(e) => setSegmentDuration(parseInt(e.target.value))}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                              <span>5s</span>
                              <span>30s</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">
                              Length of each parallel segment (smaller = more parallelism)
                            </p>
                          </div>
                          
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex">
                              <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                              </div>
                              <div className="ml-3">
                                <h3 className="text-sm font-medium text-blue-800">Performance Estimate</h3>
                                <div className="mt-2 text-sm text-blue-700">
                                  <p className="mb-1">• 5-minute video with current settings:</p>
                                  <p className="ml-4">300s ÷ {segmentDuration}s = {Math.ceil(300 / segmentDuration)} segments</p>
                                  <p className="ml-4 font-semibold">Estimated time: ~{Math.ceil(300 / segmentDuration / 10 * 30)}-{Math.ceil(300 / segmentDuration / 10 * 30 + 20)} seconds</p>
                                  <p className="mt-1 text-xs text-blue-600">vs ~1,500 seconds (25 minutes) single-threaded</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">Feature Flags</h3>

                    <div className="space-y-4">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={orgSettings.scte35_detection_enabled}
                          onChange={(e) => setOrgSettings({ ...orgSettings, scte35_detection_enabled: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700">Enable SCTE-35 Detection</span>
                      </label>

                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={orgSettings.vast_waterfall_enabled}
                          onChange={(e) => setOrgSettings({ ...orgSettings, vast_waterfall_enabled: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700">Enable VAST Waterfall</span>
                      </label>

                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={orgSettings.beacon_tracking_enabled}
                          onChange={(e) => setOrgSettings({ ...orgSettings, beacon_tracking_enabled: e.target.checked })}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700">Enable Beacon Tracking</span>
                      </label>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={saveOrganizationSettings}
                        disabled={saving}
                        variant="default"
                      >
                        {saving ? 'Saving...' : 'Save Settings'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Worker Configuration Tab */}
              {activeTab === 'workers' && (
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-6">Worker Configuration</h2>
                  <p className="text-sm text-gray-600 mb-6">
                    These settings control the behavior of the Cloudflare Workers that power your SSAI platform.
                  </p>
                  
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold mb-4">Decision Service</h3>
                    
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Decision Timeout (ms)
                        </label>
                        <input
                          type="number"
                          value={workerConfig.decision_timeout_ms}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, decision_timeout_ms: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Maximum time to wait for ad decision</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Cache Decision TTL (sec)
                        </label>
                        <input
                          type="number"
                          value={workerConfig.cache_decision_ttl}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, cache_decision_ttl: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">How long to cache ad decisions</p>
                      </div>
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">VAST Parser</h3>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          VAST Timeout (ms)
                        </label>
                        <input
                          type="number"
                          value={workerConfig.vast_timeout_ms}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, vast_timeout_ms: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Maximum time to fetch VAST XML</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Max Wrapper Depth
                        </label>
                        <input
                          type="number"
                          value={workerConfig.vast_max_wrapper_depth}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, vast_max_wrapper_depth: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Maximum VAST wrapper redirects</p>
                      </div>
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">Beacon Consumer</h3>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Beacon Timeout (ms)
                        </label>
                        <input
                          type="number"
                          value={workerConfig.beacon_timeout_ms}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, beacon_timeout_ms: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Maximum time to send beacon requests</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Retry Attempts
                        </label>
                        <input
                          type="number"
                          value={workerConfig.beacon_retry_attempts}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, beacon_retry_attempts: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Number of retry attempts for failed beacons</p>
                      </div>
                    </div>

                    <hr className="my-6" />

                    <h3 className="text-lg font-semibold mb-4">Manifest Worker</h3>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Window Bucket (sec)
                        </label>
                        <input
                          type="number"
                          value={workerConfig.window_bucket_secs}
                          onChange={(e) => setWorkerConfig({ ...workerConfig, window_bucket_secs: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-sm text-gray-500">Time bucket for manifest windows</p>
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={saveWorkerConfig}
                        disabled={saving}
                        variant="default"
                      >
                        {saving ? 'Saving...' : 'Save Configuration'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Users Tab */}
              {activeTab === 'users' && (
                <div className="space-y-6">
                  {/* Create New User */}
                  <div className="bg-white shadow rounded-lg p-6">
                    <h2 className="text-xl font-semibold mb-6">Create New User</h2>
                    
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Email *
                        </label>
                        <input
                          type="email"
                          value={newUser.email}
                          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Name
                        </label>
                        <input
                          type="text"
                          value={newUser.name}
                          onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Role *
                        </label>
                        <select
                          value={newUser.role}
                          onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Password *
                        </label>
                        <input
                          type="password"
                          value={newUser.password}
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={createUser}
                        disabled={saving}
                        variant="default"
                      >
                        {saving ? 'Creating...' : 'Create User'}
                      </Button>
                    </div>
                  </div>

                  {/* Existing Users */}
                  <div className="bg-white shadow rounded-lg p-6">
                    <h2 className="text-xl font-semibold mb-6">Existing Users</h2>
                    
                    {users.length === 0 ? (
                      <p className="text-gray-600">No users found</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Name
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Email
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Role
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Last Login
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((user) => (
                              <tr key={user.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {user.name || '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {user.email}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                    {user.role}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button
                                    onClick={() => deleteUser(user.id)}
                                    className="text-red-600 hover:text-red-900"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* API Keys Tab */}
              {activeTab === 'api-keys' && (
                <div className="space-y-6">
                  {/* Create New API Key */}
                  <div className="bg-white shadow rounded-lg p-6">
                    <h2 className="text-xl font-semibold mb-6">Create New API Key</h2>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Key Name *
                      </label>
                      <input
                        type="text"
                        value={newApiKey.name}
                        onChange={(e) => setNewApiKey({ ...newApiKey, name: e.target.value })}
                        placeholder="Production API Key"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Expires In (days)
                      </label>
                      <input
                        type="number"
                        value={newApiKey.expires_days}
                        onChange={(e) => setNewApiKey({ ...newApiKey, expires_days: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Permissions
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newApiKey.permissions.channels.includes('read')}
                            onChange={(e) => {
                              const perms = e.target.checked 
                                ? [...newApiKey.permissions.channels, 'read']
                                : newApiKey.permissions.channels.filter(p => p !== 'read')
                              setNewApiKey({ ...newApiKey, permissions: { ...newApiKey.permissions, channels: perms } })
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">Channels - Read</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newApiKey.permissions.channels.includes('write')}
                            onChange={(e) => {
                              const perms = e.target.checked 
                                ? [...newApiKey.permissions.channels, 'write']
                                : newApiKey.permissions.channels.filter(p => p !== 'write')
                              setNewApiKey({ ...newApiKey, permissions: { ...newApiKey.permissions, channels: perms } })
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">Channels - Write</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newApiKey.permissions.analytics.includes('read')}
                            onChange={(e) => {
                              const perms = e.target.checked 
                                ? [...newApiKey.permissions.analytics, 'read']
                                : newApiKey.permissions.analytics.filter(p => p !== 'read')
                              setNewApiKey({ ...newApiKey, permissions: { ...newApiKey.permissions, analytics: perms } })
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">Analytics - Read</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newApiKey.permissions.ad_pods.includes('read')}
                            onChange={(e) => {
                              const perms = e.target.checked 
                                ? [...newApiKey.permissions.ad_pods, 'read']
                                : newApiKey.permissions.ad_pods.filter(p => p !== 'read')
                              setNewApiKey({ ...newApiKey, permissions: { ...newApiKey.permissions, ad_pods: perms } })
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">Ad Pods - Read</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newApiKey.permissions.ad_pods.includes('write')}
                            onChange={(e) => {
                              const perms = e.target.checked 
                                ? [...newApiKey.permissions.ad_pods, 'write']
                                : newApiKey.permissions.ad_pods.filter(p => p !== 'write')
                              setNewApiKey({ ...newApiKey, permissions: { ...newApiKey.permissions, ad_pods: perms } })
                            }}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">Ad Pods - Write</span>
                        </label>
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <Button
                        onClick={createApiKey}
                        disabled={saving}
                        variant="default"
                      >
                        {saving ? 'Creating...' : 'Create API Key'}
                      </Button>
                    </div>
                  </div>

                  {/* Existing API Keys */}
                  <div className="bg-white shadow rounded-lg p-6">
                    <h2 className="text-xl font-semibold mb-6">Existing API Keys</h2>
                    
                    {apiKeys.length === 0 ? (
                      <p className="text-gray-600">No API keys found</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Name
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Created
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Expires
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Last Used
                              </th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {apiKeys.map((key) => (
                              <tr key={key.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {key.name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {new Date(key.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'Never'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {key.last_used ? new Date(key.last_used).toLocaleString() : 'Never'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button
                                    onClick={() => deleteApiKey(key.id)}
                                    className="text-red-600 hover:text-red-900"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

