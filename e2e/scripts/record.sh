#!/bin/sh
# Runs the e2e test with video on, then writes docs/media/demo.mp4 and demo.gif
# for the README. Needs ffmpeg.
set -e
cd "$(dirname "$0")/.."
rm -rf test-results
RECORD=1 npx playwright test
video=$(find test-results -name '*.webm' | head -n 1)
[ -n "$video" ] || { echo "No video recorded" >&2; exit 1; }
mkdir -p ../docs/media
ffmpeg -y -loglevel error -i "$video" -c:v libx264 -pix_fmt yuv420p -movflags +faststart ../docs/media/demo.mp4
ffmpeg -y -loglevel error -i "$video" -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" ../docs/media/demo.gif
echo "Wrote docs/media/demo.mp4 and docs/media/demo.gif"
