#!/usr/bin/env bash
set -euo pipefail
# Requires: wrangler r2 object put ...
# This just demonstrates structure; replace with real files.
echo "Seeding example pod to R2 (structure only)"
wrangler r2 bucket create ads-bucket || true
wrangler r2 object put ads-bucket/example-pod/v_800k/playlist.m3u8 --file r2/example-pod/v_800k/playlist.m3u8
wrangler r2 object put ads-bucket/example-pod/v_1600k/playlist.m3u8 --file r2/example-pod/v_1600k/playlist.m3u8