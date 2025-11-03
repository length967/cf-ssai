'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ChannelForm } from "./ChannelForm"
import { Channel, ChannelFormData, Organization, Slate } from "./types"

interface ChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel?: Channel
  organization?: Organization | null
  slates: Slate[]
  onSave: (data: ChannelFormData) => Promise<void>
  onShowMessage: (type: 'success' | 'error', text: string) => void
}

export function ChannelDialog({
  open,
  onOpenChange,
  channel,
  organization,
  slates,
  onSave,
  onShowMessage
}: ChannelDialogProps) {
  const [formData, setFormData] = useState<ChannelFormData>({
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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (channel) {
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
    } else {
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
    }
  }, [channel, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.slug || !formData.origin_url) {
      onShowMessage('error', 'Name, slug, and origin URL are required')
      return
    }

    setSaving(true)
    try {
      await onSave(formData)
      onOpenChange(false)
    } catch (error: any) {
      onShowMessage('error', error.message || 'Failed to save channel')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{channel ? 'Edit Channel' : 'Create New Channel'}</DialogTitle>
          <DialogDescription>
            {channel ? 'Update channel configuration' : 'Configure a new streaming channel'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {/* Playback URL - Only shown when editing */}
          {channel && organization && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold mb-2 text-blue-900">Stream Playback URL</h3>
              <p className="text-sm text-blue-700 mb-3">
                Use this URL to watch your live stream with server-side ad insertion:
              </p>
              <div className="bg-white border border-blue-300 rounded-md p-3 font-mono text-sm break-all">
                https://cf-ssai.mediamasters.workers.dev/{organization.slug}/{channel.slug}/master.m3u8
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    const url = `https://cf-ssai.mediamasters.workers.dev/${organization.slug}/${channel.slug}/master.m3u8`
                    navigator.clipboard.writeText(url)
                    onShowMessage('success', 'URL copied to clipboard!')
                  }}
                  variant="default"
                  size="sm"
                >
                  Copy URL
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const url = `https://cf-ssai.mediamasters.workers.dev/${organization.slug}/${channel.slug}/master.m3u8`
                    window.open(url, '_blank')
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Open in Browser
                </Button>
              </div>
              <p className="mt-3 text-xs text-blue-600">
                Tip: Test this URL in VLC, Safari, or any HLS-compatible player
              </p>
            </div>
          )}

          <ChannelForm
            data={formData}
            onChange={setFormData}
            slates={slates}
            isEditing={!!channel}
          />

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : channel ? 'Update Channel' : 'Create Channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
