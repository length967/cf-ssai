/**
 * SCTE-35 Monitor Durable Object
 * 
 * Lightweight DO that uses alarms to poll origin manifests every 5 seconds
 * and detect SCTE-35 signals for proactive ad break insertion.
 * 
 * Architecture:
 * - One DO instance per active channel
 * - Alarm triggers every 5 seconds (configurable)
 * - Fetches origin manifest, detects SCTE-35, writes to KV
 * - Minimal state (just last check timestamp)
 */

import { DurableObject } from 'cloudflare:workers';
import { parseSCTE35FromManifest, findActiveBreak, getBreakDuration } from './utils/scte35';
import { getAdBreakKey, getAdBreakTTL } from './types/adbreak-state';
import type { AdBreakState } from './types/adbreak-state';
import type { SCTE35Signal } from './types';

/**
 * Helper to detect SCTE-35 signal from manifest
 * Returns the most recent active break signal
 */
function detectSCTE35Signal(manifestText: string): SCTE35Signal | null {
  const signals = parseSCTE35FromManifest(manifestText);
  return findActiveBreak(signals);
}

interface Env {
  DB: D1Database;
  ADBREAK_STATE: KVNamespace;
  DECISION: Fetcher;
  SCTE35_POLL_INTERVAL_MS?: string;
  DECISION_TIMEOUT_MS?: string;
}

interface MonitorState {
  channelId: string;
  lastCheck: number;
  isActive: boolean;
  consecutiveErrors: number;
}

export class SCTE35MonitorDO extends DurableObject<Env> {
  private state: MonitorState | null = null;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds default
  private readonly MAX_ERRORS = 10; // Stop after 10 consecutive errors

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initialize or resume monitoring for a channel
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // GET /status - Check current state
    if (path === '/status' && request.method === 'GET') {
      return new Response(JSON.stringify({
        state: this.state,
        alarmScheduled: await this.ctx.storage.getAlarm() !== null,
        timestamp: Date.now(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /start - Start monitoring
    if (path === '/start' && request.method === 'POST') {
      const { channelId } = await request.json<{ channelId: string }>();
      
      if (!channelId) {
        return new Response(JSON.stringify({ error: 'channelId required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Initialize state
      this.state = {
        channelId,
        lastCheck: Date.now(),
        isActive: true,
        consecutiveErrors: 0,
      };
      
      await this.ctx.storage.put('state', this.state);
      
      // Schedule first alarm
      const pollInterval = parseInt(this.env.SCTE35_POLL_INTERVAL_MS || '5000', 10);
      await this.ctx.storage.setAlarm(Date.now() + pollInterval);

      console.log(`[SCTE35Monitor] Started monitoring channel ${channelId}, interval ${pollInterval}ms`);
      
      return new Response(JSON.stringify({
        success: true,
        channelId,
        pollInterval,
        nextCheck: Date.now() + pollInterval,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /stop - Stop monitoring
    if (path === '/stop' && request.method === 'POST') {
      if (this.state) {
        this.state.isActive = false;
        await this.ctx.storage.put('state', this.state);
        await this.ctx.storage.deleteAlarm();
        
        console.log(`[SCTE35Monitor] Stopped monitoring channel ${this.state.channelId}`);
        
        return new Response(JSON.stringify({
          success: true,
          channelId: this.state.channelId,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'Not monitoring' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Alarm handler - polls origin manifest for SCTE-35 signals
   */
  async alarm(): Promise<void> {
    // Load state if not in memory
    if (!this.state) {
      this.state = await this.ctx.storage.get<MonitorState>('state');
      if (!this.state) {
        console.error('[SCTE35Monitor] Alarm fired but no state found');
        return;
      }
    }

    if (!this.state.isActive) {
      console.log(`[SCTE35Monitor] Monitoring inactive for channel ${this.state.channelId}`);
      return;
    }

    const channelId = this.state.channelId;
    console.log(`[SCTE35Monitor] Polling channel ${channelId}`);

    try {
      // Fetch channel config from D1
      const channelRow = await this.env.DB.prepare(
        'SELECT origin_url, vast_url, default_ad_duration, scte35_enabled FROM channels WHERE id = ?'
      ).bind(channelId).first<{
        origin_url: string;
        vast_url: string;
        default_ad_duration: number;
        scte35_enabled: number;
      }>();

      if (!channelRow || channelRow.scte35_enabled !== 1) {
        console.log(`[SCTE35Monitor] Channel ${channelId} no longer active/enabled, stopping`);
        this.state.isActive = false;
        await this.ctx.storage.put('state', this.state);
        return;
      }

      // Fetch origin master manifest
      const originUrl = `${channelRow.origin_url}/master.m3u8`;
      const manifestRes = await fetch(originUrl, {
        headers: { 'User-Agent': 'cf-ssai-scte35-monitor/1.0' },
      });

      if (!manifestRes.ok) {
        throw new Error(`Origin fetch failed: ${manifestRes.status}`);
      }

      const manifestText = await manifestRes.text();

      // Detect SCTE-35 signals
      const signal = detectSCTE35Signal(manifestText);

      if (signal) {
        console.log(`[SCTE35Monitor] 🎯 SCTE-35 signal detected for channel ${channelId}:`, signal);

        // Call decision service to get ads
        const decisionTimeout = parseInt(this.env.DECISION_TIMEOUT_MS || '2000', 10);
        const decisionRes = await Promise.race([
          this.env.DECISION.fetch('http://decision/decision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channel: channelId,
              durationSec: signal.duration || channelRow.default_ad_duration || 30,
              vastUrl: channelRow.vast_url,
            }),
          }),
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('Decision timeout')), decisionTimeout)
          ),
        ]);

        if (decisionRes.ok) {
          const adDecision = await decisionRes.json<any>();
          
          // Build ad break state
          const duration = getBreakDuration(signal) || channelRow.default_ad_duration || 30;
          const startTime = new Date().toISOString();
          const eventId = `scte35_${Date.now()}`;
          
          const adBreakState: AdBreakState = {
            channelId,
            eventId,
            source: 'scte35',
            startTime,
            duration,
            endTime: new Date(Date.now() + duration * 1000).toISOString(),
            decision: {
              podId: adDecision.pod?.podId || 'unknown',
              items: adDecision.pod?.items?.map((item: any) => ({
                id: item.adId || item.podId,
                duration: item.durationSec,
                variants: {} // Filled by decision service
              })) || []
            },
            createdAt: startTime,
            scte35Data: {
              pdt: startTime,
              signalType: signal.type || 'unknown',
              eventId,
            },
          };
          
          // Write to KV
          const kvKey = getAdBreakKey(channelId, eventId);
          const ttl = getAdBreakTTL(duration);
          await this.env.ADBREAK_STATE.put(kvKey, JSON.stringify(adBreakState), {
            expirationTtl: ttl,
          });

          console.log(`[SCTE35Monitor] ✅ Ad break written to KV: ${kvKey}, TTL ${ttl}s`);
        } else {
          console.error(`[SCTE35Monitor] Decision service failed: ${decisionRes.status}`);
        }
      }

      // Reset error counter on success
      this.state.consecutiveErrors = 0;
      this.state.lastCheck = Date.now();
      await this.ctx.storage.put('state', this.state);

    } catch (error) {
      console.error(`[SCTE35Monitor] Error polling channel ${channelId}:`, error);
      
      this.state.consecutiveErrors++;
      await this.ctx.storage.put('state', this.state);

      if (this.state.consecutiveErrors >= this.MAX_ERRORS) {
        console.error(`[SCTE35Monitor] Too many errors (${this.MAX_ERRORS}), stopping monitoring for ${channelId}`);
        this.state.isActive = false;
        await this.ctx.storage.put('state', this.state);
        return; // Don't reschedule
      }
    }

    // Schedule next alarm if still active
    if (this.state.isActive) {
      const pollInterval = parseInt(this.env.SCTE35_POLL_INTERVAL_MS || '5000', 10);
      await this.ctx.storage.setAlarm(Date.now() + pollInterval);
    }
  }
}
