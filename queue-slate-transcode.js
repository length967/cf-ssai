/**
 * Queue slate transcode job to add missing 658k bitrate
 * Run: node queue-slate-transcode.js
 */

async function queueSlateTranscode() {
  const slateId = 'slate_1762142515412_9z5yoetdo';
  const bitrates = [658000, 1316000]; // Add 658k variant
  
  console.log(`Queueing transcode for slate ${slateId} with bitrates: ${bitrates}`);
  
  // Since we can't directly access the Queue from Node.js, we'll use wrangler to send a message
  const cmd = `wrangler queues send TRANSCODE_QUEUE '${JSON.stringify({
    adId: slateId,
    isSlate: true,
    bitrates: bitrates,
    organizationId: 'global',
    retryCount: 0
  })}'`;
  
  console.log('Run this command:');
  console.log(cmd);
}

queueSlateTranscode();
