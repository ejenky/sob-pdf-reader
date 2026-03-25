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
  const columns = detectColumns(rows);

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
 * Detect column boundaries by finding table header rows on the page.
 *
 * Medicare SOB PDFs have table headers like:
 *   PPO: "Benefit" at X~52 | "Your in-network costs" at X~174 | "Your out-of-network costs" at X~367
 *   HMO: "Benefit" at X~52 | "Your costs in our plan" at X~174
 *
 * Strategy: Find rows where "Benefit" appears as a standalone word at the LEFT edge,
 * and "Your" or "costs" appears further right. Use those X positions.
 */
function detectColumns(rows) {
  // Look for rows containing "Benefit" as a standalone label on the left side
  for (const row of rows) {
    // "Benefit" must be on the left side of the page (X < 150)
    const benefitItem = row.find(it =>
      /^Benefit$/i.test(it.text) && it.x < 150
    );
    if (!benefitItem) continue;

    // Now find column start positions by looking for "Your" keywords after "Benefit"
    // These mark the start of cost columns
    const yourItems = row.filter(it =>
      /^Your$/i.test(it.text) && it.x > benefitItem.x + 50
    );

    if (yourItems.length === 0) continue;

    // Sort by X position
    yourItems.sort((a, b) => a.x - b.x);

    const cols = [benefitItem.x];
    cols.push(yourItems[0].x); // In-network (or single cost column)

    if (yourItems.length >= 2 && yourItems[1].x - yourItems[0].x > 80) {
      cols.push(yourItems[1].x); // Out-of-network
    }

    return cols;
  }

  // Fallback: Look for rows with dollar amounts at distinct X positions
  // to infer column structure from data rows themselves
  const dollarXPositions = [];
  for (const row of rows) {
    for (const item of row) {
      if (/^\$[\d,]/.test(item.text)) {
        dollarXPositions.push(Math.round(item.x));
      }
    }
  }

  if (dollarXPositions.length > 0) {
    // Cluster dollar X positions
    dollarXPositions.sort((a, b) => a - b);
    const clusters = [dollarXPositions[0]];
    for (const x of dollarXPositions) {
      if (x - clusters[clusters.length - 1] > 80) {
        clusters.push(x);
      }
    }

    // Find the leftmost text position for column 0 (labels)
    let minX = Infinity;
    for (const row of rows) {
      for (const item of row) {
        if (item.x < minX) minX = item.x;
      }
    }

    if (clusters.length >= 2) {
      return [minX, clusters[0], clusters[1]];
    } else if (clusters.length === 1) {
      return [minX, clusters[0]];
    }
  }

  // Last resort: single column
  let minX = Infinity;
  for (const row of rows) {
    for (const item of row) {
      if (item.x < minX) minX = item.x;
    }
  }
  return [minX];
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
 * Merge continuation rows into their parent row.
 * A continuation row has no label (column 0 empty) but has data in other columns.
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
