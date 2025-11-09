export type ViewerJWT = {
    sub: string
    ent?: string[]
    consent?: { tcf?: string }
    geo?: { country?: string }
    bucket?: string // A/B or feature bucket
    exp: number
  }
  
  export type AdItem = {
    adId: string
    bitrate: number
    playlistUrl: string
    tracking?: { impression?: string[], quartiles?: Record<"25"|"50"|"75"|"100", string[]> }
  }
  
  export type AdPod = {
    podId: string
    items: AdItem[]         // one item per bitrate rendition (or map)
    durationSec: number
  }
  
  export type DecisionResponse = {
    pod: AdPod
  }
  
  export type ChannelPhase = "IDLE" | "PENDING_BREAK" | "IN_BREAK"
  
  export type ChannelState = {
    channelId: string
    phase: ChannelPhase
    // live timing
    latestPDT?: string
    segmentDurationSec: number
    discontinuitySeq: number
    // current or next break
    breakId?: string
    breakStartPDT?: string
    breakDurationSec?: number
    pod?: AdPod
    adPodHash?: string
    // housekeeping
    lastUpdated: number
  }
  
  // Beacon queue message types
  export type BeaconEvent = "imp" | "quartile" | "complete" | "error" | "start"
  
  export type BeaconMessage = {
    event: BeaconEvent
    adId: string
    podId?: string
    channel?: string
    ts: number
    trackerUrls: string[]
    metadata?: {
      variant?: string
      bitrate?: number
      viewerId?: string
      vastAdId?: string
      creativeId?: string
      [key: string]: any
    }
    tracking?: {
      clickThrough?: string
      errorTracking?: string[]
    }
  }

  // SCTE-35 Signal Types
  export type Scte35SpliceType = "OUT" | "IN"

  export interface Scte35Event {
    id: string
    type: Scte35SpliceType
    pts90k: number
    breakDuration90k?: number
    rawHex: string
    continuityCounter: number
    crcValid: boolean
    recvAtMs: number
    tier?: number
    segmentationTypeId?: number
    segmentationTypeName?: string
    spliceEventId?: number
    segmentationEventId?: number
  }

  export type SCTE35SignalType = "splice_insert" | "time_signal" | "return_signal"
  
  export type SCTE35SegmentationType = 
    | "Provider Ad"
    | "Distributor Ad" 
    | "Program Start"
    | "Program End"
    | "Chapter Start"
    | "Break Start"
    | "Break End"
    | "Unscheduled Event"
  
  export type SCTE35Signal = {
    id: string
    type: SCTE35SignalType
    pts?: number  // Presentation timestamp (from binary or X-PTS)
    duration?: number  // In seconds
    segmentationType?: SCTE35SegmentationType
    upid?: string  // Unique program ID
    breakDuration?: number
    autoReturn?: boolean
    segmentNum?: number
    segmentsExpected?: number
    rawHex?: string
    pts90k?: number
    breakDuration90k?: number
    // Enhanced binary data (when parsed from SCTE35-CMD)
    binaryData?: {
      spliceEventId?: number
      protocolVersion?: number
      ptsAdjustment?: bigint
      crcValid?: boolean
      tier?: number
      cwIndex?: number
      encryptedPacket?: boolean
      encryptionAlgorithm?: number
      segmentationDescriptors?: any[]  // Full segmentation descriptor data
      tier?: number
      deliveryRestrictions?: {
        webAllowed?: boolean
        noRegionalBlackout?: boolean
        archiveAllowed?: boolean
        deviceRestrictions?: number
      }
    }
    // Preserve raw manifest metadata for reinjection
    rawAttributes?: Record<string, string>
    rawCommand?: string
  }
  
  export type SCTE35Context = {
    signal: SCTE35Signal
    detectedAt: number
    channel: string
    variant: string
  }

  export type Scte35EventCommandType =
    | "splice_insert"
    | "time_signal"
    | "bandwidth_reservation"
    | "private_command"
    | "reserved"

  export type Scte35Event = {
    programNumber?: number
    pid: number
    eventId: string
    commandType: Scte35EventCommandType
    commandTypeId: number
    spliceEventId?: number
    spliceEventCancelIndicator?: boolean
    outOfNetworkIndicator?: boolean
    programSpliceFlag?: boolean
    durationFlag?: boolean
    spliceImmediateFlag?: boolean
    breakDurationSeconds?: number
    autoReturn?: boolean
    segmentationDurationSeconds?: number
    pts?: number
    ptsSeconds?: number
    ptsAdjustment?: number
    protocolVersion?: number
    cwIndex?: number
    tier?: number
    segmentationEventId?: number
    segmentationTypeId?: number
    segmentationTypeName?: string
    segmentNum?: number
    segmentsExpected?: number
    subSegmentNum?: number
    subSegmentsExpected?: number
    upidType?: number
    upid?: string
    deliveryRestrictions?: {
      webAllowed?: boolean
      noRegionalBlackout?: boolean
      archiveAllowed?: boolean
      deviceRestrictions?: number
    }
    continuityCounters: number[]
    raw: string
    rawHex: string
    crc32?: number
    crcValid?: boolean
    encrypted?: boolean
    encryptionAlgorithm?: number
    ingestTimestamp: number
  }

  // VAST Types
  export type VASTVersion = "3.0" | "4.0" | "4.1" | "4.2"
  
  export type VASTMediaFile = {
    url: string
    delivery: "progressive" | "streaming"
    type: string  // "video/mp4", "application/vnd.apple.mpegurl"
    width?: number
    height?: number
    bitrate?: number
    codec?: string
    maintainAspectRatio?: boolean
    scalable?: boolean
  }
  
  export type VASTTrackingEvent = "start" | "firstQuartile" | "midpoint" | "thirdQuartile" | 
    "complete" | "impression" | "mute" | "unmute" | "pause" | "resume" | 
    "rewind" | "skip" | "playerExpand" | "playerCollapse" | "error"
  
  export type VASTTracking = {
    event: VASTTrackingEvent
    url: string
    offset?: string  // For time-based events
  }
  
  export type VASTCompanion = {
    id?: string
    width: number
    height: number
    assetWidth?: number
    assetHeight?: number
    staticResource?: { url: string; creativeType: string }
    iframeResource?: string
    htmlResource?: string
    companionClickThrough?: string
    tracking?: VASTTracking[]
  }
  
  export type VASTCreative = {
    id: string
    sequence?: number
    adId?: string
    mediaFiles: VASTMediaFile[]
    trackingEvents: VASTTracking[]
    duration?: number  // In seconds
    videoClicks?: {
      clickThrough?: string
      clickTracking?: string[]
      customClick?: string[]
    }
    companions?: VASTCompanion[]
  }
  
  export type VASTWrapper = {
    vastAdTagURI: string
    fallbackOnNoAd?: boolean
    followAdditionalWrappers?: boolean
    allowMultipleAds?: boolean
  }
  
  export type VASTAd = {
    id: string
    sequence?: number
    version: VASTVersion
    adSystem?: string
    adTitle?: string
    description?: string
    advertiser?: string
    pricing?: string
    survey?: string
    creatives: VASTCreative[]
    wrapper?: VASTWrapper  // For VAST wrappers
    errorTracking?: string[]
    impressionTracking?: string[]
  }
  
  export type VASTResponse = {
    ads: VASTAd[]
    version: VASTVersion
    errors?: string[]
  }
  
  export type VASTParseRequest = {
    vastUrl?: string
    vastXML?: string
    durationSec: number
    maxWrapperDepth?: number
  }
  
  export type VASTParseResponse = {
    pod: AdPod
    tracking: {
      impressions: string[]
      quartiles: Record<"start" | "firstQuartile" | "midpoint" | "thirdQuartile" | "complete", string[]>
      clicks?: string[]
      errors?: string[]
    }
    vastResponse: VASTResponse
  }