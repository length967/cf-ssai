#!/bin/bash

# Create 658k variant for "Be Back Soon" slate
# This creates a 10-second black video with text at 658kbps

SLATE_ID="slate_1762142515412_9z5yoetdo"
OUTPUT_DIR="./temp-slate-658k"
BITRATE="658k"
R2_PATH="transcoded-ads/${SLATE_ID}/658k"

echo "Creating 658k slate variant..."

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Generate 10-second video with FFmpeg
# Black background, white text "Be Back Soon"
ffmpeg -f lavfi -i color=c=black:s=1280x720:d=10 \
  -vf "drawtext=text='Be Back Soon':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -b:v ${BITRATE} -maxrate ${BITRATE} -bufsize $((658*2))k \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -pix_fmt yuv420p -profile:v main -level 3.1 \
  -movflags +faststart \
  -t 10 \
  "${OUTPUT_DIR}/slate.mp4"

echo "Transcoding to HLS segments..."

# Create HLS segments
ffmpeg -i "${OUTPUT_DIR}/slate.mp4" \
  -c:v copy \
  -hls_time 2 \
  -hls_list_size 0 \
  -hls_segment_filename "${OUTPUT_DIR}/segment_%03d.ts" \
  "${OUTPUT_DIR}/playlist.m3u8"

echo ""
echo "✅ Slate variant created at ${OUTPUT_DIR}"
echo ""
echo "To upload to R2, use:"
echo "  wrangler r2 object put ssai-ads/${R2_PATH}/playlist.m3u8 --file=${OUTPUT_DIR}/playlist.m3u8"
echo "  for f in ${OUTPUT_DIR}/segment_*.ts; do"
echo "    wrangler r2 object put ssai-ads/${R2_PATH}/\$(basename \$f) --file=\$f"
echo "  done"
echo ""
echo "Then update the slate variants in D1 to include:"
echo '{"bitrate":658000,"url":"https://pub-24423d0273094578a7f498bd462c2e20.r2.dev/'${R2_PATH}'/playlist.m3u8","resolution":{"width":1280,"height":720}}'
