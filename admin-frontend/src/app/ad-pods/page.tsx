'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckCircle2, XCircle } from 'lucide-react'

type AdPod = {
  id: string
  name: string
  pod_id: string
  duration_sec: number
  status: string
  assets: string
  tracking_impressions?: string
  tracking_quartiles?: string
  tracking_clicks?: string
  tracking_errors?: string
  vast_ad_id?: string
  vast_creative_id?: string
  tags?: string
  created_at: number
  updated_at: number
}

type Asset = {
  bitrate: number
  url: string
}

type Ad = {
  id: string
  name: string
  description?: string
  duration: number
  source_key: string
  transcode_status: string
  master_playlist_url?: string
  variants?: string
  error_message?: string
}

export default function AdPodsPage() {
  const router = useRouter()
  const [adPods, setAdPods] = useState<AdPod[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showAdsLibrary, setShowAdsLibrary] = useState(false)
  const [ads, setAds] = useState<Ad[]>([])
  const [loadingAds, setLoadingAds] = useState(false)
  const [editingPod, setEditingPod] = useState<AdPod | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    pod_id: '',
    duration_sec: 30,
    status: 'active',
    assets: [
      { bitrate: 800000, url: '' },
      { bitrate: 1600000, url: '' },
    ] as Asset[],
    tracking_impressions: [] as string[],
    tracking_clicks: [] as string[],
    tracking_errors: [] as string[],
    vast_ad_id: '',
    vast_creative_id: '',
    tags: [] as string[],
  })

  useEffect(() => {
    loadAdPods()
  }, [])

  const loadAdPods = async () => {
    setLoading(true)
    try {
      const { ad_pods } = await api.getAdPods()
      setAdPods(ad_pods)
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load ad pods')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const openCreateModal = () => {
    setEditingPod(null)
    setFormData({
      name: '',
      pod_id: '',
      duration_sec: 30,
      status: 'active',
      assets: [
        { bitrate: 800000, url: '' },
        { bitrate: 1600000, url: '' },
      ],
      tracking_impressions: [],
      tracking_clicks: [],
      tracking_errors: [],
      vast_ad_id: '',
      vast_creative_id: '',
      tags: [],
    })
    setShowModal(true)
  }

  const openEditModal = (pod: AdPod) => {
    setEditingPod(pod)
    setFormData({
      name: pod.name,
      pod_id: pod.pod_id,
      duration_sec: pod.duration_sec,
      status: pod.status,
      assets: JSON.parse(pod.assets),
      tracking_impressions: pod.tracking_impressions ? JSON.parse(pod.tracking_impressions) : [],
      tracking_clicks: pod.tracking_clicks ? JSON.parse(pod.tracking_clicks) : [],
      tracking_errors: pod.tracking_errors ? JSON.parse(pod.tracking_errors) : [],
      vast_ad_id: pod.vast_ad_id || '',
      vast_creative_id: pod.vast_creative_id || '',
      tags: pod.tags ? JSON.parse(pod.tags) : [],
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name || !formData.pod_id) {
      showMessage('error', 'Name and pod ID are required')
      return
    }

    if (formData.assets.some(a => !a.url)) {
      showMessage('error', 'All asset URLs are required')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: formData.name,
        pod_id: formData.pod_id,
        duration_sec: formData.duration_sec,
        status: formData.status,
        assets: formData.assets,
        tracking_impressions: formData.tracking_impressions,
        tracking_quartiles: {
          start: formData.tracking_impressions,
          firstQuartile: [],
          midpoint: [],
          thirdQuartile: [],
          complete: [],
        },
        tracking_clicks: formData.tracking_clicks,
        tracking_errors: formData.tracking_errors,
        vast_ad_id: formData.vast_ad_id || null,
        vast_creative_id: formData.vast_creative_id || null,
        tags: formData.tags,
      }

      if (editingPod) {
        await api.updateAdPod(editingPod.id, payload)
        showMessage('success', 'Ad pod updated successfully')
      } else {
        await api.createAdPod(payload)
        showMessage('success', 'Ad pod created successfully')
      }
      
      setShowModal(false)
      loadAdPods()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to save ad pod')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (pod: AdPod) => {
    if (!confirm(`Are you sure you want to delete "${pod.name}"?`)) return

    try {
      await api.deleteAdPod(pod.id)
      showMessage('success', 'Ad pod deleted successfully')
      loadAdPods()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete ad pod')
    }
  }

  const addAsset = () => {
    setFormData({
      ...formData,
      assets: [...formData.assets, { bitrate: 2400000, url: '' }]
    })
  }

  const removeAsset = (index: number) => {
    setFormData({
      ...formData,
      assets: formData.assets.filter((_, i) => i !== index)
    })
  }

  const updateAsset = (index: number, field: keyof Asset, value: string | number) => {
    const newAssets = [...formData.assets]
    newAssets[index] = { ...newAssets[index], [field]: value }
    setFormData({ ...formData, assets: newAssets })
  }

  const loadAdsLibrary = async () => {
    setLoadingAds(true)
    try {
      const data = await api.listAds()
      // Filter to only show ready ads
      const readyAds = (data.ads || []).filter((ad: Ad) => ad.transcode_status === 'ready')
      setAds(readyAds)
      setShowAdsLibrary(true)
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to load ads library')
    } finally {
      setLoadingAds(false)
    }
  }

  const selectAdFromLibrary = (ad: Ad) => {
    // Parse variants from transcoded R2 HLS
    let variants = []
    if (ad.variants) {
      try {
        variants = JSON.parse(ad.variants)
      } catch (e) {
        console.warn('Failed to parse ad variants:', e)
        variants = []
      }
    }

    // If no variants, can't use this ad
    if (variants.length === 0) {
      showMessage('error', 'This ad has no transcoded variants. Please wait for transcoding to complete.')
      return
    }

    setFormData({
      ...formData,
      name: formData.name || ad.name,
      duration_sec: ad.duration || formData.duration_sec,
      assets: variants.map((v: any) => ({ 
        bitrate: v.bitrate, 
        url: v.url || v.playlist_url 
      }))
    })
    setShowAdsLibrary(false)
    showMessage('success', `Ad "${ad.name}" selected! ${variants.length} bitrate variant(s) auto-populated from R2.`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Ad Pods</h1>
              <p className="mt-2 text-gray-600">Manage your pre-transcoded ad assets</p>
            </div>
            <Button
              onClick={openCreateModal}
              variant="default"
            >
              + New Ad Pod
            </Button>
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

          {/* Ad Pods List */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : adPods.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <p className="text-gray-600 mb-4">No ad pods yet. Create your first ad pod to get started.</p>
              <Button
                onClick={openCreateModal}
                variant="default"
              >
                Create Ad Pod
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {adPods.map((pod) => {
                const assets = JSON.parse(pod.assets)
                return (
                  <div key={pod.id} className="bg-white shadow rounded-lg p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{pod.name}</h3>
                        <p className="text-sm text-gray-500">{pod.pod_id}</p>
                      </div>
                      <StatusBadge
                        status={pod.status === 'active' ? 'active' : 'archived'}
                      />
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Duration:</span>
                        <span className="font-medium">{pod.duration_sec}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Variants:</span>
                        <span className="font-medium">{assets.length}</span>
                      </div>
                      {pod.vast_ad_id && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">VAST Ad ID:</span>
                          <span className="font-medium text-xs">{pod.vast_ad_id}</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button
                        onClick={() => openEditModal(pod)}
                        variant="outline"
                        size="sm"
                        className="flex-1"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => handleDelete(pod)}
                        variant="destructive"
                        size="sm"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPod ? 'Edit Ad Pod' : 'Create New Ad Pod'}
            </DialogTitle>
            <DialogDescription>
              Configure ad pod bitrate variants and tracking
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="pod-name">Pod Name *</Label>
                  <Input
                    id="pod-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pod-id">Pod ID *</Label>
                  <Input
                    id="pod-id"
                    type="text"
                    value={formData.pod_id}
                    onChange={(e) => setFormData({ ...formData, pod_id: e.target.value })}
                    placeholder="ad-pod-001"
                    required
                    disabled={!!editingPod}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="duration">Duration (seconds)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={formData.duration_sec}
                    onChange={(e) => setFormData({ ...formData, duration_sec: parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

              {/* Assets (Bitrate Variants) */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Bitrate Variants</h3>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={loadAdsLibrary}
                      disabled={loadingAds}
                      variant="secondary"
                      size="sm"
                    >
                      🎬 Browse Ads Library
                    </Button>
                    <Button
                      type="button"
                      onClick={addAsset}
                      variant="default"
                      size="sm"
                    >
                      + Add Variant
                    </Button>
                  </div>
                </div>
                
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                  💡 <strong>Tip:</strong> Click "Browse Ads Library" to select a video you've already uploaded via the Ads Library. This will auto-populate all bitrate variants!
                </div>
                
                <div className="space-y-4">
                  {formData.assets.map((asset, index) => (
                    <div key={index} className="flex gap-4 items-start p-4 border border-gray-200 rounded-md">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor={`bitrate-${index}`}>Bitrate (bps)</Label>
                        <Input
                          id={`bitrate-${index}`}
                          type="number"
                          value={asset.bitrate}
                          onChange={(e) => updateAsset(index, 'bitrate', parseInt(e.target.value))}
                          required
                        />
                      </div>
                      <div className="flex-[2] space-y-2">
                        <Label htmlFor={`url-${index}`}>Playlist URL</Label>
                        <Input
                          id={`url-${index}`}
                          type="text"
                          value={asset.url}
                          onChange={(e) => updateAsset(index, 'url', e.target.value)}
                          placeholder="https://ads.example.com/pod/v_800k/playlist.m3u8"
                          required
                        />
                      </div>
                      {formData.assets.length > 1 && (
                        <Button
                          type="button"
                          onClick={() => removeAsset(index)}
                          variant="ghost"
                          size="sm"
                          className="mt-8 text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Tracking URLs */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Tracking URLs (Optional)</h3>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Impression Tracking URLs
                  </label>
                  <textarea
                    value={formData.tracking_impressions.join('\n')}
                    onChange={(e) => setFormData({
                      ...formData,
                      tracking_impressions: e.target.value.split('\n').filter(u => u.trim())
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="One URL per line"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Click Tracking URLs
                  </label>
                  <textarea
                    value={formData.tracking_clicks.join('\n')}
                    onChange={(e) => setFormData({
                      ...formData,
                      tracking_clicks: e.target.value.split('\n').filter(u => u.trim())
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="One URL per line"
                  />
                </div>
              </div>

              {/* VAST Metadata */}
              <div>
                <h3 className="text-lg font-semibold mb-4">VAST Metadata (Optional)</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      VAST Ad ID
                    </label>
                    <input
                      type="text"
                      value={formData.vast_ad_id}
                      onChange={(e) => setFormData({ ...formData, vast_ad_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      VAST Creative ID
                    </label>
                    <input
                      type="text"
                      value={formData.vast_creative_id}
                      onChange={(e) => setFormData({ ...formData, vast_creative_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => setShowModal(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  variant="default"
                >
                  {saving ? 'Saving...' : editingPod ? 'Update Ad Pod' : 'Create Ad Pod'}
                </Button>
              </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>

      {/* Ads Library Modal */}
      <Dialog open={showAdsLibrary} onOpenChange={setShowAdsLibrary}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Browse Ads Library</DialogTitle>
            <DialogDescription>
              Select an ad to auto-populate bitrate variants
            </DialogDescription>
          </DialogHeader>

          <div>
              {loadingAds ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading ads...</p>
                </div>
              ) : ads.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🎬</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No ready ads yet</h3>
                  <p className="text-gray-600 mb-6">Upload and process ads in the Ads Library first</p>
                  <Button
                    onClick={() => window.location.href = '/ads'}
                    variant="default"
                  >
                    Go to Ads Library
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ads.map((ad) => (
                    <button
                      key={ad.id}
                      onClick={() => selectAdFromLibrary(ad)}
                      className="bg-white border-2 border-gray-200 hover:border-blue-500 rounded-lg overflow-hidden text-left transition-all"
                    >
                      <div className="w-full h-32 bg-gray-200 flex items-center justify-center text-4xl">
                        🎬
                      </div>
                      
                      <div className="p-3">
                        <h3 className="font-semibold text-gray-900">{ad.name}</h3>
                        {ad.description && (
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{ad.description}</p>
                        )}
                        <div className="mt-2 text-xs text-gray-500">
                          ⏱️ Duration: {ad.duration}s
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


