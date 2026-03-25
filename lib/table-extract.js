// table-extract.js — Spatial table reconstruction from PDF.js text items
// Solves the column interleaving problem by using X/Y coordinates to rebuild rows

const ROW_TOLERANCE = 5;       // Y-distance threshold for same-row grouping (points)
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

  // Step 2: Detect column boundaries from table header rows
  const columns = detectColumns(rows, filtered);

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
 * Detect column boundaries by looking for table header rows.
 * Medicare SOB PDFs have headers like:
 *   "Benefit | Your in-network costs | Your out-of-network costs"
 *   "Benefit | Your costs in our plan"
 * We find these header rows and use their X positions as column boundaries.
 * Falls back to a frequency-based approach if no header is found.
 */
function detectColumns(rows, allItems) {
  // Strategy 1: Find table header rows with known keywords
  const headerPatterns = [
    { label: /^Benefit$/i, col1: /in-network\s*costs/i, col2: /out-of-network\s*costs/i },
    { label: /^Benefit$/i, col1: /costs?\s*in\s*our\s*plan/i },
    { label: /^Benefit$/i, col1: /your\s*costs/i },
  ];

  for (const row of rows) {
    const rowText = row.map(it => it.text).join(' ');

    for (const pattern of headerPatterns) {
      // Check if this row contains a "Benefit" label
      const benefitItem = row.find(it => pattern.label.test(it.text));
      if (!benefitItem) continue;

      // Look for column 1 header
      const col1Text = rowText;
      const col1Match = pattern.col1 && pattern.col1.test(col1Text);
      if (!col1Match) continue;

      // Find the X position of the column headers
      const col0X = benefitItem.x;

      // Find the "Your" or "$" that starts the in-network column
      // It's the first item after "Benefit" that starts a cost column header
      let col1X = null;
      let col2X = null;

      // Find items that contain "Your" or "in-network" after the Benefit label
      const afterBenefit = row.filter(it => it.x > benefitItem.x + benefitItem.width);
      if (afterBenefit.length > 0) {
        col1X = afterBenefit[0].x;
      }

      // Check for out-of-network column
      if (pattern.col2) {
        for (const item of row) {
          if (pattern.col2.test(item.text) || /out-of-network/i.test(item.text)) {
            col2X = item.x;
            break;
          }
        }
        // If we didn't find exact match, look for second "Your" in the row
        if (!col2X) {
          const yourItems = row.filter(it => /^Your$/i.test(it.text));
          if (yourItems.length >= 2) {
            col2X = yourItems[1].x;
          }
        }
      }

      if (col1X) {
        const cols = [col0X];
        cols.push(col1X);
        if (col2X && col2X > col1X + 30) cols.push(col2X);
        return cols;
      }
    }
  }

  // Strategy 2: Look for rows with exactly "Your" appearing 1 or 2 times
  // This catches header rows we might have missed
  for (const row of rows) {
    const yourItems = row.filter(it => /^Your$/i.test(it.text));
    const benefitItem = row.find(it => /^Benefit$/i.test(it.text));

    if (benefitItem && yourItems.length >= 1) {
      const cols = [benefitItem.x];
      // Sort "Your" items by X to get column order
      yourItems.sort((a, b) => a.x - b.x);
      cols.push(yourItems[0].x);
      if (yourItems.length >= 2) cols.push(yourItems[1].x);
      return cols;
    }
  }

  // Strategy 3: Frequency-based — find the most common X-start positions
  // Group X positions into clusters and pick the top 2-3
  const xBuckets = {};
  for (const item of allItems) {
    const bucket = Math.round(item.x / 10) * 10; // Round to nearest 10
    xBuckets[bucket] = (xBuckets[bucket] || 0) + 1;
  }

  const sortedBuckets = Object.entries(xBuckets)
    .map(([x, count]) => ({ x: parseFloat(x), count }))
    .sort((a, b) => b.count - a.count);

  // Take top 3 most common X positions (spaced apart by at least 80px)
  const cols = [sortedBuckets[0].x];
  for (const bucket of sortedBuckets.slice(1)) {
    if (cols.every(c => Math.abs(bucket.x - c) > 80)) {
      cols.push(bucket.x);
      if (cols.length >= 3) break;
    }
  }

  cols.sort((a, b) => a - b);
  return cols;
}

/**
 * Assign an X position to its column index using floor assignment.
 * Each item belongs to the column whose start X is the largest value
 * that doesn't exceed the item's X position (with a small tolerance).
 */
function assignColumn(x, columns) {
  const TOLERANCE = 15;
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
