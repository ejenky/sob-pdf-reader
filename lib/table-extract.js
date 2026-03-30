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

  // Detect if this is a flowing-text (non-tabular) page: all content in ~1 column
  const isFlowing = columns.length <= 1 || (columns.length === 2 && Math.abs(columns[1] - columns[0]) < 30);

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

  // For flowing-text pages, also build a prose version (all text in reading order)
  const proseText = isFlowing
    ? filtered.sort((a, b) => a.y - b.y || a.x - b.x).map(it => it.text).join(' ')
    : '';

  return { rows: merged, rawText, proseText, isFlowing };
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
 * Check if a label looks like a fragment continuation rather than a new benefit label.
 * Fragments: "number of days)", "U.S.)", "observation services", "(ground or air,"
 * Real labels: "PCP", "Specialist", "Preventive care", "Hearing aids"
 */
function isFragmentLabel(label) {
  if (!label) return false;

  // NOT fragments — these are section titles or meaningful labels that start with lowercase
  if (/^out[- ]?of/i.test(label)) return false; // "out-of-pocket (MOOP)" section title

  // Starts with lowercase → likely a fragment (e.g. "number of days)", "covered)")
  if (/^[a-z]/.test(label)) return true;
  // Starts with punctuation or closing paren → fragment
  if (/^[)\]\-,;]/.test(label)) return true;
  // Very short and no dollar sign → could be fragment
  if (label.length < 15 && !/\$/.test(label)) {
    // But not if it matches a known benefit keyword
    if (/^(PCP|SNF|DME|Specialist|Preventive|Emergency|Ambulance|Dental|Vision|Hearing|Routine|Contacts)/i.test(label)) {
      return false;
    }
    // Fragment-like patterns: "number of days)", "one-way trip)", "U.S.)"
    if (/\)$/.test(label)) return true;
    if (/^(of|and|or|the|for|per|in|to|at|by|on)\s/i.test(label)) return true;
  }
  // Contains "covered" as a standalone label for multi-line "non-Medicare covered"
  if (/^covered\)?$/i.test(label)) return true;
  return false;
}

/**
 * Merge continuation rows into their parent row.
 * A continuation row is one where:
 *   - Column 0 is empty (no label), OR
 *   - Column 0 has a short fragment that continues the previous label
 *     (e.g. "number of days)" continuing "Inpatient (unlimited")
 */
function mergeMultiLineRows(rows) {
  const merged = [];
  for (const row of rows) {
    const label = (row.label || '').trim();
    const labelEmpty = !label;
    const hasData = row.inNetwork || row.outOfNetwork;

    // Detect label continuations: short text fragments that aren't standalone benefit labels
    const isLabelContinuation = !labelEmpty && hasData && merged.length > 0 && isFragmentLabel(label);

    if ((labelEmpty || isLabelContinuation) && hasData && merged.length > 0) {
      // Continuation of previous row — merge data columns
      const prev = merged[merged.length - 1];
      if (isLabelContinuation) {
        prev.label = (prev.label ? prev.label + ' ' : '') + label;
      }
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
