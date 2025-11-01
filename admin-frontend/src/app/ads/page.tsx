'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'

type Ad = {
  id: string
  name: string
  description?: string
  duration: number
  source_key: string
  transcode_status: 'pending' | 'queued' | 'processing' | 'ready' | 'error'
  master_playlist_url?: string
  variants?: string
  error_message?: string
  original_filename: string
  file_size: number
  mime_type: string
  created_at: number
  updated_at: number
  transcoded_at?: number
  status: 'active' | 'archived'
}

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadAds = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.listAds()
      setAds(data.ads || [])
    } catch (err) {
      console.error('Failed to load ads:', err)
      setMessage({ type: 'error', text: 'Failed to load ads' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAds()
    // Auto-refresh every 10 seconds for processing ads
    const interval = setInterval(() => {
      loadAds()
    }, 10000)
    return () => clearInterval(interval)
  }, [loadAds])

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files && files[0]) {
      setSelectedFile(files[0])
      setUploadName(files[0].name.replace(/\.[^/.]+$/, ''))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files[0]) {
      setSelectedFile(files[0])
      setUploadName(files[0].name.replace(/\.[^/.]+$/, ''))
    }
  }

  const handleUpload = async () => {
    if (!selectedFile || !uploadName) return

    try {
      setUploading(true)
      await api.uploadAd(selectedFile, uploadName, uploadDescription)
      setUploadModalOpen(false)
      setSelectedFile(null)
      setUploadName('')
      setUploadDescription('')
      setMessage({ type: 'success', text: 'Ad uploaded successfully! Processing will take a few minutes.' })
      loadAds()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ad "${name}"? This will also delete it from Cloudflare Stream.`)) return

    try {
      await api.deleteAd(id)
      setMessage({ type: 'success', text: 'Ad deleted successfully' })
      loadAds()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Delete failed' })
    }
  }

  const handleRefresh = async (id: string) => {
    try {
      await api.refreshAdStatus(id)
      setMessage({ type: 'success', text: 'Status refreshed' })
      loadAds()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Refresh failed' })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <span className="px-3 py-1 text-sm font-semibold rounded-full bg-green-500 text-white">✓ READY TO USE</span>
      case 'processing':
        return <span className="px-3 py-1 text-sm font-semibold rounded-full bg-blue-500 text-white animate-pulse">⏳ TRANSCODING...</span>
      case 'queued':
        return <span className="px-3 py-1 text-sm font-semibold rounded-full bg-yellow-500 text-white">⏱️ QUEUED</span>
      case 'error':
        return <span className="px-3 py-1 text-sm font-semibold rounded-full bg-red-500 text-white">✗ ERROR</span>
      default:
        return <span className="px-3 py-1 text-sm font-semibold rounded-full bg-gray-400 text-white">⋯ PENDING</span>
    }
  }

  const getStatusMessage = (status: string, errorMessage?: string) => {
    switch (status) {
      case 'ready':
        return '🎉 Video is transcoded and ready! You can now add this to an Ad Pod.'
      case 'processing':
        return '⏳ FFmpeg is transcoding your video to HLS. This usually takes 30-60 seconds depending on length. The page auto-refreshes every 10 seconds.'
      case 'queued':
        return '⏱️ Your video is queued for transcoding. It will start shortly.'
      case 'error':
        return `❌ Transcoding error: ${errorMessage || 'Unknown error'}. Please try uploading again.`
      default:
        return '📤 Upload initiated. Waiting for transcode to begin.'
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Ads Library</h1>
            <p className="text-gray-600 mt-1">Upload and manage your video commercials</p>
          </div>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            📤 Upload Ad
          </button>
        </div>

        {/* Messages */}
        {message && (
          <div className={`mb-6 p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            <button onClick={() => setMessage(null)} className="float-right text-xl">&times;</button>
            {message.text}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading ads...</p>
          </div>
        ) : ads.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🎬</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No ads yet</h3>
            <p className="text-gray-600 mb-6">Upload your first video commercial to get started</p>
            <button
              onClick={() => setUploadModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              📤 Upload Ad
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ads.map((ad) => (
              <div key={ad.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="w-full h-48 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-6xl">
                  🎬
                </div>
                
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 flex-1">{ad.name}</h3>
                  </div>
                  
                  {/* Status Badge - More Prominent */}
                  <div className="mb-3 flex justify-center">
                    {getStatusBadge(ad.transcode_status)}
                  </div>
                  
                  {/* Status Message */}
                  <div className={`text-xs p-2 rounded mb-3 ${
                    ad.transcode_status === 'ready' ? 'bg-green-50 text-green-800' :
                    ad.transcode_status === 'error' ? 'bg-red-50 text-red-800' :
                    'bg-blue-50 text-blue-800'
                  }`}>
                    {getStatusMessage(ad.transcode_status, ad.error_message)}
                  </div>
                  
                  {ad.description && (
                    <p className="text-sm text-gray-600 mb-3">{ad.description}</p>
                  )}
                  
                  <div className="space-y-1 text-sm text-gray-500 mb-4">
                    <div>⏱️ Duration: {ad.duration > 0 ? formatDuration(ad.duration) : 'Processing...'}</div>
                    <div>💾 File size: {formatFileSize(ad.file_size)}</div>
                    <div className="truncate">📄 {ad.original_filename}</div>
                    {ad.master_playlist_url && (
                      <div className="pt-2 border-t">
                        <a 
                          href={ad.master_playlist_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline truncate"
                        >
                          🔗 View HLS URL →
                        </a>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    {(ad.transcode_status === 'processing' || ad.transcode_status === 'queued') && (
                      <button 
                        onClick={() => handleRefresh(ad.id)}
                        className="flex-1 px-3 py-1 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
                      >
                        🔄 Refresh Status
                      </button>
                    )}
                    {ad.transcode_status === 'ready' && (
                      <a
                        href="/ad-pods"
                        className="flex-1 px-3 py-1 text-sm text-center bg-green-600 text-white rounded-md hover:bg-green-700"
                      >
                        ➕ Add to Ad Pod
                      </a>
                    )}
                    <button 
                      onClick={() => handleDelete(ad.id, ad.name)}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Upload Video Ad</h2>
                <button 
                  onClick={() => {
                    setUploadModalOpen(false)
                    setSelectedFile(null)
                    setUploadName('')
                    setUploadDescription('')
                  }}
                  className="text-2xl text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </div>
              
              <div className="space-y-6">
                {/* File Drop Zone */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  {selectedFile ? (
                    <div>
                      <div className="text-6xl mb-2">🎬</div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
                      <button
                        onClick={() => setSelectedFile(null)}
                        className="mt-4 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Choose different file
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="text-6xl mb-4">📤</div>
                      <p className="text-lg font-medium mb-2">
                        Drag and drop your video here
                      </p>
                      <p className="text-sm text-gray-500 mb-4">
                        or
                      </p>
                      <label htmlFor="file-upload" className="cursor-pointer">
                        <span className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 inline-block">
                          Browse files
                        </span>
                      </label>
                      <input
                        id="file-upload"
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <p className="text-xs text-gray-500 mt-4">
                        Supported formats: MP4, MOV, AVI, etc.
                      </p>
                    </div>
                  )}
                </div>

                {/* Ad Details */}
                {selectedFile && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Ad Name *
                      </label>
                      <input
                        type="text"
                        value={uploadName}
                        onChange={(e) => setUploadName(e.target.value)}
                        placeholder="e.g., Summer Sale 2025"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description (Optional)
                      </label>
                      <textarea
                        value={uploadDescription}
                        onChange={(e) => setUploadDescription(e.target.value)}
                        placeholder="Brief description of the ad..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    onClick={() => {
                      setUploadModalOpen(false)
                      setSelectedFile(null)
                      setUploadName('')
                      setUploadDescription('')
                    }}
                    disabled={uploading}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || !uploadName || uploading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploading ? (
                      <>
                        <span className="inline-block animate-spin mr-2">⏳</span>
                        Uploading...
                      </>
                    ) : (
                      <>
                        📤 Upload to Cloudflare Stream
                      </>
                    )}
                  </button>
                </div>
                
                {uploading && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-4">
                    <p className="text-sm text-blue-800">
                      <strong>Uploading to Cloudflare Stream...</strong>
                      <br />
                      Your video will be automatically transcoded into multiple bitrates for optimal playback.
                      This may take a few minutes depending on the file size.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
