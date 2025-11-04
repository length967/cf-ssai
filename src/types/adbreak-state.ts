/**
 * Ad Break State - Stored in KV for stateless manifest serving
 * 
 * Phase 1: Written by DO, read by Manifest Worker
 * Phase 2: Written by SCTE-35 Monitor Cron, read by Manifest Worker
 * Phase 3: Written by /cue API, read by Manifest Worker
 */

export interface AdBreakState {
  // Identity
  channelId: string;
  eventId: string;
  source: 'scte35' | 'manual' | 'scheduled';
  
  // Timing
  startTime: string; // ISO-8601 timestamp
  duration: number;  // seconds
  endTime: string;   // ISO-8601 timestamp
  
  // Ad Decision (pre-calculated)
  decision: AdDecision;
  
  // Metadata
  createdAt: string; // ISO-8601 timestamp
  
  // Optional SCTE-35 data (if source === 'scte35')
  scte35Data?: {
    pdt: string;
    signalType: string;
    eventId: string;
    segmentNumber?: number;
  };
}

export interface AdDecision {
  podId: string;
  items: AdItem[];
}

export interface AdItem {
  id: string;
  duration: number;
  variants: Record<string, string>; // bitrate → playlist URL
}

/**
 * Helper to generate KV key for ad break
 */
export function getAdBreakKey(channelId: string, eventId: string): string {
  return `adbreak:${channelId}:${eventId}`;
}

/**
 * Helper to check if ad break is currently active
 */
export function isAdBreakActive(state: AdBreakState, now: Date = new Date()): boolean {
  const start = new Date(state.startTime);
  const end = new Date(state.endTime);
  return now >= start && now <= end;
}

/**
 * Helper to calculate elapsed time since ad break started
 */
export function getElapsedSinceStart(state: AdBreakState, now: Date = new Date()): number {
  const start = new Date(state.startTime);
  return Math.max(0, (now.getTime() - start.getTime()) / 1000);
}

/**
 * Helper to get TTL for KV storage (duration + 60s buffer)
 */
export function getAdBreakTTL(duration: number): number {
  return Math.floor(duration) + 60;
}
