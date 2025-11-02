// Transcode Coordinator Durable Object
// Manages state for parallel segment transcoding jobs
// Ephemeral coordination - state auto-cleans after job completion

import type { 
  SegmentInfo, 
  TranscodeMetadata, 
  CoordinatorResponse, 
  SegmentFailureResponse 
} from './types/transcode';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  TRANSCODE_QUEUE: Queue;
  R2_PUBLIC_URL: string;
}

export class TranscodeCoordinatorDO {
  private state: DurableObjectState;
  private env: Env;
  private segments: Map<number, SegmentInfo>;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.segments = new Map();
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      // Initialize new transcode job
      if (path === '/init' && request.method === 'POST') {
        const data = await request.json<{
          adId: string;
          segmentCount: number;
          bitrates: number[];
          organizationId: string;
          channelId?: string;
          sourceKey: string;
        }>();
        
        await this.initJob(
          data.segmentCount,
          data.adId,
          data.bitrates,
          data.organizationId,
          data.sourceKey,
          data.channelId
        );
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Mark segment as completed
      if (path === '/segment-completed' && request.method === 'POST') {
        const data = await request.json<{ segmentId: number; r2Path: string }>();
        const result = await this.markSegmentCompleted(data.segmentId, data.r2Path);
        
        return new Response(JSON.stringify(result || { status: 'processing' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Mark segment as failed
      if (path === '/segment-failed' && request.method === 'POST') {
        const data = await request.json<{ segmentId: number; error: string }>();
        const result = await this.markSegmentFailed(data.segmentId, data.error);
        
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Get current status (for admin dashboard)
      if (path === '/status' && request.method === 'GET') {
        const status = await this.getStatus();
        
        return new Response(JSON.stringify(status), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response('Not found', { status: 404 });
      
    } catch (error: any) {
      console.error('[TranscodeCoordinatorDO] Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  async initJob(
    segmentCount: number,
    adId: string,
    bitrates: number[],
    organizationId: string,
    sourceKey: string,
    channelId?: string
  ): Promise<void> {
    console.log(`[TranscodeCoordinatorDO] Initializing job for ad ${adId} with ${segmentCount} segments`);
    
    // Initialize segment tracking
    this.segments.clear();
    for (let i = 0; i < segmentCount; i++) {
      this.segments.set(i, {
        id: i,
        status: 'pending',
        retryCount: 0,
        r2Path: null
      });
    }
    
    // Store metadata for recovery and assembly
    const metadata: TranscodeMetadata = {
      adId,
      segmentCount,
      completedCount: 0,
      failedCount: 0,
      startTime: Date.now(),
      bitrates,
      organizationId,
      channelId,
      sourceKey
    };
    
    await this.state.storage.put('metadata', metadata);
    
    // Store segment map (for recovery after hibernation)
    await this.syncSegmentsToStorage();
    
    console.log(`[TranscodeCoordinatorDO] Job initialized for ad ${adId}`);
  }
  
  async markSegmentCompleted(segmentId: number, r2Path: string): Promise<CoordinatorResponse | null> {
    const segment = this.segments.get(segmentId);
    if (!segment) {
      throw new Error(`Unknown segment ${segmentId}`);
    }
    
    segment.status = 'completed';
    segment.r2Path = r2Path;
    segment.completedAt = Date.now();
    
    const metadata = await this.state.storage.get<TranscodeMetadata>('metadata');
    if (!metadata) {
      throw new Error('Metadata not found');
    }
    
    metadata.completedCount++;
    await this.state.storage.put('metadata', metadata);
    await this.syncSegmentsToStorage();
    
    console.log(`[TranscodeCoordinatorDO] Segment ${segmentId} completed (${metadata.completedCount}/${metadata.segmentCount})`);
    
    // Check if entire job is complete
    return this.checkCompletion();
  }
  
  async markSegmentFailed(segmentId: number, error: string): Promise<SegmentFailureResponse> {
    const segment = this.segments.get(segmentId);
    if (!segment) {
      throw new Error(`Unknown segment ${segmentId}`);
    }
    
    segment.retryCount++;
    segment.error = error;
    
    const MAX_RETRIES = 3;
    
    if (segment.retryCount >= MAX_RETRIES) {
      // Permanent failure
      segment.status = 'failed';
      
      const metadata = await this.state.storage.get<TranscodeMetadata>('metadata');
      if (!metadata) {
        throw new Error('Metadata not found');
      }
      
      metadata.failedCount++;
      await this.state.storage.put('metadata', metadata);
      await this.syncSegmentsToStorage();
      
      console.error(`[TranscodeCoordinatorDO] Segment ${segmentId} permanently failed after ${MAX_RETRIES} attempts`);
      
      const completionResult = await this.checkCompletion();
      
      return { 
        shouldRetry: false, 
        isJobFailed: completionResult || false 
      };
    }
    
    segment.status = 'retrying';
    await this.syncSegmentsToStorage();
    
    console.log(`[TranscodeCoordinatorDO] Segment ${segmentId} will retry (attempt ${segment.retryCount + 1}/${MAX_RETRIES})`);
    
    return { shouldRetry: true, isJobFailed: false };
  }
  
  private async checkCompletion(): Promise<CoordinatorResponse | null> {
    const metadata = await this.state.storage.get<TranscodeMetadata>('metadata');
    if (!metadata) {
      throw new Error('Metadata not found');
    }
    
    const totalProcessed = metadata.completedCount + metadata.failedCount;
    
    if (totalProcessed === metadata.segmentCount) {
      if (metadata.failedCount > 0) {
        // Job failed
        console.error(`[TranscodeCoordinatorDO] Job failed for ad ${metadata.adId}: ${metadata.failedCount} segment(s) failed`);
        await this.notifyFailure(metadata);
        await this.scheduleCleanup();
        
        return { status: 'failed', failedCount: metadata.failedCount };
        
      } else {
        // Job succeeded - trigger assembly
        console.log(`[TranscodeCoordinatorDO] Job completed successfully for ad ${metadata.adId}, triggering assembly`);
        const segmentPaths = this.getCompletedSegments();
        await this.triggerAssembly(metadata, segmentPaths);
        
        return { status: 'completed', segmentPaths };
      }
    }
    
    // Still processing
    return null;
  }
  
  private getCompletedSegments(): string[] {
    return Array.from(this.segments.values())
      .filter(s => s.status === 'completed')
      .sort((a, b) => a.id - b.id)
      .map(s => s.r2Path!);
  }
  
  private async triggerAssembly(metadata: TranscodeMetadata, segmentPaths: string[]): Promise<void> {
    // Update ad status in D1
    await this.env.DB.prepare(`
      UPDATE ads
      SET transcode_status = 'assembling',
          updated_at = ?
      WHERE id = ?
    `).bind(Date.now(), metadata.adId).run();
    
    // Queue assembly job
    await this.env.TRANSCODE_QUEUE.send({
      type: 'ASSEMBLY',
      adId: metadata.adId,
      segmentCount: metadata.segmentCount,
      jobGroupId: this.state.id.toString(),
      segmentPaths,
      bitrates: metadata.bitrates,
      organizationId: metadata.organizationId
    });
    
    console.log(`[TranscodeCoordinatorDO] Assembly job queued for ad ${metadata.adId}`);
    
    // Schedule cleanup after 1 hour
    await this.scheduleCleanup();
  }
  
  private async notifyFailure(metadata: TranscodeMetadata): Promise<void> {
    // Update ad status in D1
    await this.env.DB.prepare(`
      UPDATE ads
      SET transcode_status = 'error',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).bind(
      `Transcode failed: ${metadata.failedCount} segment(s) failed after retries`,
      Date.now(),
      metadata.adId
    ).run();
    
    console.error(`[TranscodeCoordinatorDO] Failure notification sent for ad ${metadata.adId}`);
  }
  
  private async scheduleCleanup(): Promise<void> {
    // Clean up after 1 hour (in case we need to inspect state for debugging)
    const cleanupTime = Date.now() + (60 * 60 * 1000);
    await this.state.storage.setAlarm(cleanupTime);
    console.log(`[TranscodeCoordinatorDO] Cleanup scheduled for ${new Date(cleanupTime).toISOString()}`);
  }
  
  async alarm(): Promise<void> {
    console.log('[TranscodeCoordinatorDO] Alarm triggered - cleaning up state');
    await this.state.storage.deleteAll();
    this.segments.clear();
  }
  
  async getStatus(): Promise<any> {
    const metadata = await this.state.storage.get<TranscodeMetadata>('metadata');
    
    return {
      metadata,
      segments: Array.from(this.segments.values()),
      progress: metadata ? `${metadata.completedCount}/${metadata.segmentCount}` : 'unknown'
    };
  }
  
  private async syncSegmentsToStorage(): Promise<void> {
    // Store segments map for recovery after hibernation
    const segmentsArray = Array.from(this.segments.entries());
    await this.state.storage.put('segments', segmentsArray);
  }
  
  // Called after hibernation to restore state
  private async restoreFromStorage(): Promise<void> {
    const segmentsArray = await this.state.storage.get<[number, SegmentInfo][]>('segments');
    if (segmentsArray) {
      this.segments = new Map(segmentsArray);
    }
  }
}
