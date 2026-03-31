// test-parse.js — Run the SOB parser on a local PDF file via Node.js
// Usage: node test-parse.js /path/to/file.pdf [plan-index]
//   plan-index: optional, 0-based index of plan to extract from multi-plan PDFs

const fs = require('fs');
const path = require('path');

// Polyfill window for our browser modules
global.window = global;
global.Normalizer = null;
global.SOBParser = null;
global.TableExtract = null;
global.MultiPlan = null;

// Load our modules
require('./lib/normalizer.js');
require('./lib/carrier-detect.js');
require('./lib/parsers/base-parser.js');
require('./lib/parsers/generic.js');
require('./lib/parsers/aetna.js');
require('./lib/parsers/uhc.js');
require('./lib/parsers/anthem.js');
require('./lib/parsers/healthspring.js');
require('./lib/parsers/clearspring.js');
require('./lib/parsers/zing.js');
require('./lib/parsers/clover.js');
require('./lib/parsers/kaiser.js');
require('./lib/parsers/molina.js');
require('./lib/parsers/bcbsnc.js');
require('./lib/parsers/wellcare.js');
require('./lib/sob-parser.js');
require('./lib/multi-plan.js');

// We need to rewrite table-extract for Node since it uses PDF.js differently
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const ROW_TOLERANCE = 5;
const HEADER_FOOTER_MARGIN = 30;

function isFragmentLabel(label) {
  if (!label) return false;
  if (/^out[- ]?of/i.test(label)) return false;
  if (/^[a-z]/.test(label)) return true;
  if (/^[)\]\-,;]/.test(label)) return true;
  if (label.length < 15 && !/\$/.test(label)) {
    if (/^(PCP|SNF|DME|Specialist|Preventive|Emergency|Ambulance|Dental|Vision|Hearing|Routine|Contacts)/i.test(label)) {
      return false;
    }
    if (/\)$/.test(label)) return true;
    if (/^(of|and|or|the|for|per|in|to|at|by|on)\s/i.test(label)) return true;
  }
  if (/^covered\)?$/i.test(label)) return true;
  return false;
}

function detectColumns(rows) {
  for (const row of rows) {
    const benefitItem = row.find(it => /^Benefit$/i.test(it.text) && it.x < 150);
    if (!benefitItem) continue;
    const yourItems = row.filter(it => /^Your$/i.test(it.text) && it.x > benefitItem.x + 50);
    if (yourItems.length === 0) continue;
    yourItems.sort((a, b) => a.x - b.x);
    const cols = [benefitItem.x];
    cols.push(yourItems[0].x);
    if (yourItems.length >= 2 && yourItems[1].x - yourItems[0].x > 80) {
      cols.push(yourItems[1].x);
    }
    return cols;
  }

  // Fallback: cluster dollar positions
  const dollarXPositions = [];
  for (const row of rows) {
    for (const item of row) {
      if (/^\$[\d,]/.test(item.text)) {
        dollarXPositions.push(Math.round(item.x));
      }
    }
  }
  if (dollarXPositions.length > 0) {
    dollarXPositions.sort((a, b) => a - b);
    const clusters = [dollarXPositions[0]];
    for (const x of dollarXPositions) {
      if (x - clusters[clusters.length - 1] > 80) clusters.push(x);
    }
    let minX = Infinity;
    for (const row of rows) {
      for (const item of row) {
        if (item.x < minX) minX = item.x;
      }
    }
    if (clusters.length >= 2) return [minX, clusters[0], clusters[1]];
    if (clusters.length === 1) return [minX, clusters[0]];
  }

  let minX = Infinity;
  for (const row of rows) {
    for (const item of row) {
      if (item.x < minX) minX = item.x;
    }
  }
  return [minX];
}

function assignColumn(x, columns) {
  const TOLERANCE = 15;
  let bestIdx = 0;
  for (let i = 1; i < columns.length; i++) {
    if (x >= columns[i] - TOLERANCE) bestIdx = i;
  }
  return bestIdx;
}

/**
 * Extract raw text items from a page (for multi-plan detection)
 */
async function extractPageRaw(page, pageNum) {
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const textContent = await page.getTextContent();
  const items = textContent.items
    .filter(item => item.str && item.str.trim())
    .map(item => ({
      text: item.str.trim().replace(/[\u2010-\u2015\u2212]/g, '-'),
      x: item.transform[4],
      y: pageHeight - item.transform[5],
      width: item.width,
      height: item.height,
      fontSize: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12
    }));

  return { items, pageWidth, pageHeight, pageNum };
}

async function extractPage(page) {
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const textContent = await page.getTextContent();
  const items = textContent.items.filter(item => item.str && item.str.trim());

  const mapped = items.map(item => ({
    text: item.str.trim().replace(/[\u2010-\u2015\u2212]/g, '-'),
    x: item.transform[4],
    y: pageHeight - item.transform[5],
    width: item.width,
    height: item.height,
    fontSize: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12
  }));

  const filtered = mapped.filter(item =>
    item.y > HEADER_FOOTER_MARGIN && item.y < pageHeight - HEADER_FOOTER_MARGIN
  );

  if (filtered.length === 0) return { rows: [], rawText: '' };

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
  rows.forEach(row => row.sort((a, b) => a.x - b.x));

  const columns = detectColumns(rows);

  // Detect if this is a flowing-text (non-tabular) page
  const isFlowing = columns.length <= 1 || (columns.length === 2 && Math.abs(columns[1] - columns[0]) < 30);

  const structuredRows = rows.map(rowItems => {
    const avgY = rowItems.reduce((s, it) => s + it.y, 0) / rowItems.length;
    const maxFontSize = Math.max(...rowItems.map(it => it.fontSize));
    const cellsByCol = {};
    for (const item of rowItems) {
      const colIdx = assignColumn(item.x, columns);
      if (!cellsByCol[colIdx]) cellsByCol[colIdx] = [];
      cellsByCol[colIdx].push(item.text);
    }
    const cells = {};
    for (const [colIdx, texts] of Object.entries(cellsByCol)) {
      cells[colIdx] = texts.join(' ');
    }
    return {
      y: avgY,
      fontSize: maxFontSize,
      cells,
      colCount: Object.keys(cells).length,
      label: cells[0] || '',
      inNetwork: cells[1] || '',
      outOfNetwork: cells[2] || ''
    };
  });

  // Merge continuation rows
  const merged = [];
  for (const row of structuredRows) {
    const label = (row.label || '').trim();
    const labelEmpty = !label;
    const hasData = row.inNetwork || row.outOfNetwork;
    const isLabelContinuation = !labelEmpty && hasData && merged.length > 0 && isFragmentLabel(label);

    if ((labelEmpty || isLabelContinuation) && hasData && merged.length > 0) {
      const prev = merged[merged.length - 1];
      if (isLabelContinuation) prev.label = (prev.label ? prev.label + ' ' : '') + label;
      if (row.inNetwork) prev.inNetwork = (prev.inNetwork ? prev.inNetwork + ' ' : '') + row.inNetwork;
      if (row.outOfNetwork) prev.outOfNetwork = (prev.outOfNetwork ? prev.outOfNetwork + ' ' : '') + row.outOfNetwork;
    } else if (labelEmpty && !hasData) {
      continue;
    } else {
      merged.push({ ...row });
    }
  }

  const rawText = merged.map(r => {
    const parts = [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');

  // Always build prose text (all text in reading order) for flowing-text format detection
  const proseText = filtered.sort((a, b) => a.y - b.y || a.x - b.x).map(it => it.text).join(' ');

  return { rows: merged, rawText, proseText, isFlowing };
}

async function main() {
  const pdfPath = process.argv[2];
  const planIndex = process.argv[3] !== undefined ? parseInt(process.argv[3]) : null;

  if (!pdfPath) {
    console.error('Usage: node test-parse.js <pdf-file> [plan-index]');
    process.exit(1);
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
  console.log(`PDF loaded: ${pdf.numPages} pages\n`);

  // Phase 1: Extract raw items for multi-plan detection
  const pagesRaw = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const rawPage = await extractPageRaw(page, i - 1);
    pagesRaw.push(rawPage);
  }

  // Phase 2: Detect multiple plans
  const detectedPlans = MultiPlan.detectMultiplePlans(pagesRaw);

  if (detectedPlans.length > 0) {
    console.log(`=== MULTI-PLAN PDF DETECTED: ${detectedPlans.length} plans ===`);
    for (let i = 0; i < detectedPlans.length; i++) {
      const p = detectedPlans[i];
      console.log(`  [${i}] ${p.name} (${p.hNumber}) — ${p.type}` +
        (p.type === 'section' ? `, pages ${p.startPage + 1}-${p.endPage + 1}` : '') +
        (p.type === 'column' ? `, xMin=${Math.round(p.xMin)} xMax=${Math.round(p.xMax)}` : ''));
    }
    console.log('');

    if (planIndex === null) {
      console.log('To extract a specific plan, run: node test-parse.js <pdf-file> <plan-index>');
      console.log('Example: node test-parse.js ' + pdfPath + ' 0');

      // Also run the default (unfiltered) parse for comparison
      console.log('\n=== DEFAULT (UNFILTERED) PARSE ===');
    } else if (planIndex >= 0 && planIndex < detectedPlans.length) {
      const selectedPlan = detectedPlans[planIndex];
      console.log(`=== EXTRACTING PLAN [${planIndex}]: ${selectedPlan.name} ===\n`);

      // Phase 3: Extract all pages structured
      const allPages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const pageData = await extractPage(page);
        allPages.push(pageData);
      }

      // Phase 4: Filter for selected plan
      const filteredPages = MultiPlan.filterForPlan(allPages, selectedPlan, pagesRaw);

      console.log(`Filtered to ${filteredPages.length} pages\n`);

      // Debug: show some rows
      console.log('=== SAMPLE FILTERED ROWS ===');
      for (let p = 0; p < Math.min(3, filteredPages.length); p++) {
        for (const row of filteredPages[p].rows.slice(0, 5)) {
          console.log(`  Label: "${row.label}" | InNet: "${row.inNetwork}"`);
        }
      }

      // Parse
      console.log('\n=== PARSED RESULTS ===');
      const result = SOBParser.parse(filteredPages, pagesRaw);
      for (const [key, value] of Object.entries(result)) {
        console.log(`${key}: ${value}`);
      }
      return;
    } else {
      console.error(`Invalid plan index ${planIndex}. Must be 0-${detectedPlans.length - 1}`);
      process.exit(1);
    }
  }

  // Standard single-plan extraction
  const allPages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pct = 20 + Math.round((i / pdf.numPages) * 50);
    const page = await pdf.getPage(i);
    const pageData = await extractPage(page);
    allPages.push(pageData);
  }

  // Debug: show Inpatient-related rows
  console.log('=== INPATIENT ROWS (debug) ===');
  for (let p = 0; p < allPages.length; p++) {
    for (const row of allPages[p].rows) {
      if (/inpatient/i.test(row.label) && !/outpatient|psychiatric/i.test(row.label)) {
        console.log(`Page ${p + 1}:`);
        console.log(`  Label: "${row.label}"`);
        console.log(`  InNet: "${row.inNetwork}"`);
        console.log(`  OONet: "${row.outOfNetwork}"`);
      }
    }
  }

  // Debug: show rawText around Inpatient
  console.log('\n=== RAW TEXT AROUND INPATIENT ===');
  for (let p = 0; p < allPages.length; p++) {
    const raw = allPages[p].rawText.replace(/[\u2010-\u2015]/g, '-');
    const idx = raw.search(/\bInpatient\b(?!.*psychiatric)/i);
    if (idx !== -1) {
      const after = raw.substring(idx, idx + 600);
      const stopIdx = after.search(/\bOutpatient\b/i);
      const segment = stopIdx > 0 ? after.substring(0, stopIdx) : after;
      console.log(`Page ${p + 1} segment:\n${segment}\n`);

      // Test the regex
      const tiers = [...segment.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
      console.log(`Tiers found: ${tiers.length}`);
      tiers.forEach(m => console.log(`  $${m[1]} days ${m[2]}-${m[3]}`));
    }
  }

  // Run the actual parser
  console.log('\n=== PARSED RESULTS ===');
  const result = SOBParser.parse(allPages, pagesRaw);
  for (const [key, value] of Object.entries(result)) {
    console.log(`${key}: ${value}`);
  }
}

main().catch(console.error);
