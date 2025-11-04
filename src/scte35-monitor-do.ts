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

      // Fetch origin variant manifest (SCTE-35 signals are in variant playlists, not master)
      // Use a mid-bitrate variant for reliable SCTE-35 detection
      let baseUrl = channelRow.origin_url;
      // Remove trailing .m3u8 if present to construct variant URL
      if (baseUrl.endsWith('.m3u8')) {
        baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
      }
      
      // Use the 1000k variant (common across streams)
      const variantUrl = `${baseUrl}/scte35-audio_eng=128000-video=1000000.m3u8`;
      
      console.log(`[SCTE35Monitor] Fetching variant: ${variantUrl}`);
      
      const manifestRes = await fetch(variantUrl, {
        headers: { 'User-Agent': 'cf-ssai-scte35-monitor/1.0' },
      });

      if (!manifestRes.ok) {
        throw new Error(`Origin fetch failed: ${manifestRes.status} for ${variantUrl}`);
      }

      const manifestText = await manifestRes.text();

      // Detect SCTE-35 signals
      const signals = parseSCTE35FromManifest(manifestText);
      console.log(`Total SCTE-35 signals found: ${signals.length}`);
      
      const signal = findActiveBreak(signals);

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
          console.log(`[SCTE35Monitor] Decision response:`, JSON.stringify(adDecision));
          
          // Build variants map from decision service items
          const duration = getBreakDuration(signal) || channelRow.default_ad_duration || 30;
          // CRITICAL: Use the signal's PDT (from START-DATE) as the ad break start time
          const startTime = signal.pdt || new Date().toISOString();
          const eventId = `scte35_${Date.now()}`;
          
          // Build variants map from decision service items
          // Decision service returns: [{adId, bitrate, playlistUrl}]
          // We need to group by adId and create variant map per ad
          const adItems = adDecision.pod?.items || [];
          const adsById = new Map<string, {duration: number, variants: Record<string, string>}>();
          
          for (const item of adItems) {
            const adId = item.adId || 'unknown';
            if (!adsById.has(adId)) {
              adsById.set(adId, {
                duration: adDecision.pod?.durationSec || duration,
                variants: {}
              });
            }
            const ad = adsById.get(adId)!;
            ad.variants[item.bitrate.toString()] = item.playlistUrl;
          }
          
          const adBreakState: AdBreakState = {
            channelId,
            eventId,
            source: 'scte35',
            startTime,
            duration,
            endTime: new Date(Date.now() + duration * 1000).toISOString(),
            decision: {
              podId: adDecision.pod?.podId || 'unknown',
              items: Array.from(adsById.entries()).map(([adId, ad]) => ({
                id: adId,
                duration: ad.duration,
                variants: ad.variants
              }))
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
