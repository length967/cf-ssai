/**
 * Trigger Slate Transcode
 * 
 * One-off worker to queue slate transcode job
 * Deploy: wrangler deploy --name trigger-slate-transcode trigger-slate-transcode.ts
 * Run: curl https://trigger-slate-transcode.YOURSUBDOMAIN.workers.dev/
 */

interface Env {
  TRANSCODE_QUEUE: Queue;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const slateId = 'slate_1762142515412_9z5yoetdo';
    const bitrates = [658000, 1316000];
    
    try {
      await env.TRANSCODE_QUEUE.send({
        adId: slateId,
        isSlate: true,
        isGenerated: true, // This is a text-based generated slate
        bitrates: bitrates,
        organizationId: 'global',
        retryCount: 0,
        slateConfig: {
          text: '...back soon!',
          backgroundColor: '#000000',
          textColor: '#ffffff',
          fontSize: 48
        }
      });
      
      return new Response(JSON.stringify({
        success: true,
        message: `Queued transcode for slate ${slateId}`,
        bitrates: bitrates
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
