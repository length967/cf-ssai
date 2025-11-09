// FFmpeg Transcoding Logic
// Downloads from R2, transcodes to HLS with exact bitrates, uploads back to R2

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Detect if source has a video stream using ffprobe
async function hasVideoStream(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${filePath}"`
    );
    const hasVideo = stdout.trim() === 'video';
    console.log(`[FFprobe] Source has video stream: ${hasVideo}`);
    return hasVideo;
  } catch (error) {
    console.warn('[FFprobe] Could not detect video stream, assuming video exists:', error.message);
    return true; // Default to assuming video exists for safety
  }
}

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
async function transcodeVariant(sourceFile, outputDir, bitrateKbps, sourceResolution, sourceHasVideo) {
  const playlistPath = path.join(outputDir, 'playlist.m3u8');
  const segmentPattern = path.join(outputDir, 'segment_%03d.ts');

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  let cmd;
  let isAudioOnly;

  // Determine if this variant should be audio-only:
  // 1. If source has NO video stream → always audio-only
  // 2. If source HAS video stream AND bitrate ≤ 256kbps → create audio-only variant
  // 3. Otherwise → video + audio
  if (!sourceHasVideo) {
    isAudioOnly = true;
    console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (AUDIO-ONLY - source has no video stream)`);
  } else if (bitrateKbps <= 256) {
    isAudioOnly = true;
    console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (AUDIO-ONLY - low bitrate from video source)`);
  } else {
    isAudioOnly = false;
    const resolution = calculateOutputResolution(sourceResolution, bitrateKbps);
    console.log(`[FFmpeg] Transcoding ${bitrateKbps}k variant (VIDEO+AUDIO ${resolution.width}x${resolution.height})`);
  }

  if (isAudioOnly) {
    // Audio-only transcoding (no video)
    cmd = `ffmpeg -i "${sourceFile}" \
      -vn \
      -c:a aac -b:a ${bitrateKbps}k -ac 2 -ar 48000 \
      -f hls -hls_time 6 -hls_list_size 0 -hls_segment_type mpegts \
      -hls_segment_filename "${segmentPattern}" \
      "${playlistPath}"`;
  } else {
    // Video + audio transcoding
    const resolution = calculateOutputResolution(sourceResolution, bitrateKbps);
    cmd = `ffmpeg -i "${sourceFile}" \
      -vf "scale=w=${resolution.width}:h=${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -profile:v main -level 4.0 \
      -b:v ${bitrateKbps}k -maxrate ${bitrateKbps}k -bufsize ${bitrateKbps * 2}k \
      -preset medium -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 128k -ac 2 -ar 48000 \
      -f hls -hls_time 6 -hls_list_size 0 -hls_segment_type mpegts \
      -hls_segment_filename "${segmentPattern}" \
      "${playlistPath}"`;
  }

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

    // Audio-only variants should include CODECS attribute without RESOLUTION
    if (variant.isAudioOnly) {
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"\n`;
    } else {
      const resolution = variant.resolution;
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height},CODECS="avc1.42C01F,mp4a.40.2"\n`;
    }

    playlist += `${variant.bitrate / 1000}k/playlist.m3u8\n`;
  }

  return playlist;
}

// Generate slate video with FFmpeg
async function generateSlateVideo(workDir, slateConfig) {
  const outputFile = path.join(workDir, 'generated_slate.mp4');
  const duration = slateConfig.duration || 10;
  const text = slateConfig.text || '...back soon!';
  const bgColor = slateConfig.backgroundColor || '#000000';
  const textColor = slateConfig.textColor || '#FFFFFF';
  const fontSize = slateConfig.fontSize || 48;
  
  // Convert hex colors to FFmpeg format (without #)
  const bgHex = bgColor.replace('#', '0x');
  
  console.log(`[GenerateSlate] Creating ${duration}s slate with text: "${text}"`);
  console.log(`[GenerateSlate] Colors: bg=${bgColor}, text=${textColor}, fontSize=${fontSize}`);
  
  // Escape text for FFmpeg drawtext filter
  const escapedText = text.replace(/'/g, "'\\\''").replace(/:/g, '\\:');
  
  // Generate video with color background and text overlay
  // Using 1280x720 resolution as default for slates
  // Use DejaVu Sans font (installed in Alpine)
  const cmd = `ffmpeg -f lavfi -i color=c=${bgHex}:s=1280x720:d=${duration}:r=30 \
    -vf "drawtext=text='${escapedText}':fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:fontcolor=${textColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2" \
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    -t ${duration} \
    "${outputFile}"`
  
  try {
    console.log(`[GenerateSlate] Running FFmpeg...`);
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (!fs.existsSync(outputFile)) {
      throw new Error('Generated slate file not created');
    }
    
    const fileSize = fs.statSync(outputFile).size;
    console.log(`[GenerateSlate] Generated slate: ${fileSize} bytes`);
    
    return outputFile;
  } catch (error) {
    console.error(`[GenerateSlate] Error:`, error.message);
    throw new Error(`Failed to generate slate: ${error.message}`);
  }
}

// Main transcode function
async function transcodeVideo({ adId, sourceKey, bitrates, r2Config, isSlate, isGenerated, slateConfig }) {
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
    
    let fileSize;
    
    // 1. Get source file (either download or generate)
    if (isGenerated && slateConfig) {
      // Generate slate video with FFmpeg
      console.log(`[Transcode] Generating slate video`);
      const generatedFile = await generateSlateVideo(workDir, slateConfig);
      // Copy to expected source location
      fs.copyFileSync(generatedFile, sourceFile);
      fileSize = fs.statSync(sourceFile).size;
      console.log(`[Transcode] Using generated slate: ${fileSize} bytes`);
    } else {
      // Download source from R2
      fileSize = await downloadFromR2(r2Client, bucket, sourceKey, sourceFile);
      console.log(`[Transcode] Source file size: ${fileSize} bytes`);
    }
    
    // 2. Get video duration
    const duration = await getVideoDuration(sourceFile);
    console.log(`[Transcode] Video duration: ${duration}s`);

    // 3. Detect if source has video stream ONCE (before transcoding)
    const sourceHasVideo = await hasVideoStream(sourceFile);
    console.log(`[Transcode] Source has video: ${sourceHasVideo}`);

    // 4. Detect source resolution if video exists
    let sourceResolution = { width: 1280, height: 720 }; // Default for audio-only
    if (sourceHasVideo) {
      sourceResolution = await detectSourceResolution(sourceFile);
      console.log(`[Transcode] Source resolution: ${sourceResolution.width}x${sourceResolution.height}`);
    }

    // 5. Transcode each bitrate variant
    const variants = [];
    for (const bitrateKbps of bitrates) {
      const variantDir = path.join(outputBaseDir, `${bitrateKbps}k`);
      await transcodeVariant(sourceFile, variantDir, bitrateKbps, sourceResolution, sourceHasVideo);

      // Upload variant to R2
      const remotePrefix = `transcoded-ads/${adId}/${bitrateKbps}k`;
      await uploadDirectory(r2Client, bucket, variantDir, remotePrefix);

      // Determine if this variant is audio-only
      // Audio-only if: source has no video OR (source has video AND bitrate ≤ 256kbps)
      const isAudioOnly = !sourceHasVideo || bitrateKbps <= 256;

      // Calculate actual resolution used for this variant (video+audio only)
      const variantResolution = isAudioOnly
        ? null  // Audio-only has no resolution
        : calculateOutputResolution(sourceResolution, bitrateKbps);

      variants.push({
        bitrate: bitrateKbps * 1000,
        url: `${r2Config.publicUrl || 'https://pub-XXXXX.r2.dev'}/${remotePrefix}/playlist.m3u8`,
        resolution: variantResolution,
        isAudioOnly: isAudioOnly
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

// Transcode a specific time segment of a video
async function transcodeSegment({ adId, segmentId, sourceKey, startTime, duration, bitrates, r2Config }) {
  const workDir = `/tmp/transcode-seg-${adId}-${segmentId}-${Date.now()}`;
  const sourceFile = path.join(workDir, 'source.mp4');
  const segmentFile = path.join(workDir, 'segment.mp4');
  const outputBaseDir = path.join(workDir, 'output');
  
  // Create R2 client
  const r2Client = createR2Client(r2Config);
  const bucket = r2Config.bucket || 'ssai-ads';
  
  try {
    // Create working directories
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outputBaseDir, { recursive: true });
    
    // 1. Download source from R2
    console.log(`[TranscodeSegment] Downloading source for segment ${segmentId}`);
    await downloadFromR2(r2Client, bucket, sourceKey, sourceFile);
    
    // 2. Extract segment using FFmpeg (stream copy for speed)
    console.log(`[TranscodeSegment] Extracting segment ${segmentId}: ${startTime}s-${startTime + duration}s`);
    const extractCmd = `ffmpeg -ss ${startTime} -t ${duration} -i "${sourceFile}" -c copy -avoid_negative_ts 1 "${segmentFile}"`;
    await execAsync(extractCmd, { maxBuffer: 10 * 1024 * 1024 });
    
    // Verify segment was created
    if (!fs.existsSync(segmentFile)) {
      throw new Error('Segment extraction failed');
    }
    
    const segmentSize = fs.statSync(segmentFile).size;
    console.log(`[TranscodeSegment] Extracted segment: ${segmentSize} bytes`);

    // 3. Detect if segment has video stream
    const sourceHasVideo = await hasVideoStream(segmentFile);
    console.log(`[TranscodeSegment] Segment has video: ${sourceHasVideo}`);

    // 4. Detect source resolution if video exists
    let sourceResolution = { width: 1280, height: 720 }; // Default for audio-only
    if (sourceHasVideo) {
      sourceResolution = await detectSourceResolution(segmentFile);
    }

    // 5. Transcode segment to HLS for each bitrate
    const variants = [];
    for (const bitrateKbps of bitrates) {
      const variantDir = path.join(outputBaseDir, `${bitrateKbps}k`);
      await transcodeVariant(segmentFile, variantDir, bitrateKbps, sourceResolution, sourceHasVideo);
      
      // Upload variant to R2
      const remotePrefix = `transcoded-ads/${adId}/segment-${segmentId}/${bitrateKbps}k`;
      await uploadDirectory(r2Client, bucket, variantDir, remotePrefix);
      
      variants.push({
        bitrate: bitrateKbps,
        path: remotePrefix
      });
    }
    
    // 5. Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`[TranscodeSegment] Segment ${segmentId} completed`);
    
    // Return R2 path prefix for this segment
    const r2Path = `transcoded-ads/${adId}/segment-${segmentId}`;
    
    return {
      success: true,
      r2Path,
      segmentId,
      variants
    };
    
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

// Download text content from R2
async function downloadTextFromR2(r2Client, bucket, key) {
  console.log(`[R2] Downloading text from ${key}`);
  
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await r2Client.send(command);
    const chunks = [];
    
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    return buffer.toString('utf-8');
  } catch (error) {
    console.error(`[R2] Download text error:`, error);
    throw new Error(`Failed to download ${key}: ${error.message}`);
  }
}

// Merge multiple HLS playlists into one
function mergeHLSPlaylists(playlists, segmentPrefix) {
  // Start with base tags from first playlist
  let merged = '#EXTM3U\n';
  merged += '#EXT-X-VERSION:3\n';
  merged += '#EXT-X-TARGETDURATION:6\n';
  
  let segmentNumber = 0;
  
  // Extract segments from each playlist
  for (let i = 0; i < playlists.length; i++) {
    const lines = playlists[i].split('\n');
    
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      
      // Copy EXTINF tags
      if (line.startsWith('#EXTINF:')) {
        merged += line + '\n';
        // Next line should be the segment URL
        if (j + 1 < lines.length) {
          const segmentUrl = lines[j + 1].trim();
          if (segmentUrl && !segmentUrl.startsWith('#')) {
            // Rewrite segment URL to include segment prefix
            const segmentFilename = path.basename(segmentUrl);
            merged += `../segment-${i}/${segmentPrefix}k/${segmentFilename}\n`;
            segmentNumber++;
          }
        }
      }
    }
  }
  
  merged += '#EXT-X-ENDLIST\n';
  
  console.log(`[Merge] Combined ${playlists.length} playlists into ${segmentNumber} segments`);
  
  return merged;
}

// Assemble transcoded segments into final HLS output
async function assembleSegments({ adId, segmentPaths, bitrates, r2Config }) {
  const workDir = `/tmp/assemble-${adId}-${Date.now()}`;
  
  // Create R2 client
  const r2Client = createR2Client(r2Config);
  const bucket = r2Config.bucket || 'ssai-ads';
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    console.log(`[Assembly] Assembling ${segmentPaths.length} segments for ad ${adId}`);
    
    const variants = [];
    
    // For each bitrate, merge the segment playlists
    for (const bitrateKbps of bitrates) {
      console.log(`[Assembly] Processing ${bitrateKbps}k variant`);
      
      const segmentPlaylists = [];
      
      // Download all segment playlists for this bitrate
      for (let i = 0; i < segmentPaths.length; i++) {
        const segmentPath = segmentPaths[i];
        const playlistKey = `${segmentPath}/${bitrateKbps}k/playlist.m3u8`;
        
        try {
          const playlist = await downloadTextFromR2(r2Client, bucket, playlistKey);
          segmentPlaylists.push(playlist);
        } catch (error) {
          console.error(`[Assembly] Failed to download ${playlistKey}:`, error.message);
          throw new Error(`Missing segment playlist: ${playlistKey}`);
        }
      }
      
      // Merge playlists
      const mergedPlaylist = mergeHLSPlaylists(segmentPlaylists, bitrateKbps);
      
      // Upload merged playlist to final location
      const finalPlaylistKey = `transcoded-ads/${adId}/${bitrateKbps}k/playlist.m3u8`;
      await uploadTextToR2(r2Client, bucket, finalPlaylistKey, mergedPlaylist);
      
      // Calculate resolution for master playlist
      // Use a dummy source resolution - we'll detect it properly later
      const sourceRes = { width: 1920, height: 1080 };
      const resolution = calculateOutputResolution(sourceRes, bitrateKbps);
      
      variants.push({
        bitrate: bitrateKbps * 1000,
        url: `${r2Config.publicUrl}/${finalPlaylistKey}`,
        resolution
      });
    }
    
    // Create master playlist
    const masterPlaylist = createMasterPlaylist(variants);
    const masterKey = `transcoded-ads/${adId}/master.m3u8`;
    await uploadTextToR2(r2Client, bucket, masterKey, masterPlaylist);
    
    const masterUrl = `${r2Config.publicUrl}/${masterKey}`;
    
    // Get duration from first variant (all should be the same)
    // TODO: Calculate actual duration from segments
    const estimatedDuration = segmentPaths.length * 10; // Assuming 10s segments
    
    // Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`[Assembly] Assembly complete for ad ${adId}`);
    
    return {
      success: true,
      variants,
      masterUrl,
      duration: estimatedDuration
    };
    
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = { transcodeVideo, transcodeSegment, assembleSegments };

