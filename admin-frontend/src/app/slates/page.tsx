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
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, XCircle } from 'lucide-react'

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
            <Button
              onClick={() => setShowModal(true)}
              variant="default"
            >
              + Create Slate
            </Button>
          </div>

          {message && (
            <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-500 bg-green-50' : ''}>
              {message.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
              <AlertDescription className={message.type === 'success' ? 'text-green-600' : ''}>
                {message.text}
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : slates.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <p className="text-gray-600 mb-4">No slates yet. Create your first slate!</p>
              <Button
                onClick={() => setShowModal(true)}
                variant="default"
              >
                Create Slate
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {slates.map((slate) => (
                <Card key={slate.id}>
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{slate.name}</h3>
                        <p className="text-sm text-gray-500">{slate.duration}s duration</p>
                      </div>
                      <StatusBadge
                        status={slate.status as 'ready' | 'pending' | 'transcoding' | 'error'}
                      />
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
                      <Button
                        onClick={() => handleDelete(slate)}
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                      >
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Slate Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Slate</DialogTitle>
            <DialogDescription>
              <div className="mt-4 flex gap-4">
                <Button
                  onClick={() => setMode('generate')}
                  variant={mode === 'generate' ? 'default' : 'secondary'}
                  type="button"
                >
                  🎨 Generate with Text
                </Button>
                <Button
                  onClick={() => setMode('upload')}
                  variant={mode === 'upload' ? 'default' : 'secondary'}
                  type="button"
                >
                  📹 Upload Video
                </Button>
              </div>
            </DialogDescription>
          </DialogHeader>

            {mode === 'generate' ? (
              <form onSubmit={handleGenerateSlate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="slate-name">Slate Name *</Label>
                  <Input
                    id="slate-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Back Soon Slate"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="text-content">Text Content *</Label>
                  <Input
                    id="text-content"
                    type="text"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="...back soon!"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bg-color">Background Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-12 h-10 border border-gray-300 rounded"
                      />
                      <Input
                        id="bg-color"
                        type="text"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="flex-1 font-mono"
                        placeholder="#000000"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="text-color">Text Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="w-12 h-10 border border-gray-300 rounded"
                      />
                      <Input
                        id="text-color"
                        type="text"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="flex-1 font-mono"
                        placeholder="#FFFFFF"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="font-size">Font Size (px)</Label>
                    <Input
                      id="font-size"
                      type="number"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value) || 48)}
                      min="12"
                      max="200"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="duration">Duration (seconds)</Label>
                    <Input
                      id="duration"
                      type="number"
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value) || 10)}
                      min="1"
                      max="60"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="channel">Channel (optional)</Label>
                  <Select value={channelId} onValueChange={setChannelId}>
                    <SelectTrigger id="channel">
                      <SelectValue placeholder="Use default bitrates" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Use default bitrates</SelectItem>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">Select a channel to match its bitrate ladder</p>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowModal(false)
                      resetForm()
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    variant="default"
                  >
                    {saving ? 'Generating...' : 'Generate Slate'}
                  </Button>
                </DialogFooter>
              </form>
            ) : (
              <form onSubmit={handleUploadSlate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="upload-name">Slate Name *</Label>
                  <Input
                    id="upload-name"
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="Branded Slate"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="video-file">Video File *</Label>
                  <Input
                    id="video-file"
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
                    required
                  />
                  <p className="text-sm text-muted-foreground">Supported: MP4, MOV, AVI, or images (JPG, PNG)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="upload-channel">Channel (optional)</Label>
                  <Select value={channelId} onValueChange={setChannelId}>
                    <SelectTrigger id="upload-channel">
                      <SelectValue placeholder="Use default bitrates" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Use default bitrates</SelectItem>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">Select a channel to match its bitrate ladder</p>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowModal(false)
                      resetForm()
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    variant="default"
                  >
                    {saving ? 'Uploading...' : 'Upload Slate'}
                  </Button>
                </DialogFooter>
              </form>
            )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
