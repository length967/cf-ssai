#!/bin/bash

# SSAI Comprehensive Monitoring Script
# This script provides real-time monitoring of SSAI ad insertion with color-coded output

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Configuration
WORKER_NAME="${1:-cf-ssai}"
LOG_FILE="/tmp/ssai-monitor-$(date +%Y%m%d-%H%M%S).log"
DURATION="${2:-300}" # Default 5 minutes

echo -e "${WHITE}========================================${NC}"
echo -e "${WHITE}SSAI Comprehensive Monitoring Dashboard${NC}"
echo -e "${WHITE}========================================${NC}"
echo -e "${CYAN}Worker: ${WORKER_NAME}${NC}"
echo -e "${CYAN}Log File: ${LOG_FILE}${NC}"
echo -e "${CYAN}Duration: ${DURATION}s${NC}"
echo -e "${WHITE}========================================${NC}\n"

# Create monitoring sections
echo -e "${WHITE}[LEGEND]${NC}"
echo -e "${GREEN}✓ SUCCESS${NC} - Successful operations"
echo -e "${YELLOW}⚠ WARNING${NC} - Warnings and important info"
echo -e "${RED}✗ ERROR${NC} - Errors and failures"
echo -e "${BLUE}ℹ INFO${NC} - General information"
echo -e "${MAGENTA}🎬 AD INSERTION${NC} - Ad insertion events"
echo -e "${CYAN}📺 STREAM${NC} - Stream/manifest processing"
echo -e "${WHITE}========================================${NC}\n"

# Function to colorize and format log lines
process_log_line() {
    local line="$1"

    # Ad Insertion Events
    if echo "$line" | grep -qE "shouldInsertAd|Ad insertion|SGAI|SSAI"; then
        echo -e "${MAGENTA}🎬 $(date '+%H:%M:%S')${NC} $line"

    # SCTE-35 Markers
    elif echo "$line" | grep -qE "SCTE|scte35|cue|CUE-OUT|CUE-IN"; then
        echo -e "${YELLOW}⏰ $(date '+%H:%M:%S')${NC} $line"

    # Bitrate Detection
    elif echo "$line" | grep -qE "bitrate|Bitrate|BITRATE|extractBitrates"; then
        echo -e "${CYAN}📊 $(date '+%H:%M:%S')${NC} $line"

    # Audio-Only Detection
    elif echo "$line" | grep -qE "audio-only|Audio-only|AUDIO-ONLY|hasVideoStream|FFprobe"; then
        echo -e "${BLUE}🎵 $(date '+%H:%M:%S')${NC} $line"

    # Variant Selection
    elif echo "$line" | grep -qE "variant|Variant|eligibleItems|filtered"; then
        echo -e "${CYAN}📺 $(date '+%H:%M:%S')${NC} $line"

    # Errors
    elif echo "$line" | grep -qE "ERROR|Error|error|✗|failed|Failed"; then
        echo -e "${RED}✗ $(date '+%H:%M:%S')${NC} $line"

    # Warnings
    elif echo "$line" | grep -qE "WARN|Warning|warning|⚠️"; then
        echo -e "${YELLOW}⚠ $(date '+%H:%M:%S')${NC} $line"

    # Success
    elif echo "$line" | grep -qE "SUCCESS|success|✓|completed|Completed"; then
        echo -e "${GREEN}✓ $(date '+%H:%M:%S')${NC} $line"

    # Transcode Events
    elif echo "$line" | grep -qE "Transcode|transcode|FFmpeg|ffmpeg"; then
        echo -e "${MAGENTA}🎬 $(date '+%H:%M:%S')${NC} $line"

    # Default
    else
        echo -e "${WHITE}$(date '+%H:%M:%S')${NC} $line"
    fi
}

# Start monitoring
echo -e "${GREEN}Starting live monitoring...${NC}\n"

# Run wrangler tail with timeout and process output
timeout "$DURATION" wrangler tail "$WORKER_NAME" --format pretty 2>&1 | tee "$LOG_FILE" | while IFS= read -r line; do
    process_log_line "$line"
done

echo -e "\n${WHITE}========================================${NC}"
echo -e "${GREEN}Monitoring session completed${NC}"
echo -e "${CYAN}Full logs saved to: ${LOG_FILE}${NC}"
echo -e "${WHITE}========================================${NC}"

# Generate summary
echo -e "\n${WHITE}[SUMMARY]${NC}"
echo -e "${MAGENTA}Ad Insertion Events:${NC} $(grep -c "shouldInsertAd\|Ad insertion\|SGAI\|SSAI" "$LOG_FILE" 2>/dev/null || echo 0)"
echo -e "${YELLOW}SCTE-35 Markers:${NC} $(grep -c "SCTE\|scte35\|CUE-OUT\|CUE-IN" "$LOG_FILE" 2>/dev/null || echo 0)"
echo -e "${BLUE}Audio-Only Detections:${NC} $(grep -c "audio-only\|Audio-only\|FFprobe" "$LOG_FILE" 2>/dev/null || echo 0)"
echo -e "${RED}Errors:${NC} $(grep -c "ERROR\|Error\|error\|failed" "$LOG_FILE" 2>/dev/null || echo 0)"
echo -e "${YELLOW}Warnings:${NC} $(grep -c "WARN\|Warning\|warning" "$LOG_FILE" 2>/dev/null || echo 0)"
echo -e "${GREEN}Success Events:${NC} $(grep -c "SUCCESS\|success\|completed" "$LOG_FILE" 2>/dev/null || echo 0)"
