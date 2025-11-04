/**
 * SCTE-35 Monitor Coordinator Worker
 * 
 * Phase 2: DO Alarm-based SCTE-35 detection (5-second polling)
 * 
 * Responsibilities:
 * 1. Cron (every minute): Ensure all active channels have monitor DOs running
 * 2. HTTP API: Manual control to start/stop channel monitoring
 * 3. Delegates actual polling to SCTE35MonitorDO instances
 * 
 * This enables:
 * - Sub-minute polling (5 seconds via DO alarms)
 * - Fully stateless manifest serving
 * - Per-channel monitoring lifecycle management
 */

import { SCTE35MonitorDO } from './scte35-monitor-do';

export interface Env {
  // Database for channel configuration
  DB: D1Database
  
  // KV for ad break state
  ADBREAK_STATE: KVNamespace
  
  // Service binding to decision worker
  DECISION: Fetcher
  
  // Durable Object namespace for SCTE-35 monitors
  SCTE35_MONITOR: DurableObjectNamespace<SCTE35MonitorDO>
  
  // Configuration
  SCTE35_POLL_INTERVAL_MS?: string
  DECISION_TIMEOUT_MS?: string
}

export { SCTE35MonitorDO };

/**
 * Get or create a monitor DO for a channel
 */
function getMonitorDO(env: Env, channelId: string): DurableObjectStub<SCTE35MonitorDO> {
  const id = env.SCTE35_MONITOR.idFromName(channelId);
  return env.SCTE35_MONITOR.get(id);
}

/**
 * Start monitoring for a specific channel
 */
async function startChannelMonitoring(env: Env, channelId: string): Promise<void> {
  const stub = getMonitorDO(env, channelId);
  const response = await stub.fetch('http://do/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to start monitoring for ${channelId}: ${error}`);
  }
  
  const result = await response.json<any>();
  console.log(`[Coordinator] Started monitoring for ${channelId}, poll interval ${result.pollInterval}ms`);
}

/**
 * Stop monitoring for a specific channel
 */
async function stopChannelMonitoring(env: Env, channelId: string): Promise<void> {
  const stub = getMonitorDO(env, channelId);
  const response = await stub.fetch('http://do/stop', {
    method: 'POST',
  });
  
  if (response.ok) {
    console.log(`[Coordinator] Stopped monitoring for ${channelId}`);
  }
}

/**
 * Get monitoring status for a channel
 */
async function getMonitoringStatus(env: Env, channelId: string): Promise<any> {
  const stub = getMonitorDO(env, channelId);
  const response = await stub.fetch('http://do/status');
  return response.json();
}

/**
 * Cron handler - ensures all active channels have monitors running
 */
async function handleScheduled(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[Coordinator] 🔄 Starting monitor sync');
  
  try {
    // Fetch all active channels with SCTE-35 enabled
    const result = await env.DB.prepare(`
      SELECT channel_id as id
      FROM channels
      WHERE scte35_enabled = 1
    `).all<{ id: string }>();
    
    if (!result.results || result.results.length === 0) {
      console.log('[Coordinator] No active channels with SCTE-35 enabled');
      return;
    }
    
    console.log(`[Coordinator] 📺 Syncing ${result.results.length} channel(s)`);
    
    // Start monitoring for each channel (idempotent)
    const promises = result.results.map(channel =>
      startChannelMonitoring(env, channel.id).catch(error => {
        console.error(`[Coordinator] Error starting monitor for ${channel.id}:`, error);
      })
    );
    
    await Promise.all(promises);
    
    const duration = Date.now() - startTime;
    console.log(`[Coordinator] ✅ Monitor sync complete (${duration}ms)`);
    
  } catch (error) {
    console.error('[Coordinator] Fatal error:', error);
  }
}

/**
 * HTTP handler - manual control endpoints
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // POST /start/:channelId - Start monitoring a channel
  if (path.startsWith('/start/') && request.method === 'POST') {
    const channelId = path.split('/')[2];
    try {
      await startChannelMonitoring(env, channelId);
      return new Response(JSON.stringify({ success: true, channelId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  
  // POST /stop/:channelId - Stop monitoring a channel
  if (path.startsWith('/stop/') && request.method === 'POST') {
    const channelId = path.split('/')[2];
    try {
      await stopChannelMonitoring(env, channelId);
      return new Response(JSON.stringify({ success: true, channelId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  
  // GET /status/:channelId - Get monitoring status
  if (path.startsWith('/status/') && request.method === 'GET') {
    const channelId = path.split('/')[2];
    try {
      const status = await getMonitoringStatus(env, channelId);
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  
  return new Response('Not Found', { status: 404 });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(env);
  },
  
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
}
