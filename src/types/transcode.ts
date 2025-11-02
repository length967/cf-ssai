// Shared types for parallel transcoding system

export interface TranscodeJob {
  adId: string;
  sourceKey: string;
  bitrates: number[];
  organizationId: string;
  channelId?: string;
  retryCount?: number;
  isOnDemand?: boolean;
}

export interface SegmentTranscodeJob {
  type: 'SEGMENT';
  adId: string;
  segmentId: number;
  startTime: number; // seconds
  duration: number; // seconds
  sourceKey: string;
  bitrates: number[];
  organizationId: string;
  channelId?: string;
  jobGroupId: string; // Same for all segments of one video
}

export interface AssemblyJob {
  type: 'ASSEMBLY';
  adId: string;
  segmentCount: number;
  jobGroupId: string;
  segmentPaths: string[]; // R2 paths to segment directories
  bitrates: number[];
  organizationId: string;
}

export type SegmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface SegmentInfo {
  id: number;
  status: SegmentStatus;
  retryCount: number;
  r2Path: string | null; // Directory path in R2 for this segment's output
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface TranscodeMetadata {
  adId: string;
  segmentCount: number;
  completedCount: number;
  failedCount: number;
  startTime: number;
  bitrates: number[];
  organizationId: string;
  channelId?: string;
  sourceKey: string;
}

export interface CoordinatorResponse {
  status: 'processing' | 'completed' | 'failed';
  failedCount?: number;
  segmentPaths?: string[];
}

export interface SegmentFailureResponse {
  shouldRetry: boolean;
  isJobFailed: boolean | CoordinatorResponse;
}
