'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'

type Slate = {
  id: string
  name: string
  slate_type: 'video' | 'generated'
  duration: number
  status: string
  text_content?: string
  background_color?: string
  text_color?: string
  font_size?: number
  variant_count?: number
  created_at: number
}

export default function SlatesPage() {
  const router = useRouter()
  const [slates, setSlates] = useState<Slate[]>([])
  const [channels, setChannels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [mode, setMode] = useState<'upload' | 'generate'>('generate')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state for generated slate
  const [name, setName] = useState('')
  const [textContent, setTextContent] = useState('...back soon!')
  const [backgroundColor, setBackgroundColor] = useState('#000000')
  const [textColor, setTextColor] = useState('#FFFFFF')
  const [fontSize, setFontSize] = useState(48)
  const [duration, setDuration] = useState(10)
  const [channelId, setChannelId] = useState('')

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [slatesData, channelsData] = await Promise.all([
        api.listSlates(),
        api.listChannels()
      ])
      setSlates(slatesData.slates || [])
      setChannels(channelsData.channels || [])
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

  const handleGenerateSlate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    
    try {
      await api.generateSlate({
        name,
        text_content: textContent,
        background_color: backgroundColor,
        text_color: textColor,
        font_size: fontSize,
        duration,
        channel_id: channelId || undefined
      })
      
      showMessage('success', 'Slate generation started! It will be ready shortly.')
      setShowModal(false)
      resetForm()
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to generate slate')
    } finally {
      setSaving(false)
    }
  }

  const handleUploadSlate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!uploadFile) {
      showMessage('error', 'Please select a file')
      return
    }
    
    setSaving(true)
    
    try {
      await api.uploadSlate(uploadFile, uploadName, channelId || undefined)
      
      showMessage('success', 'Slate upload started! It will be transcoded shortly.')
      setShowModal(false)
      resetForm()
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to upload slate')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (slate: Slate) => {
    if (!confirm(`Delete slate "${slate.name}"?`)) return
    
    try {
      await api.deleteSlate(slate.id)
      showMessage('success', 'Slate deleted')
      loadData()
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to delete slate')
    }
  }

  const resetForm = () => {
    setName('')
    setTextContent('...back soon!')
    setBackgroundColor('#000000')
    setTextColor('#FFFFFF')
    setFontSize(48)
    setDuration(10)
    setChannelId('')
    setUploadFile(null)
    setUploadName('')
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'ready': return 'bg-green-100 text-green-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'transcoding': return 'bg-blue-100 text-blue-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Slate Management</h1>
              <p className="mt-2 text-gray-600">"We'll Be Right Back" videos for ad break padding</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + Create Slate
            </button>
          </div>

          {message && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : slates.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <p className="text-gray-600 mb-4">No slates yet. Create your first slate!</p>
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Create Slate
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {slates.map((slate) => (
                <div key={slate.id} className="bg-white shadow rounded-lg p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{slate.name}</h3>
                      <p className="text-sm text-gray-500">{slate.duration}s duration</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeColor(slate.status)}`}>
                      {slate.status}
                    </span>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Type:</span>
                      <span className="text-sm font-medium">{slate.slate_type === 'generated' ? '🎨 Generated' : '📹 Uploaded'}</span>
                    </div>
                    
                    {slate.slate_type === 'generated' && (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">Text:</span>
                          <span className="text-sm font-medium">{slate.text_content}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">Colors:</span>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded border" style={{ backgroundColor: slate.background_color }}></div>
                            <div className="w-6 h-6 rounded border" style={{ backgroundColor: slate.text_color }}></div>
                          </div>
                        </div>
                      </>
                    )}
                    
                    {slate.variant_count && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Variants:</span>
                        <span className="text-sm font-medium">{slate.variant_count}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(slate)}
                      className="flex-1 px-3 py-2 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Slate Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">Create Slate</h2>
              <div className="mt-4 flex gap-4">
                <button
                  onClick={() => setMode('generate')}
                  className={`px-4 py-2 rounded-md ${mode === 'generate' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  🎨 Generate with Text
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className={`px-4 py-2 rounded-md ${mode === 'upload' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  📹 Upload Video
                </button>
              </div>
            </div>

            {mode === 'generate' ? (
              <form onSubmit={handleGenerateSlate} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Slate Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Back Soon Slate"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Text Content *</label>
                  <input
                    type="text"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="...back soon!"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Background Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-12 h-10 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md font-mono"
                        placeholder="#000000"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Text Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="w-12 h-10 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md font-mono"
                        placeholder="#FFFFFF"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Font Size (px)</label>
                    <input
                      type="number"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value) || 48)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      min="12"
                      max="200"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Duration (seconds)</label>
                    <input
                      type="number"
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value) || 10)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      min="1"
                      max="60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Channel (optional)</label>
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Use default bitrates</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">Select a channel to match its bitrate ladder</p>
                </div>

                <div className="flex justify-end gap-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false)
                      resetForm()
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Generating...' : 'Generate Slate'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleUploadSlate} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Slate Name *</label>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Branded Slate"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Video File *</label>
                  <input
                    type="file"
                    accept="video/*,image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setUploadFile(file)
                        if (!uploadName) {
                          setUploadName(file.name.replace(/\.[^/.]+$/, ''))
                        }
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                  <p className="mt-1 text-sm text-gray-500">Supported: MP4, MOV, AVI, or images (JPG, PNG)</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Channel (optional)</label>
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Use default bitrates</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">Select a channel to match its bitrate ladder</p>
                </div>

                <div className="flex justify-end gap-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false)
                      resetForm()
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Uploading...' : 'Upload Slate'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
