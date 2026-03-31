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
        /(?:annual\s*)?medical\s*deductible/i,
        /deductible\s*(?:stage|phase|period)/i,
        /annual\s*deductible/i
      ],
      // Negative lookahead: skip if "drug" or "rx" or "prescription" or "part d" present
      antiPatterns: [/drug/i, /\brx\b/i, /prescription/i, /part\s*d/i],
      source: 'inNetwork',
      normalize: 'medDeductibleSpecial',
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
      patterns: [/specialist/i, /specialty\s*(?:care|visit)/i, /doctor\s*visits/i],
      antiPatterns: [/emergency/i],
      source: 'inNetwork',
      normalize: 'specialistSpecial',
      priority: 2
    },
    {
      key: 'preventiveCare',
      label: 'Preventive Care',
      patterns: [
        /^Preventive\b/i,
        /preventive\s*care/i,
        /preventive\s*services?$/i,
        /wellness\s*visit/i,
        /routine\s*physical/i,
      ],
      source: 'inNetwork',
      normalize: 'preventiveSpecial',
      priority: 2
    },
    {
      key: 'erCopay',
      label: 'Emergency Room',
      patterns: [
        /^emergency\s*care$/i,
        /emergency\s*(?:room|care|department|service)/i,
        /\bER\b\s*(?:visit|copay|care)/i,
        /emergency\s*and\s*urgent/i
      ],
      antiPatterns: [/urgently/i],
      source: 'inNetwork',
      normalize: 'erSpecial',
      priority: 1
    },
    {
      key: 'urgentCopay',
      label: 'Urgent Care',
      patterns: [/^urgent\s*care/i, /urgently\s*needed/i, /urgent.*service/i],
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
        /OTC\s*and\s*food/i,
        /over[- ]?the[- ]?counter\s*\(?OTC\)?\s*wallet/i,
        /\bOTC\b\s*(?:wallet|allowance|benefit|card|credit)/i,
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
        /^grocery\b/i,
        /grocery\s*(?:benefit|allowance|card)/i,
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
        /routine\s*dental/i,
        /\bdental\b.*(?:service|benefit|coverage|allowance)/i,
        /comprehensive\s*dental/i,
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
        /routine\s*eyewear/i,
        /prescription\s*eyewear/i,
        /vision\s*(?:allowance|benefit)/i,
        /eyewear\s*(?:allowance|benefit)/i,
        /vision\s*allowance/i,
        /contact\s*lenses?/i,
      ],
      antiPatterns: [/dental/i, /hearing/i, /diagnostic/i, /glaucoma/i, /cataract/i, /after\s*cataract/i],
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

    // Pre-sanitize: reset junk text values before fallback so regex can re-derive them
    for (const key of ['visionAllowance', 'transportation', 'preventiveCare']) {
      if (result[key] && !/^\$|^Not |^N\/A|^\d|^Unlimited/i.test(result[key])) {
        result[key] = 'Not found';
      }
    }

    // Detect flowing-text format (Anthem/Wellpoint): most pages lack table structure
    const flowingCount = allPages.filter(p => p.isFlowing).length;
    const isFlowingFormat = flowingCount > allPages.length * 0.5;

    // For flowing-text PDFs, parse directly from prose text
    if (isFlowingFormat) {
      const proseText = allPages.map(p => p.proseText || '').join(' ')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/\s+/g, ' ');
      this.parseFlowingText(result, proseText, allPages);
    }

    // Pass 2: Fallback regex parsing on raw text for anything still missing
    const fullText = allPages.map(p => p.rawText).join('\n');
    this.fallbackRegexParse(result, fullText, allPages);

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

    // Pass 9: Direct MOOP and Deductible lookup by exact label
    this.refineMOOPAndDeductible(result, allPages);

    // Sanitize: any field that doesn't start with $ and isn't a known value is junk
    for (const key of ['rxDeductible', 'medDeductible']) {
      if (result[key] && !/^\$|^Not |^N\/A|^\d/i.test(result[key])) {
        result[key] = 'Not found';
      }
    }
    // Sanitize vision and transportation: reset if value is junk text
    for (const key of ['visionAllowance', 'transportation']) {
      if (result[key] && !/^\$|^Not |^N\/A|^\d|^Unlimited/i.test(result[key])) {
        result[key] = 'Not found';
      }
    }

    // Rx deductible: final attempt if still not found
    if (result.rxDeductible === 'Not found') {
      const allRaw = allPages.map(p => p.rawText || '').join(' ').replace(/[\u2010-\u2015]/g, '-');
      const rxM = allRaw.match(/has\s*a\s*\$([\d,]+)\s*(?:prescription\s*)?(?:drug\s*)?deductible/i)
        || allRaw.match(/deductible\s*(?:limit|amount)\s*(?:of\s*)?\$([\d,]+)/i)
        || allRaw.match(/(?:your\s*)?deductible\s*amount\s*is\s*\$([\d,]+)/i)
        || allRaw.match(/\$([\d,]+(?:\.\d+)?)\s*deductible\s*(?:per\s*year\s*)?(?:for\s*)?(?:Part\s*D|prescription)/i)
        || allRaw.match(/Tiers?\s*\d[^$]{0,50}\$([\d,]+)\s*(?:Yearly\s*)?Deductible\s*Stage/i)
        || allRaw.match(/\$([\d,]+)\s*(?:for\s*)?Part\s*D\s*prescription\s*drugs/i);
      if (rxM) {
        const val = (rxM[1] || rxM[2]).replace(/\.00$/, '');
        const numVal = parseInt(val.replace(/,/g, ''));
        if (numVal <= 1000) result.rxDeductible = `$${val}`;
      }
      // Check for "No deductible" in drug/Rx/Part D context
      if (result.rxDeductible === 'Not found') {
        const noRxDed = allRaw.match(/(?:Part\s*D|drug|prescription|Rx)\s*(?:Deductible|deductible)\s*(?:[:,]?\s*)?(?:No\s*deductible|\$0)/i)
          || allRaw.match(/(?:No\s*deductible|Deductible[^.]{0,20}\$0)[^.]{0,60}(?:Part\s*D|drug|prescription)/i)
          || allRaw.match(/(?:Part\s*D|drug|prescription)[^.]{0,60}(?:No\s*deductible|no\s+deductible)/i)
          || allRaw.match(/(?:we\s*have\s*)?no\s+deductible[^.]{0,80}(?:initial\s*coverage|coverage\s*stage)/i)
          || allRaw.match(/Part\s*D\s*Deductible\s*[:|,\s|]*\s*(?:No\s*deductible|\$0\s*deductible|\$0)/i);
        if (noRxDed) {
          result.rxDeductible = '$0';
        }
      }
      // Scan structured rows: look for "Part D Deductible" label with "No deductible" or "$0" value
      if (result.rxDeductible === 'Not found') {
        for (const page of allPages) {
          for (const row of page.rows) {
            const label = (row.label || '') + ' ' + (row.inNetwork || '');
            if (/Part\s*D\s*Deductible/i.test(label)) {
              const allRowText = [row.label, row.inNetwork, row.outOfNetwork].join(' ');
              if (/no\s+deductible/i.test(allRowText)) {
                result.rxDeductible = '$0';
                break;
              }
              const dollars = Normalizer.extractDollars(allRowText);
              const small = dollars.filter(d => d.value <= 1000);
              if (small.length > 0) {
                result.rxDeductible = `$${small[0].raw}`;
                break;
              }
            }
          }
          if (result.rxDeductible !== 'Not found') break;
        }
      }
    }

    // Pass 10: Handle OTC + Food Card based on plan type
    const planName = (result.planName || '').toLowerCase();
    const isSNP = /c\s*-?\s*snp|d\s*-?\s*snp/i.test(planName);

    if (isSNP && result.otcAllowance && result.otcAllowance !== 'Not found') {
      // C-SNP / D-SNP: combine OTC + Food into one OTC line, hide Food Card
      const m = result.otcAllowance.match(/\$([\d,]+)/);
      if (m) {
        const period = /month/i.test(result.otcAllowance) ? '/month' : '';
        result.otcAllowance = `$${m[1]}${period} (Extra Supports Wallet) Food If Applicable`;
      }
      result.foodFlexCard = '__HIDE__';
    } else if (!isSNP) {
      // Non-SNP plans (PPO, HMO, etc.): no food card, show $0
      if (!result.foodFlexCard || result.foodFlexCard === 'Not found' || result.foodFlexCard === '__HIDE__') {
        result.foodFlexCard = '$0';
      }
    }

    // Pass 11: Prose-text based cleanup for remaining carrier issues
    // Uses proseText (all items in reading order) which works regardless of table format
    const allProse = allPages.map(p => p.proseText || '').join(' ').replace(/[\u2010-\u2015\u2212]/g, '-');
    const allRawAll = allPages.map(p => p.rawText || '').join(' ').replace(/[\u2010-\u2015\u2212]/g, '-');

    // Fix premium if junk (Zing puts plan name in premium field)
    if (result.planPremium === 'Not found' || (result.planPremium && !/^\$/.test(result.planPremium))) {
      const premM = allProse.match(/(?:Monthly\s*(?:Plan\s*)?Premium|plan\s*premium)[^$]{0,30}\$([\d,.]+)/i);
      if (premM) result.planPremium = `$${premM[1].replace(/\.00$/, '')}/month`;
    }

    // Fix MOOP if not found — search for "maximum out-of-pocket" or "MOOP" in prose
    if (result.moop === 'Not found') {
      const moopM = allProse.match(/(?:maximum\s*out[- ]?of[- ]?pocket|MOOP|out-of-pocket\s*(?:limit|amount|responsibility))[^$]{0,80}\$([\d,]+)/i);
      if (moopM) result.moop = `$${moopM[1]}`;
    }

    // Fix PCP if not found — "primary care" or "PCP" followed by $X copay
    if (result.pcpCopay === 'Not found') {
      const pcpM = allProse.match(/(?:Primary\s*care|PCP)[^$]{0,40}\$([\d,]+)\s*(?:copay|per\s*visit)/i)
        || allProse.match(/(?:Primary\s*care|PCP)[^$]{0,40}You\s*pay\s*\$([\d,]+)/i);
      if (pcpM) result.pcpCopay = `$${pcpM[1]} copay`;
    }

    // Fix ER if $0 or not found — "Emergency care" + $X copay
    if (result.erCopay === 'Not found' || result.erCopay === '$0') {
      const erM = allProse.match(/Emergency\s*(?:care|room)[^$]{0,20}\$([\d,]+)\s*(?:copay)?/i)
        || allProse.match(/Emergency\s*(?:care|room)[^$]{0,20}You\s*pay\s*\$([\d,]+)/i);
      if (erM && parseInt(erM[1].replace(/,/g, '')) > 0) result.erCopay = `$${erM[1]}`;
    }

    // Fix Urgent if junk or $0
    if (result.urgentCopay === 'Not found' || !/^\$/.test(result.urgentCopay)) {
      const urgM = allProse.match(/Urgent(?:ly)?\s*(?:needed\s*)?(?:care|services)[^$]{0,20}\$([\d,]+)\s*(?:copay|per\s*visit)?/i)
        || allProse.match(/Urgent(?:ly)?\s*(?:needed\s*)?(?:care|services)[^$]{0,20}You\s*pay\s*\$([\d,]+)/i);
      if (urgM) result.urgentCopay = `$${urgM[1]}`;
    }

    // Fix hearing — look for dollar allowance in "hearing aid" context
    // Only accept values >= $100 to avoid grabbing exam copays
    if (result.hearingAllowance === 'Not found' || result.hearingAllowance === '$0' || !/^\$/.test(result.hearingAllowance)) {
      const hearM = allProse.match(/hearing\s*aid[^.]{0,80}\$([\d,]+)\s*(?:benefit|allowance|max)/i)
        || allProse.match(/\$([\d,]+)\s*(?:benefit\s*)?(?:allowance\s*)?(?:towards|for|per\s*ear)\s*hearing\s*aid/i)
        || allProse.match(/hearing\s*aid[^.]{0,80}more\s*than\s*\$([\d,]+)/i)
        || allProse.match(/Up\s*to\s*(?:a\s*)?\$([\d,]+)[^.]{0,40}hearing\s*aid/i);
      if (hearM) {
        const amt = hearM[1] || hearM[2];
        const amtVal = parseInt(amt.replace(/,/g, ''));
        if (amtVal >= 100) {
          const perEar = /per\s*ear/i.test(allProse.substring(Math.max(0, allProse.indexOf(amt) - 50), allProse.indexOf(amt) + 100));
          result.hearingAllowance = `$${amt}${perEar ? '/ear' : ''} hearing aid benefit`;
        }
      }
    }

    // Fix transportation — look for trip count
    if (result.transportation === '$0' || result.transportation === 'Not found') {
      const tripM = allProse.match(/(\d+)\s*one[- ]?way\s*trips?\s*(?:per\s*year)?/i)
        || allProse.match(/transportation[^.]{0,60}(\d+)\s*(?:one[- ]?way\s*)?trips/i);
      if (tripM) {
        const miles = allProse.match(/(?:limit|up\s*to)\s*(\d+)\s*miles/i);
        result.transportation = `${tripM[1]} trips/year` + (miles ? `, ${miles[1]} miles` : '') + ' ($0 copay)';
      } else if (/transportation[^.]{0,60}not\s*covered/i.test(allProse)) {
        result.transportation = 'Not covered';
      }
    }

    // Fix OTC — look for dollar/quarter or dollar/month pattern
    if (result.otcAllowance === 'Not found' || (result.otcAllowance && !/^\$/.test(result.otcAllowance))) {
      const otcM = allProse.match(/OTC[^$]{0,60}\$([\d,]+)\s*(?:\/|per\s*)(?:quarter|month)/i)
        || allProse.match(/over[- ]the[- ]counter[^$]{0,60}\$([\d,]+)\s*(?:\/|per\s*)(?:quarter|month)/i)
        || allProse.match(/\$([\d,]+)\s*(?:\/|per\s*)quarter\s*(?:for\s*)?(?:over|OTC)/i);
      if (otcM) {
        const period = /month/i.test(otcM[0]) ? '/month' : '/quarter';
        result.otcAllowance = `$${otcM[1]}${period}`;
      }
    }

    // Fix dental — look for dollar allowance
    if (result.dentalAllowance === 'Not found' || result.dentalAllowance === '$0' ||
        result.dentalAllowance === '$0 copay for covered services' ||
        (result.dentalAllowance && !/^\$/.test(result.dentalAllowance))) {
      const dentM = allProse.match(/\$([\d,]+)\s*(?:combined\s*)?(?:annual\s*)?(?:benefit\s*)?(?:allowance|maximum)[^.]{0,40}dental/i)
        || allProse.match(/dental[^.]{0,80}\$([\d,]+)\s*(?:combined\s*)?(?:annual\s*)?(?:benefit\s*)?(?:allowance|maximum|coverage\s*amount)/i)
        || allProse.match(/\$([\d,]+)\s*(?:benefit\s*)?allowance\s*(?:every\s*year|per\s*year|annual)[^.]{0,40}dental/i);
      if (dentM) {
        const amt = parseInt((dentM[1] || '').replace(/,/g, ''));
        if (amt >= 100) result.dentalAllowance = `$${dentM[1]} allowance`;
      }
    }

    // Fix med deductible — "no deductible" or "$0" in medical context
    if (result.medDeductible === 'Not found') {
      const noMedDed = allProse.match(/(?:medical|plan)\s*(?:deductible)[^.]{0,30}(?:no\s*deductible|\$0)/i)
        || allProse.match(/no\s*deductible\s*(?:for\s*)?medical/i)
        || allProse.match(/deductible\s*\(medical\)[^$]{0,20}\$0/i);
      if (noMedDed) result.medDeductible = '$0';
    }

    // Fix Part B reduction — look for buyback/giveback/rebate
    if (result.partBReduction === 'Not found' || !/^\$|^N\/A/i.test(result.partBReduction)) {
      const partBM = allProse.match(/Part\s*B\s*(?:premium\s*)?(?:reduction|giveback|rebate|buy[- ]?(?:back|down)|subsidy)[^$]{0,30}\$([\d,.]+)/i)
        || allProse.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?(?:Part\s*B|premium)\s*(?:reduction|giveback|rebate)/i)
        || allProse.match(/Part\s*B\s*Rebate[^$]{0,20}\$([\d,.]+)/i);
      if (partBM) {
        result.partBReduction = `$${partBM[1].replace(/\.00$/, '')}/month`;
      } else if (result.partBReduction !== 'N/A' && !/^\$/.test(result.partBReduction || '')) {
        result.partBReduction = 'N/A';
      }
    }

    // Fix specialist — Aetna H5521-157 PPO showing wrong value
    if (result.specialistCopay === 'Not found') {
      const specM = allProse.match(/Specialist[^$]{0,30}\$([\d,]+)\s*(?:copay|per\s*visit)/i)
        || allProse.match(/Specialist[^$]{0,30}You\s*pay\s*\$([\d,]+)/i);
      if (specM) result.specialistCopay = `$${specM[1]} copay`;
    }

    // Fix MOOP — BCBSNC has "Annual Maximum" label; avoid grabbing hospital copay
    if (result.moop === 'Not found' || (result.moop && !/^\$[1-9]/.test(result.moop))) {
      const moopM2 = allProse.match(/Annual\s*Maximum[^$]{0,40}\$([\d,]+)/i);
      if (moopM2 && parseInt(moopM2[1].replace(/,/g, '')) >= 1000) {
        result.moop = `$${moopM2[1]}`;
      }
    }
    // Validate MOOP — must be >= $1000 (otherwise we grabbed a copay)
    if (result.moop && result.moop !== 'Not found') {
      const moopVal = Normalizer.extractDollars(result.moop);
      if (moopVal.length > 0 && moopVal[0].value < 1000) {
        result.moop = 'Not found';
        // Re-search
        const moopRetry = allProse.match(/(?:maximum\s*out[- ]?of[- ]?pocket|MOOP|out-of-pocket\s*(?:limit|amount|responsibility)|Annual\s*Maximum)[^$]{0,80}\$([\d,]+)/i);
        if (moopRetry && parseInt(moopRetry[1].replace(/,/g, '')) >= 1000) {
          result.moop = `$${moopRetry[1]}`;
        }
      }
    }

    // Fix Clover MOOP from prose
    if (result.moop === 'Not found') {
      const moopM3 = allProse.match(/\$([\d,]+)\s*for\s*in[- ]?network\s*providers/i);
      if (moopM3 && parseInt(moopM3[1].replace(/,/g, '')) >= 1000) {
        const combinedM = allProse.match(/\$([\d,]+)\s*for\s*in[- ]?\s*and\s*out/i);
        if (combinedM) {
          result.moop = `$${moopM3[1]} in-network / $${combinedM[1]} combined`;
        } else {
          result.moop = `$${moopM3[1]}`;
        }
      }
    }

    // Fix Kaiser PCP — "Doctor's visits $0 Primary care providers"
    if (result.pcpCopay === 'Not found' || (result.pcpCopay && !/^\$0/.test(result.pcpCopay) && /primary\s*care/i.test(allProse))) {
      const kaiserPcp = allProse.match(/Doctor.?s?\s*visits?\s*\$([\d,]+)/i);
      if (kaiserPcp) result.pcpCopay = `$${kaiserPcp[1]} copay`;
    }

    // Fix Kaiser OTC — "$0 up to the $25 quarterly benefit limit"
    if (result.otcAllowance && /^\$0/.test(result.otcAllowance)) {
      const kaiserOtc = allProse.match(/\$([\d,]+)\s*quarterly\s*benefit\s*limit/i)
        || allProse.match(/up\s*to\s*(?:the\s*)?\$([\d,]+)\s*quarterly/i);
      if (kaiserOtc && parseInt(kaiserOtc[1]) > 0) {
        result.otcAllowance = `$${kaiserOtc[1]}/quarter`;
      }
    }

    // Fix Molina hospital — "$325 copay per day for days 1-6" in prose
    if (result.hospitalCopay && /^\$0\/day.*days\s*1/i.test(result.hospitalCopay)) {
      // Hospital shows $0/day but might be wrong — re-check prose
      const hospCheck = allProse.match(/Inpatient[^.]{0,40}\$([\d,]+)\s*(?:copay\s*)?per\s*day/i);
      if (hospCheck && parseInt(hospCheck[1].replace(/,/g, '')) > 0) {
        // The actual copay is > $0, re-run hospital parse from prose
        const hospProse = allProse.match(/Inpatient[^.]{0,200}/i);
        if (hospProse) {
          const perDayAmounts = [...hospProse[0].matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day/gi)];
          const dayRanges = [...hospProse[0].matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
          const dayBeyond = [...hospProse[0].matchAll(/days?\s*(\d+)\s*and\s*beyond/gi)];
          for (const m of dayBeyond) dayRanges.push(Object.assign([...m], { index: m.index, 1: m[1], 2: '999' }));
          dayRanges.sort((a, b) => a.index - b.index);
          if (perDayAmounts.length > 0 && dayRanges.length > 0) {
            const tiers = [];
            for (const range of dayRanges) {
              let best = null;
              for (const amt of perDayAmounts) { if (amt.index < range.index) best = amt; }
              if (best) tiers.push({ amount: best[1], start: parseInt(range[1]), end: parseInt(range[2] || '999') });
            }
            if (tiers.length > 0) {
              const inNet = [tiers[0]];
              let next = tiers[0].end + 1;
              for (const t of tiers.slice(1)) { if (t.start === next) { inNet.push(t); next = t.end + 1; } }
              result.hospitalCopay = inNet.map(t => { const e = t.end >= 999 ? '+' : `-${t.end}`; return `$${t.amount}/day, days ${t.start}${e}`; }).join('; ');
            }
          }
        }
      }
    }

    // Fix Molina dental — "$4,000" annual maximum
    if (result.dentalAllowance && !/^\$[1-9].*(?:allowance|maximum)/i.test(result.dentalAllowance)) {
      const molDent = allProse.match(/(?:dental|comprehensive)[^.]{0,80}(?:coverage\s*amount|maximum\s*benefit|annual\s*(?:plan\s*)?maximum)[^$]{0,20}\$([\d,]+)/i)
        || allProse.match(/\$([\d,]+)[^.]{0,30}(?:annual|yearly)\s*(?:plan\s*)?(?:maximum|benefit\s*coverage)/i);
      if (molDent) {
        const amt = parseInt(molDent[1].replace(/,/g, ''));
        if (amt >= 500 && amt <= 10000) result.dentalAllowance = `$${molDent[1]} annual maximum`;
      }
    }

    // Fix BCBSNC dental — "$2,000 combined yearly allowance"
    if (result.dentalAllowance && !/^\$[1-9]/i.test(result.dentalAllowance)) {
      const bcDent = allProse.match(/\$([\d,]+)\s*combined\s*(?:yearly|annual)\s*allowance/i);
      if (bcDent) result.dentalAllowance = `$${bcDent[1]} combined yearly allowance`;
    }

    // Fix BCBSNC/Wellcare hearing — sanitize junk
    if (result.hearingAllowance && !/^\$|^Not |^Hearing/i.test(result.hearingAllowance)) {
      result.hearingAllowance = 'Not found';
    }
    // Hearing: fix if showing small amounts that are exam copays not aid benefits
    if (result.hearingAllowance && /^\$\d+\s/.test(result.hearingAllowance)) {
      const hVal = Normalizer.extractDollars(result.hearingAllowance);
      if (hVal.length > 0 && hVal[0].value > 0 && hVal[0].value < 100) {
        // Check if there's a description like "2 hearing aids every 2 years"
        const hDesc = allProse.match(/(?:up\s*to\s*)?(\d)\s*(?:pre[- ]?selected\s*)?hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i);
        if (hDesc) {
          result.hearingAllowance = `${hDesc[1]} hearing aids every ${hDesc[2]} years`;
        } else {
          result.hearingAllowance = 'Not found';
        }
      }
    }

    // Fix Wellcare hearing — "Up to a $750" or "Up to a $500"
    if (result.hearingAllowance === 'Not found' || result.hearingAllowance === '$0') {
      const wellHear = allProse.match(/(?:Hearing\s*Aid\s*Allowance|hearing\s*aid)[^$]{0,60}Up\s*to\s*(?:a\s*)?\$([\d,]+)/i)
        || allProse.match(/Up\s*to\s*(?:a\s*)?\$([\d,]+)[^.]{0,40}hearing\s*aid/i);
      if (wellHear) result.hearingAllowance = `$${wellHear[1]} hearing aid benefit`;
    }

    // Fix dental — search for dollar allowance/maximum if still showing $0 or copay-only
    if (result.dentalAllowance === '$0 copay for covered services' || result.dentalAllowance === '$0' || result.dentalAllowance === '$45') {
      const dentSearch = allProse.match(/\$([\d,]+)\s*(?:annual|yearly|combined)\s*(?:maximum|allowance|benefit)/i)
        || allProse.match(/\$([\d,]+)\s*(?:combined\s*)?(?:yearly|annual)\s*allowance/i)
        || allProse.match(/pays?\s*up\s*to\s*\$([\d,]+)\s*(?:every|per)\s*(?:year|calendar)/i)
        || allRawAll.match(/\$([\d,]+)\s*(?:annual|yearly|combined)\s*(?:maximum|allowance|benefit)/i)
        || allRawAll.match(/pays?\s*up\s*to\s*\$([\d,]+)\s*(?:every|per)\s*(?:year|calendar)/i);
      if (dentSearch) {
        const amt = parseInt(dentSearch[1].replace(/,/g, ''));
        if (amt >= 500 && amt <= 10000) {
          result.dentalAllowance = `$${dentSearch[1]} annual maximum`;
        }
      }
    }

    // Fix plan names for carriers that still show Unknown or H-number only
    if (result.planName === 'Unknown Plan' || /^H\d{4}/.test(result.planName)) {
      // Search prose for common plan name patterns
      const namePatterns = [
        /(?:Wellcare|Clover|Kaiser|Molina|Zing|HealthSpring|ClearSpring|BCBS|Humana|Cigna|Devoted|WellPoint)\s+[A-Z][^.]{5,60}?\([^)]+\)/i,
        /(?:UHC|United\s*Health)\s+[A-Z][^.]{5,60}?\([^)]+\)/i,
        /Blue\s+Medicare\s+[A-Z][^.]{5,50}?\)?/i,
      ];
      for (const pat of namePatterns) {
        const nameM = allProse.match(pat);
        if (nameM) {
          const hNum = result.planName.match(/H\d{4}[-_]\d{3}/);
          if (hNum) {
            result.planName = `${nameM[0].trim()} ${hNum[0]}`;
          } else {
            result.planName = nameM[0].trim();
          }
          break;
        }
      }
    }

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
      case 'preventiveSpecial': {
        // Preventive care is always $0 copay on Medicare Advantage plans
        // The value might contain junk like bullet points from the services list
        if (/\$0|no\s*charge|no\s*cost/i.test(t)) return '$0 copay';
        // If we got a list of services instead of a copay, it's still $0
        if (/screening|counseling|vaccine|mammogram|wellness/i.test(t)) return '$0 copay';
        // If the value doesn't contain a clear copay/dollar amount, it's junk text — default to $0
        // Medicare Advantage plans are required to cover preventive care at $0
        const copayResult = Normalizer.copay(t);
        if (copayResult && /^\$\d/.test(copayResult)) return copayResult;
        return '$0 copay';
      }
      case 'medDeductibleSpecial': {
        // Handle "This plan does not have a medical deductible" → $0
        // Handle "No deductible" → $0
        if (/does\s*not\s*have|no\s*(?:medical\s*)?deductible|^no\s*deductible$/i.test(t)) return '$0';
        // Handle standalone "No deductible" even with surrounding text
        if (/\bno\s+deductible\b/i.test(t) && !/\$\d/.test(t)) return '$0';
        return Normalizer.dollar(t);
      }
      case 'hospitalSpecial': {
        // Hospital per-day tiers: "$407 per day, days 1-6; $0 per day, days 7-90"
        // Also handle: "Days 1-5: $295 copay" (BCBSNC reversed), "$350 per day: days 1-6" (Anthem colon)
        // Also handle: "$2,015 copay per stay" (Wellcare flat per-stay)

        // Flat per-stay format
        const perStayM = t.match(/\$([\d,]+)\s*(?:copay\s*)?per\s*stay/i);
        if (perStayM) {
          const stayDays = t.match(/(?:for\s*)?days?\s*(\d+)\s*(?:[-–]\s*(\d+)|through\s*(\d+))/i);
          if (stayDays) {
            const end = stayDays[2] || stayDays[3];
            return `$${perStayM[1]} per stay, days ${stayDays[1]}-${end}`;
          }
          return `$${perStayM[1]} per stay`;
        }

        // Reversed format: "Days 1-5: $295 copay" or "Days 1-5: | $295 copay" (BCBSNC)
        const reversedTiers = [...t.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)\s*:?\s*\|?\s*\$([\d,]+(?:\.\d+)?)\s*(?:copay|per\s*day)?/gi)];
        if (reversedTiers.length > 0) {
          const parts = reversedTiers.map(m => `$${m[3].replace(/\.00$/, '')}/day, days ${m[1]}-${m[2]}`);
          return parts.join('; ');
        }

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
      case 'specialistSpecial': {
        // Handle combined PCP/Specialist rows like "Primary Care: $0 copay Specialist: $0 to $35 copay"
        // Extract just the specialist portion if present
        const specM = t.match(/specialist[s:]?\s*\$(\d+)\s*(?:to|-)\s*\$(\d+)\s*copay/i);
        if (specM) return `$${specM[1]} - $${specM[2]} copay`;
        const specM2 = t.match(/specialist[s:]?\s*\$([\d,]+)\s*copay/i);
        if (specM2) return `$${specM2[1]} copay`;
        // If the value itself is just a specialist copay
        return Normalizer.copay(t);
      }
      case 'erSpecial': {
        // Extract ER copay — handle multiple formats:
        // Aetna: "$115 copay for emergency care"
        // UHC: "$130 copay ($0 copay for emergency care outside...)"
        // For UHC, the FIRST dollar amount is the actual copay
        const erM = t.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?emergency\s*care/i);
        if (erM) return `$${erM[1]}`;
        // UHC format: "$130 copay ($0 copay for..."  — first $ is the real copay
        const firstDollar = t.match(/^\$([\d,]+)\s*copay/i) || t.match(/\$([\d,]+)\s*copay/i);
        if (firstDollar) return `$${firstDollar[1]}`;
        return Normalizer.copay(t);
      }
      case 'urgentSpecial': {
        // Extract urgent care copay — handle multiple formats:
        // Aetna: "$40 copay for urgent care"
        // UHC: "$50 copay ($0 copay for urgently needed services outside...)"
        const ucM = t.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?urgent/i);
        if (ucM) return `$${ucM[1]}`;
        const firstDollar = t.match(/^\$([\d,]+)\s*copay/i) || t.match(/\$([\d,]+)\s*copay/i);
        if (firstDollar) return `$${firstDollar[1]}`;
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

    // Look for H-number in page 1 rows, and also look for a row containing
    // the full plan name with H-number embedded (ClearSpring side-by-side format)
    let hNum = null;
    let fullPlanNameFromRow = null;
    for (const row of page1.rows) {
      const text = normRow(row);
      const hMatch = text.match(/(H\d{4})\s*[-_]\s*(\d{3})/i)
        || text.match(/(H\d{4})(\d{3})\b/i); // compact format e.g. "26TNH5828016"
      if (hMatch) {
        if (!hNum) hNum = `${hMatch[1]}-${hMatch[2]}`;
        // Check if this row contains a full plan name (not just H-number)
        // e.g. "Clear Spring Health Balance+ Diabetes & Heart (HMO C-SNP) H6672-003"
        const beforeH = text.substring(0, hMatch.index).trim();
        if (beforeH.length > 10 && !fullPlanNameFromRow
          && !/\.com|\.gov|a\.?m|TTY|monday|friday|october|april/i.test(beforeH)) {
          fullPlanNameFromRow = text.replace(/[\u2010-\u2015\u2212]/g, '-').trim();
        }
      }
    }

    // If no H-number found in structured rows, search raw text
    if (!hNum) {
      const rawAll = allPages.map(p => p.rawText).join('\n').replace(/[\u2010-\u2015\u2212]/g, '-');
      const hM = rawAll.match(/(H\d{4})\s*[-_]\s*(\d{3})/i)
        || rawAll.match(/(H\d{4})(\d{3})\b/i);
      if (hM) hNum = `${hM[1]}-${hM[2]}`;
    }

    // If we found a full plan name with H-number embedded in a row, use it directly
    if (fullPlanNameFromRow) return fullPlanNameFromRow;

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
      if (/\d\s*a\.?m|TTY|local\s*time|monday|friday|october|april|january/i.test(text)) continue;
      if (/\.com|\.gov|medicare\.gov/i.test(text)) continue;

      // This is likely the plan name
      const planText = text.replace(/[\u2010-\u2015\u2212]/g, '-');
      if (hNum) {
        // Don't duplicate H-number if already in the plan text
        if (planText.includes(hNum)) return planText;
        return `${planText} ${hNum}`;
      }
      return planText;
    }

    // Anthem/Wellpoint fallback: plan name may appear lower on page 1 or on later pages
    const pagesToSearch = allPages.slice(0, Math.min(3, allPages.length));
    for (const pg of pagesToSearch) {
      for (const row of pg.rows) {
        const text = (row.label || row.inNetwork || '').trim().replace(/[\u2010-\u2015\u2212]/g, '-');
        if (/(?:Wellpoint|Anthem|Humana|Cigna|BCBS)\s+Medicare\s+/i.test(text) && text.length > 10 && text.length < 100) {
          if (/summary\s*of\s*benefits/i.test(text)) continue;
          if (hNum) {
            if (text.includes(hNum)) return text;
            return `${text} ${hNum}`;
          }
          return text;
        }
      }
    }

    // Search prose text for plan name with H-number
    if (hNum) {
      const allProse = allPages.map(p => p.proseText || '').join(' ').replace(/[\u2010-\u2015\u2212]/g, '-');
      const nameM = allProse.match(/((?:Wellpoint|Anthem|Humana|Cigna|BCBS)\s+Medicare\s+[^.]{5,60}?\([^)]+\))/i);
      if (nameM) {
        const planText = nameM[1].trim();
        if (planText.includes(hNum)) return planText;
        return `${planText} ${hNum}`;
      }
    }

    return hNum || 'Unknown Plan';
  },

  /**
   * Refine MOOP: extract both in-network and combined limits
   */
  refineMOOP(result, allPages) {
    // Re-derive MOOP from structured data if not already found by flowing text parser
    const previousMoop = result.moop;
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

    // If structured data didn't find MOOP, restore previous value (e.g. from flowing text parser)
    if (result.moop === 'Not found' && previousMoop !== 'Not found') {
      result.moop = previousMoop;
    }
  },

  /**
   * Refine deductibles with context awareness
   */
  refineDeductibles(result, allPages, fullText) {
    // Medical deductible: handle "does not have a medical deductible" or "No deductible" text
    if (result.medDeductible !== 'Not found' && /does\s*not\s*have|no\s*(?:medical\s*)?deductible|\bno\s+deductible\b/i.test(result.medDeductible)) {
      result.medDeductible = '$0';
    }

    // Medical deductible validation: reject if value matches MOOP or Rx deductible
    if (result.medDeductible !== 'Not found' && result.medDeductible !== '$0') {
      const dedDollars = Normalizer.extractDollars(result.medDeductible);
      if (dedDollars.length > 0) {
        // Reject if same value as MOOP
        if (result.moop !== 'Not found' && result.moop.includes(dedDollars[0].raw)) {
          result.medDeductible = 'Not found';
        }
        // Reject if same value as Rx deductible (grabbed wrong field)
        if (result.rxDeductible !== 'Not found' && result.rxDeductible.includes(dedDollars[0].raw)) {
          result.medDeductible = 'Not found';
        }
      }
    }

    // Fallback: search rawText for medical deductible
    if (result.medDeductible === 'Not found') {
      const dedSeg = findAfterInText(fullText, 'medical deductible', 300)
        || findAfterInText(fullText, 'annual medical deductible', 300);
      if (dedSeg) {
        if (/does\s*not\s*have|no\s*(?:medical\s*)?deductible|\bno\s+deductible\b|\$0/i.test(dedSeg)) {
          result.medDeductible = '$0';
        } else {
          const m = dedSeg.match(/\$([\d,]+)/);
          if (m) result.medDeductible = `$${m[1]}`;
        }
      }
    }

    if (result.medDeductible !== 'Not found' && result.moop !== 'Not found') {
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

    // Rx deductible: handled in fallbackRegexParse — skip here
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

        // ClearSpring / side-by-side format: "Emergency" or "Emergency Care" label
        // with "$X copay" on the row ABOVE or in continuation rows.
        // In this layout, the value row often precedes the label row.
        if (result.erCopay === 'Not found' && /^Emergency\b/i.test(label) && !/urgent/i.test(label)) {
          let erVal = row.inNetwork || '';
          // Look back at previous row for value (ClearSpring puts value row before label)
          // The value may have been merged into a header row (e.g. "SUMMARY OF BENEFITS")
          if (!erVal.match(/\$([\d,]+)\s*copay/i) && i > 0) {
            const prevRow = page.rows[i - 1];
            const prevInNet = prevRow.inNetwork || '';
            // Extract the last "$X copay" from the previous row's inNetwork
            const lastCopay = prevInNet.match(/\$([\d,]+)\s*copay\s*$/i)
              || prevInNet.match(/\$([\d,]+)\s*copay(?:\s|$)/i);
            if (lastCopay) {
              erVal = lastCopay[0];
            }
          }
          const erM = erVal.match(/\$([\d,]+)\s*copay/i);
          if (erM && parseInt(erM[1].replace(/,/g, '')) > 0) {
            result.erCopay = `$${erM[1]}`;
          }
        }

        // ClearSpring: "Urgently Needed Services" label with value on row above
        if (result.urgentCopay === 'Not found' && /^Urgently\b/i.test(label)) {
          let ucVal = row.inNetwork || '';
          if (!ucVal.match(/\$([\d,]+)\s*copay/i) && i > 0) {
            const prevRow = page.rows[i - 1];
            const prevInNet = prevRow.inNetwork || '';
            // Extract the last "$X copay" from the previous row's inNetwork
            const lastCopay = prevInNet.match(/\$([\d,]+)\s*copay\s*$/i)
              || prevInNet.match(/\$([\d,]+)\s*copay(?:\s|$)/i);
            if (lastCopay) {
              ucVal = lastCopay[0];
            }
          }
          for (let j = i + 1; j < Math.min(i + 4, page.rows.length); j++) {
            const nextRow = page.rows[j];
            const nextLabel = (nextRow.label || '').trim();
            if (/diagnostic|lab|hearing|vision|dental/i.test(nextLabel)) break;
            if (!nextLabel || nextLabel.length < 5) {
              ucVal += ' ' + (nextRow.inNetwork || '');
            }
          }
          const ucM = ucVal.match(/\$([\d,]+)\s*copay/i);
          if (ucM && parseInt(ucM[1].replace(/,/g, '')) > 0) {
            result.urgentCopay = `$${ucM[1]}`;
          }
        }
      }
    }

    // Fallback: regex on full normalized text
    const t = fullText.replace(/[\u2010-\u2015]/g, '-');

    if (result.erCopay === 'Not found' || result.erCopay === '$0') {
      const erSeg = findAfterInText(t, 'Emergency care', 300)
        || findAfterInText(t, 'Emergency Care', 300);
      if (erSeg) {
        const m = erSeg.match(/\$([\d,]+)\s*copay/i);
        if (m && parseInt(m[1].replace(/,/g, '')) > 0) {
          result.erCopay = `$${m[1]}`;
        }
      }
    }

    if (result.urgentCopay === 'Not found' || result.urgentCopay === '$0') {
      const ucSeg = findAfterInText(t, 'Urgently needed', 300)
        || findAfterInText(t, 'Urgently Needed', 300)
        || findAfterInText(t, 'Urgent care', 300);
      if (ucSeg) {
        const m = ucSeg.match(/\$([\d,]+)\s*copay/i);
        if (m && parseInt(m[1].replace(/,/g, '')) > 0) {
          result.urgentCopay = `$${m[1]}`;
        }
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
  /**
   * Direct lookup for MOOP and Plan Deductible by scanning for exact label matches.
   * On Aetna PDFs:
   *   "MOOP" label → max out-of-pocket
   *   "Plan deductible" label → medical deductible
   * This runs LAST and overrides any incorrect values from earlier passes.
   */
  refineMOOPAndDeductible(result, allPages) {
    for (const page of allPages) {
      for (let i = 0; i < page.rows.length; i++) {
        const row = page.rows[i];
        const label = (row.label || '').replace(/[\u2010-\u2015\u2212]/g, '-').trim();

        // MOOP: exact label match "MOOP"
        if (/^MOOP$/i.test(label)) {
          // Gather text from this row and next few continuation rows
          let allText = '';
          for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
            const r = page.rows[j];
            allText += ' ' + [r.inNetwork, r.outOfNetwork].filter(Boolean).join(' ');
          }
          allText = allText.replace(/[\u2010-\u2015]/g, '-');

          const inNetM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-network/i);
          const combinedM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-?\s*and\s*out-?of-?network\s*(?:services\s*)?combined/i);

          if (inNetM && combinedM) {
            result.moop = `$${inNetM[1]} in-network / $${combinedM[1]} in- and out-of-network combined`;
          } else if (inNetM) {
            result.moop = `$${inNetM[1]}`;
          } else {
            const dollars = Normalizer.extractDollars(allText).filter(d => d.value >= 1000);
            if (dollars.length >= 2) {
              result.moop = `$${dollars[0].raw} in-network / $${dollars[1].raw} in- and out-of-network combined`;
            } else if (dollars.length === 1) {
              result.moop = `$${dollars[0].raw}`;
            }
          }
        }

        // MOOP: UHC uses "Maximum out-of-pocket amount"
        if (/^Maximum\s*out/i.test(label) && label.length < 50) {
          const value = row.inNetwork || '';
          const dollars = Normalizer.extractDollars(value);
          if (dollars.length > 0) {
            result.moop = `$${dollars[0].raw}`;
          }
        }

        // Plan deductible / Annual medical deductible / Deductible (standalone)
        if (/^Plan\s*deductible/i.test(label) || /^Annual\s*medical\s*deductible/i.test(label) || /^Deductible$/i.test(label)) {
          const value = row.inNetwork || label;
          // Skip if this is actually a drug/Part D deductible
          if (/Part\s*D|drug|rx|prescription/i.test(value)) continue;
          // "This plan does not have a medical deductible" / "No deductible"
          if (/does\s*not\s*have|no\s*(?:medical\s*)?deductible|\bno\s+deductible\b/i.test(value)) {
            result.medDeductible = '$0';
          } else {
            const dollars = Normalizer.extractDollars(value);
            if (dollars.length > 0) {
              result.medDeductible = `$${dollars[0].raw}`;
            } else if (/\$0/.test(value)) {
              result.medDeductible = '$0';
            }
          }
        }
      }
    }
  },

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

        // ClearSpring: standalone "Transportation" label with value on row above
        if (/^transportation$/i.test(label.trim())) {
          let value = row.inNetwork || '';
          // Check if the value row is above (ClearSpring side-by-side layout)
          if (i > 0 && !/\d+\s*(?:one[- ]?way|round)?\s*trips?/i.test(value)) {
            const prevRow = page.rows[i - 1];
            const prevInNet = prevRow.inNetwork || '';
            if (/\d+\s*(?:one[- ]?way|round)?\s*trips?/i.test(prevInNet)) {
              value = prevInNet + ' ' + value;
            }
          }
          if (/not\s*covered/i.test(value)) {
            result.transportation = 'Not covered';
          } else {
            result.transportation = Normalizer.transportation(value);
          }
          if (result.transportation !== 'Not found') return;
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
    // If the flowing text parser already found a multi-tier hospital result, keep it
    if (result.hospitalCopay && result.hospitalCopay !== 'Not found' && /days.*days/i.test(result.hospitalCopay)) {
      return;
    }
    // Use rawText to find the Inpatient section, then extract per-day tiers.
    // Key insight: "$X per day" and "days N-M" may not be adjacent in the text
    // because OON text can be interleaved. So we find them separately and
    // match each "days N-M" with the closest preceding "$X per day".
    for (const page of allPages) {
      const raw = (page.rawText || '').replace(/[\u2010-\u2015\u2212]/g, '-');

      const idx = raw.search(/\bInpatient\b(?!.*psychiatric)/i);
      if (idx === -1) continue;

      // Include up to 200 chars before "Inpatient" to catch ClearSpring format
      // where the per-day tier row appears BEFORE the label row
      const beforeStart = Math.max(0, idx - 200);
      const before = raw.substring(beforeStart, idx);
      const after = raw.substring(idx, idx + 800);
      const stopIdx = after.search(/\bOutpatient\b/i);
      const afterTrimmed = stopIdx > 0 ? after.substring(0, stopIdx) : after;
      const segment = before + afterTrimmed;

      // Check for flat "per stay" format first (Wellcare: "$2,015 copay • per stay for days 1 through 90")
      const perStayM = segment.match(/\$([\d,]+)\s*(?:copay\s*)?[•·]?\s*per\s*stay/i);
      if (perStayM) {
        // Check if there's a day range associated with it
        const afterStay = segment.substring(perStayM.index);
        const stayDays = afterStay.match(/(?:for\s*)?days?\s*(\d+)\s*(?:[-–]\s*(\d+)|through\s*(\d+))/i);
        if (stayDays) {
          const end = stayDays[2] || stayDays[3];
          result.hospitalCopay = `$${perStayM[1]} per stay, days ${stayDays[1]}-${end}`;
        } else {
          result.hospitalCopay = `$${perStayM[1]} per stay`;
        }
        return;
      }

      // Find all "$X copay per day" amounts and all "days N-M" or "days N and beyond" ranges
      // Also handle reversed format: "Days 1-5: $295 copay" (BCBSNC)
      const perDayAmounts = [...segment.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day/gi)];
      // Handle "Days 1-6: $X.XX per day" (Anthem colon format) and "Days 1-5: | $295 copay" (BCBSNC reversed, pipe-separated)
      const reversedTiers = [...segment.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)\s*:?\s*\|?\s*\$([\d,]+(?:\.\d+)?)\s*(?:copay|per\s*day)?/gi)];
      // Also match "Days X and beyond: $Y copay" (with optional pipe)
      const reversedBeyond = [...segment.matchAll(/days?\s*(\d+)\s*and\s*beyond\s*:?\s*\|?\s*\$([\d,]+(?:\.\d+)?)\s*(?:copay|per\s*day)?/gi)];

      if (reversedTiers.length > 0 || reversedBeyond.length > 0) {
        const allReversed = [];
        for (const m of reversedTiers) {
          allReversed.push({ amount: m[3].replace(/\.00$/, ''), start: parseInt(m[1]), end: parseInt(m[2]), index: m.index });
        }
        for (const m of reversedBeyond) {
          allReversed.push({ amount: m[2].replace(/\.00$/, ''), start: parseInt(m[1]), end: 999, index: m.index });
        }
        allReversed.sort((a, b) => a.index - b.index);

        // Build sequential tiers starting from day 1
        const day1Tier = allReversed.find(t => t.start === 1);
        if (day1Tier) {
          const inNetTiers = [day1Tier];
          let nextDayStart = day1Tier.end + 1;
          for (const tier of allReversed) {
            if (tier.start === nextDayStart) {
              inNetTiers.push(tier);
              nextDayStart = tier.end >= 999 ? 99999 : tier.end + 1;
            }
          }
          result.hospitalCopay = inNetTiers.map(t => {
            const endStr = t.end >= 999 ? '+' : `-${t.end}`;
            return `$${t.amount}/day, days ${t.start}${endStr}`;
          }).join('; ');
          return;
        }
        // If no day-1 tier found on this page, continue to next page
      }

      const dayRanges = [...segment.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
      // Also match "days X and beyond" (UHC format) — use 999 as the end marker
      const dayBeyond = [...segment.matchAll(/days?\s*(\d+)\s*and\s*beyond/gi)];
      for (const m of dayBeyond) {
        dayRanges.push({ ...m, 1: m[1], 2: '999', index: m.index });
        // Manually set capture groups
        dayRanges[dayRanges.length - 1][1] = m[1];
        dayRanges[dayRanges.length - 1][2] = '999';
      }
      // Sort all day ranges by position in text
      dayRanges.sort((a, b) => a.index - b.index);

      if (perDayAmounts.length > 0 && dayRanges.length > 0) {
        // Match each day range with the closest preceding per-day amount
        const tiers = [];
        for (const range of dayRanges) {
          let bestAmount = null;
          for (const amount of perDayAmounts) {
            if (amount.index < range.index) bestAmount = amount;
          }
          if (bestAmount) {
            tiers.push({
              amount: bestAmount[1],
              start: parseInt(range[1]),
              end: parseInt(range[2])
            });
          }
        }

        if (tiers.length > 0) {
          // Sequential day logic: start with first tier (days 1-X),
          // find next tier starting at X+1
          const inNetTiers = [tiers[0]];
          let nextDayStart = tiers[0].end + 1;

          for (const tier of tiers.slice(1)) {
            if (tier.start === nextDayStart) {
              inNetTiers.push(tier);
              nextDayStart = tier.end + 1;
            }
          }

          result.hospitalCopay = inNetTiers.map(t => {
            const endStr = t.end >= 999 ? '+' : `-${t.end}`;
            return `$${t.amount}/day, days ${t.start}${endStr}`;
          }).join('; ');
          return;
        }
      }

      // Simple $0 copay (D-SNP plans)
      if (/Inpatient[^|]*\$0\s*copay/i.test(segment)) {
        result.hospitalCopay = '$0 copay';
        return;
      }
    }
  },

  /**
   * Parse flowing-text (non-tabular) PDFs like Anthem/Wellpoint.
   * These PDFs have Q&A format with inline dollar amounts instead of table columns.
   */
  parseFlowingText(result, prose, allPages) {
    const t = prose;

    // Plan Premium: "How much is my premium (monthly payment)? $X.XX per month"
    if (result.planPremium === 'Not found') {
      const premM = t.match(/(?:premium|monthly\s*payment)\s*\??\s*\$([\d,.]+)\s*per\s*month/i)
        || t.match(/\$([\d,.]+)\s*per\s*month/i);
      if (premM) {
        const val = premM[1].replace(/\.00$/, '');
        result.planPremium = `$${val}/month`;
      }
    }

    // Medical Deductible: "This plan does not have a medical deductible"
    if (result.medDeductible === 'Not found' || result.medDeductible === '$200') {
      const dedSeg = findAfterInText(t, 'How much is my deductible', 500)
        || findAfterInText(t, 'medical deductible', 300);
      if (dedSeg) {
        if (/does\s*not\s*have\s*a\s*medical\s*deductible/i.test(dedSeg) ||
            /no\s*medical\s*deductible/i.test(dedSeg)) {
          result.medDeductible = '$0';
        } else {
          // Look for a dollar amount NOT associated with Part D/drug/prescription
          const sentences = dedSeg.split(/\.\s*/);
          for (const s of sentences) {
            if (/Part\s*D|prescription|drug/i.test(s)) continue;
            const m = s.match(/\$([\d,]+(?:\.\d+)?)/);
            if (m) {
              result.medDeductible = `$${m[1].replace(/\.00$/, '')}`;
              break;
            }
          }
          if (result.medDeductible === '$200') {
            // $200 was wrongly grabbed from Rx section; check if "does not have" precedes it
            if (/does\s*not\s*have\s*a\s*medical\s*deductible/i.test(dedSeg)) {
              result.medDeductible = '$0';
            }
          }
        }
      }
    }

    // Rx Deductible: "$200.00 deductible per year for Part D prescription drugs"
    if (result.rxDeductible === 'Not found') {
      const rxM = t.match(/\$([\d,.]+)\s*deductible\s*(?:per\s*year\s*)?(?:for\s*)?Part\s*D/i)
        || t.match(/Part\s*D[^.]{0,60}\$([\d,.]+)\s*deductible/i);
      if (rxM) {
        result.rxDeductible = `$${rxM[1].replace(/\.00$/, '')}`;
      }
    }

    // MOOP: "Is there a limit on how much I will pay..." then "$X,XXX.XX per year"
    if (result.moop === 'Not found') {
      const moopSeg = findAfterInText(t, 'limit on how much I will pay', 400)
        || findAfterInText(t, 'out-of-pocket', 300);
      if (moopSeg) {
        const m = moopSeg.match(/\$([\d,]+(?:\.\d+)?)\s*per\s*year/i);
        if (m) {
          const val = m[1].replace(/\.00$/, '');
          const numVal = parseInt(val.replace(/,/g, ''));
          if (numVal >= 1000) result.moop = `$${val}`;
        }
      }
    }

    // PCP Copay: "Primary care physician (PCP) visit: PCPs in our plan: $X.XX copay"
    // Always override in flowing text since structured parser may grab chiropractic copay
    {
      const pcpSeg = findAfterInText(t, 'Primary care physician \\(PCP\\) visit', 300)
        || findAfterInText(t, 'PCP\\)? visit', 200)
        || findAfterInText(t, 'Doctor.{0,5}s Office Visits', 400);
      if (pcpSeg) {
        const m = pcpSeg.match(/(?:PCPs?|doctors?)\s*in\s*our\s*plan\s*:?\s*\$([\d,.]+)\s*copay/i);
        if (m) result.pcpCopay = `$${m[1].replace(/\.00$/, '')} copay`;
      }
    }

    // Specialist Copay: "Specialist visit: Doctors in our plan: $X.XX copay"
    if (result.specialistCopay === 'Not found') {
      const specSeg = findAfterInText(t, 'Specialist visit', 200);
      if (specSeg) {
        const m = specSeg.match(/(?:Doctors?|Providers?)\s*in\s*our\s*plan\s*:?\s*\$([\d,.]+)\s*copay/i);
        if (m) result.specialistCopay = `$${m[1].replace(/\.00$/, '')} copay`;
      }
    }
    // ClearSpring: "Specialist: $0 to $35 copay" in raw text
    if (result.specialistCopay === 'Not found') {
      const specM = t.match(/Specialist[s:]?\s*\$(\d+)\s*(?:to|-)\s*\$(\d+)\s*copay/i);
      if (specM) {
        result.specialistCopay = `$${specM[1]} - $${specM[2]}`;
      } else {
        const specM2 = t.match(/Specialist[s:]?\s*\$([\d,]+)\s*copay/i);
        if (specM2) result.specialistCopay = `$${specM2[1]} copay`;
      }
    }

    // Emergency Care: "Emergency Care $X.XX copay"
    if (result.erCopay === 'Not found') {
      const erSeg = findAfterInText(t, 'Emergency Care', 300);
      if (erSeg) {
        const m = erSeg.match(/\$([\d,.]+)\s*copay/i);
        if (m) result.erCopay = `$${m[1].replace(/\.00$/, '')}`;
      }
    }

    // Urgent Care: "Urgently Needed Services $X.XX copay"
    if (result.urgentCopay === 'Not found') {
      const urgSeg = findAfterInText(t, 'Urgently Needed', 200)
        || findAfterInText(t, 'Urgent Care', 200);
      if (urgSeg) {
        const m = urgSeg.match(/\$([\d,.]+)\s*copay/i);
        if (m) result.urgentCopay = `$${m[1].replace(/\.00$/, '')}`;
      }
    }

    // Inpatient Hospital: "Days 1-6: $350.00 per day ... Days 7-90: $0.00 per day"
    // Always re-derive from flowing text for accuracy
    {
      const hospSeg = findAfterInText(t, 'Inpatient Hospital', 600);
      if (hospSeg && !/Outpatient|psychiatric/i.test(hospSeg.substring(0, 20))) {
        // Anthem format: "Days 1-6: $350.00 per day, per admission / Days 7-90: $0.00 per day"
        const tiers = [...hospSeg.matchAll(/Days?\s*(\d+)\s*-\s*(\d+)\s*:\s*\$([\d,.]+)\s*per\s*day/gi)];
        if (tiers.length > 0) {
          result.hospitalCopay = tiers.map(m =>
            `$${m[3].replace(/\.00$/, '')}/day, days ${m[1]}-${m[2]}`
          ).join('; ');
        }
      }
    }

    // OTC: "spending allowance of $25 every quarter"
    if (result.otcAllowance === 'Not found' || (result.otcAllowance && parseInt(result.otcAllowance.replace(/[^0-9]/g, '')) > 500)) {
      const otcSeg = findAfterInText(t, 'Over-the-Counter\\s*(?:Products|Items|Benefits|\\(OTC\\))', 500)
        || findAfterInText(t, 'Over-the-Counter\\s*\\(OTC\\)', 500)
        || findAfterInText(t, 'OTC\\s*(?:allowance|benefit|wallet|card|products)', 500);
      if (otcSeg) {
        const m = otcSeg.match(/\$([\d,.]+)\s*(?:every|per)\s*quarter/i);
        if (m) {
          result.otcAllowance = `$${m[1].replace(/\.00$/, '')}/quarter ($${parseInt(m[1]) * 4}/year)`;
        } else {
          const m2 = otcSeg.match(/\$([\d,.]+)\s*(?:every|per)\s*month/i);
          if (m2) result.otcAllowance = `$${m2[1].replace(/\.00$/, '')}/month`;
          else {
            const m3 = otcSeg.match(/allowance\s*of\s*\$([\d,.]+)/i) || otcSeg.match(/\$([\d,.]+)\s*(?:allowance|benefit)/i);
            if (m3) {
              const period = /quarter/i.test(otcSeg) ? '/quarter' : /month/i.test(otcSeg) ? '/month' : '';
              const val = m3[1].replace(/\.00$/, '');
              if (period === '/quarter') {
                result.otcAllowance = `$${val}/quarter ($${parseInt(val) * 4}/year)`;
              } else {
                result.otcAllowance = `$${val}${period}`;
              }
            }
          }
        }
      }
    }

    // Dental: "up to a $2,250 allowance for covered preventive and comprehensive dental services"
    if (result.dentalAllowance === 'Not found' || !/^\$[\d,]+/.test(result.dentalAllowance)) {
      const dentalSeg = findAfterInText(t, 'Dental Services Medicare-covered dental', 1000)
        || findAfterInText(t, 'Dental\\s*(?:Combined\\s*)?Allowance', 600)
        || findAfterInText(t, 'Preventive and Comprehensive.*Dental', 600)
        || findAfterInText(t, 'Dental Services', 1000);
      if (dentalSeg) {
        // Anthem: "$2,250 allowance for covered preventive and comprehensive dental"
        const m = dentalSeg.match(/\$([\d,]+)\s*(?:combined\s*)?allowance\s*(?:for\s*)?(?:covered\s*)?(?:preventive|dental|comprehensive)/i)
          || dentalSeg.match(/(?:up\s*to\s*(?:a\s*)?)?\$([\d,]+)\s*allowance/i);
        if (m) {
          const amt = parseInt(m[1].replace(/,/g, ''));
          if (amt >= 100) {
            result.dentalAllowance = `$${m[1]} combined allowance`;
          }
        }
      }
    }

    // Vision: "covers up to $300 for eyeglasses or contact lenses every year"
    // (Vision is already correct for Anthem, but handle for completeness)
    if (result.visionAllowance === 'Not found') {
      const visionSeg = findAfterInText(t, 'Routine eyewear', 400)
        || findAfterInText(t, 'Vision Services', 600);
      if (visionSeg) {
        const m = visionSeg.match(/\$([\d,]+)\s*(?:for\s*)?(?:eyeglasses|eyewear|contact)/i);
        if (m) {
          result.visionAllowance = `$${m[1]} annual eyewear allowance`;
        }
      }
    }

    // Hearing: "$3,000 maximum plan benefit for prescribed hearing aids"
    if (result.hearingAllowance === 'Not found') {
      const hearingSeg = findAfterInText(t, 'Hearing Services', 800)
        || findAfterInText(t, 'hearing aid', 500);
      if (hearingSeg) {
        const m = hearingSeg.match(/\$([\d,]+)\s*maximum\s*(?:plan\s*)?benefit\s*(?:for\s*)?(?:prescribed\s*)?hearing\s*aid/i);
        if (m) {
          result.hearingAllowance = `$${m[1]} hearing aid benefit`;
        } else {
          // Look for hearing aid benefit amount
          const m2 = hearingSeg.match(/hearing\s*aid[^.]*\$([\d,]+)/i)
            || hearingSeg.match(/\$([\d,]+)[^.]*hearing\s*aid/i);
          if (m2) {
            const amt = parseInt(m2[1].replace(/,/g, ''));
            if (amt >= 100) result.hearingAllowance = `$${m2[1]} hearing aid benefit`;
          }
        }
      }
    }

    // Transportation: "Transportation Not Covered" (standalone heading, not "transportation, when traveling")
    if (result.transportation === 'Not found') {
      // Search for "Transportation" as a section heading followed by benefit info
      // Skip matches embedded in sentences (e.g., "emergency transportation, when traveling")
      const transPattern = /(?:^|\.\s+|[A-Z][a-z]+\s+)Transportation\s+(Not\s*Covered|(?:\$[\d,.]+|Covered|\d+\s*(?:one|round|trip)))/i;
      const transM = t.match(transPattern);
      if (transM) {
        if (/Not\s*Covered/i.test(transM[1])) {
          result.transportation = 'Not covered';
        } else {
          result.transportation = Normalizer.transportation(transM[1]);
        }
      } else {
        // Fallback: look for the LAST occurrence of standalone "Transportation" heading
        const allMatches = [...t.matchAll(/\bTransportation\b/gi)];
        for (let mi = allMatches.length - 1; mi >= 0; mi--) {
          const afterTxt = t.substring(allMatches[mi].index, allMatches[mi].index + 200);
          // Skip if embedded in a sentence about emergency transportation
          if (/^transportation\s*,\s*when/i.test(afterTxt)) continue;
          if (/^transportation\s*services/i.test(afterTxt)) continue;
          if (/Not\s*Covered/i.test(afterTxt.substring(0, 80))) {
            result.transportation = 'Not covered';
            break;
          } else {
            const mVal = afterTxt.match(/\$([\d,.]+)/);
            if (mVal) {
              result.transportation = Normalizer.transportation(afterTxt);
            }
            break;
          }
        }
      }
    }

    // Preventive Care (should always be $0 on MA plans)
    if (result.preventiveCare === 'Not found') {
      const prevSeg = findAfterInText(t, 'Preventive Care', 300);
      if (prevSeg && /\$0|no\s*charge|no\s*cost/i.test(prevSeg)) {
        result.preventiveCare = '$0 copay';
      }
    }

    // Part B reduction
    if (result.partBReduction === 'Not found') {
      if (/must\s*continue\s*to\s*pay\s*(?:your\s*)?Medicare\s*Part\s*B/i.test(t)) {
        result.partBReduction = 'N/A';
      }
    }
  },

  fallbackRegexParse(result, fullText, allPages) {
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
    if (result.dentalAllowance === 'Not found' || result.dentalAllowance === '$0' || result.dentalAllowance === '$0 copay for covered services' || result.dentalAllowance === '$0 annual allowance ($0 copay)') {
      const allRawDental = allPages.map(p => p.rawText || '').join(' ').replace(/[\u2010-\u2015]/g, '-');
      // First try to find "$X,XXX allowance" near "dental"
      const dentalAllowanceM = allRawDental.match(/\$([\d,]+)\s*allowance\s*(?:for\s*)?(?:all\s*)?covered\s*dental/i)
        || allRawDental.match(/dental[^.]{0,100}\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?(?:amount\s*)?(?:\()?allowance/i)
        || allRawDental.match(/allowance[^.]{0,50}of\s*\$([\d,]+)[^.]{0,50}dental/i)
        || allRawDental.match(/\$([\d,]+)\s*maximum\s*plan\s*coverage\s*amount\s*every\s*year[^.]{0,120}dental/i);
      if (dentalAllowanceM) {
        const amt = parseInt(dentalAllowanceM[1].replace(/,/g, ''));
        if (amt >= 100) {
          result.dentalAllowance = `$${dentalAllowanceM[1]} allowance`;
          return;
        }
      }
      const dentalSeg = findAfterInText(allRawDental, 'dental.*allowance', 600)
        || findAfterInText(allRawDental, 'dental.*services', 600)
        || findAfterInText(t, 'dental', 600);
      if (dentalSeg) {
        // UHC: "$3,000 allowance for all covered dental services"
        // Aetna: "allowance of $750 for covered services"
        const allowanceM = dentalSeg.match(/\$([\d,]+)\s*allowance/i)
          || dentalSeg.match(/allowance.*?\$([\d,]+)/i)
          || dentalSeg.match(/\$([\d,]+).*?(?:for\s*covered|annual\s*(?:benefit|allowance))/i);
        if (allowanceM) {
          const amt = parseInt((allowanceM[1] || '').replace(/,/g, ''));
          if (amt >= 100) {
            result.dentalAllowance = `$${allowanceM[1]} allowance`;
          }
        }
        if (result.dentalAllowance === 'Not found' && /\$0\s*copay/i.test(dentalSeg)) {
          result.dentalAllowance = '$0 copay for covered services';
        }
      }
    }

    // Vision fallback
    if (result.visionAllowance === 'Not found' || result.visionAllowance === '$0') {
      const allRawVision = allPages.map(p => p.rawText || '').join(' ').replace(/[\u2010-\u2015]/g, '-');
      // First try direct pattern for "maximum plan coverage amount every year...eyewear" (ClearSpring)
      const maxCovEyewear = allRawVision.match(/\$([\d,]+)\s*maximum\s*plan\s*coverage\s*amount\s*every\s*year[^.]{0,120}eyewear/i);
      if (maxCovEyewear) {
        const amt = parseInt(maxCovEyewear[1].replace(/,/g, ''));
        if (amt >= 50 && amt <= 2000) {
          result.visionAllowance = `$${maxCovEyewear[1]}/year`;
          return;
        }
      }
      const visionSeg = findAfterInText(allRawVision, 'Vision Allowance', 400)
        || findAfterInText(allRawVision, 'Routine Eyewear', 400)
        || findAfterInText(allRawVision, 'Routine eyeglasses', 400)
        || findAfterInText(allRawVision, 'Other eyewear', 400)
        || findAfterInText(allRawVision, 'Contacts and eyeglasses', 400)
        || findAfterInText(allRawVision, 'prescription eyewear', 400)
        || findAfterInText(allRawVision, 'eyewear allowance', 400)
        || findAfterInText(t, 'eyeglasses or contact', 400)
        || findAfterInText(allRawVision, 'vision allowance', 400)
        || findAfterInText(allRawVision, 'Medicare-covered eyewear', 400);
      if (visionSeg) {
        // "$300 yearly allowance" / "$275 yearly allowance" (BCBSNC, Healthspring)
        const yearlyM = visionSeg.match(/\$([\d,]+)\s*(?:yearly|annual|per\s*year|combined)\s*(?:allowance|benefit)/i);
        if (yearlyM) {
          result.visionAllowance = `$${yearlyM[1]} annual eyewear allowance`;
        } else {
          // "$300 combined ... vision allowance" (Clover)
          const combinedM = visionSeg.match(/\$([\d,]+)\s*\(?combined[^)]*\)?\s*(?:vision\s*)?allowance/i);
          if (combinedM) {
            result.visionAllowance = `$${combinedM[1]} annual eyewear allowance`;
          } else {
            // "Up to $350 per year" near eyewear (Molina)
            const upToM = visionSeg.match(/up\s*to\s*\$([\d,]+)\s*per\s*year/i);
            if (upToM) {
              result.visionAllowance = `$${upToM[1]} annual eyewear allowance`;
            } else {
              // "$300 for eyeglasses or contact lenses" (Anthem)
              const forEyeM = visionSeg.match(/\$([\d,]+)\s*(?:for\s*)?(?:eyeglasses|eyewear|contact\s*lenses?|frames?)/i);
              if (forEyeM) {
                result.visionAllowance = `$${forEyeM[1]} annual eyewear allowance`;
              } else {
                // "costs more than $200, you pay the difference" (Kaiser)
                const costMoreM = visionSeg.match(/(?:costs?\s*(?:more\s*than|exceeds?)\s*\$([\d,]+))/i);
                if (costMoreM) {
                  result.visionAllowance = `$${costMoreM[1]} annual eyewear allowance`;
                } else {
                  // "$X ... vision allowance" or "$X ... allowance" (Clover: "$300 (combined...) vision allowance")
                  const visionAlM = visionSeg.match(/\$([\d,]+)[^.]{0,80}(?:vision\s*)?allowance/i);
                  if (visionAlM) {
                    const amt = parseInt(visionAlM[1].replace(/,/g, ''));
                    if (amt >= 50) {
                      result.visionAllowance = `$${visionAlM[1]} annual eyewear allowance`;
                    }
                  } else {
                    // Generic: allowance ... $X
                    const genericM = visionSeg.match(/allowance.*?\$([\d,]+)/i)
                      || visionSeg.match(/\$([\d,]+)\s*allowance/i);
                    if (genericM) {
                      const amt = parseInt(genericM[1].replace(/,/g, ''));
                      if (amt >= 50) result.visionAllowance = `$${genericM[1]} annual eyewear allowance`;
                    }
                  }
                }
              }
            }
          }
        }
      }
      // Final: check for "$X until you've spent your $Y yearly allowance" (Healthspring)
      if (result.visionAllowance === 'Not found' || result.visionAllowance === '$0') {
        const spentM = allRawVision.match(/spent\s*your\s*\$([\d,]+)\s*yearly\s*allowance/i);
        if (spentM) {
          result.visionAllowance = `$${spentM[1]} annual eyewear allowance`;
        }
      }
      // Last resort: scan structured rows for "$X (combined" or "$X ... vision allowance" in inNetwork column
      if (result.visionAllowance === 'Not found' || result.visionAllowance === '$0') {
        for (const page of allPages) {
          for (const row of page.rows) {
            const inNet = row.inNetwork || '';
            const label = row.label || '';
            // Check for "$300 (combined..." pattern in in-network column near vision rows
            const combinedM = inNet.match(/\$([\d,]+)\s*\(combined/i)
              || inNet.match(/\$([\d,]+)[^.]{0,60}(?:vision|eyewear|eyeglasses)\s*allowance/i);
            if (combinedM) {
              const amt = parseInt(combinedM[1].replace(/,/g, ''));
              if (amt >= 50 && amt <= 2000) {
                result.visionAllowance = `$${combinedM[1]} annual eyewear allowance`;
                break;
              }
            }
          }
          if (result.visionAllowance !== 'Not found' && result.visionAllowance !== '$0') break;
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

    // Rx deductible — multiple patterns across carriers
    // Reset if we got junk text (doesn't start with $) or wrong value
    if (result.rxDeductible !== 'Not found' && !/^\$/.test(result.rxDeductible)) {
      result.rxDeductible = 'Not found';
    }
    // Also reset if Rx deductible > $1000 (likely grabbed OOP threshold)
    const rxCheck = Normalizer.extractDollars(result.rxDeductible);
    if (rxCheck.length > 0 && rxCheck[0].value > 1000) {
      result.rxDeductible = 'Not found';
    }
    if (result.rxDeductible === 'Not found') {
      // Search ALL raw text for Rx deductible patterns
      // Use both the table rawText AND fall back to direct text search
      const allRaw = allPages.map(p => p.rawText || '').join(' ')
        .replace(/[\u2010-\u2015]/g, '-');
      const combinedText = t + ' ' + allRaw;

      // UHC: "Your plan has a $615 prescription drug deductible"
      const rxM1 = combinedText.match(/has\s*a\s*\$([\d,]+)\s*(?:prescription\s*)?(?:drug\s*)?deductible/i);
      if (rxM1) {
        result.rxDeductible = `$${rxM1[1]}`;
      }
      // Wellcare/Anthem: "$615 for Part D prescription drugs" or "$615 deductible for Part D"
      if (result.rxDeductible === 'Not found') {
        const rxForPartD = combinedText.match(/(?:Deductible\s*)\$([\d,]+)\s*(?:for\s*)?(?:Part\s*D|prescription\s*drug)/i)
          || combinedText.match(/\$([\d,]+)\s*(?:deductible\s*)?for\s*Part\s*D\s*prescription\s*drugs/i);
        if (rxForPartD) {
          const val = parseInt(rxForPartD[1].replace(/,/g, ''));
          if (val <= 1000) result.rxDeductible = `$${rxForPartD[1]}`;
        }
      }
      if (result.rxDeductible === 'Not found') {
        // Zing: "Your deductible amount is $0"
        const rxAmtIs = combinedText.match(/(?:your\s*)?deductible\s*amount\s*is\s*\$([\d,]+)/i);
        if (rxAmtIs) {
          result.rxDeductible = `$${rxAmtIs[1]}`;
        } else {
          // Anthem/Wellcare: "$200 deductible per year for Part D"
          const rxPerYear = combinedText.match(/\$([\d,]+(?:\.\d+)?)\s*deductible\s*(?:per\s*year\s*)?(?:for\s*)?(?:Part\s*D|prescription)/i);
          if (rxPerYear) {
            const val = parseInt(rxPerYear[1].replace(/[,.]/g, ''));
            if (val <= 1000) result.rxDeductible = `$${rxPerYear[1].replace(/\.00$/, '')}`;
          }
        }
      }
      // Aetna: "deductible limit of $615"
      if (result.rxDeductible === 'Not found') {
        const rxSeg = findAfterInText(combinedText, 'deductible limit', 400)
          || findAfterInText(combinedText, 'Deductible phase', 400);
        if (rxSeg) {
          const m = rxSeg.match(/deductible\s*(?:limit|amount)?\s*(?:of\s*)?\$([\d,]+)/i)
            || rxSeg.match(/\$([\d,]+)/);
          if (m) {
            const val = parseInt((m[1] || '').replace(/,/g, ''));
            if (val <= 1000) result.rxDeductible = `$${m[1]}`;
          }
        }
      }
      // BCBSNC: "Tiers 3, 4 and 5: $615 Yearly Deductible Stage"
      if (result.rxDeductible === 'Not found') {
        const tierDedM = combinedText.match(/Tiers?\s*\d[^$]{0,50}\$([\d,]+)\s*(?:Yearly\s*)?Deductible\s*Stage/i);
        if (tierDedM) {
          const val = parseInt(tierDedM[1].replace(/,/g, ''));
          if (val <= 1000) result.rxDeductible = `$${tierDedM[1]}`;
        }
      }
      // "No deductible" or "$0 deductible" in drug/Part D context
      if (result.rxDeductible === 'Not found') {
        const noRxDed = combinedText.match(/(?:Part\s*D|drug|prescription)\s*(?:Deductible|deductible)\s*[:|,\s|]*\s*(?:No\s*deductible|\$0)/i)
          || combinedText.match(/(?:No\s*deductible)[^.]{0,80}(?:Part\s*D|drug|prescription)/i)
          || combinedText.match(/(?:Part\s*D|drug|prescription)[^.\n]{0,80}(?:no\s+deductible)/i);
        if (noRxDed) {
          result.rxDeductible = '$0';
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
