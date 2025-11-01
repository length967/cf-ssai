// FFmpeg Transcode Server
// Runs inside Cloudflare Container, transcodes videos to HLS with exact bitrates

const express = require('express');
const { transcodeVideo } = require('./transcode');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Transcode endpoint
app.post('/transcode', async (req, res) => {
  const startTime = Date.now();
  console.log('[Transcode] Starting job:', req.body);

  try {
    const { adId, sourceKey, bitrates, r2Config } = req.body;

    // Validation
    if (!adId || !sourceKey || !bitrates || !r2Config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: adId, sourceKey, bitrates, r2Config'
      });
    }

    if (!Array.isArray(bitrates) || bitrates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'bitrates must be a non-empty array'
      });
    }

    // Transcode video
    const result = await transcodeVideo({
      adId,
      sourceKey,
      bitrates,
      r2Config,
    });

    const duration = (Date.now() - startTime) / 1000;
    console.log(`[Transcode] Completed in ${duration}s:`, result);

    res.json({
      success: true,
      ...result,
      processingTime: duration,
    });

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error('[Transcode] Error:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Transcode failed',
      processingTime: duration,
    });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: Date.now(),
    ffmpegVersion: 'FFmpeg 6.x',
    containerVersion: '1.0.0',
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`[Server] FFmpeg transcode server listening on port ${PORT}`);
  console.log(`[Server] Ready to accept transcode jobs`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully');
  process.exit(0);
});

