// multi-plan.js — Multi-plan PDF detection and column/section filtering
// Handles two formats:
//   1. Side-by-side columns (Clover, Wellcare, ClearSpring) — plans share rows
//   2. Sequential sections (BCBS NC) — plans in separate page ranges

const MultiPlan = {

  /**
   * Detect multiple plans in a PDF by scanning raw text items from each page.
   * Called BEFORE structured extraction so we work with raw PDF text items.
   *
   * @param {Array} pagesRaw - Array of { items: [{text, x, y, ...}], pageWidth, pageHeight, pageNum }
   * @returns {Array} Array of plan objects, empty if single-plan PDF
   *   Each plan: { name, hNumber, type: 'column'|'section', columnIndex,
   *                startPage, endPage, xMin, xMax, labelXMax }
   */
  detectMultiplePlans(pagesRaw) {
    // Try sequential section detection first (BCBS NC)
    // Do this first because BCBS NC page 1 lists all H-numbers which could
    // confuse the columnar detector
    const sequential = this._detectSequentialPlans(pagesRaw);
    if (sequential.length > 1) return sequential;

    // Try columnar detection (Clover, Wellcare, ClearSpring)
    const columnar = this._detectColumnarPlans(pagesRaw);
    if (columnar.length > 1) return columnar;

    return [];
  },

  /**
   * Detect side-by-side columnar plans by finding pages where multiple plan
   * name/H-number headers appear at distinct X positions in the header area.
   *
   * Key patterns:
   *   - Wellcare page 4: "Wellcare Giveback" at x=243, "Wellcare Simple" at x=353, "Wellcare Assist" at x=463
   *     with "H2775, Plan 111," at x=243, "H2775, Plan 106," at x=353, "H2775, Plan 113," at x=463
   *   - Clover page 3: "(Plan 004)" at x=852, "(Plan 007)" at x=1052 (right half of spread)
   *   - ClearSpring page 5: "H6672-003" at x=227, "H6672-005" at x=420
   */
  _detectColumnarPlans(pagesRaw) {
    // Scan first ~12 pages for column headers
    for (let pi = 0; pi < Math.min(12, pagesRaw.length); pi++) {
      const page = pagesRaw[pi];
      const pageWidth = page.pageWidth;

      // For spread pages (width > 900), focus on the half that has
      // benefit labels like "Inpatient", "PCP", dollar values, etc.
      // Clover uses 1224px-wide spread pages where left half is intro
      // and right half is the actual benefits table.
      let xFocusMin = 0;
      if (pageWidth > 900) {
        // Check if benefit data exists on the right half
        const rightHalfLabels = page.items.filter(it =>
          it.x >= pageWidth / 2 && it.y > 100 &&
          /^(?:Inpatient|Emergency|Urgent|PCP|Specialist|Preventive|Dental|Vision|Hearing|OTC|Monthly|Deductible|MOOP|Premium)/i.test(it.text)
        );
        if (rightHalfLabels.length > 0) {
          xFocusMin = pageWidth / 2;
        }
      }

      // Collect plan identifiers in the header area (y < 250)
      const headerItems = page.items.filter(it =>
        it.y < 250 && it.y > 30 && it.x >= xFocusMin
      );

      const result = this._tryDetectColumnsOnPage(headerItems, page, pagesRaw, pi);
      if (result && result.length >= 2) return result;
    }

    return [];
  },

  /**
   * Try to detect columnar plan headers on a single page.
   */
  _tryDetectColumnsOnPage(headerItems, page, pagesRaw, pageIdx) {
    // Strategy 1: Find H-numbers at distinct X positions
    const hNumberItems = [];
    for (const item of headerItems) {
      const hMatch = item.text.match(/(H\d{4})\s*[-]\s*(\d{3})/);
      if (hMatch) {
        hNumberItems.push({
          hNumber: `${hMatch[1]}-${hMatch[2]}`,
          x: item.x,
          y: item.y,
          text: item.text
        });
        continue;
      }
      const wcMatch = item.text.match(/H(\d{4}),?\s*Plan\s*(\d{2,3})/i);
      if (wcMatch) {
        hNumberItems.push({
          hNumber: `H${wcMatch[1]}-${wcMatch[2].padStart(3, '0')}`,
          planNum: wcMatch[2],
          x: item.x,
          y: item.y,
          text: item.text
        });
        continue;
      }
    }

    let uniqueHNumbers = this._deduplicateByHNumber(hNumberItems);
    if (uniqueHNumbers.length >= 2 && this._areAtDistinctXPositions(uniqueHNumbers)) {
      const plans = this._buildColumnarPlans(uniqueHNumbers, page, pagesRaw, pageIdx);
      if (plans.length >= 2) return plans;
    }

    // Strategy 2: Find "(Plan XXX)" patterns at distinct X positions
    const planNumItems = [];
    for (const item of headerItems) {
      const planMatch = item.text.match(/\(Plan\s*(\d{3})\)/i);
      if (planMatch) {
        planNumItems.push({
          hNumber: `Plan ${planMatch[1]}`,
          planNum: planMatch[1],
          x: item.x,
          y: item.y,
          text: item.text
        });
      }
    }

    const uniquePlanNums = this._deduplicateByHNumber(planNumItems);
    if (uniquePlanNums.length >= 2 && this._areAtDistinctXPositions(uniquePlanNums)) {
      const plans = this._buildColumnarPlans(uniquePlanNums, page, pagesRaw, pageIdx);
      if (plans.length >= 2) return plans;
    }

    // Strategy 3: Find carrier plan names at distinct X positions
    const carrierNameItems = [];
    for (const item of headerItems) {
      if (/^(?:Wellcare|Clover|Clear\s*Spring|Humana|Cigna|Devoted|Zing|Kaiser)\s+\w/i.test(item.text)
          && item.text.length > 10 && item.text.length < 60
          && !/summary|benefit|contract|network|service|smart\s*card|flex\s*card|wallet|allowance/i.test(item.text)) {
        carrierNameItems.push({
          hNumber: '',
          name: item.text,
          x: item.x,
          y: item.y,
          text: item.text
        });
      }
    }

    if (carrierNameItems.length >= 2 && this._areAtDistinctXPositions(carrierNameItems)) {
      for (const cn of carrierNameItems) {
        for (const item of headerItems) {
          if (Math.abs(item.x - cn.x) < 30 && Math.abs(item.y - cn.y) < 80) {
            const hMatch = item.text.match(/(H\d{4})\s*[-]\s*(\d{3})/);
            if (hMatch) {
              cn.hNumber = `${hMatch[1]}-${hMatch[2]}`;
              break;
            }
            const wcMatch = item.text.match(/H(\d{4}),?\s*Plan\s*(\d{2,3})/i);
            if (wcMatch) {
              cn.hNumber = `H${wcMatch[1]}-${wcMatch[2].padStart(3, '0')}`;
              cn.planNum = wcMatch[2];
              break;
            }
          }
        }
      }
      const plans = this._buildColumnarPlans(carrierNameItems, page, pagesRaw, pageIdx);
      if (plans.length >= 2) return plans;
    }

    return null;
  },

  /**
   * Refine column X positions by looking at actual data items ($ values)
   * near each plan's header position. H-numbers may be centered in their column,
   * while data values start at the left edge.
   */
  _refineColumnPositions(sortedColumns, page, pagesRaw, pageIdx) {
    const refined = [];

    // Gather $ data items from this page and nearby pages
    const dataItems = [];
    for (let pi = Math.max(0, pageIdx); pi < Math.min(pageIdx + 4, pagesRaw.length); pi++) {
      for (const item of pagesRaw[pi].items) {
        if (/^\$[\d,]/.test(item.text) && item.y > 100) {
          dataItems.push(item);
        }
      }
    }

    if (dataItems.length === 0) {
      // No data items found, use H-number positions as-is
      return sortedColumns.map((col, i) => ({
        xMin: col.x - 10,
        xMax: (i < sortedColumns.length - 1) ? sortedColumns[i + 1].x - 10 : page.pageWidth
      }));
    }

    // Cluster data item X positions
    const dataXPositions = dataItems.map(it => Math.round(it.x));
    dataXPositions.sort((a, b) => a - b);
    const clusters = [];
    let clusterStart = dataXPositions[0];
    let clusterItems = [dataXPositions[0]];
    for (let i = 1; i < dataXPositions.length; i++) {
      if (dataXPositions[i] - clusterStart < 40) {
        clusterItems.push(dataXPositions[i]);
      } else {
        clusters.push(Math.min(...clusterItems));
        clusterStart = dataXPositions[i];
        clusterItems = [dataXPositions[i]];
      }
    }
    if (clusterItems.length > 0) clusters.push(Math.min(...clusterItems));

    // For each plan column, find the closest data cluster
    for (let i = 0; i < sortedColumns.length; i++) {
      const col = sortedColumns[i];
      // Find the data cluster closest to this column's header X
      // (within a reasonable range — data should be near the header)
      let bestCluster = null;
      let bestDist = Infinity;
      for (const clusterX of clusters) {
        const dist = Math.abs(clusterX - col.x);
        // Data cluster should be within 80px of the header and preferably at or left of it
        if (dist < bestDist && dist < 100) {
          bestDist = dist;
          bestCluster = clusterX;
        }
      }

      if (bestCluster !== null) {
        const xMin = bestCluster - 5;
        // xMax: next column's refined xMin, or page width
        refined.push({ xMin });
      } else {
        refined.push({ xMin: col.x - 10 });
      }
    }

    // Set xMax for each column based on next column's xMin
    for (let i = 0; i < refined.length; i++) {
      refined[i].xMax = (i < refined.length - 1)
        ? refined[i + 1].xMin
        : page.pageWidth;
    }

    return refined;
  },

  /**
   * Find ALL occurrences of plan identifiers on a page (including duplicates
   * from spread pages). Returns all items, not deduplicated.
   */
  _findAllPlanOccurrences(uniquePlans, page) {
    const allOccs = [];
    for (const plan of uniquePlans) {
      for (const item of page.items) {
        if (item.y > 250 || item.y < 30) continue;
        if (plan.hNumber) {
          if (item.text.includes(plan.hNumber)) {
            allOccs.push({ ...plan, x: item.x, y: item.y });
          }
          // Also check for Wellcare format
          if (plan.planNum) {
            const wcRe = new RegExp(`H\\d{4},?\\s*Plan\\s*${plan.planNum}`, 'i');
            if (wcRe.test(item.text) && !allOccs.some(o => Math.abs(o.x - item.x) < 20 && o.hNumber === plan.hNumber)) {
              allOccs.push({ ...plan, x: item.x, y: item.y });
            }
          }
        }
        if (plan.planNum) {
          const planRe = new RegExp(`\\(Plan\\s*${plan.planNum}\\)`, 'i');
          if (planRe.test(item.text) && !allOccs.some(o => Math.abs(o.x - item.x) < 20 && o.planNum === plan.planNum)) {
            allOccs.push({ ...plan, x: item.x, y: item.y });
          }
        }
      }
    }
    return allOccs;
  },

  /**
   * Deduplicate plan items by H-number, keeping only the first occurrence
   * of each unique plan.
   */
  _deduplicateByHNumber(items) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = item.hNumber || item.name || item.text;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    return unique;
  },

  /**
   * Check if plan items are at distinct X positions (>50px apart).
   * This distinguishes columnar layouts from lists on the same page.
   */
  _areAtDistinctXPositions(items) {
    if (items.length < 2) return false;
    const sorted = [...items].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x - sorted[i - 1].x < 50) return false;
    }
    return true;
  },

  /**
   * Build plan objects from detected column header items.
   * Determines X boundaries and finds plan names.
   *
   * For spread pages (Clover), the same column structure repeats on both halves.
   * We detect this and store multiple column regions per plan.
   */
  _buildColumnarPlans(columnItems, page, pagesRaw, pageIdx) {
    const plans = [];
    const pageWidth = page.pageWidth;

    // Sort by X position
    const sorted = [...columnItems].sort((a, b) => a.x - b.x);

    // Detect spread pages: look for the same plan identifiers repeated at different X positions
    const allOccurrences = this._findAllPlanOccurrences(sorted, page);

    // Refine column boundaries by looking at actual data items ($ values)
    // on this page or nearby pages. The H-number position may be centered in
    // the column, while data values start at the left edge of the column.
    const refinedPositions = this._refineColumnPositions(sorted, page, pagesRaw, pageIdx);

    // Find the label column for the primary (detected) column region
    const firstColX = sorted[0].x;
    const refinedFirstXMin = refinedPositions[0]?.xMin;
    let labelXMax = (refinedFirstXMin !== undefined ? refinedFirstXMin : firstColX) - 5;
    let labelXMin = 0;

    // For spread pages, find label column for the detected half
    const labelCandidates = page.items.filter(it =>
      it.x < (refinedFirstXMin || firstColX) - 20 && it.y > 100 &&
      it.text.length > 3 && /^[A-Z]/i.test(it.text)
    );
    if (pageWidth > 900) {
      const halfBoundary = pageWidth / 2;
      const sameHalfLabels = labelCandidates.filter(it =>
        (firstColX >= halfBoundary && it.x >= halfBoundary - 50) ||
        (firstColX < halfBoundary && it.x < halfBoundary)
      );
      if (sameHalfLabels.length > 0) {
        labelXMin = Math.min(...sameHalfLabels.map(it => it.x)) - 5;
      }
    }

    for (let i = 0; i < sorted.length; i++) {
      const col = sorted[i];
      const refined = refinedPositions[i] || {};
      const xMin = refined.xMin !== undefined ? refined.xMin : col.x - 10;
      const xMax = refined.xMax !== undefined ? refined.xMax :
        ((i < sorted.length - 1)
          ? (refinedPositions[i + 1]?.xMin !== undefined ? refinedPositions[i + 1].xMin : sorted[i + 1].x - 10)
          : pageWidth);

      // Find plan name
      let planName = col.name || '';
      if (!planName) {
        // Look for name text near this column's X position in header area
        const candidates = page.items.filter(it =>
          Math.abs(it.x - col.x) < 30 && it.y < 250 && it.y > 30 &&
          it.text.length > 5 &&
          !/^H\d{4}|^\(Plan|^Plan\s*\d|^Y\d{4}|^\d+$/.test(it.text) &&
          !/summary|benefit|note:|services with/i.test(it.text)
        );
        // Prefer the longest carrier-name-like text
        candidates.sort((a, b) => b.text.length - a.text.length);
        for (const c of candidates) {
          if (/health|medicare|wellcare|clover|clear\s*spring|humana|cigna|devoted|zing|kaiser/i.test(c.text)) {
            planName = c.text;
            break;
          }
        }
        if (!planName && candidates.length > 0) {
          planName = candidates[0].text;
        }
      }

      // Also try page 1 for plan names if we're on a later page
      if (!planName && pagesRaw[0]) {
        const page1Items = pagesRaw[0].items;
        // Look for plan names listed in order
        const nameItems = page1Items.filter(it =>
          it.text.length > 10 &&
          /health|medicare|wellcare|clover|clear\s*spring/i.test(it.text) &&
          !/has\s*a\s*network|contract|summary|enrolled|member|entitled/i.test(it.text)
        );
        if (nameItems.length > i) {
          planName = nameItems[i].text;
        }
      }

      // Build display name: plan name + H-number if not already included
      const hNum = col.hNumber || '';
      let displayName = planName || '';
      if (displayName && hNum && !displayName.includes(hNum)) {
        displayName = displayName + ' ' + hNum;
      }
      if (!displayName) displayName = hNum || `Plan ${i + 1}`;

      // Build column regions: primary region + any additional regions from spread pages
      const regions = [{
        labelXMin: labelXMin,
        labelXMax: labelXMax,
        valueXMin: xMin,
        valueXMax: xMax
      }];

      // For spread pages, find matching columns on other halves
      if (allOccurrences.length > sorted.length) {
        const myOccurrences = allOccurrences.filter(occ =>
          occ.hNumber === col.hNumber || occ.planNum === col.planNum
        );
        for (const occ of myOccurrences) {
          // Skip if this is the same occurrence we already have
          if (Math.abs(occ.x - col.x) < 50) continue;

          // Find the label column for this occurrence's region
          const occLabelXMax = occ.x - 10;
          let occLabelXMin = 0;
          const occHalf = occ.x >= pageWidth / 2 ? 'right' : 'left';
          const occLabels = labelCandidates.filter(it => {
            if (occHalf === 'right') return it.x >= pageWidth / 2 - 50 && it.x < occ.x - 20;
            return it.x < pageWidth / 2 && it.x < occ.x - 20;
          });
          if (occLabels.length > 0) {
            occLabelXMin = Math.min(...occLabels.map(it => it.x)) - 5;
          }

          // Find value boundaries: same column index but at this occurrence's X
          const otherPlanOccs = allOccurrences.filter(o =>
            o.hNumber !== col.hNumber && o.planNum !== col.planNum &&
            Math.abs(o.y - occ.y) < 50
          ).sort((a, b) => a.x - b.x);

          let occValueXMin = occ.x - 10;
          let occValueXMax = pageWidth;
          // Find next plan column in this region
          const nextCol = otherPlanOccs.find(o => o.x > occ.x + 50);
          if (nextCol) occValueXMax = nextCol.x - 10;
          // Find prev plan column in this region
          const prevCols = otherPlanOccs.filter(o => o.x < occ.x - 50);
          if (prevCols.length > 0 && i > 0) {
            // This plan isn't the first column in this region
          }

          regions.push({
            labelXMin: occLabelXMin,
            labelXMax: occLabelXMax,
            valueXMin: occValueXMin,
            valueXMax: occValueXMax
          });
        }
      }

      plans.push({
        name: displayName,
        hNumber: hNum,
        type: 'column',
        columnIndex: i,
        xMin: xMin,
        xMax: xMax,
        startPage: 0,
        endPage: pagesRaw.length - 1,
        labelXMin: labelXMin,
        labelXMax: labelXMax,
        regions: regions
      });
    }

    return plans;
  },

  /**
   * Detect sequential section plans (BCBS NC style).
   * Pattern: "Plan offerings and premiums by county" section headers
   * followed by "Blue Medicare [Name]" + H-number on each section's pages.
   */
  _detectSequentialPlans(pagesRaw) {
    const plans = [];

    // Look for "Plan offerings and premiums by county" markers
    const sectionStarts = [];
    for (let pi = 0; pi < pagesRaw.length; pi++) {
      const page = pagesRaw[pi];
      const allText = page.items.map(it => it.text).join(' ');

      if (/plan\s*offerings\s*and\s*premiums\s*by\s*county/i.test(allText)) {
        // Found a section boundary. Extract plan name and H-numbers from this page.
        let planName = '';
        const hNumbers = [];

        // Sort items by Y to find the first plan name heading
        const sortedItems = [...page.items].sort((a, b) => a.y - b.y);

        for (const item of sortedItems) {
          const text = item.text.trim();
          // Plan name: "Blue Medicare [Name]" near top of page, short and not in a sentence
          if (/^Blue\s*Medicare\s+\w/i.test(text) && text.length < 60 && item.y < 250
              && !/available|counties|offerings|is\s+a/i.test(text)) {
            if (!planName) planName = text;
          }
          // H-number
          const hMatch = text.match(/(H\d{4})\s*[-]\s*(\d{3})/);
          if (hMatch) {
            const hNum = `${hMatch[1]}-${hMatch[2]}`;
            if (!hNumbers.includes(hNum)) hNumbers.push(hNum);
          }
        }

        if (planName) {
          sectionStarts.push({
            pageNum: pi,
            planName,
            hNumbers
          });
        }
      }
    }

    if (sectionStarts.length < 2) return [];

    // Determine page ranges for each section
    for (let i = 0; i < sectionStarts.length; i++) {
      const section = sectionStarts[i];
      const startPage = section.pageNum;
      const endPage = (i < sectionStarts.length - 1)
        ? sectionStarts[i + 1].pageNum - 1
        : pagesRaw.length - 1;

      // Build display name with first H-number if not already in name
      let displayName = section.planName;
      if (section.hNumbers.length > 0 && !displayName.includes(section.hNumbers[0])) {
        displayName = `${section.planName} (${section.hNumbers[0]})`;
      }

      plans.push({
        name: displayName,
        hNumber: section.hNumbers.length > 0 ? section.hNumbers[0] : '',
        hNumbers: section.hNumbers,
        type: 'section',
        columnIndex: 0,
        startPage: startPage,
        endPage: endPage,
        xMin: 0,
        xMax: Infinity,
        labelXMax: 0
      });
    }

    return plans;
  },

  /**
   * Filter structured page data to only include a selected plan's data.
   *
   * @param {Array} allPages - Structured page data from extractPageStructured
   * @param {Object} selectedPlan - The selected plan from detectMultiplePlans
   * @param {Array} pagesRaw - Raw page items (needed for column re-extraction)
   * @returns {Array} Filtered page data
   */
  filterForPlan(allPages, selectedPlan, pagesRaw) {
    if (selectedPlan.type === 'section') {
      return this._filterSectionPlan(allPages, selectedPlan);
    } else if (selectedPlan.type === 'column') {
      return this._filterColumnPlan(allPages, selectedPlan, pagesRaw);
    }
    return allPages;
  },

  /**
   * Filter for sequential section plans — just slice the page range.
   */
  _filterSectionPlan(allPages, plan) {
    return allPages.slice(plan.startPage, plan.endPage + 1);
  },

  /**
   * Filter for columnar plans — re-extract rows using only items in the plan's column.
   * Takes the label column (col 0) + the selected plan's value column,
   * creating a 2-column (label + value) view.
   */
  _filterColumnPlan(allPages, plan, pagesRaw) {
    const ROW_TOLERANCE = 5;
    const HEADER_FOOTER_MARGIN = 30;

    const filteredPages = [];

    for (let pi = 0; pi < pagesRaw.length; pi++) {
      const page = pagesRaw[pi];
      const items = page.items;

      if (!items || items.length === 0) {
        filteredPages.push({ rows: [], rawText: '', proseText: '', isFlowing: false });
        continue;
      }

      // Filter items to only include items from any of the plan's column regions.
      // Each region has: labelXMin/labelXMax (label column) and valueXMin/valueXMax (value column)
      const regions = plan.regions || [{
        labelXMin: plan.labelXMin || 0,
        labelXMax: plan.labelXMax,
        valueXMin: plan.xMin,
        valueXMax: plan.xMax
      }];
      const filtered = items.filter(item => {
        if (item.y <= HEADER_FOOTER_MARGIN || item.y >= page.pageHeight - HEADER_FOOTER_MARGIN) return false;
        return regions.some(r =>
          (item.x >= r.labelXMin && item.x < r.labelXMax) ||
          (item.x >= r.valueXMin && item.x < r.valueXMax)
        );
      });

      if (filtered.length === 0) {
        filteredPages.push({ rows: [], rawText: '', proseText: '', isFlowing: false });
        continue;
      }

      // Remap X positions: label items go to x=50 area, value items go to x=174+ area.
      // This ensures the parser's column detection works correctly.
      const remapped = filtered.map(item => {
        // Check which region this item belongs to
        for (const r of regions) {
          if (item.x >= r.valueXMin && item.x < r.valueXMax) {
            const offset = item.x - r.valueXMin;
            return { ...item, x: 174 + offset };
          }
          if (item.x >= r.labelXMin && item.x < r.labelXMax) {
            const offset = item.x - r.labelXMin;
            return { ...item, x: 30 + offset };
          }
        }
        return { ...item };
      });

      // Group into rows by Y
      const sorted = [...remapped].sort((a, b) => a.y - b.y);
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

      // Detect columns from these filtered rows
      const columns = _detectColumnsFiltered(rows);

      // Build structured rows
      const structuredRows = rows.map(rowItems => {
        const avgY = rowItems.reduce((s, it) => s + it.y, 0) / rowItems.length;
        const maxFontSize = Math.max(...rowItems.map(it => it.fontSize));
        const cellsByCol = {};
        for (const item of rowItems) {
          const colIdx = _assignColumnFiltered(item.x, columns);
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
      const merged = _mergeMultiLineRowsFiltered(structuredRows);

      const rawText = merged.map(r => {
        const parts = [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean);
        return parts.join(' | ');
      }).join('\n');

      const proseText = filtered.sort((a, b) => a.y - b.y || a.x - b.x).map(it => it.text).join(' ');

      const isFlowing = columns.length <= 1 || (columns.length === 2 && Math.abs(columns[1] - columns[0]) < 30);

      filteredPages.push({ rows: merged, rawText, proseText, isFlowing });
    }

    return filteredPages;
  }
};

// ─── Helpers for column filtering (mirror table-extract.js logic) ────────────

function _detectColumnsFiltered(rows) {
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

function _assignColumnFiltered(x, columns) {
  const TOLERANCE = 15;
  let bestIdx = 0;
  for (let i = 1; i < columns.length; i++) {
    if (x >= columns[i] - TOLERANCE) bestIdx = i;
  }
  return bestIdx;
}

function _isFragmentLabelFiltered(label) {
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

function _mergeMultiLineRowsFiltered(rows) {
  const merged = [];
  for (const row of rows) {
    const label = (row.label || '').trim();
    const labelEmpty = !label;
    const hasData = row.inNetwork || row.outOfNetwork;
    const isLabelContinuation = !labelEmpty && hasData && merged.length > 0 && _isFragmentLabelFiltered(label);

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
  return merged;
}

// Export for browser and Node.js
if (typeof window !== 'undefined') {
  window.MultiPlan = MultiPlan;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MultiPlan;
}
