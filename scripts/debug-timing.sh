#!/bin/bash
# Debug timing issues in SSAI playback
# Captures detailed logs for glitching/buffering diagnosis

set -e

CHANNEL="${1:-sports1}"
VARIANT="${2:-v_1600k.m3u8}"
DOMAIN="${SSAI_DOMAIN:-cf-ssai.markjohns.workers.dev}"

echo "🔍 SSAI Timing Debugger"
echo "======================="
echo "Channel: $CHANNEL"
echo "Variant: $VARIANT"
echo "Domain: $DOMAIN"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}[1/5] Fetching baseline manifest (no ad)...${NC}"
BASELINE=$(curl -s "https://${DOMAIN}/?channel=${CHANNEL}&variant=${VARIANT}")
BASELINE_DURATION=$(echo "$BASELINE" | grep -c '#EXTINF:' || echo "0")
BASELINE_AVG=$(echo "$BASELINE" | grep '#EXTINF:' | head -5 | sed 's/.*#EXTINF:\([0-9.]*\).*/\1/' | awk '{sum+=$1; count++} END {if(count>0) print sum/count; else print 0}')

echo "  ✓ Content segments: $BASELINE_DURATION"
echo "  ✓ Average segment duration: ${BASELINE_AVG}s"
echo ""

echo -e "${BLUE}[2/5] Triggering ad break...${NC}"
AD_DURATION=30
./scripts/cue.sh start --channel "$CHANNEL" --duration $AD_DURATION 2>&1 | grep -E "(ok|error|status)" || echo "  ⚠ Cue script may have failed"
echo ""

sleep 2

echo -e "${BLUE}[3/5] Fetching manifest with ad (SSAI mode)...${NC}"
AD_MANIFEST=$(curl -s "https://${DOMAIN}/?channel=${CHANNEL}&variant=${VARIANT}&force=ssai")

# Parse manifest structure
TOTAL_SEGMENTS=$(echo "$AD_MANIFEST" | grep -c '#EXTINF:' || echo "0")
DISCONTINUITIES=$(echo "$AD_MANIFEST" | grep -c '#EXT-X-DISCONTINUITY' || echo "0")
PDT_COUNT=$(echo "$AD_MANIFEST" | grep -c '#EXT-X-PROGRAM-DATE-TIME:' || echo "0")

echo "  ✓ Total segments in manifest: $TOTAL_SEGMENTS"
echo "  ✓ Discontinuities: $DISCONTINUITIES"
echo "  ✓ PDT tags: $PDT_COUNT"
echo ""

# Extract segment durations around discontinuities
echo -e "${YELLOW}[CRITICAL] Analyzing segment timing around discontinuities...${NC}"
echo "$AD_MANIFEST" | awk '
  /^#EXT-X-DISCONTINUITY/ { 
    disc_count++; 
    print "  🔵 DISCONTINUITY #" disc_count " at line " NR
    context_start = NR - 3
    context_end = NR + 8
  }
  (NR >= context_start && NR <= context_end) && /^#EXTINF/ {
    match($0, /#EXTINF:([0-9.]+)/, arr)
    print "    Line " NR ": #EXTINF:" arr[1] "s"
  }
  (NR >= context_start && NR <= context_end) && /^#EXT-X-PROGRAM-DATE-TIME/ {
    print "    Line " NR ": " $0
  }
  (NR >= context_start && NR <= context_end) && !/^#/ && NF > 0 {
    print "    Line " NR ": [segment] " $0
  }
'
echo ""

# Calculate ad segment duration
echo -e "${YELLOW}[CRITICAL] Analyzing ad segment durations...${NC}"
echo "$AD_MANIFEST" | awk '
  BEGIN { in_ad = 0; ad_total = 0; ad_count = 0 }
  /^#EXT-X-DISCONTINUITY/ { 
    if (in_ad == 0) { 
      in_ad = 1; 
      print "  🎬 Start of ad pod"
    } else {
      in_ad = 0
      print "  🎬 End of ad pod"
      print "    Total ad duration: " ad_total "s"
      print "    Ad segments: " ad_count
      print "    Average ad segment: " (ad_count > 0 ? ad_total/ad_count : 0) "s"
    }
  }
  in_ad == 1 && /^#EXTINF/ {
    match($0, /#EXTINF:([0-9.]+)/, arr)
    dur = arr[1]
    ad_total += dur
    ad_count++
    print "    Ad segment " ad_count ": " dur "s"
  }
'
echo ""

# Check for timing mismatches
echo -e "${YELLOW}[CRITICAL] Checking for common timing issues...${NC}"

# Issue 1: Missing PDT continuity
PDT_BEFORE_DISC=$(echo "$AD_MANIFEST" | grep -B1 '#EXT-X-DISCONTINUITY' | grep -c '#EXT-X-PROGRAM-DATE-TIME:' || echo "0")
PDT_AFTER_DISC=$(echo "$AD_MANIFEST" | grep -A1 '#EXT-X-DISCONTINUITY' | grep -c '#EXT-X-PROGRAM-DATE-TIME:' || echo "0")

if [ "$DISCONTINUITIES" -gt 0 ]; then
  if [ "$PDT_BEFORE_DISC" -lt "$DISCONTINUITIES" ]; then
    echo -e "  ${RED}❌ ISSUE: Missing PDT tags before discontinuities${NC}"
    echo "     Expected: $DISCONTINUITIES, Found: $PDT_BEFORE_DISC"
  else
    echo -e "  ${GREEN}✓ PDT tags present before discontinuities${NC}"
  fi
  
  if [ "$PDT_AFTER_DISC" -lt "$DISCONTINUITIES" ]; then
    echo -e "  ${RED}❌ ISSUE: Missing PDT tags after discontinuities${NC}"
    echo "     Expected: $DISCONTINUITIES, Found: $PDT_AFTER_DISC"
  else
    echo -e "  ${GREEN}✓ PDT tags present after discontinuities${NC}"
  fi
fi

# Issue 2: Discontinuity pairing
if [ "$DISCONTINUITIES" -ne 2 ] && [ "$DISCONTINUITIES" -ne 0 ]; then
  echo -e "  ${RED}❌ ISSUE: Discontinuity count mismatch${NC}"
  echo "     Expected: 2 (before+after ad), Found: $DISCONTINUITIES"
else
  echo -e "  ${GREEN}✓ Discontinuity pairing correct${NC}"
fi

# Issue 3: Segment duration variance
SEGMENT_VARIANCE=$(echo "$AD_MANIFEST" | grep '#EXTINF:' | sed 's/.*#EXTINF:\([0-9.]*\).*/\1/' | awk '
  { 
    sum += $1; 
    sumsq += ($1)^2; 
    count++ 
  } 
  END { 
    if (count > 0) {
      mean = sum/count
      variance = (sumsq/count) - (mean^2)
      stddev = sqrt(variance > 0 ? variance : 0)
      print stddev
    } else {
      print 0
    }
  }
')

if (( $(echo "$SEGMENT_VARIANCE > 2.0" | bc -l) )); then
  echo -e "  ${YELLOW}⚠ WARNING: High segment duration variance (${SEGMENT_VARIANCE}s)${NC}"
  echo "     This may cause buffering"
else
  echo -e "  ${GREEN}✓ Segment duration variance acceptable (${SEGMENT_VARIANCE}s)${NC}"
fi

echo ""
echo -e "${BLUE}[4/5] Fetching worker logs...${NC}"
echo "Tailing logs for 5 seconds (Ctrl+C to skip)..."
timeout 5s wrangler tail cf-ssai --format pretty 2>&1 | grep -E "(segment duration|PDT|Segments to skip|Ad duration|SCTE-35|duration mismatch)" || echo "  ⚠ No relevant logs captured"
echo ""

echo -e "${BLUE}[5/5] Summary & Recommendations${NC}"
echo "================================"

# Save manifest for manual inspection
MANIFEST_FILE="/tmp/ssai-debug-manifest-$(date +%s).m3u8"
echo "$AD_MANIFEST" > "$MANIFEST_FILE"
echo "📄 Full manifest saved to: $MANIFEST_FILE"
echo ""

echo "🔍 To manually inspect:"
echo "   cat $MANIFEST_FILE"
echo ""
echo "📊 To analyze with video player:"
echo "   ffprobe -v quiet -print_format json -show_format -show_streams $MANIFEST_FILE"
echo ""
echo "🎥 To test playback:"
echo "   ffplay $MANIFEST_FILE"
echo ""

# Cleanup
./scripts/cue.sh stop --channel "$CHANNEL" 2>&1 > /dev/null || true

echo "✅ Debug complete!"
