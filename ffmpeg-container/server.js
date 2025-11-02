// FFmpeg Transcode Server
// Runs inside Cloudflare Container, transcodes videos to HLS with exact bitrates

const express = require('express');
const { transcodeVideo, transcodeSegment, assembleSegments } = require('./transcode');

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

// Transcode segment endpoint (for parallel transcoding)
app.post('/transcode-segment', async (req, res) => {
  const startTime = Date.now();
  console.log('[TranscodeSegment] Starting segment job:', req.body);

  try {
    const { adId, segmentId, sourceKey, startTime: segmentStart, duration, bitrates, r2Config } = req.body;

    // Validation
    if (!adId || segmentId === undefined || !sourceKey || segmentStart === undefined || !duration || !bitrates || !r2Config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: adId, segmentId, sourceKey, startTime, duration, bitrates, r2Config'
      });
    }

    if (!Array.isArray(bitrates) || bitrates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'bitrates must be a non-empty array'
      });
    }

    // Transcode segment
    const result = await transcodeSegment({
      adId,
      segmentId,
      sourceKey,
      startTime: segmentStart,
      duration,
      bitrates,
      r2Config,
    });

    const processingDuration = (Date.now() - startTime) / 1000;
    console.log(`[TranscodeSegment] Completed segment ${segmentId} in ${processingDuration}s`);

    res.json({
      ...result,
      processingTime: processingDuration,
    });

  } catch (error) {
    const processingDuration = (Date.now() - startTime) / 1000;
    console.error('[TranscodeSegment] Error:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Segment transcode failed',
      processingTime: processingDuration,
    });
  }
});

// Assemble segments endpoint (for parallel transcoding)
app.post('/assemble-segments', async (req, res) => {
  const startTime = Date.now();
  console.log('[AssembleSegments] Starting assembly job:', req.body);

  try {
    const { adId, segmentPaths, bitrates, r2Config } = req.body;

    // Validation
    if (!adId || !segmentPaths || !bitrates || !r2Config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: adId, segmentPaths, bitrates, r2Config'
      });
    }

    if (!Array.isArray(segmentPaths) || segmentPaths.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'segmentPaths must be a non-empty array'
      });
    }

    if (!Array.isArray(bitrates) || bitrates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'bitrates must be a non-empty array'
      });
    }

    // Assemble segments
    const result = await assembleSegments({
      adId,
      segmentPaths,
      bitrates,
      r2Config,
    });

    const processingDuration = (Date.now() - startTime) / 1000;
    console.log(`[AssembleSegments] Completed in ${processingDuration}s`);

    res.json({
      ...result,
      processingTime: processingDuration,
    });

  } catch (error) {
    const processingDuration = (Date.now() - startTime) / 1000;
    console.error('[AssembleSegments] Error:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Assembly failed',
      processingTime: processingDuration,
    });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: Date.now(),
    ffmpegVersion: 'FFmpeg 6.x',
    containerVersion: '1.1.0', // Updated for parallel transcoding support
    features: ['full-video', 'segment', 'assembly']
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

