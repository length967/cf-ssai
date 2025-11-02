// Transcode Worker
// Consumes jobs from queue, manages FFmpeg container lifecycle, handles retries
// Supports both full video transcoding and parallel segment transcoding

import { Container, getContainer } from '@cloudflare/containers';
import { releaseTranscodeLock } from './on-demand-transcode';
import type { TranscodeJob, SegmentTranscodeJob, AssemblyJob } from './types/transcode';

// Re-export TranscodeCoordinatorDO for wrangler
export { TranscodeCoordinatorDO } from './transcode-coordinator-do';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  TRANSCODE_QUEUE: Queue;
  FFMPEG_CONTAINER: DurableObjectNamespace;
  TRANSCODE_COORDINATOR: DurableObjectNamespace; // Coordinator DO for parallel jobs
  KV: KVNamespace; // For transcode locks
  R2_PUBLIC_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  CONTAINER_URL?: string; // Optional: FFmpeg container URL (default: http://localhost:8080)
}

// FFmpeg Container Class
export class FFmpegContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m'; // Sleep after 5 minutes of inactivity
  instanceType = 'standard-2'; // 1 vCPU, 6GB RAM, 12GB disk
  
  override onStart() {
    console.log('[FFmpegContainer] Container started');
  }
  
  override onStop() {
    console.log('[FFmpegContainer] Container stopped');
  }
  
  override onError(error: unknown) {
    console.error('[FFmpegContainer] Container error:', error);
  }
}

// Queue consumer
export default {
  async queue(batch: MessageBatch<TranscodeJob | SegmentTranscodeJob | AssemblyJob>, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[TranscodeWorker] Processing ${batch.messages.length} messages`);
    
    for (const message of batch.messages) {
      const job = message.body;
      const startTime = Date.now();
      
      // Route to appropriate handler based on job type
      if ('type' in job) {
        if (job.type === 'SEGMENT') {
          await handleSegmentJob(message as Message<SegmentTranscodeJob>, env, startTime);
        } else if (job.type === 'ASSEMBLY') {
          await handleAssemblyJob(message as Message<AssemblyJob>, env, startTime);
        }
        continue;
      }
      
      // Legacy full-video transcode job
      try {
        console.log(`[TranscodeWorker] Starting full-video job for ad ${job.adId}`);
        
        // Update status: processing
        await env.DB.prepare(`
          UPDATE ads 
          SET transcode_status = 'processing', 
              updated_at = ?
          WHERE id = ?
        `).bind(Date.now(), job.adId).run();
        
        // Get container instance (one per ad for isolation)
        const containerId = `ffmpeg-${job.adId}`;
        const containerInstance = getContainer(env.FFMPEG_CONTAINER, containerId);
        
        // Prepare R2 configuration
        const r2Config = {
          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          bucket: 'ssai-ads',
          publicUrl: env.R2_PUBLIC_URL,
        };
        
        // Call container to transcode
        console.log(`[TranscodeWorker] Calling FFmpeg container for ad ${job.adId}`);
        const containerUrl = env.CONTAINER_URL || 'http://localhost:8080';
        const response = await containerInstance.fetch(`${containerUrl}/transcode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adId: job.adId,
            sourceKey: job.sourceKey,
            bitrates: job.bitrates,
            r2Config,
          }),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Container returned ${response.status}: ${error}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Transcode failed');
        }
        
        console.log(`[TranscodeWorker] Transcode successful for ad ${job.adId}:`, result);
        
        // Update database with results
        await env.DB.prepare(`
          UPDATE ads 
          SET transcode_status = 'ready',
              variants = ?,
              master_playlist_url = ?,
              duration = ?,
              transcoded_at = ?,
              error_message = NULL,
              updated_at = ?
          WHERE id = ?
        `).bind(
          JSON.stringify(result.variants),
          result.masterUrl,
          result.duration,
          Date.now(),
          Date.now(),
          job.adId
        ).run();
        
        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`[TranscodeWorker] Job completed for ad ${job.adId} in ${processingTime}s`);
        
        // Release on-demand transcode lock if applicable
        if (job.isOnDemand) {
          try {
            await releaseTranscodeLock(env, job.adId, job.bitrates);
          } catch (e) {
            console.warn(`Failed to release transcode lock:`, e);
          }
        }
        
        // Acknowledge message
        message.ack();
        
      } catch (error: any) {
        const processingTime = (Date.now() - startTime) / 1000;
        console.error(`[TranscodeWorker] Job failed for ad ${job.adId} after ${processingTime}s:`, error);
        
        const retryCount = (job.retryCount || 0) + 1;
        const maxRetries = 3;
        
        if (retryCount < maxRetries) {
          // Retry the job
          console.log(`[TranscodeWorker] Retrying job for ad ${job.adId} (attempt ${retryCount + 1}/${maxRetries})`);
          
          // Update retry count and requeue
          message.retry({
            delaySeconds: Math.min(60 * retryCount, 300), // Exponential backoff: 60s, 120s, 180s
          });
          
          // Update status in database
          await env.DB.prepare(`
            UPDATE ads 
            SET transcode_status = 'queued',
                error_message = ?,
                updated_at = ?
            WHERE id = ?
          `).bind(
            `Retry ${retryCount}/${maxRetries}: ${error.message}`,
            Date.now(),
            job.adId
          ).run();
          
        } else {
          // Max retries exceeded, mark as error
          console.error(`[TranscodeWorker] Max retries exceeded for ad ${job.adId}`);
          
          await env.DB.prepare(`
            UPDATE ads 
            SET transcode_status = 'error',
                error_message = ?,
                updated_at = ?
            WHERE id = ?
          `).bind(
            `Failed after ${maxRetries} attempts: ${error.message}`,
            Date.now(),
            job.adId
          ).run();
          
          // Acknowledge to remove from queue
          message.ack();
        }
      }
    }
  }
};

// ============================================================================
// PARALLEL SEGMENT TRANSCODING HANDLERS
// ============================================================================

async function handleSegmentJob(
  message: Message<SegmentTranscodeJob>,
  env: Env,
  startTime: number
): Promise<void> {
  const job = message.body;
  
  // Get coordinator DO
  const doId = env.TRANSCODE_COORDINATOR.idFromName(job.jobGroupId);
  const coordinator = env.TRANSCODE_COORDINATOR.get(doId);
  
  try {
    console.log(`[TranscodeWorker] Starting segment ${job.segmentId} for ad ${job.adId} (${job.startTime}s-${job.startTime + job.duration}s)`);
    
    // Get container instance
    const containerId = `ffmpeg-seg-${job.jobGroupId}-${job.segmentId}`;
    const containerInstance = getContainer(env.FFMPEG_CONTAINER, containerId);
    
    // Prepare R2 configuration
    const r2Config = {
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: 'ssai-ads',
      publicUrl: env.R2_PUBLIC_URL,
    };
    
    // Call container to transcode this segment
    const containerUrl = env.CONTAINER_URL || 'http://localhost:8080';
    const response = await containerInstance.fetch(`${containerUrl}/transcode-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: job.adId,
        segmentId: job.segmentId,
        sourceKey: job.sourceKey,
        startTime: job.startTime,
        duration: job.duration,
        bitrates: job.bitrates,
        r2Config,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Container returned ${response.status}: ${error}`);
    }
    
    const result = await response.json<{ success: boolean; r2Path: string; error?: string }>();
    
    if (!result.success) {
      throw new Error(result.error || 'Segment transcode failed');
    }
    
    console.log(`[TranscodeWorker] Segment ${job.segmentId} completed: ${result.r2Path}`);
    
    // Notify coordinator of completion
    const coordResponse = await coordinator.fetch('http://coordinator/segment-completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmentId: job.segmentId,
        r2Path: result.r2Path
      })
    });
    
    const coordResult = await coordResponse.json<{ status: string }>();
    
    if (coordResult.status === 'completed') {
      console.log(`[TranscodeWorker] Job ${job.jobGroupId} completed, assembly will be triggered`);
    }
    
    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`[TranscodeWorker] Segment ${job.segmentId} processed in ${processingTime}s`);
    
    message.ack();
    
  } catch (error: any) {
    const processingTime = (Date.now() - startTime) / 1000;
    console.error(`[TranscodeWorker] Segment ${job.segmentId} failed after ${processingTime}s:`, error);
    
    // Notify coordinator of failure
    const coordResponse = await coordinator.fetch('http://coordinator/segment-failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmentId: job.segmentId,
        error: error.message
      })
    });
    
    const result = await coordResponse.json<{ shouldRetry: boolean; isJobFailed: any }>();
    
    if (result.shouldRetry) {
      // Retry with exponential backoff
      console.log(`[TranscodeWorker] Retrying segment ${job.segmentId}`);
      message.retry({ delaySeconds: 30 });
    } else {
      // Max retries exceeded
      console.error(`[TranscodeWorker] Segment ${job.segmentId} permanently failed`);
      message.ack();
      
      if (result.isJobFailed && typeof result.isJobFailed === 'object' && result.isJobFailed.status === 'failed') {
        console.error(`[TranscodeWorker] Entire job ${job.jobGroupId} failed`);
      }
    }
  }
}

async function handleAssemblyJob(
  message: Message<AssemblyJob>,
  env: Env,
  startTime: number
): Promise<void> {
  const job = message.body;
  
  try {
    console.log(`[TranscodeWorker] Starting assembly for ad ${job.adId} (${job.segmentCount} segments)`);
    
    // Get container instance
    const containerId = `ffmpeg-assembly-${job.adId}`;
    const containerInstance = getContainer(env.FFMPEG_CONTAINER, containerId);
    
    // Prepare R2 configuration
    const r2Config = {
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: 'ssai-ads',
      publicUrl: env.R2_PUBLIC_URL,
    };
    
    // Call container to assemble segments
    const containerUrl = env.CONTAINER_URL || 'http://localhost:8080';
    const response = await containerInstance.fetch(`${containerUrl}/assemble-segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: job.adId,
        segmentPaths: job.segmentPaths,
        bitrates: job.bitrates,
        r2Config,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Container returned ${response.status}: ${error}`);
    }
    
    const result = await response.json<{ 
      success: boolean; 
      variants?: any[]; 
      masterUrl?: string; 
      duration?: number;
      error?: string;
    }>();
    
    if (!result.success) {
      throw new Error(result.error || 'Assembly failed');
    }
    
    console.log(`[TranscodeWorker] Assembly successful for ad ${job.adId}`);
    
    // Update database with final results
    await env.DB.prepare(`
      UPDATE ads 
      SET transcode_status = 'ready',
          variants = ?,
          master_playlist_url = ?,
          duration = ?,
          transcoded_at = ?,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
    `).bind(
      JSON.stringify(result.variants),
      result.masterUrl,
      result.duration,
      Date.now(),
      Date.now(),
      job.adId
    ).run();
    
    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`[TranscodeWorker] Assembly completed for ad ${job.adId} in ${processingTime}s`);
    
    message.ack();
    
  } catch (error: any) {
    const processingTime = (Date.now() - startTime) / 1000;
    console.error(`[TranscodeWorker] Assembly failed for ad ${job.adId} after ${processingTime}s:`, error);
    
    // Update database with error
    await env.DB.prepare(`
      UPDATE ads 
      SET transcode_status = 'error',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).bind(
      `Assembly failed: ${error.message}`,
      Date.now(),
      job.adId
    ).run();
    
    // Don't retry assembly jobs - if they fail, the entire job has failed
    message.ack();
  }
}

