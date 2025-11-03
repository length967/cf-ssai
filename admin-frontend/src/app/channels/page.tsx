'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { BitrateDetector } from '@/components/BitrateDetector'
import Navigation from '@/components/Navigation'

type Channel = {
  id: string
  name: string
  slug: string
  origin_url: string
  status: string
  mode: string
  scte35_enabled: number
  scte35_auto_insert?: number
  tier?: number
  vast_enabled: number
  vast_url?: string
  vast_timeout_ms?: number
  default_ad_duration: number
  ad_pod_base_url?: string
  sign_host?: string
  slate_id?: string
  time_based_auto_insert?: number
  segment_cache_max_age?: number
  manifest_cache_max_age?: number
  settings?: string
  bitrate_ladder?: string
  bitrate_ladder_source?: string
  detected_bitrates?: string
  last_bitrate_detection?: number
  created_at: number
  updated_at: number
}

type Organization = {
  id: string
  name: string
  slug: string
  status: string
}

type Slate = {
  id: string
  name: string
  slate_type: 'video' | 'generated'
  duration: number
  status: string
  text_content?: string
}

export default function ChannelsPage() {
  const router = useRouter()
  const [channels, setChannels] = useState<Channel[]>([])
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [slates, setSlates] = useState<Slate[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    origin_url: '',
    status: 'active',
    mode: 'auto',
    scte35_enabled: true,
    scte35_auto_insert: false,
    tier: 0,
    vast_enabled: true,
    vast_url: '',
    vast_timeout_ms: 2000,
    default_ad_duration: 30,
    ad_pod_base_url: '',
    sign_host: '',
    slate_id: '',
    time_based_auto_insert: false,
    segment_cache_max_age: 60,
    manifest_cache_max_age: 4,
    settings: {
      max_bitrate: null,
      min_bitrate: null,
      prefer_hls: true,
    },
    bitrate_ladder: [] as number[],
    bitrate_ladder_source: null as 'auto' | 'manual' | null,
    detected_bitrates: [] as number[]
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [channelsData, orgData, slatesData] = await Promise.all([
        api.getChannels(),
        api.getOrganization(),
        api.listSlates().catch(() => ({ slates: [] })) // Fallback if slates not available
      ])
      setChannels(channelsData.channels)
      setOrganization(orgData.organization)
      setSlates(slatesData.slates || [])
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const loadChannels = async () => {
    try {
      const { channels: channelList } = await api.getChannels()
      setChannels(channelList)
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load channels')
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const openCreateModal = () => {
    setEditingChannel(null)
    setFormData({
      name: '',
      slug: '',
      origin_url: '',
      status: 'active',
      mode: 'auto',
      scte35_enabled: true,
      scte35_auto_insert: false,
      tier: 0,
      vast_enabled: true,
      vast_url: '',
      vast_timeout_ms: 2000,
      default_ad_duration: 30,
      ad_pod_base_url: '',
      sign_host: '',
      slate_id: '',
      time_based_auto_insert: false,
      segment_cache_max_age: 60,
      manifest_cache_max_age: 4,
      settings: {
        max_bitrate: null,
        min_bitrate: null,
        prefer_hls: true,
      },
      bitrate_ladder: [],
      bitrate_ladder_source: null,
      detected_bitrates: []
    })
    setShowModal(true)
  }

  const openEditModal = (channel: Channel) => {
    setEditingChannel(channel)
    const settings = channel.settings ? JSON.parse(channel.settings) : {}
    
    let bitrateLadder: number[] = []
    let detectedBitrates: number[] = []
    
    if (channel.bitrate_ladder) {
      try {
        bitrateLadder = JSON.parse(channel.bitrate_ladder)
      } catch (e) {}
    }
    
    if (channel.detected_bitrates) {
      try {
        detectedBitrates = JSON.parse(channel.detected_bitrates)
      } catch (e) {}
    }
    
    setFormData({
      name: channel.name,
      slug: channel.slug,
      origin_url: channel.origin_url,
      status: channel.status,
      mode: channel.mode,
      scte35_enabled: Boolean(channel.scte35_enabled),
      scte35_auto_insert: Boolean(channel.scte35_auto_insert),
      tier: channel.tier ?? 0,
      vast_enabled: Boolean(channel.vast_enabled),
      vast_url: channel.vast_url || '',
      vast_timeout_ms: channel.vast_timeout_ms || 2000,
      default_ad_duration: channel.default_ad_duration,
      ad_pod_base_url: channel.ad_pod_base_url || '',
      sign_host: channel.sign_host || '',
      slate_id: channel.slate_id || '',
      time_based_auto_insert: Boolean(channel.time_based_auto_insert),
      segment_cache_max_age: channel.segment_cache_max_age || 60,
      manifest_cache_max_age: channel.manifest_cache_max_age || 4,
      settings: {
        max_bitrate: settings.max_bitrate || null,
        min_bitrate: settings.min_bitrate || null,
        prefer_hls: settings.prefer_hls ?? true,
      },
      bitrate_ladder: bitrateLadder,
      bitrate_ladder_source: (channel.bitrate_ladder_source as 'auto' | 'manual' | null) || null,
      detected_bitrates: detectedBitrates
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name || !formData.slug || !formData.origin_url) {
      showMessage('error', 'Name, slug, and origin URL are required')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...formData,
        scte35_enabled: formData.scte35_enabled ? 1 : 0,
        scte35_auto_insert: formData.scte35_auto_insert ? 1 : 0,
        vast_enabled: formData.vast_enabled ? 1 : 0,
        time_based_auto_insert: formData.time_based_auto_insert ? 1 : 0,
        settings: formData.settings,
        bitrate_ladder: formData.bitrate_ladder.length > 0 ? formData.bitrate_ladder : undefined,
        bitrate_ladder_source: formData.bitrate_ladder_source,
        detected_bitrates: formData.detected_bitrates.length > 0 ? formData.detected_bitrates : undefined,
        last_bitrate_detection: formData.bitrate_ladder_source === 'auto' ? Date.now() : undefined
      }

      if (editingChannel) {
        await api.updateChannel(editingChannel.id, payload)
        showMessage('success', 'Channel updated successfully')
      } else {
        await api.createChannel(payload)
        showMessage('success', 'Channel created successfully')
      }
      
      setShowModal(false)
      loadChannels()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to save channel')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (channel: Channel) => {
    if (!confirm(`Are you sure you want to delete "${channel.name}"?`)) return

    try {
      await api.deleteChannel(channel.id)
      showMessage('success', 'Channel deleted successfully')
      loadChannels()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete channel')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Channels</h1>
              <p className="mt-2 text-gray-600">Manage your live stream channels</p>
            </div>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              + New Channel
            </button>
          </div>

          {/* Message banner */}
          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          {/* Channels List */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : channels.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <p className="text-gray-600 mb-4">No channels yet. Create your first channel to get started.</p>
              <button
                onClick={openCreateModal}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Create Channel
              </button>
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Slug
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Mode
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Features
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {channels.map((channel) => (
                    <tr key={channel.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{channel.name}</div>
                        <div className="text-sm text-gray-500">{channel.origin_url}</div>
                        {channel.bitrate_ladder && (() => {
                          try {
                            const bitrates = JSON.parse(channel.bitrate_ladder)
                            return (
                              <div className="mt-1 flex items-center gap-1">
                                <span className="text-xs text-gray-400">Bitrates:</span>
                                <span className="text-xs font-mono text-gray-600">
                                  {bitrates.join(', ')} kbps
                                </span>
                                {channel.bitrate_ladder_source === 'auto' && (
                                  <span className="text-xs text-blue-600">✓</span>
                                )}
                              </div>
                            )
                          } catch (e) {
                            return null
                          }
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {channel.slug}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                          {channel.mode.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          channel.status === 'active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {channel.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex gap-2">
                          {channel.scte35_enabled ? (
                            <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">SCTE-35</span>
                          ) : null}
                          {channel.vast_enabled ? (
                            <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded">VAST</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => openEditModal(channel)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(channel)}
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
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">
                {editingChannel ? 'Edit Channel' : 'Create New Channel'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Playback URL - Only shown when editing */}
              {editingChannel && organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-2 text-blue-900">🎥 Stream Playback URL</h3>
                  <p className="text-sm text-blue-700 mb-3">
                    Use this URL to watch your live stream with server-side ad insertion:
                  </p>
                  <div className="bg-white border border-blue-300 rounded-md p-3 font-mono text-sm break-all">
                    https://cf-ssai.mediamasters.workers.dev/{organization.slug}/{editingChannel.slug}/master.m3u8
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const url = `https://cf-ssai.mediamasters.workers.dev/${organization.slug}/${editingChannel.slug}/master.m3u8`
                        navigator.clipboard.writeText(url)
                        showMessage('success', 'URL copied to clipboard!')
                      }}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      📋 Copy URL
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = `https://cf-ssai.mediamasters.workers.dev/${organization.slug}/${editingChannel.slug}/master.m3u8`
                        window.open(url, '_blank')
                      }}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      ▶️ Open in Browser
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-blue-600">
                    💡 Tip: Test this URL in VLC, Safari, or any HLS-compatible player
                  </p>
                </div>
              )}

              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Channel Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Slug *
                    </label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="my-channel"
                      required
                      disabled={!!editingChannel}
                    />
                    <p className="mt-1 text-sm text-gray-500">URL-friendly identifier</p>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Origin URL *
                  </label>
                  <input
                    type="text"
                    value={formData.origin_url}
                    onChange={(e) => setFormData({ ...formData, origin_url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://origin.example.com/hls/channel"
                    required
                  />
                  <p className="mt-1 text-sm text-gray-500">Base URL of your origin HLS stream</p>
                </div>

                <div className="grid grid-cols-2 gap-6 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Mode
                    </label>
                    <select
                      value={formData.mode}
                      onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="auto">Auto (SCTE-35 or SGAI)</option>
                      <option value="sgai">SGAI Only</option>
                      <option value="ssai">SSAI Only</option>
                    </select>
                    <p className="mt-1 text-sm text-gray-500">Ad insertion mode</p>
                  </div>
                </div>
              </div>

              {/* Bitrate Detection */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Bitrate Configuration</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Detect and configure bitrate variants for this channel. Ads will be transcoded to match these exact bitrates.
                </p>
                <BitrateDetector
                  originUrl={formData.origin_url}
                  bitrateLadder={formData.bitrate_ladder}
                  bitrateSource={formData.bitrate_ladder_source}
                  onBitratesDetected={(bitrates, source) => {
                    setFormData({
                      ...formData,
                      bitrate_ladder: bitrates,
                      bitrate_ladder_source: source,
                      detected_bitrates: bitrates
                    })
                  }}
                  onBitratesChanged={(bitrates, source) => {
                    setFormData({
                      ...formData,
                      bitrate_ladder: bitrates,
                      bitrate_ladder_source: source
                    })
                  }}
                />
              </div>

              {/* SCTE-35 Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-4">SCTE-35 Configuration</h3>
                <div className="space-y-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.scte35_enabled}
                      onChange={(e) => setFormData({ ...formData, scte35_enabled: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Enable SCTE-35 Detection</span>
                  </label>
                  <p className="text-sm text-gray-500">Detect ad breaks from SCTE-35 markers in the stream</p>
                  
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.scte35_auto_insert}
                      onChange={(e) => setFormData({ ...formData, scte35_auto_insert: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      disabled={!formData.scte35_enabled}
                    />
                    <span className="ml-2 text-sm text-gray-700">Auto-Insert Ads on SCTE-35 Signals</span>
                  </label>
                  <p className="text-sm text-gray-500">Automatically trigger ad insertion when SCTE-35 markers are detected (disable to only trigger manually via API)</p>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Authorization Tier (SCTE-35 Filtering)
                    </label>
                    <select
                      value={formData.tier}
                      onChange={(e) => setFormData({ ...formData, tier: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={!formData.scte35_enabled}
                    >
                      <option value={0}>No restrictions (0x000) - All ads allowed</option>
                      <option value={1}>Tier 1 (0x001) - Basic subscribers</option>
                      <option value={2}>Tier 2 (0x002) - Premium subscribers</option>
                      <option value={3}>Tier 3 (0x003) - VIP subscribers</option>
                      <option value={4}>Tier 4 (0x004) - Custom tier</option>
                      <option value={5}>Tier 5 (0x005) - Custom tier</option>
                    </select>
                    <p className="mt-1 text-sm text-gray-500">
                      Only insert ads from SCTE-35 signals matching this tier level. 
                      Set to 0 to allow all ads. Higher tiers can be used for premium/ad-free services.
                    </p>
                  </div>
                </div>
              </div>

              {/* Auto-Insertion Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Auto-Insertion</h3>
                <div className="space-y-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.time_based_auto_insert}
                      onChange={(e) => setFormData({ ...formData, time_based_auto_insert: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Time-Based Auto-Insert</span>
                  </label>
                  <p className="text-sm text-gray-500">Insert ads at scheduled intervals (e.g., every 5 minutes) for testing</p>
                </div>
              </div>

              {/* Cache Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Cache Configuration</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Segment Cache Max-Age (seconds)
                    </label>
                    <input
                      type="number"
                      value={formData.segment_cache_max_age}
                      onChange={(e) => setFormData({ ...formData, segment_cache_max_age: parseInt(e.target.value) || 60 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="1"
                      max="300"
                    />
                    <p className="mt-1 text-sm text-gray-500">How long browsers cache video segments (60-120 recommended for Safari)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manifest Cache Max-Age (seconds)
                    </label>
                    <input
                      type="number"
                      value={formData.manifest_cache_max_age}
                      onChange={(e) => setFormData({ ...formData, manifest_cache_max_age: parseInt(e.target.value) || 4 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="1"
                      max="30"
                    />
                    <p className="mt-1 text-sm text-gray-500">How long browsers cache the manifest (3-6 recommended for live streams)</p>
                  </div>
                </div>
              </div>

              {/* VAST Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-4">VAST Configuration</h3>
                <div className="space-y-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.vast_enabled}
                      onChange={(e) => setFormData({ ...formData, vast_enabled: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Enable VAST Integration</span>
                  </label>

                  {formData.vast_enabled && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          VAST URL
                        </label>
                        <input
                          type="text"
                          value={formData.vast_url}
                          onChange={(e) => setFormData({ ...formData, vast_url: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="https://example.com/vast.xml"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          VAST Timeout (ms)
                        </label>
                        <input
                          type="number"
                          value={formData.vast_timeout_ms}
                          onChange={(e) => setFormData({ ...formData, vast_timeout_ms: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Ad Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Ad Configuration</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Default Ad Duration (sec)
                    </label>
                    <input
                      type="number"
                      value={formData.default_ad_duration}
                      onChange={(e) => setFormData({ ...formData, default_ad_duration: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Slate Video
                    </label>
                    <select
                      value={formData.slate_id}
                      onChange={(e) => setFormData({ ...formData, slate_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">No slate (use ad pod fallback)</option>
                      {slates.filter(s => s.status === 'ready').map(slate => (
                        <option key={slate.id} value={slate.id}>
                          {slate.name} ({slate.slate_type} - {slate.duration}s)
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-sm text-gray-500">
                      Select a slate video to pad ad breaks when ads are shorter than SCTE-35 duration.
                      {slates.length === 0 && (
                        <span className="text-blue-600"> No slates available - create one in the Slates section.</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Ad Pod Base URL
                  </label>
                  <input
                    type="text"
                    value={formData.ad_pod_base_url}
                    onChange={(e) => setFormData({ ...formData, ad_pod_base_url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://ads.example.com/pods"
                  />
                  <p className="mt-1 text-sm text-gray-500">Base URL for ad pod assets (leave empty to use global default)</p>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sign Host
                  </label>
                  <input
                    type="text"
                    value={formData.sign_host}
                    onChange={(e) => setFormData({ ...formData, sign_host: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="media.example.com"
                  />
                  <p className="mt-1 text-sm text-gray-500">Host used for URL signing (leave empty to use global default)</p>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-4 pt-6 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingChannel ? 'Update Channel' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

