// carrier-detect.js — Auto-detect carrier from raw PDF text
// Scans first 3 pages for H-number prefixes and carrier name text

const CarrierDetect = {

  // H-number prefix → carrier mapping
  H_NUMBER_MAP: {
    'H5521': 'aetna',
    'H3312': 'aetna',
    'H5253': 'uhc',
    'H5828': 'anthem',
    'H4513': 'healthspring',
    'H6672': 'clearspring',
    'H4624': 'zing',
    'H9745': 'clover',
    'H2172': 'kaiser',
    'H5810': 'molina',
    'H3449': 'bcbsnc',
    'H2775': 'wellcare'
  },

  // Carrier name text patterns (checked in order)
  NAME_PATTERNS: [
    { pattern: /Aetna\s*Medicare/i, carrier: 'aetna' },
    { pattern: /UnitedHealthcare|UHC\s+/i, carrier: 'uhc' },
    { pattern: /Wellpoint|Anthem\s*Blue/i, carrier: 'anthem' },
    { pattern: /HealthSpring/i, carrier: 'healthspring' },
    { pattern: /Clear\s*Spring\s*Health/i, carrier: 'clearspring' },
    { pattern: /Zing\s*Health/i, carrier: 'zing' },
    { pattern: /Clover\s*Health/i, carrier: 'clover' },
    { pattern: /Kaiser\s*Permanente/i, carrier: 'kaiser' },
    { pattern: /Molina\s*Healthcare/i, carrier: 'molina' },
    { pattern: /Blue\s*Cross\s*NC|BlueCrossNC/i, carrier: 'bcbsnc' },
    { pattern: /Wellcare|go\.wellcare\.com/i, carrier: 'wellcare' }
  ],

  /**
   * Detect carrier from raw PDF page data.
   * @param {Array} pagesRaw - Array of { items: [{text, ...}], ... } from PDF extraction
   * @returns {{ carrier: string, confidence: 'high'|'medium'|'low' }}
   */
  detect(pagesRaw) {
    // Scan first 3 pages
    const pagesToScan = pagesRaw.slice(0, Math.min(3, pagesRaw.length));
    const allText = pagesToScan.map(p =>
      (p.items || []).map(it => it.text || '').join(' ')
    ).join(' ');

    // Strategy 1: H-number prefix (high confidence)
    const hMatch = allText.match(/(H\d{4})\s*[-_]\s*\d{3}/i)
      || allText.match(/(H\d{4})\d{3}\b/i);
    if (hMatch) {
      const prefix = hMatch[1].toUpperCase();
      const carrier = this.H_NUMBER_MAP[prefix];
      if (carrier) {
        return { carrier, confidence: 'high' };
      }
    }

    // Strategy 2: Carrier name text matching (medium confidence)
    for (const { pattern, carrier } of this.NAME_PATTERNS) {
      if (pattern.test(allText)) {
        return { carrier, confidence: 'medium' };
      }
    }

    // Strategy 3: Fallback — check rawText if items not available
    // (e.g. when called with pagesRaw as strings)
    if (typeof pagesRaw === 'string' || (pagesRaw.length > 0 && typeof pagesRaw[0] === 'string')) {
      const textStr = typeof pagesRaw === 'string' ? pagesRaw : pagesRaw.join(' ');
      const hM = textStr.match(/(H\d{4})\s*[-_]\s*\d{3}/i);
      if (hM) {
        const carrier = this.H_NUMBER_MAP[hM[1].toUpperCase()];
        if (carrier) return { carrier, confidence: 'medium' };
      }
      for (const { pattern, carrier } of this.NAME_PATTERNS) {
        if (pattern.test(textStr)) {
          return { carrier, confidence: 'low' };
        }
      }
    }

    return { carrier: 'generic', confidence: 'low' };
  },

  /**
   * Simple text-based detection (for test-parse.js or when pagesRaw is not available)
   * @param {string} text - Concatenated raw text from all pages
   * @returns {{ carrier: string, confidence: 'high'|'medium'|'low' }}
   */
  detectFromText(text) {
    const hMatch = text.match(/(H\d{4})\s*[-_]\s*\d{3}/i);
    if (hMatch) {
      const prefix = hMatch[1].toUpperCase();
      const carrier = this.H_NUMBER_MAP[prefix];
      if (carrier) return { carrier, confidence: 'high' };
    }
    for (const { pattern, carrier } of this.NAME_PATTERNS) {
      if (pattern.test(text)) {
        return { carrier, confidence: 'medium' };
      }
    }
    return { carrier: 'generic', confidence: 'low' };
  }
};

if (typeof window !== 'undefined') {
  window.CarrierDetect = CarrierDetect;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CarrierDetect;
}
