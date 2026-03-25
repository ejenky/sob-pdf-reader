// table-extract.js — Spatial table reconstruction from PDF.js text items
// Solves the column interleaving problem by using X/Y coordinates to rebuild rows

const ROW_TOLERANCE = 5;       // Y-distance threshold for same-row grouping (points)
const COL_GAP_THRESHOLD = 40;  // Minimum X gap to detect a column boundary (points)
const HEADER_FOOTER_MARGIN = 30; // Points from top/bottom edge to ignore

/**
 * Extract structured table data from a single PDF page
 * @param {Object} page - PDF.js page object
 * @returns {Object} { pageNum, rows: [{ y, cells: [{x, text}] }], rawText }
 */
async function extractPageStructured(page) {
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const textContent = await page.getTextContent();
  const items = textContent.items.filter(item => item.str && item.str.trim());

  // Convert PDF coordinates (origin bottom-left) to top-down Y
  // Normalize unicode hyphens in all text items
  const mapped = items.map(item => ({
    text: item.str.trim().replace(/[\u2010-\u2015\u2212]/g, '-'),
    x: item.transform[4],
    y: pageHeight - item.transform[5], // flip to top-down
    width: item.width,
    height: item.height,
    fontSize: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12
  }));

  // Filter out header/footer items (too close to page edges)
  const filtered = mapped.filter(item =>
    item.y > HEADER_FOOTER_MARGIN && item.y < pageHeight - HEADER_FOOTER_MARGIN
  );

  if (filtered.length === 0) return { rows: [], rawText: '' };

  // Step 1: Group items into rows by Y-coordinate clustering
  const sorted = [...filtered].sort((a, b) => a.y - b.y);
  const rows = [];
  let currentRow = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= ROW_TOLERANCE) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Sort items within each row by X position (left to right)
  rows.forEach(row => row.sort((a, b) => a.x - b.x));

  // Step 2: Detect column boundaries across the page
  const columns = detectColumns(filtered);

  // Step 3: Build structured rows with column assignments
  const structuredRows = rows.map(rowItems => {
    const avgY = rowItems.reduce((s, it) => s + it.y, 0) / rowItems.length;
    const maxFontSize = Math.max(...rowItems.map(it => it.fontSize));

    // Assign each item to a column
    const cellsByCol = {};
    for (const item of rowItems) {
      const colIdx = assignColumn(item.x, columns);
      if (!cellsByCol[colIdx]) cellsByCol[colIdx] = [];
      cellsByCol[colIdx].push(item.text);
    }

    // Join text within each column cell
    const cells = {};
    for (const [colIdx, texts] of Object.entries(cellsByCol)) {
      cells[colIdx] = texts.join(' ');
    }

    return {
      y: avgY,
      fontSize: maxFontSize,
      cells: cells,
      colCount: Object.keys(cells).length,
      // Convenience: first col is typically the label
      label: cells[0] || '',
      inNetwork: cells[1] || '',
      outOfNetwork: cells[2] || ''
    };
  });

  // Step 4: Merge multi-line cells (continuation rows where col 0 is empty)
  const merged = mergeMultiLineRows(structuredRows);

  // Build raw text for fallback regex parsing
  const rawText = merged.map(r => {
    const parts = [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');

  return { rows: merged, rawText };
}

/**
 * Detect column boundaries from all text items on a page
 * Uses X-position clustering to find distinct columns
 */
function detectColumns(items) {
  if (items.length === 0) return [0];

  // Collect all X start positions
  const xPositions = items.map(it => it.x).sort((a, b) => a - b);

  // Find clusters by looking for gaps
  const columns = [xPositions[0]];
  for (let i = 1; i < xPositions.length; i++) {
    const gap = xPositions[i] - xPositions[i - 1];
    if (gap > COL_GAP_THRESHOLD) {
      columns.push(xPositions[i]);
    }
  }

  // Deduplicate nearby column starts (within 20px)
  const deduped = [columns[0]];
  for (let i = 1; i < columns.length; i++) {
    if (columns[i] - deduped[deduped.length - 1] > 20) {
      deduped.push(columns[i]);
    }
  }

  return deduped;
}

/**
 * Assign an X position to its column index using floor assignment.
 * Each item belongs to the column whose start X is the largest value
 * that doesn't exceed the item's X position (with a small tolerance).
 * This prevents text in the right half of a wide column from being
 * assigned to the next column (e.g. in-network text at X=300 being
 * assigned to out-of-network column starting at X=366).
 */
function assignColumn(x, columns) {
  const TOLERANCE = 15; // Allow items slightly left of column start
  let bestIdx = 0;
  for (let i = 1; i < columns.length; i++) {
    if (x >= columns[i] - TOLERANCE) {
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Merge continuation rows into their parent row
 * A continuation row has no label (column 0 empty) but has data in other columns,
 * OR has content that appears to continue the previous label
 */
function mergeMultiLineRows(rows) {
  const merged = [];
  for (const row of rows) {
    const labelEmpty = !row.label || row.label.trim() === '';
    const hasData = row.inNetwork || row.outOfNetwork;

    if (labelEmpty && hasData && merged.length > 0) {
      // Continuation of previous row
      const prev = merged[merged.length - 1];
      if (row.inNetwork) {
        prev.inNetwork = (prev.inNetwork ? prev.inNetwork + ' ' : '') + row.inNetwork;
      }
      if (row.outOfNetwork) {
        prev.outOfNetwork = (prev.outOfNetwork ? prev.outOfNetwork + ' ' : '') + row.outOfNetwork;
      }
    } else if (labelEmpty && !hasData) {
      // Skip empty rows
      continue;
    } else {
      merged.push({ ...row });
    }
  }
  return merged;
}

// Export for use in popup.js
if (typeof window !== 'undefined') {
  window.TableExtract = { extractPageStructured };
}
