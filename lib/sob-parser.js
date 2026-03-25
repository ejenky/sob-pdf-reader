// sob-parser.js — Medicare SOB field extraction using structured table data
// Uses fuzzy label matching against a field definition registry

const SOBParser = {

  /**
   * Field definitions: each field has keyword patterns to match against row labels,
   * which column to read from, and which normalizer to use.
   * Priority: lower number = matched first (for disambiguation)
   */
  FIELD_DEFS: [
    {
      key: 'planPremium',
      label: 'Plan Premium',
      patterns: [/monthly\s*(?:plan\s*)?premium/i, /plan\s*premium/i, /premium.*\$\d/i],
      source: 'inNetwork',
      normalize: 'dollar',
      priority: 1
    },
    {
      key: 'partBReduction',
      label: 'Part B Reduction',
      patterns: [
        /part\s*b.*give\s*back/i,
        /part\s*b.*reduc/i,
        /part\s*b.*premium.*reduc/i,
        /give\s*back/i,
        /medicare\s*part\s*b\s*premium/i
      ],
      source: 'inNetwork',
      normalize: 'dollar',
      priority: 2
    },
    {
      key: 'moop',
      label: 'MOOP',
      patterns: [
        /maximum\s*out[- ]?of[- ]?pocket/i,
        /\bMOOP\b/i,
        /out[- ]?of[- ]?pocket\s*(?:maximum|max|limit)/i,
        /most\s*you\s*(?:will\s*)?pay/i
      ],
      source: 'inNetwork',
      normalize: 'moopSpecial',
      priority: 1
    },
    {
      key: 'medDeductible',
      label: 'Medical Deductible',
      patterns: [
        /(?:medical|plan|health)\s*deductible/i,
        /deductible\s*(?:stage|phase|period)/i,
        /annual\s*deductible/i
      ],
      // Negative lookahead: skip if "drug" or "rx" or "prescription" or "part d" present
      antiPatterns: [/drug/i, /\brx\b/i, /prescription/i, /part\s*d/i],
      source: 'inNetwork',
      normalize: 'dollar',
      priority: 1
    },
    {
      key: 'rxDeductible',
      label: 'Rx Deductible',
      patterns: [
        /(?:drug|rx|prescription|part\s*d).*deductible/i,
        /deductible.*(?:drug|rx|prescription|part\s*d)/i,
        /deductible\s*(?:phase|stage).*(?:drug|rx|prescription)/i
      ],
      source: 'inNetwork',
      normalize: 'dollar',
      priority: 2
    },
    {
      key: 'pcpCopay',
      label: 'PCP Copay',
      patterns: [
        /primary\s*care\s*(?:provider|physician)?/i,
        /\bPCP\b(?!\s*specialist)/i,
        /doctor\s*(?:office\s*)?visit/i
      ],
      antiPatterns: [/specialist/i, /emergency/i, /urgent/i, /hospital/i],
      source: 'inNetwork',
      normalize: 'copay',
      priority: 1
    },
    {
      key: 'specialistCopay',
      label: 'Specialist Copay',
      patterns: [/specialist/i, /specialty\s*(?:care|visit)/i],
      antiPatterns: [/primary/i, /PCP/i, /emergency/i],
      source: 'inNetwork',
      normalize: 'copay',
      priority: 2
    },
    {
      key: 'preventiveCare',
      label: 'Preventive Care',
      patterns: [
        /preventive\s*care/i,
        /wellness\s*visit/i,
        /annual\s*(?:physical|wellness|checkup)/i,
        /preventive\s*(?:service|visit)/i
      ],
      source: 'inNetwork',
      normalize: 'copay',
      priority: 2
    },
    {
      key: 'erCopay',
      label: 'Emergency Room',
      patterns: [
        /emergency\s*(?:room|care|department|service)/i,
        /\bER\b\s*(?:visit|copay|care)/i,
        /emergency\s*and\s*urgent/i
      ],
      source: 'inNetwork',
      normalize: 'erSpecial', // Special: extract ER from combined ER/urgent cell
      priority: 1
    },
    {
      key: 'urgentCopay',
      label: 'Urgent Care',
      patterns: [/^urgent\s*care/i, /urgently\s*needed/i],
      antiPatterns: [/emergency/i],
      source: 'inNetwork',
      normalize: 'urgentSpecial',
      priority: 2
    },
    {
      key: 'hospitalCopay',
      label: 'Hospital (Inpatient)',
      patterns: [
        /^Inpatient\b/i,
        /inpatient\s*\(?unlimited/i,
        /inpatient\s*hospital/i,
        /hospital\s*(?:stay|copay|inpatient|admission)/i,
        /acute\s*inpatient/i
      ],
      antiPatterns: [/outpatient/i, /psychiatric/i, /mental/i],
      source: 'inNetwork',
      normalize: 'hospitalSpecial',
      priority: 2
    },
    {
      key: 'otcAllowance',
      label: 'OTC Allowance',
      patterns: [
        /over[- ]?the[- ]?counter\s*\(?OTC\)?\s*wallet/i,
        /\bOTC\b\s*(?:wallet|allowance|benefit|card)/i,
        /over[- ]?the[- ]?counter/i,
      ],
      antiPatterns: [/extra\s*supports?\s*wallet/i], // Don't grab Extra Supports Wallet as OTC
      source: 'inNetwork',
      normalize: 'allowance',
      priority: 1
    },
    {
      key: 'foodFlexCard',
      label: 'Food/Flex Card',
      patterns: [
        /extra\s*supports?\s*wallet/i,
        /food\s*(?:allowance|benefit|card)/i,
        /flex\s*(?:card|allowance|benefit|spending)/i,
        /grocery/i,
        /healthy\s*(?:food|grocer)/i,
      ],
      antiPatterns: [/over[- ]?the[- ]?counter\s*\(?OTC\)?/i, /\bOTC\b\s*wallet/i],
      source: 'inNetwork',
      normalize: 'allowance',
      priority: 3
    },
    {
      key: 'dentalAllowance',
      label: 'Dental',
      patterns: [
        /\bdental\b/i,
        /comprehensive\s*dental/i,
        /preventive\s*dental/i,
        /dental\s*(?:service|benefit|coverage|allowance|care)/i
      ],
      antiPatterns: [/vision/i, /hearing/i],
      source: 'inNetwork',
      normalize: 'dentalAllowance',
      priority: 2
    },
    {
      key: 'visionAllowance',
      label: 'Vision',
      patterns: [
        /contacts?\s*and/i,
        /eyeglasses/i,
        /eyewear/i,
        /prescription\s*eyewear/i,
        /vision\s*(?:allowance|benefit)/i,
      ],
      antiPatterns: [/dental/i, /hearing/i, /diagnostic/i, /glaucoma/i, /routine\s*eye/i],
      source: 'inNetwork',
      normalize: 'visionAllowance',
      priority: 2
    },
    {
      key: 'hearingAllowance',
      label: 'Hearing',
      patterns: [
        /hearing\s*aids?\b/i,
      ],
      antiPatterns: [/dental/i, /vision/i, /diagnostic\s*hearing/i, /routine\s*hearing/i],
      source: 'inNetwork',
      normalize: 'hearingAllowance',
      priority: 2
    },
    {
      key: 'transportation',
      label: 'Transportation',
      patterns: [
        /routine.*transportation/i,
        /non[- ]?emergency\s*transportation/i,
        /^Routine,$/i,
        /^non-emergency$/i,
        /^transportation$/i,
        /rides?\s*(?:to|for)/i,
        /\bNEMT\b/i
      ],
      antiPatterns: [/ambulance/i, /fixed\s*wing/i, /aircraft/i],
      source: 'inNetwork',
      normalize: 'transportation',
      priority: 2
    }
  ],

  /**
   * Parse structured page data into benefit fields
   * @param {Array} allPages - Array of { rows, rawText } from table-extract
   * @returns {Object} Extracted benefit fields
   */
  parse(allPages) {
    const result = {};
    const matched = new Set(); // Track which rows have been matched

    // Initialize all fields as 'Not found'
    for (const def of this.FIELD_DEFS) {
      result[def.key] = 'Not found';
    }

    // Sort field defs by priority
    const sortedDefs = [...this.FIELD_DEFS].sort((a, b) => a.priority - b.priority);

    // Pass 1: Match structured rows to field definitions
    for (const page of allPages) {
      for (let rowIdx = 0; rowIdx < page.rows.length; rowIdx++) {
        const row = page.rows[rowIdx];
        const label = row.label || '';

        for (const def of sortedDefs) {
          // Skip if already found
          if (result[def.key] !== 'Not found') continue;

          // Check if label matches any pattern
          const matches = def.patterns.some(p => p.test(label));
          if (!matches) continue;

          // Check anti-patterns
          if (def.antiPatterns && def.antiPatterns.some(p => p.test(label))) continue;

          // Get the value from the appropriate column
          // For PPO (3-column) PDFs: only use the in-network column
          // For HMO (2-column) PDFs: the single value column becomes inNetwork
          // Only fall back to outOfNetwork for HMO plans (where colCount <= 2)
          let value = '';
          if (def.source === 'inNetwork') {
            value = row.inNetwork || '';
            if (!value && row.colCount <= 2) {
              value = row.outOfNetwork || '';
            }
          } else if (def.source === 'outOfNetwork') {
            value = row.outOfNetwork || '';
          } else {
            value = label;
          }

          // If no value in the column, check if the value is embedded in the label
          if (!value && label) {
            const dollarInLabel = label.match(/\$[\d,]+/);
            if (dollarInLabel) value = label;
          }

          // Also check nearby rows for continuation data
          if (!value || !value.match(/[\$\d%]/)) {
            // Look at next 2 rows for values
            for (let j = 1; j <= 2 && rowIdx + j < page.rows.length; j++) {
              const nextRow = page.rows[rowIdx + j];
              const nextLabel = nextRow.label || '';
              const nextValue = nextRow.inNetwork || nextRow.outOfNetwork || '';
              // Only use if it looks like a value (has $ or %)
              if (nextValue && nextValue.match(/[\$\d%]/) && !nextLabel.match(/[a-zA-Z]{5,}/)) {
                value = nextValue;
                break;
              }
            }
          }

          if (value) {
            // Normalize the value
            result[def.key] = this.normalizeField(def, value, row);
            matched.add(rowIdx);
            break;
          }
        }
      }
    }

    // Pass 2: Fallback regex parsing on raw text for anything still missing
    const fullText = allPages.map(p => p.rawText).join('\n');
    this.fallbackRegexParse(result, fullText);

    // Pass 3: Extract plan name (special handling - look at page 1 headers)
    result.planName = this.extractPlanName(allPages);

    // Pass 4: MOOP special handling - needs both in-network and combined
    this.refineMOOP(result, allPages);

    // Pass 5: Deductible refinement
    this.refineDeductibles(result, allPages, fullText);

    // Pass 6: ER and Urgent care from combined section
    this.refineEmergencyUrgent(result, allPages, fullText);

    // Pass 7: Transportation — handle multi-row labels
    this.refineTransportation(result, allPages);

    // Pass 8: Hospital — gather continuation rows for full per-day tiers
    this.refineHospital(result, allPages);

    return result;
  },

  /**
   * Apply the appropriate normalizer for a field
   */
  normalizeField(def, value, row) {
    const norm = def.normalize;
    const t = value.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
    switch (norm) {
      case 'dollar': return Normalizer.dollar(t);
      case 'copay': return Normalizer.copay(t);
      case 'allowance': return Normalizer.allowance(t);
      case 'dentalAllowance': return Normalizer.dentalAllowance(t);
      case 'visionAllowance': return Normalizer.visionAllowance(t);
      case 'hearingAllowance': return Normalizer.hearingAllowance(t);
      case 'transportation': return Normalizer.transportation(t);
      case 'moopSpecial': return Normalizer.dollar(t); // Refined in refineMOOP
      case 'hospitalSpecial': {
        // Hospital per-day tiers: "$407 per day, days 1-6; $0 per day, days 7-90"
        // If both in-network and out-of-network data leaked into the value,
        // only use the in-network portion (first set of per-day tiers before any
        // out-of-network values that are typically higher for day 1)
        const tiers = [...t.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
        if (tiers.length > 0) {
          // In-network tiers start with days 1-X where the first day range begins at 1
          // Out-of-network tiers also start at days 1-X but with a different dollar amount
          // If we see two tiers both starting at day 1, take only the first one's group
          const day1Tiers = tiers.filter(m => m[2] === '1');
          if (day1Tiers.length >= 2) {
            // Two day-1 entries means in-network AND out-of-network leaked in
            // Take only tiers from the first day-1 up to (but not including) the second day-1
            const firstDay1Idx = tiers.indexOf(day1Tiers[0]);
            const secondDay1Idx = tiers.indexOf(day1Tiers[1]);
            const inNetTiers = tiers.slice(firstDay1Idx, secondDay1Idx);
            return inNetTiers.map(m => `$${m[1]}/day, days ${m[2]}-${m[3]}`).join('; ');
          }
          // All tiers are in-network
          return tiers.map(m => `$${m[1]}/day, days ${m[2]}-${m[3]}`).join('; ');
        }
        // Fall back to regular copay
        return Normalizer.copay(t);
      }
      case 'erSpecial': {
        // Extract ER copay from combined "emergency and urgent care" cell
        // Value may contain both: "$115 copay for emergency care $40 copay for urgent care"
        const erM = t.match(/\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?emergency\s*care/i);
        if (erM) return `$${erM[1]}`;
        return Normalizer.copay(t);
      }
      case 'urgentSpecial': {
        // Extract urgent care copay from combined cell
        const ucM = t.match(/\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?urgent\s*care/i);
        if (ucM) return `$${ucM[1]}`;
        return Normalizer.copay(t);
      }
      default: return value;
    }
  },

  /**
   * Extract plan name from page 1 header text
   */
  extractPlanName(allPages) {
    if (allPages.length === 0) return 'Unknown Plan';

    const page1 = allPages[0];

    // Normalize all text for H-number matching (unicode hyphens)
    const normRow = (r) => {
      const parts = [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean);
      return parts.join(' ').replace(/[\u2010-\u2015\u2212]/g, '-');
    };

    // Look for H-number in page 1 rows
    let hNum = null;
    for (const row of page1.rows) {
      const text = normRow(row);
      const hMatch = text.match(/(H\d{4})\s*-\s*(\d{3})/i);
      if (hMatch) {
        hNum = `${hMatch[1]}-${hMatch[2]}`;
        break;
      }
    }

    // If no H-number found in structured rows, search raw text
    if (!hNum) {
      const rawAll = allPages.map(p => p.rawText).join('\n').replace(/[\u2010-\u2015\u2212]/g, '-');
      const hM = rawAll.match(/(H\d{4})\s*-\s*(\d{3})/i);
      if (hM) hNum = `${hM[1]}-${hM[2]}`;
    }

    // Find plan name: look for large-font rows near top of page 1
    // Sort by Y position to get the topmost text
    const topRows = page1.rows
      .filter(r => r.y < 200)
      .sort((a, b) => a.y - b.y);

    for (const row of topRows) {
      const text = (row.label || row.inNetwork || '').trim();
      // Skip generic headers, page numbers, dates, and short text
      if (text.length < 5) continue;
      if (/^\d{4}/.test(text) && text.length < 20) continue;
      if (/summary\s*of\s*benefits/i.test(text)) continue;
      if (/^(we're|you may|not a member|already|call|keep in mind)/i.test(text)) continue;

      // This is likely the plan name
      const planText = text.replace(/[\u2010-\u2015\u2212]/g, '-');
      if (hNum) {
        // Don't duplicate H-number if already in the plan text
        if (planText.includes(hNum)) return planText;
        return `${planText} ${hNum}`;
      }
      return planText;
    }

    return hNum || 'Unknown Plan';
  },

  /**
   * Refine MOOP: extract both in-network and combined limits
   */
  refineMOOP(result, allPages) {
    // Always re-derive MOOP from structured data for accuracy
    result.moop = 'Not found';

    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = (row.label || '').replace(/[\u2010-\u2015]/g, '-');
        // Only match "MOOP" as a standalone label or short label containing MOOP.
        // Do NOT match section titles like "Plan premium, deductible, and maximum out-of-pocket (MOOP)"
        const isMoopLabel = (
          /^\s*MOOP\s*$/i.test(label) ||
          (/\bMOOP\b/i.test(label) && label.length < 25) ||
          (/^maximum\s*out/i.test(label) && label.length < 40)
        );
        if (!isMoopLabel) continue;

        // Gather all text from this row and next few continuation rows
        let allText = '';
        for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
          const r = page.rows[j];
          allText += ' ' + [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean).join(' ');
        }
        allText = allText.replace(/[\u2010-\u2015]/g, '-');

        const allDollars = Normalizer.extractDollars(allText).filter(d => d.value >= 1000);

        // Check for explicit "in-network" and "out-of-network combined" text
        const inNetM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-network/i);
        const combinedM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-?\s*and\s*out-?of-?network\s*combined/i);

        if (inNetM && combinedM) {
          result.moop = `$${inNetM[1]} in-network / $${combinedM[1]} in- and out-of-network combined`;
        } else if (allDollars.length >= 2) {
          // Two large amounts: first is in-network, second is combined
          result.moop = `$${allDollars[0].raw} in-network / $${allDollars[1].raw} in- and out-of-network combined`;
        } else if (allDollars.length === 1) {
          // Single value (HMO plans - no OON distinction)
          result.moop = `$${allDollars[0].raw}`;
        }

        if (result.moop !== 'Not found') return;
      }
    }
  },

  /**
   * Refine deductibles with context awareness
   */
  refineDeductibles(result, allPages, fullText) {
    // Medical deductible validation: some plans have deductibles up to ~$2,000
    // Only reject if the value matches the MOOP (which would mean we grabbed MOOP by mistake)
    if (result.medDeductible !== 'Not found' && result.moop !== 'Not found') {
      // If the deductible value appears in the MOOP string, it's probably MOOP not deductible
      const dedDollars = Normalizer.extractDollars(result.medDeductible);
      if (dedDollars.length > 0) {
        const dedVal = dedDollars[0].raw;
        if (result.moop.includes(dedVal)) {
          result.medDeductible = 'Not found';
        }
      }
    }

    if (result.medDeductible === 'Not found') {
      // Search for deductible in structured data
      for (const page of allPages) {
        for (const row of page.rows) {
          const label = row.label || '';
          if (!/deductible/i.test(label)) continue;
          if (/drug|rx|prescription|part\s*d/i.test(label)) continue;

          const value = row.inNetwork || '';
          const dollars = Normalizer.extractDollars(value);
          const small = dollars.filter(d => d.value < 1000);
          if (small.length > 0) {
            // Check for range
            const range = value.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
            if (range) {
              const a = parseInt(range[1].replace(/,/g, ''));
              const b = parseInt(range[2].replace(/,/g, ''));
              if (a < 1000 && b < 1000) {
                result.medDeductible = `$${range[1]} - $${range[2]}`;
                break;
              }
            }
            result.medDeductible = `$${small[0].raw}`;
            break;
          }
        }
        if (result.medDeductible !== 'Not found') break;
      }
    }

    // Rx deductible fallback
    if (result.rxDeductible === 'Not found') {
      const rxSeg = findAfterInText(fullText, 'deductible phase', 400)
        || findAfterInText(fullText, 'deductible limit', 400)
        || findAfterInText(fullText, 'Part D', 700);
      if (rxSeg) {
        const m = rxSeg.match(/\$([\d,]+)/);
        if (m) {
          result.rxDeductible = `$${m[1]}`;
        }
      }
    }
  },

  /**
   * Refine ER and Urgent care extraction
   * These are often in a combined "Emergency and urgently needed care" section
   */
  refineEmergencyUrgent(result, allPages, fullText) {
    // Always re-derive from structured data for combined ER/urgent rows
    // Aetna format: "Emergency and urgent care (inside the U.S.)" label
    // with "$115 copay for emergency care" and "$40 copay for urgent care" in the value cell

    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = (row.label || '').replace(/[\u2010-\u2015]/g, '-');

        // Look for the combined ER/urgent row (inside the U.S. variant)
        if (/emergency\s*and\s*urgent.*(?:inside|U\.?S)/i.test(label) ||
            (/emergency\s*and\s*urgent/i.test(label) && !/outside/i.test(label))) {

          // Gather all text from this row and next few continuation rows
          let allText = '';
          for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
            const r = page.rows[j];
            const rLabel = (r.label || '').replace(/[\u2010-\u2015]/g, '-');
            // Stop if we hit the "outside the U.S." section
            if (j > i && /outside/i.test(rLabel)) break;
            allText += ' ' + [rLabel, r.inNetwork, r.outOfNetwork].filter(Boolean).join(' ');
          }
          allText = allText.replace(/[\u2010-\u2015]/g, '-');

          // Extract ER copay
          if (result.erCopay === 'Not found') {
            const erM = allText.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?emergency\s*care/i);
            if (erM) result.erCopay = `$${erM[1]}`;
          }

          // Extract urgent care copay
          if (result.urgentCopay === 'Not found') {
            const ucM = allText.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?urgent\s*care/i);
            if (ucM) result.urgentCopay = `$${ucM[1]}`;
          }

          if (result.erCopay !== 'Not found' && result.urgentCopay !== 'Not found') return;
        }
      }
    }

    // Fallback: regex on full normalized text
    const t = fullText.replace(/[\u2010-\u2015]/g, '-');

    if (result.erCopay === 'Not found') {
      const erSeg = findAfterInText(t, 'emergency.*care.*inside', 500)
        || findAfterInText(t, 'emergency', 500);
      if (erSeg) {
        const m = erSeg.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?emergency\s*care/i);
        if (m) result.erCopay = `$${m[1]}`;
      }
    }

    if (result.urgentCopay === 'Not found') {
      const ucSeg = findAfterInText(t, 'urgent\s*care', 400);
      if (ucSeg) {
        const m = ucSeg.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?urgent\s*care/i);
        if (m) result.urgentCopay = `$${m[1]}`;
      }
    }
  },

  /**
   * Fallback regex parsing on full text for fields still missing
   */
  /**
   * Refine transportation — handle multi-row labels like:
   *   Row 1: "Routine,"
   *   Row 2: "non-emergency"
   *   Row 3: "transportation"
   * The value "Not Covered" is on the same Y as "Routine,"
   */
  refineTransportation(result, allPages) {
    // Always re-derive transportation from structured data
    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = (row.label || '').toLowerCase();

        // Look for "Routine," as standalone label
        if (/^routine,?$/i.test(label.trim())) {
          // Check if next rows continue with "non-emergency" and/or "transportation"
          let isTransportation = false;
          for (let j = 1; j <= 3 && i + j < page.rows.length; j++) {
            const nextLabel = (page.rows[i + j].label || '').toLowerCase().trim();
            if (/non-emergency|transportation/.test(nextLabel)) {
              isTransportation = true;
              break;
            }
          }

          if (isTransportation) {
            const value = row.inNetwork || '';
            if (/not\s*covered/i.test(value)) {
              result.transportation = 'Not covered';
            } else {
              result.transportation = Normalizer.transportation(value);
            }
            return;
          }
        }

        // Also check for full "Routine, non-emergency transportation" in one label
        if (/routine.*non.*emergency.*transport/i.test(label)) {
          const value = row.inNetwork || '';
          if (/not\s*covered/i.test(value)) {
            result.transportation = 'Not covered';
          } else {
            result.transportation = Normalizer.transportation(value);
          }
          return;
        }
      }
    }
  },

  /**
   * Refine hospital inpatient — find per-day tiers by sequential day ranges.
   * Approach: find the first tier (e.g. "$407 per day, days 1-6"), then look for
   * the next sequential day number (7) in the same and nearby rows to find
   * "$0 per day, days 7-90". This works even when rows don't merge properly.
   */
  refineHospital(result, allPages) {
    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = (row.label || '');
        if (!/^Inpatient\b/i.test(label) && !/inpatient\s*\(?unlimited/i.test(label)) continue;
        if (/outpatient|psychiatric/i.test(label)) continue;

        // Gather ALL text from this row and next few rows (both columns + labels)
        // We'll parse out per-day tiers and use sequential day logic to pick in-network ones
        let allText = '';
        for (let j = i; j < Math.min(i + 5, page.rows.length); j++) {
          const r = page.rows[j];
          const rLabel = (r.label || '').trim();
          // Stop if we hit a clearly different benefit section
          if (j > i && rLabel && /^(Outpatient|Ambulatory|Observation)/i.test(rLabel)) break;
          allText += ' ' + [r.label, r.inNetwork, r.outOfNetwork].filter(Boolean).join(' ');
        }
        allText = allText.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();

        // Extract ALL per-day tiers from the combined text
        const allTiers = [...allText.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];

        if (allTiers.length > 0) {
          // Build sequential in-network tiers:
          // Start with the first tier (days 1-X), then find the tier whose start day
          // is X+1 (the next in sequence), and so on
          const inNetTiers = [allTiers[0]];
          let nextDayStart = parseInt(allTiers[0][3]) + 1; // end of first tier + 1

          for (const tier of allTiers.slice(1)) {
            const tierStart = parseInt(tier[2]);
            if (tierStart === nextDayStart) {
              inNetTiers.push(tier);
              nextDayStart = parseInt(tier[3]) + 1;
            }
          }

          result.hospitalCopay = inNetTiers.map(m => `$${m[1]}/day, days ${m[2]}-${m[3]}`).join('; ');
        } else if (/\$0\s*copay/i.test(allText)) {
          result.hospitalCopay = '$0 copay';
        }
        return;
      }
    }
  },

  fallbackRegexParse(result, fullText) {
    const t = fullText.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ');

    // Plan Premium fallback
    if (result.planPremium === 'Not found') {
      const seg = findAfterInText(t, 'monthly plan premium', 120)
        || findAfterInText(t, 'plan premium', 120);
      if (seg) {
        const m = seg.match(/\$([\d,]+)/);
        if (m) result.planPremium = `$${m[1]}/month`;
      }
    }
    // Format premium as /month if it's just a dollar amount
    if (result.planPremium !== 'Not found' && !result.planPremium.includes('/month') && !result.planPremium.includes('Not')) {
      result.planPremium = result.planPremium + '/month';
    }

    // Part B reduction fallback - check for "must continue to pay" (means no reduction)
    if (result.partBReduction === 'Not found') {
      if (/must\s*continue\s*to\s*pay\s*(?:your\s*)?Medicare\s*Part\s*B/i.test(t)) {
        result.partBReduction = 'N/A';
      } else {
        const seg = findAfterInText(t, 'part b.*?give', 200)
          || findAfterInText(t, 'part b.*?reduc', 200);
        if (seg) {
          const m = seg.match(/\$([\d,]+(?:\.\d+)?)/);
          if (m) result.partBReduction = `$${m[1]}/month reduction`;
        } else {
          result.partBReduction = 'N/A';
        }
      }
    }

    // Preventive care fallback
    if (result.preventiveCare === 'Not found') {
      const seg = findAfterInText(t, 'preventive care', 200);
      if (seg) {
        if (/\$0|no\s*(?:charge|cost|copay)/i.test(seg)) {
          result.preventiveCare = '$0 copay';
        }
      }
    }

    // OTC fallback — handle "OTC Wallet" and "Extra Supports Wallet" patterns
    if (result.otcAllowance === 'Not found') {
      // Pattern 1: "Over-the-Counter (OTC) Wallet" with "$X monthly benefit amount"
      const otcWalletSeg = findAfterInText(t, 'Over-the-Counter.*Wallet', 400)
        || findAfterInText(t, 'OTC.*Wallet', 400);
      if (otcWalletSeg) {
        const m = otcWalletSeg.match(/\$([\d,]+)\s*monthly\s*(?:benefit\s*)?(?:amount)?/i);
        if (m) {
          result.otcAllowance = `$${m[1]}/month`;
        }
      }

      // Pattern 2: "Extra Supports Wallet" with monthly benefit
      if (result.otcAllowance === 'Not found') {
        const extraSeg = findAfterInText(t, 'Extra Supports Wallet', 500);
        if (extraSeg) {
          const m = extraSeg.match(/\$([\d,]+)\s*monthly\s*(?:benefit\s*)?(?:amount)?/i);
          if (m) {
            result.otcAllowance = `$${m[1]}/month (Extra Supports Wallet)`;
          }
        }
      }

      // Pattern 3: Generic OTC search
      if (result.otcAllowance === 'Not found') {
        const seg = findAfterInText(t, 'over-the-counter', 300) || findAfterInText(t, 'OTC', 300);
        if (seg) {
          const m = seg.match(/\$([\d,]+)/);
          if (m) {
            if (/month/i.test(seg)) result.otcAllowance = `$${m[1]}/month`;
            else if (/quarter/i.test(seg)) result.otcAllowance = `$${m[1]}/quarter`;
            else result.otcAllowance = `$${m[1]}`;
          }
        }
      }
    }

    // Food/Flex Card fallback — check for Extra Supports Wallet or healthy foods
    if (result.foodFlexCard === 'Not found') {
      const walletSeg = findAfterInText(t, 'Extra Supports Wallet', 600);
      if (walletSeg && /healthy\s*foods|food/i.test(walletSeg)) {
        const m = walletSeg.match(/\$([\d,]+)\s*monthly/i);
        if (m) {
          result.foodFlexCard = `Included in $${m[1]}/month Extra Supports Wallet`;
        } else {
          result.foodFlexCard = 'Via Extra Supports Wallet';
        }
      }
    }

    // Dental fallback — look for allowance amount
    if (result.dentalAllowance === 'Not found') {
      const dentalSeg = findAfterInText(t, 'Dental services', 500);
      if (dentalSeg) {
        const allowanceM = dentalSeg.match(/allowance.*?\$([\d,]+)/i)
          || dentalSeg.match(/\$([\d,]+).*?(?:for\s*covered|annual\s*(?:benefit|allowance))/i);
        if (allowanceM) {
          result.dentalAllowance = `$${allowanceM[1]} annual allowance ($0 copay)`;
        } else if (/\$0\s*copay/i.test(dentalSeg)) {
          result.dentalAllowance = '$0 copay for covered services';
        }
      }
    }

    // Vision fallback
    if (result.visionAllowance === 'Not found') {
      const visionSeg = findAfterInText(t, 'Contacts and eyeglasses', 300)
        || findAfterInText(t, 'prescription eyewear', 300);
      if (visionSeg) {
        const m = visionSeg.match(/allowance.*?\$([\d,]+)/i)
          || visionSeg.match(/\$([\d,]+).*?(?:eyewear|prescription)/i);
        if (m) {
          result.visionAllowance = `$${m[1]} annual eyewear allowance`;
        }
      }
    }

    // Hearing fallback — look for tiered levels
    if (result.hearingAllowance === 'Not found') {
      const hearingSeg = findAfterInText(t, 'Hearing aids', 800);
      if (hearingSeg) {
        const levels = [...hearingSeg.matchAll(/Level\s*\d[^:]*:\s*\$([\d,]+)\s*copay\s*per\s*ear/gi)];
        if (levels.length > 0) {
          const amounts = levels.map(m => parseInt(m[1].replace(/,/g, '')));
          const min = Math.min(...amounts);
          const max = Math.max(...amounts);
          result.hearingAllowance = `$${min.toLocaleString()} - $${max.toLocaleString()}/ear/year (tiered by level)`;
        }
      }
    }

    // Hospital inpatient fallback
    if (result.hospitalCopay === 'Not found') {
      const hospSeg = findAfterInText(t, 'Inpatient', 400);
      if (hospSeg) {
        // "$407 per day, days 1-6; $0 per day, days 7-90"
        const tiers = [...hospSeg.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*-\s*(\d+)/gi)];
        if (tiers.length > 0) {
          result.hospitalCopay = tiers.map(m => `$${m[1]}/day, days ${m[2]}-${m[3]}`).join('; ');
        } else if (/\$0\s*copay/i.test(hospSeg)) {
          result.hospitalCopay = '$0 copay';
        }
      }
    }

    // Transportation fallback
    if (result.transportation === 'Not found') {
      const transSeg = findAfterInText(t, 'non-emergency transportation', 200)
        || findAfterInText(t, 'Routine.*transportation', 200);
      if (transSeg) {
        if (/not\s*covered/i.test(transSeg)) {
          result.transportation = 'Not covered';
        } else {
          result.transportation = Normalizer.transportation(transSeg);
        }
      }
    }

    // Rx deductible — improve extraction from "deductible limit of $615" pattern
    if (result.rxDeductible === 'Not found') {
      const rxSeg = findAfterInText(t, 'Deductible phase', 400)
        || findAfterInText(t, 'deductible limit', 400);
      if (rxSeg) {
        const m = rxSeg.match(/deductible\s*(?:limit|amount)\s*(?:of\s*)?\$([\d,]+)/i)
          || rxSeg.match(/\$([\d,]+)/);
        if (m) result.rxDeductible = `$${m[1]}`;
      }
    }
  }
};

// Helper: find text after a keyword in raw text
function findAfterInText(text, keyword, maxChars) {
  const idx = text.search(new RegExp(keyword, 'i'));
  if (idx === -1) return null;
  return text.substring(idx, idx + maxChars);
}

if (typeof window !== 'undefined') {
  window.SOBParser = SOBParser;
}
