// normalizer.js — Dollar/copay/coinsurance/allowance normalization
// Handles the variety of cost-sharing formats across Medicare carriers

const Normalizer = {

  /**
   * Extract all dollar amounts from text, returns array of {raw, value}
   */
  extractDollars(text) {
    if (!text) return [];
    const matches = [...text.matchAll(/\$([\d,]+(?:\.\d{2})?)/g)];
    return matches.map(m => ({
      raw: m[1],
      value: parseFloat(m[1].replace(/,/g, '')),
      full: m[0]
    }));
  },

  /**
   * Extract percentage from text
   */
  extractPercent(text) {
    if (!text) return null;
    const m = text.match(/(\d+)\s*%/);
    return m ? parseInt(m[1]) : null;
  },

  /**
   * Normalize a copay/coinsurance value
   * Handles: "$0 copay", "$25 copay - 20% coinsurance", "20%", "$0 - $75", "No charge"
   */
  copay(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    // "Not Covered"
    if (/not\s*covered|n\/a/i.test(t) && !t.match(/\$\d/)) {
      return 'Not covered';
    }

    // "No charge" / "$0 copay" / "No cost" (only if no range)
    if (/no\s*charge|no\s*cost/i.test(t) || (/\$0\s*copay/i.test(t) && !t.match(/\$0\s*[-–]\s*\$/))) {
      return '$0 copay';
    }

    // Inpatient per-day tiered format: "$407 per day, days 1-6; $0 per day, days 7-90"
    const perDayTiered = t.match(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*[-–]\s*(\d+)/i);
    if (perDayTiered) {
      // Extract all tiers from the semicolon-separated string
      const tiers = [...t.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day,?\s*days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
      if (tiers.length > 0) {
        const parts = tiers.map(m => `$${m[1]}/day, days ${m[2]}-${m[3]}`);
        return parts.join('; ');
      }
    }

    // "$X copay - Y% coinsurance" (in-network / out-of-network range)
    const copayCoins = t.match(/\$([\d,]+)\s*(?:copay)?\s*[-–]\s*(\d+)\s*%\s*(?:coinsurance)?/i);
    if (copayCoins) {
      return `$${copayCoins[1]} copay - ${copayCoins[2]}% coinsurance`;
    }

    // "$X - $Y copay" (range pattern)
    const rangeD = t.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*copay/i);
    if (rangeD) {
      return `$${rangeD[1]} - $${rangeD[2]} copay`;
    }

    // "$X - $Y" (plain range without "copay")
    const plainRange = t.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
    if (plainRange) {
      return `$${plainRange[1]} - $${plainRange[2]}`;
    }

    // "$X copay per day" or "$X per day" (single tier)
    const perDay = t.match(/\$([\d,]+)\s*(?:copay\s*)?per\s*day/i);
    if (perDay) {
      const days = t.match(/days?\s*(\d+\s*[-–]\s*\d+)/i);
      return `$${perDay[1]}/day${days ? ` (days ${days[1]})` : ''}`;
    }

    // "$X - $Y per stay"
    const stayRange = t.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*(?:copay\s*)?per\s*stay/i);
    if (stayRange) {
      return `$${stayRange[1]} - $${stayRange[2]} per stay`;
    }

    // "$X copay per stay" or "$X per stay"
    const perStay = t.match(/\$([\d,]+)\s*(?:copay\s*)?per\s*stay/i);
    if (perStay) {
      return `$${perStay[1]} per stay`;
    }

    // "$X copay for emergency/urgent" - extract just the amount
    const copayFor = t.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?(?:emergency|urgent)/i);
    if (copayFor) {
      return `$${copayFor[1]}`;
    }

    // Simple "$X copay"
    const simpleCopay = t.match(/\$([\d,]+)\s*copay/i);
    if (simpleCopay) {
      return `$${simpleCopay[1]} copay`;
    }

    // Just a percentage
    const pctOnly = t.match(/^(\d+)\s*%/);
    if (pctOnly) {
      return `${pctOnly[1]}% coinsurance`;
    }

    // Just a dollar amount
    const justDollar = t.match(/\$([\d,]+)/);
    if (justDollar) {
      return `$${justDollar[1]}`;
    }

    // Not covered
    if (/not\s*covered|n\/a/i.test(t)) {
      return 'Not covered';
    }

    return text.trim() || 'Not found';
  },

  /**
   * Normalize a dollar amount (premium, deductible, MOOP)
   */
  dollar(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    if (/no\s*charge|\$0(?:\s|$|\.00)/i.test(t) && !t.includes('-')) {
      return '$0';
    }

    // Range: "$X - $Y"
    const range = t.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)/);
    if (range) {
      return `$${range[1]} - $${range[2]}`;
    }

    const dollars = Normalizer.extractDollars(t);
    if (dollars.length > 0) {
      return `$${dollars[0].raw}`;
    }

    if (/not\s*covered|n\/a/i.test(t)) return 'N/A';
    return text.trim() || 'Not found';
  },

  /**
   * Normalize an allowance amount (OTC, dental, vision, hearing, food/flex)
   * Handles periodic amounts and annualizes them
   */
  allowance(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    const dollars = Normalizer.extractDollars(t);
    if (dollars.length === 0) {
      if (/not\s*covered|n\/a|not\s*included/i.test(t)) return 'Not covered';
      // Check for descriptive text without dollar amounts
      if (t.length > 5) return text.trim();
      return 'Not found';
    }

    const amount = dollars[0];

    // Detect period
    const period = detectPeriod(t);
    if (period) {
      const annual = annualize(amount.value, period);
      if (period === 'month') {
        return `$${amount.raw}/month ($${formatNum(annual)}/year)`;
      } else if (period === 'quarter') {
        return `$${amount.raw}/quarter ($${formatNum(annual)}/year)`;
      } else if (period === 'year') {
        return `$${amount.raw}/year`;
      } else if (period === 'semi-annual') {
        return `$${amount.raw} every 6 months ($${formatNum(annual)}/year)`;
      }
    }

    return `$${amount.raw}`;
  },

  /**
   * Normalize dental allowance - may include both copay and annual max
   */
  dentalAllowance(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    const dollars = Normalizer.extractDollars(t);
    if (dollars.length === 0) {
      if (/not\s*covered/i.test(t)) return 'Not covered';
      // Check for $0 copay with context
      if (/\$0\s*copay/i.test(t)) {
        if (/preventive/i.test(t)) return '$0 copay (preventive only)';
        if (/covered\s*services/i.test(t)) return '$0 copay for covered services';
        return '$0 copay';
      }
      return text.trim() || 'Not found';
    }

    // Look for annual allowance/maximum
    const annualMatch = t.match(/\$([\d,]+)\s*(?:annual|per\s*year|yearly)\s*(?:allowance|maximum|max|benefit|limit)/i)
      || t.match(/(?:annual|per\s*year|yearly)\s*(?:allowance|maximum|max|benefit|limit)\s*(?:of\s*)?\$([\d,]+)/i)
      || t.match(/allowance\)??\s*of\s*\$([\d,]+)/i);

    if (annualMatch) {
      const allowance = annualMatch[1] || annualMatch[2];
      // Check for copay too
      const copayM = t.match(/\$(\d+)\s*copay/i);
      if (copayM && copayM[1] !== allowance) {
        return `$${allowance} annual allowance ($${copayM[1]} copay)`;
      }
      return `$${allowance} annual allowance`;
    }

    // Multiple dollar amounts - largest is likely the allowance
    if (dollars.length >= 2) {
      const sorted = [...dollars].sort((a, b) => b.value - a.value);
      const allowance = sorted[0];
      const copay = sorted.find(d => d.value < allowance.value);
      if (copay && copay.value <= 100) {
        return `$${allowance.raw} annual allowance ($${copay.raw} copay)`;
      }
      return `$${allowance.raw} annual allowance`;
    }

    return `$${dollars[0].raw}`;
  },

  /**
   * Normalize vision allowance
   */
  visionAllowance(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    const dollars = Normalizer.extractDollars(t);
    if (dollars.length === 0) {
      if (/not\s*covered/i.test(t)) return 'Not covered';
      return text.trim() || 'Not found';
    }

    // Look for eyewear/frames allowance
    const eyewearM = t.match(/\$([\d,]+)\s*(?:annual\s*)?(?:eyewear|frames?|contacts?|lens(?:es)?)\s*(?:allowance|benefit)?/i)
      || t.match(/(?:eyewear|frames?|contacts?)\s*(?:allowance|benefit)\s*(?:of\s*)?\$([\d,]+)/i);

    if (eyewearM) {
      const amt = eyewearM[1] || eyewearM[2];
      // Look for exam copay
      const examCopay = t.match(/\$(\d+)\s*(?:copay\s*)?(?:for\s*)?(?:routine\s*)?exam/i);
      if (examCopay) {
        return `$${amt} eyewear allowance / $${examCopay[1]} exam copay`;
      }
      return `$${amt} eyewear allowance`;
    }

    // If we have a $0 and another amount, it's likely $0 exam + $X allowance
    if (dollars.length >= 2) {
      const sorted = [...dollars].sort((a, b) => a.value - b.value);
      if (sorted[0].value === 0) {
        return `$${sorted[sorted.length - 1].raw} annual allowance / $0 routine exam`;
      }
    }

    return `$${dollars[0].raw}`;
  },

  /**
   * Normalize hearing allowance
   */
  hearingAllowance(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    if (/not\s*covered/i.test(t) && !t.match(/\$\d/)) return 'Not covered';

    // Tiered copay pattern: "Level 1 (Standard): $0 copay per ear, per year"
    // Extract all levels to provide a range summary
    const levels = [...t.matchAll(/Level\s*\d[^:]*:\s*\$([\d,]+)\s*copay\s*per\s*ear/gi)];
    if (levels.length > 0) {
      const amounts = levels.map(m => parseInt(m[1].replace(/,/g, '')));
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);
      if (min === max) return `$${min.toLocaleString()}/ear/year`;
      return `$${min.toLocaleString()} - $${max.toLocaleString()}/ear/year (tiered by level)`;
    }

    const dollars = Normalizer.extractDollars(t);
    if (dollars.length === 0) {
      // Check if text describes hearing aids coverage without dollar amounts
      if (/hearing\s*aid/i.test(t)) return 'Hearing aids covered (see plan details)';
      return text.trim() || 'Not found';
    }

    // Per ear pattern
    const perEar = t.match(/\$([\d,]+)\s*(?:copay\s*)?(?:per|each|\/)\s*ear/i);
    if (perEar) {
      const period = detectPeriod(t);
      const periodStr = period === 'year' ? '/year' : '';
      return `$${perEar[1]}/ear${periodStr}`;
    }

    // General hearing aid benefit
    const aidM = t.match(/\$([\d,]+)\s*(?:for\s*)?hearing\s*aid/i)
      || t.match(/hearing\s*aid\s*(?:benefit|allowance|coverage)\s*(?:of\s*)?\$([\d,]+)/i);
    if (aidM) {
      const amt = aidM[1] || aidM[2];
      return `$${amt} hearing aid benefit`;
    }

    return `$${dollars[0].raw}`;
  },

  /**
   * Normalize transportation benefit
   */
  transportation(text) {
    if (!text) return 'Not found';
    const t = normText(text);

    // Check "Not Covered" FIRST — before looking for dollar amounts
    if (/not\s*covered/i.test(t)) return 'Not covered';
    if (/n\/a/i.test(t) && !t.match(/\$\d/)) return 'N/A';

    // Trip count patterns
    const trips = t.match(/(\d+)\s*(?:one[- ]?way|round[- ]?trip)?\s*trips?\s*(?:per\s*year|annual|yearly)?/i);
    const miles = t.match(/(?:up\s*to\s*)?(\d+)\s*miles?/i);
    const copay = t.match(/\$(\d+)\s*copay/i);

    if (/unlimited/i.test(t)) {
      return 'Unlimited trips' + (copay ? ` ($${copay[1]} copay)` : '');
    }

    if (trips) {
      let result = `${trips[1]} trips/year`;
      if (miles) result += `, up to ${miles[1]} miles`;
      if (copay) result += ` ($${copay[1]} copay)`;
      return result;
    }

    // Dollar amount for transportation
    const dollars = Normalizer.extractDollars(t);
    if (dollars.length > 0) {
      return `$${dollars[0].raw}`;
    }

    return text.trim() || 'Not found';
  },

  /**
   * Extract plan name with H-number
   */
  planName(text) {
    if (!text) return 'Unknown Plan';
    const t = normText(text);

    // H-number pattern: H1234-001 or H1234-001-000
    const hMatch = t.match(/(H\d{4})\s*[-–]\s*(\d{3})(?:\s*[-–]\s*(\d{3}))?/i);
    if (hMatch) {
      const hNum = `${hMatch[1]}-${hMatch[2]}${hMatch[3] ? '-' + hMatch[3] : ''}`;
      // Try to get plan name from text before the H-number
      const idx = t.indexOf(hMatch[0]);
      const before = t.substring(Math.max(0, idx - 150), idx).trim();
      // Get the last meaningful line/phrase before the H-number
      const nameParts = before.split(/\n|(?<=\s{3,})/);
      const planPart = nameParts[nameParts.length - 1].trim();
      if (planPart.length > 3) {
        return `${planPart} ${hNum}`;
      }
      return hNum;
    }

    return text.trim().substring(0, 100) || 'Unknown Plan';
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function normText(text) {
  return text
    .replace(/[\u2010-\u2015\u2212\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPeriod(text) {
  const t = text.toLowerCase();
  if (/per\s*month|monthly|\/month|\/mo\b|each\s*month/i.test(t)) return 'month';
  if (/per\s*quarter|quarterly|every\s*(?:3|three)\s*months?|each\s*quarter/i.test(t)) return 'quarter';
  if (/per\s*year|annual|yearly|\/year|\/yr/i.test(t)) return 'year';
  if (/every\s*(?:6|six)\s*months?|semi[- ]?annual|twice\s*(?:a|per)\s*year/i.test(t)) return 'semi-annual';
  if (/every\s*(?:2|two)\s*months?|bi[- ]?monthly/i.test(t)) return 'bi-monthly';
  return null;
}

function annualize(amount, period) {
  switch (period) {
    case 'month': return amount * 12;
    case 'quarter': return amount * 4;
    case 'semi-annual': return amount * 2;
    case 'bi-monthly': return amount * 6;
    case 'year': return amount;
    default: return amount;
  }
}

function formatNum(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

if (typeof window !== 'undefined') {
  window.Normalizer = Normalizer;
}
