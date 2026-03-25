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
      normalize: 'copay',
      priority: 1
    },
    {
      key: 'urgentCopay',
      label: 'Urgent Care',
      patterns: [/urgent\s*care/i, /urgently\s*needed/i],
      antiPatterns: [/emergency/i],
      source: 'inNetwork',
      normalize: 'copay',
      priority: 2
    },
    {
      key: 'hospitalCopay',
      label: 'Hospital (Inpatient)',
      patterns: [
        /inpatient\s*hospital/i,
        /hospital\s*(?:stay|copay|inpatient|admission)/i,
        /inpatient\s*(?:\(unlimited)?/i,
        /acute\s*inpatient/i
      ],
      antiPatterns: [/outpatient/i, /mental\s*health.*outpatient/i],
      source: 'inNetwork',
      normalize: 'copay',
      priority: 2
    },
    {
      key: 'otcAllowance',
      label: 'OTC Allowance',
      patterns: [
        /over[- ]?the[- ]?counter/i,
        /\bOTC\b/i,
        /otc\s*(?:allowance|benefit|card|items)/i
      ],
      source: 'inNetwork',
      normalize: 'allowance',
      priority: 1
    },
    {
      key: 'foodFlexCard',
      label: 'Food/Flex Card',
      patterns: [
        /food\s*(?:allowance|benefit|card)/i,
        /flex\s*(?:card|allowance|benefit|spending)/i,
        /grocery/i,
        /healthy\s*(?:food|grocer)/i,
        /meal\s*(?:benefit|delivery|allowance)/i,
        /extra\s*supports?\s*wallet/i,
        /supplemental\s*benefit/i
      ],
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
        /\bvision\b/i,
        /eyewear/i,
        /eye\s*(?:exam|glass|care)/i,
        /vision\s*(?:service|benefit|coverage|allowance)/i,
        /routine\s*eye/i
      ],
      antiPatterns: [/dental/i, /hearing/i],
      source: 'inNetwork',
      normalize: 'visionAllowance',
      priority: 2
    },
    {
      key: 'hearingAllowance',
      label: 'Hearing',
      patterns: [
        /\bhearing\b/i,
        /hearing\s*(?:aid|exam|service|benefit|coverage|allowance)/i,
        /routine\s*hearing/i
      ],
      antiPatterns: [/dental/i, /vision/i],
      source: 'inNetwork',
      normalize: 'hearingAllowance',
      priority: 2
    },
    {
      key: 'transportation',
      label: 'Transportation',
      patterns: [
        /transportation/i,
        /rides?\s*(?:to|for)/i,
        /non[- ]?emergency\s*(?:medical\s*)?transport/i,
        /\bNEMT\b/i
      ],
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
          let value = '';
          if (def.source === 'inNetwork') {
            value = row.inNetwork || row.outOfNetwork || '';
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

    return result;
  },

  /**
   * Apply the appropriate normalizer for a field
   */
  normalizeField(def, value, row) {
    const norm = def.normalize;
    switch (norm) {
      case 'dollar': return Normalizer.dollar(value);
      case 'copay': return Normalizer.copay(value);
      case 'allowance': return Normalizer.allowance(value);
      case 'dentalAllowance': return Normalizer.dentalAllowance(value);
      case 'visionAllowance': return Normalizer.visionAllowance(value);
      case 'hearingAllowance': return Normalizer.hearingAllowance(value);
      case 'transportation': return Normalizer.transportation(value);
      case 'moopSpecial': return Normalizer.dollar(value); // Refined in refineMOOP
      default: return value;
    }
  },

  /**
   * Extract plan name from page 1 header text
   */
  extractPlanName(allPages) {
    if (allPages.length === 0) return 'Unknown Plan';

    const page1 = allPages[0];
    const allText = page1.rawText || '';

    // Look for H-number in the structured rows first (usually in large font)
    for (const row of page1.rows) {
      const fullRowText = [row.label, row.inNetwork, row.outOfNetwork].join(' ');
      const hMatch = fullRowText.match(/(H\d{4})\s*[-–]\s*(\d{3})(?:\s*[-–]\s*(\d+))?/i);
      if (hMatch) {
        const hNum = `${hMatch[1]}-${hMatch[2]}${hMatch[3] ? '-' + hMatch[3] : ''}`;
        // Look for plan name in larger font rows near the top
        const headerRows = page1.rows.filter(r => r.fontSize > 10 && r.y < 200);
        for (const hr of headerRows) {
          const text = hr.label || hr.inNetwork || '';
          if (text.length > 5 && !text.match(/summary\s*of\s*benefits/i) && !text.match(/^\d{4}\s*$/)) {
            return `${text.trim()} ${hNum}`;
          }
        }
        return hNum;
      }
    }

    // Fallback: regex on raw text
    const hMatch = allText.match(/([A-Za-z][\w\s,()\-]+?)\s*(H\d{4})\s*[-–]\s*(\d{3})/);
    if (hMatch) {
      return `${hMatch[1].trim()} ${hMatch[2]}-${hMatch[3]}`;
    }

    // Look for first large-font text
    const largeRows = page1.rows
      .filter(r => r.fontSize > 12 && r.y < 200)
      .sort((a, b) => a.y - b.y);
    if (largeRows.length > 0) {
      return (largeRows[0].label || largeRows[0].inNetwork || 'Unknown Plan').trim();
    }

    return 'Unknown Plan';
  },

  /**
   * Refine MOOP: extract both in-network and combined limits
   */
  refineMOOP(result, allPages) {
    if (result.moop !== 'Not found') return;

    for (const page of allPages) {
      for (const row of page.rows) {
        const label = row.label || '';
        if (!/maximum\s*out|moop|out.*pocket.*max|most.*you.*pay/i.test(label)) continue;

        const inNet = row.inNetwork || '';
        const outNet = row.outOfNetwork || '';
        const inDollars = Normalizer.extractDollars(inNet).filter(d => d.value >= 1000);
        const outDollars = Normalizer.extractDollars(outNet).filter(d => d.value >= 1000);

        if (inDollars.length > 0 && outDollars.length > 0) {
          result.moop = `$${inDollars[0].raw} in-network / $${outDollars[0].raw} in- and out-of-network combined`;
        } else if (inDollars.length > 0) {
          result.moop = `$${inDollars[0].raw}`;
        } else {
          // Try parsing both from in-network column (some PDFs combine)
          const combined = inNet + ' ' + outNet;
          const allBig = Normalizer.extractDollars(combined).filter(d => d.value >= 1000);
          if (allBig.length >= 2) {
            result.moop = `$${allBig[0].raw} in-network / $${allBig[1].raw} in- and out-of-network combined`;
          } else if (allBig.length === 1) {
            result.moop = `$${allBig[0].raw}`;
          }
        }
        if (result.moop !== 'Not found') return;
      }
    }
  },

  /**
   * Refine deductibles with context awareness
   */
  refineDeductibles(result, allPages, fullText) {
    // Medical deductible: value should be < $1000
    if (result.medDeductible !== 'Not found') {
      const dollars = Normalizer.extractDollars(result.medDeductible);
      if (dollars.length > 0 && dollars[0].value >= 1000) {
        // Probably grabbed MOOP instead, reset and try again
        result.medDeductible = 'Not found';
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
    // If both found, we're good
    if (result.erCopay !== 'Not found' && result.urgentCopay !== 'Not found') return;

    // Search for combined emergency/urgent section
    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = row.label || '';

        // Combined section header
        if (/emergency\s*and\s*urgent/i.test(label)) {
          const value = row.inNetwork || '';
          // Look at this row and next few rows for ER and urgent values
          const window = [];
          for (let j = i; j < Math.min(i + 6, page.rows.length); j++) {
            const r = page.rows[j];
            window.push({
              label: r.label || '',
              value: r.inNetwork || r.outOfNetwork || ''
            });
          }

          for (const w of window) {
            const combined = w.label + ' ' + w.value;
            if (result.erCopay === 'Not found') {
              const erM = combined.match(/\$([\d,]+)\s*[-–]?\s*\$?([\d,]+)?\s*(?:copay\s*)?(?:for\s*)?emergency/i);
              if (erM) {
                result.erCopay = erM[2] ? `$${erM[1]} - $${erM[2]}` : `$${erM[1]}`;
              }
            }
            if (result.urgentCopay === 'Not found') {
              const ucM = combined.match(/\$([\d,]+)\s*[-–]?\s*\$?([\d,]+)?\s*(?:copay\s*)?(?:for\s*)?urgent/i);
              if (ucM) {
                result.urgentCopay = ucM[2] ? `$${ucM[1]} - $${ucM[2]}` : `$${ucM[1]}`;
              }
            }
          }
          break;
        }
      }
    }

    // Fallback: regex on full text
    if (result.erCopay === 'Not found') {
      const erSeg = findAfterInText(fullText, 'emergency', 500);
      if (erSeg) {
        const m = erSeg.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?emergency/i)
          || erSeg.match(/\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?emergency/i);
        if (m) {
          result.erCopay = m[2] ? `$${m[1]} - $${m[2]}` : `$${m[1]}`;
        }
      }
    }

    if (result.urgentCopay === 'Not found') {
      const ucSeg = findAfterInText(fullText, 'urgent care', 400);
      if (ucSeg) {
        const m = ucSeg.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?urgent/i)
          || ucSeg.match(/\$([\d,]+)\s*(?:copay\s*)?(?:for\s*)?urgent/i);
        if (m) {
          result.urgentCopay = m[2] ? `$${m[1]} - $${m[2]}` : `$${m[1]}`;
        }
      }
    }
  },

  /**
   * Fallback regex parsing on full text for fields still missing
   */
  fallbackRegexParse(result, fullText) {
    const t = fullText.replace(/[‑–—\u2010-\u2015]/g, '-').replace(/\s+/g, ' ');

    // Plan Premium fallback
    if (result.planPremium === 'Not found') {
      const seg = findAfterInText(t, 'monthly plan premium', 120)
        || findAfterInText(t, 'plan premium', 120);
      if (seg) {
        const m = seg.match(/\$([\d,]+)/);
        if (m) result.planPremium = `$${m[1]}/month`;
      }
    }

    // Part B reduction fallback
    if (result.partBReduction === 'Not found') {
      const seg = findAfterInText(t, 'part b.*?give', 200)
        || findAfterInText(t, 'part b.*?reduc', 200);
      if (seg) {
        const m = seg.match(/\$([\d,]+(?:\.\d+)?)/);
        if (m) result.partBReduction = `$${m[1]}/month reduction`;
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

    // OTC fallback
    if (result.otcAllowance === 'Not found') {
      const seg = findAfterInText(t, 'over.the.counter', 300) || findAfterInText(t, '\\bOTC\\b', 300);
      if (seg) {
        const m = seg.match(/\$([\d,]+)/);
        if (m) {
          const period = seg.toLowerCase();
          if (/month/i.test(period)) result.otcAllowance = `$${m[1]}/month`;
          else if (/quarter/i.test(period)) result.otcAllowance = `$${m[1]}/quarter`;
          else result.otcAllowance = `$${m[1]}`;
        }
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
