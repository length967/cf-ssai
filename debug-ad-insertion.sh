#!/bin/bash

# Debug Ad Insertion Script
# Focused monitoring for debugging why ads aren't being inserted

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

WORKER_NAME="${1:-cf-ssai}"
DURATION="${2:-60}"

echo -e "${WHITE}================================================${NC}"
echo -e "${WHITE}  Ad Insertion Debug Monitor${NC}"
echo -e "${WHITE}================================================${NC}"
echo -e "${CYAN}Worker: ${WORKER_NAME}${NC}"
echo -e "${CYAN}Duration: ${DURATION}s${NC}"
echo -e "${WHITE}================================================${NC}\n"

echo -e "${YELLOW}What to look for:${NC}"
echo -e "  1. ${CYAN}shouldInsertAd${NC} - Is the decision being made?"
echo -e "  2. ${MAGENTA}SCTE markers${NC} - Are markers being detected?"
echo -e "  3. ${BLUE}Ad pods${NC} - Are ad pods being selected?"
echo -e "  4. ${GREEN}Variant matching${NC} - Are variants being matched?"
echo -e "  5. ${RED}Errors/Warnings${NC} - What's going wrong?"
echo -e "${WHITE}================================================${NC}\n"

# Key patterns to monitor
PATTERNS=(
    "shouldInsertAd"
    "SCTE|scte35|CUE-OUT|CUE-IN"
    "Ad pod|ad pod|pod.items"
    "audio-only|Audio-only"
    "eligibleItems|filtered"
    "bitrate.*detected"
    "ERROR|Error|failed"
    "WARN|Warning"
    "transcoded-ads"
    "master.*m3u8"
)

# Build grep pattern
GREP_PATTERN=$(IFS='|'; echo "${PATTERNS[*]}")

echo -e "${GREEN}Monitoring for key ad insertion events...${NC}\n"

# Monitor with highlighting
timeout "$DURATION" wrangler tail "$WORKER_NAME" --format pretty 2>&1 | \
    grep -E "$GREP_PATTERN" --line-buffered --color=always | \
    while IFS= read -r line; do
        timestamp=$(date '+%H:%M:%S')

        if echo "$line" | grep -qE "shouldInsertAd"; then
            echo -e "${CYAN}[$timestamp]${NC} ${MAGENTA}DECISION:${NC} $line"
        elif echo "$line" | grep -qE "SCTE|scte35|CUE"; then
            echo -e "${CYAN}[$timestamp]${NC} ${YELLOW}SCTE:${NC} $line"
        elif echo "$line" | grep -qE "pod"; then
            echo -e "${CYAN}[$timestamp]${NC} ${BLUE}POD:${NC} $line"
        elif echo "$line" | grep -qE "audio-only"; then
            echo -e "${CYAN}[$timestamp]${NC} ${GREEN}AUDIO:${NC} $line"
        elif echo "$line" | grep -qE "ERROR|failed"; then
            echo -e "${CYAN}[$timestamp]${NC} ${RED}ERROR:${NC} $line"
        elif echo "$line" | grep -qE "WARN"; then
            echo -e "${CYAN}[$timestamp]${NC} ${YELLOW}WARN:${NC} $line"
        else
            echo -e "${CYAN}[$timestamp]${NC} $line"
        fi
    done

echo -e "\n${WHITE}================================================${NC}"
echo -e "${GREEN}Debug session completed${NC}"
echo -e "${WHITE}================================================${NC}"
