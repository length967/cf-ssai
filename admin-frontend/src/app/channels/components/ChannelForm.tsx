'use client'

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BitrateDetector } from "@/components/BitrateDetector"
import { ChannelFormData, Slate } from "./types"

interface ChannelFormProps {
  data: ChannelFormData
  onChange: (data: ChannelFormData) => void
  slates: Slate[]
  isEditing: boolean
}

export function ChannelForm({ data, onChange, slates, isEditing }: ChannelFormProps) {
  const updateField = <K extends keyof ChannelFormData>(field: K, value: ChannelFormData[K]) => {
    onChange({ ...data, [field]: value })
  }

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel Name *</Label>
            <Input
              id="channel-name"
              value={data.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="My Channel"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-slug">Slug *</Label>
            <Input
              id="channel-slug"
              value={data.slug}
              onChange={(e) => updateField('slug', e.target.value)}
              placeholder="my-channel"
              required
              disabled={isEditing}
            />
            <p className="text-sm text-muted-foreground">URL-friendly identifier</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="origin-url">Origin URL *</Label>
          <Input
            id="origin-url"
            value={data.origin_url}
            onChange={(e) => updateField('origin_url', e.target.value)}
            placeholder="https://origin.example.com/hls/channel"
            required
          />
          <p className="text-sm text-muted-foreground">Base URL of your origin HLS stream</p>
        </div>

        <div className="grid grid-cols-2 gap-6 mt-4">
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={data.status} onValueChange={(value) => updateField('status', value)}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">Mode</Label>
            <Select value={data.mode} onValueChange={(value) => updateField('mode', value)}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (SCTE-35 or SGAI)</SelectItem>
                <SelectItem value="sgai">SGAI Only</SelectItem>
                <SelectItem value="ssai">SSAI Only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">Ad insertion mode</p>
          </div>
        </div>
      </div>

      {/* Bitrate Configuration */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Bitrate Configuration</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Detect and configure bitrate variants for this channel. Ads will be transcoded to match these exact bitrates.
        </p>
        <BitrateDetector
          originUrl={data.origin_url}
          bitrateLadder={data.bitrate_ladder}
          bitrateSource={data.bitrate_ladder_source}
          onBitratesDetected={(bitrates, source) => {
            onChange({
              ...data,
              bitrate_ladder: bitrates,
              bitrate_ladder_source: source,
              detected_bitrates: bitrates
            })
          }}
          onBitratesChanged={(bitrates, source) => {
            onChange({
              ...data,
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
              checked={data.scte35_enabled}
              onChange={(e) => updateField('scte35_enabled', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm">Enable SCTE-35 Detection</span>
          </label>
          <p className="text-sm text-muted-foreground">Detect ad breaks from SCTE-35 markers in the stream</p>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={data.scte35_auto_insert}
              onChange={(e) => updateField('scte35_auto_insert', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={!data.scte35_enabled}
            />
            <span className="ml-2 text-sm">Auto-Insert Ads on SCTE-35 Signals</span>
          </label>
          <p className="text-sm text-muted-foreground">Automatically trigger ad insertion when SCTE-35 markers are detected</p>

          <div className="space-y-2">
            <Label htmlFor="tier">Authorization Tier (SCTE-35 Filtering)</Label>
            <Select value={data.tier.toString()} onValueChange={(value) => updateField('tier', parseInt(value))}>
              <SelectTrigger id="tier" disabled={!data.scte35_enabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No restrictions (0x000) - All ads allowed</SelectItem>
                <SelectItem value="1">Tier 1 (0x001) - Basic subscribers</SelectItem>
                <SelectItem value="2">Tier 2 (0x002) - Premium subscribers</SelectItem>
                <SelectItem value="3">Tier 3 (0x003) - VIP subscribers</SelectItem>
                <SelectItem value="4">Tier 4 (0x004) - Custom tier</SelectItem>
                <SelectItem value="5">Tier 5 (0x005) - Custom tier</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Only insert ads from SCTE-35 signals matching this tier level. Set to 0 to allow all ads.
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
              checked={data.time_based_auto_insert}
              onChange={(e) => updateField('time_based_auto_insert', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm">Time-Based Auto-Insert</span>
          </label>
          <p className="text-sm text-muted-foreground">Insert ads at scheduled intervals for testing</p>
        </div>
      </div>

      {/* Cache Configuration */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Cache Configuration</h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="segment-cache">Segment Cache Max-Age (seconds)</Label>
            <Input
              id="segment-cache"
              type="number"
              value={data.segment_cache_max_age}
              onChange={(e) => updateField('segment_cache_max_age', parseInt(e.target.value) || 60)}
              min="1"
              max="300"
            />
            <p className="text-sm text-muted-foreground">How long browsers cache video segments (60-120 recommended for Safari)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manifest-cache">Manifest Cache Max-Age (seconds)</Label>
            <Input
              id="manifest-cache"
              type="number"
              value={data.manifest_cache_max_age}
              onChange={(e) => updateField('manifest_cache_max_age', parseInt(e.target.value) || 4)}
              min="1"
              max="30"
            />
            <p className="text-sm text-muted-foreground">How long browsers cache the manifest (3-6 recommended for live streams)</p>
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
              checked={data.vast_enabled}
              onChange={(e) => updateField('vast_enabled', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-2 text-sm">Enable VAST Integration</span>
          </label>

          {data.vast_enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="vast-url">VAST URL</Label>
                <Input
                  id="vast-url"
                  value={data.vast_url}
                  onChange={(e) => updateField('vast_url', e.target.value)}
                  placeholder="https://example.com/vast.xml"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="vast-timeout">VAST Timeout (ms)</Label>
                <Input
                  id="vast-timeout"
                  type="number"
                  value={data.vast_timeout_ms}
                  onChange={(e) => updateField('vast_timeout_ms', parseInt(e.target.value))}
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
          <div className="space-y-2">
            <Label htmlFor="default-ad-duration">Default Ad Duration (sec)</Label>
            <Input
              id="default-ad-duration"
              type="number"
              value={data.default_ad_duration}
              onChange={(e) => updateField('default_ad_duration', parseInt(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slate-video">Slate Video</Label>
            <Select value={data.slate_id || "none"} onValueChange={(value) => updateField('slate_id', value === "none" ? "" : value)}>
              <SelectTrigger id="slate-video">
                <SelectValue placeholder="No slate (use ad pod fallback)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No slate (use ad pod fallback)</SelectItem>
                {slates.filter(s => s.status === 'ready').map(slate => (
                  <SelectItem key={slate.id} value={slate.id}>
                    {slate.name} ({slate.slate_type} - {slate.duration}s)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Select a slate video to pad ad breaks when ads are shorter than SCTE-35 duration.
              {slates.length === 0 && (
                <span className="text-blue-600"> No slates available - create one in the Slates section.</span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="ad-pod-base-url">Ad Pod Base URL</Label>
          <Input
            id="ad-pod-base-url"
            value={data.ad_pod_base_url}
            onChange={(e) => updateField('ad_pod_base_url', e.target.value)}
            placeholder="https://ads.example.com/pods"
          />
          <p className="text-sm text-muted-foreground">Base URL for ad pod assets (leave empty to use global default)</p>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="sign-host">Sign Host</Label>
          <Input
            id="sign-host"
            value={data.sign_host}
            onChange={(e) => updateField('sign_host', e.target.value)}
            placeholder="media.example.com"
          />
          <p className="text-sm text-muted-foreground">Host used for URL signing (leave empty to use global default)</p>
        </div>
      </div>
    </div>
  )
}
