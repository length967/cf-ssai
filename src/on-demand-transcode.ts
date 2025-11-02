/**
 * On-Demand Transcode Service
 * 
 * Automatically transcodes ads to match channel bitrate ladders on-demand
 * Prevents duplicate uploads and enables true cross-channel ad reuse
 */

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  TRANSCODE_QUEUE: Queue;
  KV: KVNamespace;
}

export interface VariantInfo {
  bitrate: number;
  url: string;
}

/**
 * Check if ad has all required variants for a channel's bitrate ladder
 * Returns missing bitrates that need to be transcoded
 */
export async function getMissingVariants(
  env: Env,
  adId: string,
  requiredBitrates: number[] // in kbps
): Promise<number[]> {
  // Fetch ad record
  const ad = await env.DB.prepare(`
    SELECT variants FROM ads WHERE id = ? AND transcode_status = 'ready'
  `).bind(adId).first<any>();
  
  if (!ad || !ad.variants) {
    throw new Error(`Ad ${adId} not found or not ready`);
  }
  
  // Parse existing variants
  const existingVariants: VariantInfo[] = JSON.parse(ad.variants);
  const existingBitrates = new Set(existingVariants.map(v => v.bitrate));
  
  // Find missing bitrates
  const missing = requiredBitrates.filter(br => !existingBitrates.has(br));
  
  return missing;
}

/**
 * Queue on-demand transcode job for missing variants
 * Uses KV to deduplicate concurrent requests
 */
export async function queueOnDemandTranscode(
  env: Env,
  adId: string,
  channelId: string,
  missingBitrates: number[]
): Promise<{ queued: boolean; lockKey?: string }> {
  // Create lock key for deduplication
  const lockKey = `transcode_lock:${adId}:${missingBitrates.sort().join(',')}`;
  const lockTTL = 600; // 10 minutes
  
  // Try to acquire lock (prevent duplicate transcode jobs)
  const existingLock = await env.KV.get(lockKey);
  if (existingLock) {
    console.log(`Transcode already in progress for ${adId} bitrates ${missingBitrates}`);
    return { queued: false, lockKey };
  }
  
  // Acquire lock
  await env.KV.put(lockKey, Date.now().toString(), { expirationTtl: lockTTL });
  
  // Fetch ad details
  const ad = await env.DB.prepare(`
    SELECT source_key, organization_id, variants FROM ads WHERE id = ?
  `).bind(adId).first<any>();
  
  if (!ad) {
    throw new Error(`Ad ${adId} not found`);
  }
  
  // Parse existing variants to merge with new ones
  const existingVariants: VariantInfo[] = ad.variants ? JSON.parse(ad.variants) : [];
  const allBitrates = [
    ...new Set([
      ...existingVariants.map(v => v.bitrate),
      ...missingBitrates
    ])
  ].sort((a, b) => a - b);
  
  console.log(`Queueing on-demand transcode for ad ${adId}: adding ${missingBitrates} to existing ${existingVariants.map(v => v.bitrate)}`);
  
  // Queue transcode job with ALL bitrates (existing + new)
  await env.TRANSCODE_QUEUE.send({
    adId,
    sourceKey: ad.source_key,
    bitrates: allBitrates,
    organizationId: ad.organization_id,
    channelId,
    retryCount: 0,
    isOnDemand: true, // Flag to indicate this is on-demand transcode
  });
  
  // Update ad status to indicate re-transcoding
  await env.DB.prepare(`
    UPDATE ads 
    SET transcode_status = 'processing',
        updated_at = ?
    WHERE id = ?
  `).bind(Date.now(), adId).run();
  
  return { queued: true, lockKey };
}

/**
 * Wait for on-demand transcode to complete (with timeout)
 * Used for synchronous workflows where we need variants immediately
 */
export async function waitForVariants(
  env: Env,
  adId: string,
  requiredBitrates: number[],
  timeoutMs: number = 60000 // 60 seconds default
): Promise<{ ready: boolean; variants?: VariantInfo[] }> {
  const startTime = Date.now();
  const pollInterval = 2000; // Poll every 2 seconds
  
  while (Date.now() - startTime < timeoutMs) {
    // Check if ad has required variants
    const missing = await getMissingVariants(env, adId, requiredBitrates);
    
    if (missing.length === 0) {
      // All variants ready!
      const ad = await env.DB.prepare(`
        SELECT variants FROM ads WHERE id = ?
      `).bind(adId).first<any>();
      
      return { 
        ready: true, 
        variants: ad?.variants ? JSON.parse(ad.variants) : [] 
      };
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // Timeout reached
  console.warn(`Timeout waiting for variants of ad ${adId}`);
  return { ready: false };
}

/**
 * Get variants for channel, triggering on-demand transcode if needed
 * Returns immediately with closest available variants while queueing missing ones
 */
export async function getVariantsForChannel(
  env: Env,
  adId: string,
  channelId: string,
  channelBitrates: number[],
  waitForCompletion: boolean = false
): Promise<{
  variants: VariantInfo[];
  missingBitrates: number[];
  transcodeQueued: boolean;
}> {
  // Check for missing variants
  const missingBitrates = await getMissingVariants(env, adId, channelBitrates);
  
  // Fetch current variants
  const ad = await env.DB.prepare(`
    SELECT variants FROM ads WHERE id = ?
  `).bind(adId).first<any>();
  
  const existingVariants: VariantInfo[] = ad?.variants ? JSON.parse(ad.variants) : [];
  
  let transcodeQueued = false;
  
  // Queue on-demand transcode if variants are missing
  if (missingBitrates.length > 0) {
    const result = await queueOnDemandTranscode(env, adId, channelId, missingBitrates);
    transcodeQueued = result.queued;
    
    // Optionally wait for completion (blocking)
    if (waitForCompletion && transcodeQueued) {
      const waitResult = await waitForVariants(env, adId, channelBitrates, 60000);
      if (waitResult.ready) {
        return {
          variants: waitResult.variants || [],
          missingBitrates: [],
          transcodeQueued: true,
        };
      }
    }
  }
  
  return {
    variants: existingVariants,
    missingBitrates,
    transcodeQueued,
  };
}

/**
 * Cleanup transcode locks (called by transcode worker on completion)
 */
export async function releaseTranscodeLock(
  env: Env,
  adId: string,
  bitrates: number[]
): Promise<void> {
  const lockKey = `transcode_lock:${adId}:${bitrates.sort().join(',')}`;
  await env.KV.delete(lockKey);
  console.log(`Released transcode lock: ${lockKey}`);
}
