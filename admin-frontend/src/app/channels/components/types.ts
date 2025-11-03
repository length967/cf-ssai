export interface Channel {
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

export interface Organization {
  id: string
  name: string
  slug: string
  status: string
}

export interface Slate {
  id: string
  name: string
  slate_type: 'video' | 'generated'
  duration: number
  status: string
  text_content?: string
}

export interface ChannelFormData {
  name: string
  slug: string
  origin_url: string
  status: string
  mode: string
  scte35_enabled: boolean
  scte35_auto_insert: boolean
  tier: number
  vast_enabled: boolean
  vast_url: string
  vast_timeout_ms: number
  default_ad_duration: number
  ad_pod_base_url: string
  sign_host: string
  slate_id: string
  time_based_auto_insert: boolean
  segment_cache_max_age: number
  manifest_cache_max_age: number
  settings: {
    max_bitrate: number | null
    min_bitrate: number | null
    prefer_hls: boolean
  }
  bitrate_ladder: number[]
  bitrate_ladder_source: 'auto' | 'manual' | null
  detected_bitrates: number[]
}
