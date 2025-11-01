#!/bin/bash

# Transcode commercial to match live stream bitrates
# Creates HLS variants with exact bitrates for seamless ad insertion
# 
# Usage: ./transcode-ad.sh input.mp4 output_dir 1000k,2000k,3000k

set -e

INPUT_FILE="$1"
OUTPUT_DIR="$2"
BITRATES="$3"

if [ -z "$INPUT_FILE" ] || [ -z "$OUTPUT_DIR" ] || [ -z "$BITRATES" ]; then
  echo "❌ Usage: ./transcode-ad.sh <input.mp4> <output_dir> <bitrates>"
  echo ""
  echo "Example:"
  echo "  ./transcode-ad.sh summer-sale.mp4 ./ads/summer-sale 1000k,2000k,3000k"
  echo ""
  echo "This creates HLS variants at exactly 1Mbps, 2Mbps, and 3Mbps"
  echo "to match your live stream bitrates."
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "❌ Error: Input file not found: $INPUT_FILE"
  exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
  echo "❌ Error: ffmpeg is not installed"
  echo ""
  echo "Install on macOS:"
  echo "  brew install ffmpeg"
  echo ""
  echo "Install on Ubuntu/Debian:"
  echo "  sudo apt-get install ffmpeg"
  exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "🎬 Transcoding ad to match stream bitrates..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Input: $INPUT_FILE"
echo "Output: $OUTPUT_DIR"
echo "Bitrates: $BITRATES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get video info
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE")
echo "📊 Duration: ${DURATION}s"

# Convert bitrates string to array
IFS=',' read -ra BITRATE_ARRAY <<< "$BITRATES"

# Build ffmpeg command with multiple outputs
FFMPEG_CMD="ffmpeg -i \"$INPUT_FILE\""
STREAM_MAPS=""
VARIANT_PLAYLISTS=""
VARIANT_COUNT=0

for BITRATE in "${BITRATE_ARRAY[@]}"; do
  # Remove 'k' suffix and convert to number
  BITRATE_NUM=$(echo "$BITRATE" | sed 's/k$//')
  BITRATE_BPS=$((BITRATE_NUM * 1000))
  
  # Calculate resolution based on bitrate (rough estimate)
  if [ $BITRATE_NUM -lt 800 ]; then
    RESOLUTION="640x360"
    SCALE="640:360"
  elif [ $BITRATE_NUM -lt 1500 ]; then
    RESOLUTION="854x480"
    SCALE="854:480"
  elif [ $BITRATE_NUM -lt 2500 ]; then
    RESOLUTION="1280x720"
    SCALE="1280:720"
  else
    RESOLUTION="1920x1080"
    SCALE="1920:1080"
  fi
  
  echo "📺 Creating variant: ${BITRATE} (${RESOLUTION})"
  
  # Create output path
  OUTPUT_PATH="${OUTPUT_DIR}/${BITRATE_NUM}k"
  mkdir -p "$OUTPUT_PATH"
  
  # Transcode this variant
  ffmpeg -i "$INPUT_FILE" \
    -vf "scale=${SCALE}:force_original_aspect_ratio=decrease,pad=${SCALE}:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 \
    -b:v ${BITRATE} \
    -maxrate ${BITRATE} \
    -bufsize $((BITRATE_NUM * 2))k \
    -preset medium \
    -g 60 \
    -keyint_min 60 \
    -sc_threshold 0 \
    -c:a aac \
    -b:a 128k \
    -ac 2 \
    -ar 44100 \
    -f hls \
    -hls_time 6 \
    -hls_list_size 0 \
    -hls_segment_filename "${OUTPUT_PATH}/segment_%03d.ts" \
    "${OUTPUT_PATH}/playlist.m3u8" \
    2>&1 | grep -E "time=|frame=|speed=" || true
  
  echo "   ✓ Created: ${OUTPUT_PATH}/playlist.m3u8"
  
  VARIANT_PLAYLISTS="${VARIANT_PLAYLISTS}${BITRATE_NUM}k/playlist.m3u8,"
  VARIANT_COUNT=$((VARIANT_COUNT + 1))
done

# Remove trailing comma
VARIANT_PLAYLISTS=${VARIANT_PLAYLISTS%,}

echo ""
echo "📝 Creating master playlist..."

# Create master playlist
MASTER_PLAYLIST="${OUTPUT_DIR}/master.m3u8"
echo "#EXTM3U" > "$MASTER_PLAYLIST"
echo "#EXT-X-VERSION:3" >> "$MASTER_PLAYLIST"

for BITRATE in "${BITRATE_ARRAY[@]}"; do
  BITRATE_NUM=$(echo "$BITRATE" | sed 's/k$//')
  BITRATE_BPS=$((BITRATE_NUM * 1000))
  
  # Calculate resolution based on bitrate
  if [ $BITRATE_NUM -lt 800 ]; then
    RESOLUTION="640x360"
  elif [ $BITRATE_NUM -lt 1500 ]; then
    RESOLUTION="854x480"
  elif [ $BITRATE_NUM -lt 2500 ]; then
    RESOLUTION="1280x720"
  else
    RESOLUTION="1920x1080"
  fi
  
  echo "#EXT-X-STREAM-INF:BANDWIDTH=${BITRATE_BPS},RESOLUTION=${RESOLUTION}" >> "$MASTER_PLAYLIST"
  echo "${BITRATE_NUM}k/playlist.m3u8" >> "$MASTER_PLAYLIST"
done

echo "   ✓ Created: $MASTER_PLAYLIST"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Transcoding complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📂 Output directory: $OUTPUT_DIR"
echo "   Master playlist: master.m3u8"
echo "   Variants: $VARIANT_COUNT"
echo ""
echo "📊 File structure:"
tree -L 2 "$OUTPUT_DIR" 2>/dev/null || find "$OUTPUT_DIR" -type f | head -20
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Upload to R2:"
echo "   npx wrangler r2 object put ads-bucket/summer-sale --file=${OUTPUT_DIR} --recursive"
echo ""
echo "2. Or test locally:"
echo "   python3 -m http.server 8000"
echo "   # Then open: http://localhost:8000/${OUTPUT_DIR}/master.m3u8"
echo ""
echo "3. Create Ad Pod with these URLs:"
echo "   - 1Mbps: http://your-r2-url.com/summer-sale/1000k/playlist.m3u8"
echo "   - 2Mbps: http://your-r2-url.com/summer-sale/2000k/playlist.m3u8"
echo "   - 3Mbps: http://your-r2-url.com/summer-sale/3000k/playlist.m3u8"
echo ""

