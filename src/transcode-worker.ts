// Transcode Worker
// Consumes jobs from queue, manages FFmpeg container lifecycle, handles retries

import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  TRANSCODE_QUEUE: Queue;
  FFMPEG_CONTAINER: DurableObjectNamespace;
  R2_PUBLIC_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
}

export interface TranscodeJob {
  adId: string;
  sourceKey: string;
  bitrates: number[]; // in kbps, e.g. [1000, 2000, 3000]
  organizationId: string;
  channelId?: string;
  retryCount?: number;
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
  async queue(batch: MessageBatch<TranscodeJob>, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[TranscodeWorker] Processing ${batch.messages.length} messages`);
    
    for (const message of batch.messages) {
      const job = message.body;
      const startTime = Date.now();
      
      try {
        console.log(`[TranscodeWorker] Starting job for ad ${job.adId}`);
        
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
        const response = await containerInstance.fetch('http://localhost:8080/transcode', {
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

