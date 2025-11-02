'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Navigation from '@/components/Navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, Play, Trash2, RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react'

type Variant = {
  bitrate: number
  bitrate_kbps: number
  bitrate_mbps: string
  url: string
  resolution?: string
}

type Ad = {
  id: string
  name: string
  description?: string
  duration: number
  source_key: string
  transcode_status: 'pending' | 'queued' | 'processing' | 'ready' | 'error'
  master_playlist_url?: string
  variants?: string
  variant_count?: number
  variant_bitrates?: number[]
  variants_detailed?: Variant[]
  error_message?: string
  original_filename: string
  file_size: number
  mime_type: string
  created_at: number
  updated_at: number
  transcoded_at?: number
  status: 'active' | 'archived'
  channel_id?: string
}

type Channel = {
  id: string
  name: string
  slug: string
  bitrate_ladder?: string
  bitrate_ladder_source?: 'auto' | 'manual'
}

type PlannedVariant = {
  bitrate: number
  resolution: string
  willUpscale: boolean
}

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [channelBitrates, setChannelBitrates] = useState<number[]>([])
  const [plannedVariants, setPlannedVariants] = useState<PlannedVariant[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
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

  const loadChannels = useCallback(async () => {
    try {
      const data = await api.listChannels()
      setChannels(data.channels || [])
    } catch (err) {
      console.error('Failed to load channels:', err)
    }
  }, [])

  useEffect(() => {
    loadAds()
    loadChannels()
    // Auto-refresh every 10 seconds for processing ads
    const interval = setInterval(() => {
      loadAds()
    }, 10000)
    return () => clearInterval(interval)
  }, [loadAds, loadChannels])

  // Load channel bitrates when channel is selected
  useEffect(() => {
    if (selectedChannelId) {
      const channel = channels.find(ch => ch.id === selectedChannelId)
      if (channel?.bitrate_ladder) {
        try {
          const bitrates = JSON.parse(channel.bitrate_ladder)
          setChannelBitrates(bitrates)
          
          // Calculate planned variants (simplified - would need source video analysis)
          const planned: PlannedVariant[] = bitrates.map((br: number) => ({
            bitrate: br,
            resolution: getResolutionForBitrate(br),
            willUpscale: false // Would need source analysis to determine
          }))
          setPlannedVariants(planned)
        } catch (e) {
          console.error('Failed to parse bitrate ladder:', e)
        }
      }
    } else {
      setChannelBitrates([])
      setPlannedVariants([])
    }
  }, [selectedChannelId, channels])

  const getResolutionForBitrate = (bitrateKbps: number): string => {
    if (bitrateKbps < 600) return '640x360'
    if (bitrateKbps < 1200) return '854x480'
    if (bitrateKbps < 2500) return '1280x720'
    return '1920x1080'
  }

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
    if (!selectedFile || !uploadName || !selectedChannelId) return

    try {
      setUploading(true)
      setUploadProgress(10)
      
      await api.uploadAd(selectedFile, uploadName, uploadDescription, selectedChannelId)
      
      setUploadProgress(100)
      setUploadModalOpen(false)
      setSelectedFile(null)
      setUploadName('')
      setUploadDescription('')
      setSelectedChannelId('')
      setMessage({ type: 'success', text: 'Ad uploaded successfully! Transcoding will take 1-2 minutes.' })
      loadAds()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Upload failed' })
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ad "${name}"?`)) return

    try {
      await api.deleteAd(id)
      setMessage({ type: 'success', text: 'Ad deleted successfully' })
      loadAds()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Delete failed' })
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="h-4 w-4" />
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'queued':
        return <Clock className="h-4 w-4" />
      case 'error':
        return <AlertCircle className="h-4 w-4" />
      default:
        return <Clock className="h-4 w-4" />
    }
  }

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'ready':
        return 'default'
      case 'processing':
        return 'secondary'
      case 'error':
        return 'destructive'
      default:
        return 'outline'
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
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Ad Library</h1>
            <p className="text-muted-foreground mt-2">
              Upload and manage your video commercials
            </p>
          </div>
          <Button onClick={() => setUploadModalOpen(true)} size="lg">
            <Upload className="mr-2 h-4 w-4" />
            Upload Ad
          </Button>
        </div>

        {/* Messages */}
        {message && (
          <Alert className="mb-6" variant={message.type === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => setMessage(null)}
            >
              ×
            </Button>
          </Alert>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p className="text-muted-foreground">Loading ads...</p>
          </div>
        ) : ads.length === 0 ? (
          <Card className="text-center py-12">
            <CardHeader>
              <div className="text-6xl mb-4">🎬</div>
              <CardTitle>No ads yet</CardTitle>
              <CardDescription>
                Upload your first video commercial to get started
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button onClick={() => setUploadModalOpen(true)} size="lg">
                <Upload className="mr-2 h-4 w-4" />
                Upload Ad
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ads.map((ad) => (
              <Card key={ad.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <CardTitle className="text-lg">{ad.name}</CardTitle>
                    <Badge variant={getStatusVariant(ad.transcode_status)} className="ml-2">
                      <span className="flex items-center gap-1">
                        {getStatusIcon(ad.transcode_status)}
                        {ad.transcode_status}
                      </span>
                    </Badge>
                  </div>
                  {ad.description && (
                    <CardDescription>{ad.description}</CardDescription>
                  )}
                </CardHeader>
                
                <CardContent className="flex-1 space-y-3">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">
                        {ad.duration > 0 ? formatDuration(ad.duration) : 'Processing...'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">File size</span>
                      <span className="font-medium">{formatFileSize(ad.file_size)}</span>
                    </div>
                  </div>

                  {/* Transcoded Variants */}
                  {ad.variant_count && ad.variant_count > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">Variants</span>
                          <Badge variant="secondary">{ad.variant_count}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {ad.variant_bitrates?.map((bitrate) => (
                            <Badge key={bitrate} variant="outline" className="text-xs">
                              {Math.round(bitrate / 1000)}k
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>

                <CardFooter className="gap-2">
                  {ad.transcode_status === 'ready' && (
                    <Button variant="default" size="sm" asChild className="flex-1">
                      <a href="/ad-pods">
                        <Play className="mr-1 h-3 w-3" />
                        Add to Pod
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(ad.id, ad.name)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Video Ad</DialogTitle>
            <DialogDescription>
              Select a channel and upload your video commercial
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* File Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
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
                  <p className="text-sm text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setSelectedFile(null)}
                  >
                    Choose different file
                  </Button>
                </div>
              ) : (
                <div>
                  <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">
                    Drag and drop your video here
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    or
                  </p>
                  <Label htmlFor="file-upload">
                    <Button variant="outline" asChild>
                      <span>Browse files</span>
                    </Button>
                  </Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <p className="text-xs text-muted-foreground mt-4">
                    Supported formats: MP4, MOV, AVI, etc.
                  </p>
                </div>
              )}
            </div>

            {/* Ad Details */}
            {selectedFile && (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Ad Name *</Label>
                    <Input
                      id="name"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      placeholder="e.g., Summer Sale 2025"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      placeholder="Brief description of the ad..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="channel">Target Channel *</Label>
                    <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                      <SelectTrigger id="channel">
                        <SelectValue placeholder="Select a channel..." />
                      </SelectTrigger>
                      <SelectContent>
                        {channels.map((ch) => (
                          <SelectItem key={ch.id} value={ch.id}>
                            {ch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The video will be transcoded to match this channel's bitrate ladder
                    </p>
                  </div>
                </div>

                {/* Preview Planned Variants */}
                {plannedVariants.length > 0 && (
                  <Alert>
                    <AlertDescription>
                      <div className="space-y-2">
                        <p className="font-medium">Will create {plannedVariants.length} variants:</p>
                        <div className="flex flex-wrap gap-2">
                          {plannedVariants.map((v) => (
                            <Badge key={v.bitrate} variant="secondary">
                              {v.bitrate}k → {v.resolution}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Upload Progress */}
                {uploading && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Uploading...</span>
                      <span className="font-medium">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} />
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadModalOpen(false)
                setSelectedFile(null)
                setUploadName('')
                setUploadDescription('')
                setSelectedChannelId('')
              }}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !uploadName || !selectedChannelId || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
