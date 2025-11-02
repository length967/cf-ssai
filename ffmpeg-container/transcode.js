// FFmpeg Transcoding Logic
// Downloads from R2, transcodes to HLS with exact bitrates, uploads back to R2

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Detect source video resolution using ffprobe
async function detectSourceResolution(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`
    );
    const [width, height] = stdout.trim().split('x').map(Number);
    console.log(`[FFprobe] Detected source resolution: ${width}x${height}`);
    return { width, height };
  } catch (error) {
    console.error('[FFprobe] Failed to detect resolution:', error.message);
    // Fallback to conservative defaults
    return { width: 1280, height: 720 };
  }
}

// Calculate output resolution based on source and target bitrate
// NEVER upscales - preserves aspect ratio
function calculateOutputResolution(sourceRes, targetBitrateKbps) {
  const aspectRatio = sourceRes.width / sourceRes.height;
  
  // Determine target height based on bitrate (max, never upscale)
  let targetHeight;
  if (targetBitrateKbps < 600) {
    targetHeight = 360;
  } else if (targetBitrateKbps < 1200) {
    targetHeight = 480;
  } else if (targetBitrateKbps < 2500) {
    targetHeight = 720;
  } else {
    targetHeight = 1080;
  }
  
  // CRITICAL: Never upscale beyond source resolution
  targetHeight = Math.min(targetHeight, sourceRes.height);
  
  // Calculate width maintaining aspect ratio
  const targetWidth = Math.round(targetHeight * aspectRatio);
  
  // Ensure even dimensions (required by x264 encoder)
  const evenWidth = targetWidth - (targetWidth % 2);
  const evenHeight = targetHeight - (targetHeight % 2);
  
  console.log(`[Resolution] ${targetBitrateKbps}k: ${sourceRes.width}x${sourceRes.height} → ${evenWidth}x${evenHeight} (aspect: ${aspectRatio.toFixed(2)})`);
  
  return { width: evenWidth, height: evenHeight };
}

// Create R2 client (S3-compatible)
function createR2Client(r2Config) {
  return new S3Client({
    region: 'auto',
    endpoint: r2Config.endpoint || `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Config.accessKeyId,
      secretAccessKey: r2Config.secretAccessKey,
    },
  });
}

// Download file from R2
async function downloadFromR2(r2Client, bucket, key, localPath) {
  console.log(`[R2] Downloading ${key} from bucket ${bucket}`);
  
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await r2Client.send(command);
    const chunks = [];
    
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(localPath, buffer);
    
    console.log(`[R2] Downloaded ${buffer.length} bytes to ${localPath}`);
    return buffer.length;
  } catch (error) {
    console.error(`[R2] Download error:`, error);
    throw new Error(`Failed to download ${key}: ${error.message}`);
  }
}

// Upload file to R2
async function uploadToR2(r2Client, bucket, key, localPath, contentType = 'application/octet-stream') {
  console.log(`[R2] Uploading ${localPath} to ${key}`);
  
  try {
    const fileContent = fs.readFileSync(localPath);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    });
    
    await r2Client.send(command);
    console.log(`[R2] Uploaded ${fileContent.length} bytes`);
  } catch (error) {
    console.error(`[R2] Upload error:`, error);
    throw new Error(`Failed to upload ${key}: ${error.message}`);
  }
}

// Upload text content to R2
async function uploadTextToR2(r2Client, bucket, key, content, contentType = 'application/x-mpegURL') {
  console.log(`[R2] Uploading text to ${key}`);
  
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    });
    
    await r2Client.send(command);
    console.log(`[R2] Uploaded ${content.length} bytes of text`);
  } catch (error) {
    console.error(`[R2] Upload error:`, error);
    throw new Error(`Failed to upload ${key}: ${error.message}`);
  }
}

// Get video duration using ffprobe
async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch (error) {
    console.warn('[FFprobe] Could not determine duration:', error.message);
    return 0;
  }
}

// Transcode to a specific bitrate variant
async function transcodeVariant(sourceFile, outputDir, bitrateKbps, sourceResolution) {
  const resolution = calculateOutputResolution(sourceResolution, bitrateKbps);
  const playlistPath = path.join(outputDir, 'playlist.m3u8');
  const segmentPattern = path.join(outputDir, 'segment_%03d.ts');
  
  console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (${resolution.width}x${resolution.height})`);
  
  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });
  
  // FFmpeg command for HLS transcoding
  const cmd = `ffmpeg -i "${sourceFile}" \
    -vf "scale=w=${resolution.width}:h=${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -profile:v main -level 4.0 \
    -b:v ${bitrateKbps}k -maxrate ${bitrateKbps}k -bufsize ${bitrateKbps * 2}k \
    -preset medium -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 128k -ac 2 -ar 48000 \
    -f hls -hls_time 6 -hls_list_size 0 -hls_segment_type mpegts \
    -hls_segment_filename "${segmentPattern}" \
    "${playlistPath}"`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    console.log(`[FFmpeg] ${bitrateKbps}k variant completed`);
    
    // Verify output
    if (!fs.existsSync(playlistPath)) {
      throw new Error('Playlist file not created');
    }
    
    return {
      playlistPath,
      segmentDir: outputDir,
    };
  } catch (error) {
    console.error(`[FFmpeg] Transcode error for ${bitrateKbps}k:`, error.message);
    throw error;
  }
}

// Upload a directory to R2
async function uploadDirectory(r2Client, bucket, localDir, remotePrefix) {
  console.log(`[R2] Uploading directory ${localDir} to ${remotePrefix}`);
  
  const files = fs.readdirSync(localDir);
  const uploadPromises = [];
  
  for (const file of files) {
    const localPath = path.join(localDir, file);
    const remoteKey = `${remotePrefix}/${file}`;
    
    if (fs.statSync(localPath).isFile()) {
      const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
      uploadPromises.push(uploadToR2(r2Client, bucket, remoteKey, localPath, contentType));
    }
  }
  
  await Promise.all(uploadPromises);
  console.log(`[R2] Uploaded ${files.length} files from ${localDir}`);
}

// Create master playlist with actual variant resolutions
function createMasterPlaylist(variants) {
  let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n';
  
  for (const variant of variants) {
    const bandwidth = variant.bitrate;
    const resolution = variant.resolution;
    
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height}\n`;
    playlist += `${variant.bitrate / 1000}k/playlist.m3u8\n`;
  }
  
  return playlist;
}

// Main transcode function
async function transcodeVideo({ adId, sourceKey, bitrates, r2Config }) {
  const workDir = `/tmp/transcode-${adId}-${Date.now()}`;
  const sourceFile = path.join(workDir, 'source.mp4');
  const outputBaseDir = path.join(workDir, 'output');
  
  // Create R2 client
  const r2Client = createR2Client(r2Config);
  const bucket = r2Config.bucket || 'ssai-ads';
  
  try {
    // Create working directories
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outputBaseDir, { recursive: true });
    
    // 1. Download source from R2
    const fileSize = await downloadFromR2(r2Client, bucket, sourceKey, sourceFile);
    console.log(`[Transcode] Source file size: ${fileSize} bytes`);
    
    // 2. Get video duration
    const duration = await getVideoDuration(sourceFile);
    console.log(`[Transcode] Video duration: ${duration}s`);
    
    // 3. Detect source resolution ONCE (before transcoding)
    const sourceResolution = await detectSourceResolution(sourceFile);
    console.log(`[Transcode] Source resolution: ${sourceResolution.width}x${sourceResolution.height}`);
    
    // 4. Transcode each bitrate variant with detected resolution
    const variants = [];
    for (const bitrateKbps of bitrates) {
      const variantDir = path.join(outputBaseDir, `${bitrateKbps}k`);
      const resolution = await transcodeVariant(sourceFile, variantDir, bitrateKbps, sourceResolution);
      
      // Upload variant to R2
      const remotePrefix = `transcoded-ads/${adId}/${bitrateKbps}k`;
      await uploadDirectory(r2Client, bucket, variantDir, remotePrefix);
      
      // Calculate actual resolution used for this variant
      const variantResolution = calculateOutputResolution(sourceResolution, bitrateKbps);
      
      variants.push({
        bitrate: bitrateKbps * 1000,
        url: `${r2Config.publicUrl || 'https://pub-XXXXX.r2.dev'}/${remotePrefix}/playlist.m3u8`,
        resolution: variantResolution  // Include actual resolution
      });
    }
    
    // 5. Create and upload master playlist with actual variant resolutions
    const masterPlaylist = createMasterPlaylist(variants);
    const masterKey = `transcoded-ads/${adId}/master.m3u8`;
    await uploadTextToR2(r2Client, bucket, masterKey, masterPlaylist);
    
    const masterUrl = `${r2Config.publicUrl || 'https://pub-XXXXX.r2.dev'}/${masterKey}`;
    
    // 5. Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`[Transcode] Cleanup complete`);
    
    return {
      variants,
      masterUrl,
      duration: Math.round(duration),
      fileSize,
    };
    
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = { transcodeVideo };

