#!/usr/bin/env bash
# Site trailer: .ai3d/capture/trailer/f*.jpg (recorded by src/trailer.js at 30 fps), 720p for the web
#   -> public/assets/site/trailer.mp4 (H.264, plays everywhere) + trailer.jpg (poster)
set -euo pipefail
cd "$(dirname "$0")/.."
IN=.ai3d/capture/trailer
OUT=public/assets/site
mkdir -p "$OUT"
N=$(ls "$IN" | wc -l)
DUR=$(awk "BEGIN { print $N / 30 }")
VF="scale=1280:720:flags=lanczos,fade=t=in:st=0:d=0.5,fade=t=out:st=$(awk "BEGIN { print $DUR - 0.7 }"):d=0.7"
ffmpeg -y -v error -framerate 30 -i "$IN/f%05d.jpg" -vf "$VF" \
  -c:v libx264 -preset slow -tune film -crf 33 -pix_fmt yuv420p -movflags +faststart -an "$OUT/trailer.mp4"
ffmpeg -y -v error -i "$IN/f00060.jpg" -vf "scale=1280:720:flags=lanczos" -q:v 4 "$OUT/trailer.jpg"
ls -la "$OUT"/trailer.*
