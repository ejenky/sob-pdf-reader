#!/bin/bash
# setup.sh — Medicare SOB Extractor
# Downloads PDF.js library (required for PDF parsing)

set -e

PDFJS_VERSION="3.11.174"
LIB_DIR="$(dirname "$0")/lib"

echo "================================"
echo " Medicare SOB Extractor Setup"
echo "================================"
echo ""
echo "Downloading PDF.js v${PDFJS_VERSION}..."
echo ""

mkdir -p "$LIB_DIR"

# Download pdf.min.js
echo "[1/2] Fetching pdf.min.js..."
curl -fL \
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js" \
  -o "$LIB_DIR/pdf.min.js" \
  --progress-bar

echo "[2/2] Fetching pdf.worker.min.js..."
curl -fL \
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js" \
  -o "$LIB_DIR/pdf.worker.min.js" \
  --progress-bar

echo ""
echo "PDF.js downloaded successfully!"
echo "  -> lib/pdf.min.js"
echo "  -> lib/pdf.worker.min.js"
echo ""
echo "================================"
echo " Next Steps:"
echo "================================"
echo ""
echo "1. Open Chrome -> chrome://extensions/"
echo "2. Enable 'Developer mode' (top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select this folder: $(dirname "$0")"
echo "5. Navigate to any Medicare SOB PDF"
echo "6. Click the extension icon -> Extract!"
echo ""
