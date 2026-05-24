#!/usr/bin/env bash
# Record a backup demo video using macOS screencapture.
# Usage:  ./scripts/record-demo.sh [SECONDS]    (default 180s)
#
# After this runs:
# 1. The script blocks N seconds while recording the WHOLE screen
# 2. Save lands at ~/Desktop/blackmamba-demo-<timestamp>.mov
# 3. Trim in QuickTime if needed (Cmd+T to trim)

set -euo pipefail

DURATION="${1:-180}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$HOME/Desktop/blackmamba-demo-${TS}.mov"

echo "→ Recording $DURATION seconds of full screen to $OUT"
echo "→ Run the demo NOW. Recording starts in 3..."
sleep 1; echo "2..."
sleep 1; echo "1..."
sleep 1; echo "REC ●"

# -v: video, -V: duration in seconds, -t mov: format
screencapture -v -V "$DURATION" -t mov "$OUT"

echo ""
echo "✓ Saved: $OUT"
echo "→ Open in QuickTime, trim (Cmd+T), save as ~/Desktop/blackmamba-demo-FINAL.mov"
