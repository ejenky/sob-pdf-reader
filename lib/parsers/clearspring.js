// clearspring.js — ClearSpring Health carrier-specific parser
// Format: side-by-side dual-column multi-plan
// H6672-003 (C-SNP) and H6672-005 (HMO) in parallel columns
// Key values for H6672-003:
//   Hospital: "$300 copay per day for days 1-5; $0 copay per day for days 6-90"
//   ER: "$115 copay"
//   Urgent: "$40 copay"
//   OTC: "$50 maximum plan coverage amount every month for OTC"
//   Vision: "$250 maximum plan coverage"
//   Dental: "$2,000 maximum plan coverage"
//   Hearing: "$500 maximum plan coverage per ear"

const ClearSpringParser = Object.create(BaseParser);
ClearSpringParser.carrierName = 'ClearSpring';

// Override parse to always use FULL prose text (not filtered)
// since ClearSpring's side-by-side format means the left column value
// (first in prose) is always plan H6672-003
ClearSpringParser.parse = function(allPages, pagesRaw) {
  const result = this.initResult();
  // For side-by-side multi-plan: use FULL prose from pagesRaw (unfiltered)
  // The first value in reading order is always the left column (plan 003)
  let prose;
  if (pagesRaw && pagesRaw.length > 0 && pagesRaw[0].items) {
    prose = pagesRaw.map(p => (p.items || []).map(it => it.text || '').join(' ')).join(' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
  } else {
    prose = this.getProseText(allPages);
  }
  const raw = this.getRawText(allPages);

  this.extractPlanName(result, allPages, prose);
  this.extractPremium(result, allPages, prose);
  this.extractPartB(result, allPages, prose);
  this.extractMOOP(result, allPages, prose);
  this.extractMedDeductible(result, allPages, prose);
  this.extractRxDeductible(result, allPages, prose, raw);
  this.extractPCP(result, allPages, prose);
  this.extractSpecialist(result, allPages, prose);
  this.extractPreventive(result, allPages, prose);
  this.extractER(result, allPages, prose);
  this.extractUrgent(result, allPages, prose);
  this.extractHospital(result, allPages, prose, raw);
  this.extractOTC(result, allPages, prose);
  this.extractFoodCard(result, allPages, prose);
  this.extractDental(result, allPages, prose);
  this.extractVision(result, allPages, prose);
  this.extractHearing(result, allPages, prose);
  this.extractTransportation(result, allPages, prose);
  this.validate(result, prose);
  return result;
};

ClearSpringParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Clear\s*Spring\s+Health\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  const hM = prose.match(/(H6672)\s*[-_]\s*(\d{3})/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}`;
  else if (hM) result.planName = `ClearSpring ${hM[1]}-${hM[2]}`;
};

ClearSpringParser.extractPremium = function(result, allPages, prose) {
  // ClearSpring C-SNP is typically $0
  if (/\$0\s*(?:Plan\s*)?Premium|\$0\.\s*You\s*must/i.test(prose) ||
      /must\s*continue\s*to\s*pay\s*.*Part\s*B/i.test(prose)) {
    result.planPremium = '$0/month';
    return;
  }
  BaseParser.extractPremium.call(this, result, allPages, prose);
};

ClearSpringParser.extractMOOP = function(result, allPages, prose) {
  // ClearSpring: look for out-of-pocket maximum
  const m = prose.match(/out[- ]?of[- ]?pocket\s*(?:maximum|limit)[^$]{0,40}\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:out[- ]?of[- ]?pocket|annual)\s*(?:maximum|limit)/i);
  if (m && parseInt(m[1].replace(/,/g,'')) >= 1000) {
    result.moop = `$${m[1]}`;
    return;
  }
  BaseParser.extractMOOP.call(this, result, allPages, prose);
};

ClearSpringParser.extractMedDeductible = function(result, allPages, prose) {
  result.medDeductible = '$0'; // ClearSpring plans typically $0
};

ClearSpringParser.extractER = function(result, allPages, prose) {
  // "$115 copay" near "Emergency"
  const seg = this.after(prose, 'Emergency', 200);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*copay/i);
    if (m && parseInt(m[1]) > 0) { result.erCopay = `$${m[1]}`; return; }
  }
  BaseParser.extractER.call(this, result, allPages, prose);
};

ClearSpringParser.extractUrgent = function(result, allPages, prose) {
  const seg = this.after(prose, 'Urgently', 200);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*copay/i);
    if (m) { result.urgentCopay = `$${m[1]}`; return; }
  }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

ClearSpringParser.extractHospital = function(result, allPages, prose) {
  // "$300 copay per day for days 1-5; $0 copay per day for days 6-90"
  const seg = this.after(prose, 'Inpatient', 600);
  if (!seg) return;
  const perDayAmts = [...seg.matchAll(/\$([\d,]+)\s*copay\s*per\s*day/gi)];
  const dayRanges = [...seg.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
  dayRanges.sort((a, b) => a.index - b.index);
  if (perDayAmts.length > 0 && dayRanges.length > 0) {
    const tiers = [];
    for (const range of dayRanges) {
      let best = null;
      for (const amt of perDayAmts) { if (amt.index < range.index) best = amt; }
      if (best) tiers.push({amount: best[1], start: parseInt(range[1]), end: parseInt(range[2])});
    }
    if (tiers.length > 0) {
      const inNet = [tiers[0]]; let next = tiers[0].end + 1;
      for (const t of tiers.slice(1)) { if (t.start === next) { inNet.push(t); next = t.end + 1; } }
      result.hospitalCopay = inNet.map(t => `$${t.amount}/day, days ${t.start}-${t.end}`).join('; ');
      return;
    }
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

ClearSpringParser.extractOTC = function(result, allPages, prose) {
  // "$50 maximum plan coverage amount every month for OTC"
  const m = prose.match(/\$([\d,]+)\s*(?:maximum\s*)?(?:plan\s*)?(?:coverage\s*)?(?:amount\s*)?(?:every|per)\s*month\s*(?:for\s*)?OTC/i)
    || prose.match(/OTC[^$]{0,60}\$([\d,]+)\s*(?:maximum\s*)?(?:every|per)\s*month/i);
  if (m) { result.otcAllowance = `$${m[1]}/month`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

ClearSpringParser.extractVision = function(result, allPages, prose) {
  // "$250 maximum plan coverage" near "eyewear" or "vision"
  const m = prose.match(/\$([\d,]+)\s*maximum\s*plan\s*coverage[^.]{0,40}(?:eyewear|vision|eye)/i)
    || prose.match(/(?:eyewear|vision|routine\s*eye)[^$]{0,60}\$([\d,]+)\s*maximum\s*plan/i);
  if (m) { result.visionAllowance = `$${m[1]||m[2]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

ClearSpringParser.extractDental = function(result, allPages, prose) {
  // "$2,000 maximum plan coverage" near "dental"
  const m = prose.match(/\$([\d,]+)\s*maximum\s*plan\s*coverage[^.]{0,40}dental/i)
    || prose.match(/dental[^$]{0,60}\$([\d,]+)\s*maximum\s*plan/i);
  if (m) {
    const amt = parseInt((m[1]||'').replace(/,/g,''));
    if (amt >= 100) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

ClearSpringParser.extractHearing = function(result, allPages, prose) {
  // "$500 maximum plan coverage per ear" or "Hearing aids: $500 maximum"
  const m = prose.match(/[Hh]earing\s*aids?\s*:?\s*\$([\d,]+)\s*maximum/i)
    || prose.match(/\$([\d,]+)\s*maximum\s*(?:plan\s*)?(?:coverage\s*)?(?:per\s*ear)/i);
  if (m && parseInt(m[1].replace(/,/g,'')) >= 100) {
    result.hearingAllowance = `$${m[1]}/ear hearing aid benefit`;
    return;
  }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

ClearSpringParser.extractRxDeductible = function(result, allPages, prose) {
  // ClearSpring: "$300 Applies to: Tier 3, Tier 4, Tier 5" before "Deductible" label
  const m = prose.match(/\$([\d,]+)\s*Applies\s*to\s*:\s*Tier/i);
  if (m && parseInt(m[1].replace(/,/g,'')) <= 1000) { result.rxDeductible = `$${m[1]}`; return; }
  // Fallback
  const m2 = prose.match(/\$([\d,]+)\s*(?:drug\s*)?[Dd]eductible/i);
  if (m2 && parseInt(m2[1].replace(/,/g,'')) <= 1000) { result.rxDeductible = `$${m2[1]}`; return; }
  if (/no\s*(?:drug\s*)?deductible/i.test(prose)) result.rxDeductible = '$0';
};

ClearSpringParser.extractMOOP = function(result, allPages, prose) {
  // ClearSpring: the $2,100 is Rx MOOP not medical MOOP
  // Medical MOOP may not be explicitly stated — check for "Maximum out-of-pocket"
  // that's NOT in the prescription drug section
  const seg = this.after(prose, 'Maximum\\s*out[- ]?of[- ]?pocket', 200);
  if (seg && !/prescription\s*drug/i.test(seg.substring(0, 100))) {
    const m = seg.match(/\$([\d,]+)/i);
    if (m && parseInt(m[1].replace(/,/g,'')) >= 1000) { result.moop = `$${m[1]}`; return; }
  }
  // If only Rx MOOP found, still report it but note it
  const rxMoop = prose.match(/\$([\d,]+)\s*Out[- ]?of[- ]?Pocket\s*Maximum/i);
  if (rxMoop) result.moop = `$${rxMoop[1]} (Rx)`;
};

ClearSpringParser.validate = function(result, prose) {
  BaseParser.validate.call(this, result, prose);
  // ClearSpring C-SNP: handle OTC + Food wallet
  if (/C\s*-?\s*SNP/i.test(result.planName) && result.otcAllowance && result.otcAllowance !== 'Not found') {
    const m = result.otcAllowance.match(/\$([\d,]+)/);
    if (m) {
      result.otcAllowance = `$${m[1]}/month (Extra Supports Wallet) Food If Applicable`;
      result.foodFlexCard = '__HIDE__';
    }
  }
};

if (typeof window !== 'undefined') window.ClearSpringParser = ClearSpringParser;
if (typeof module !== 'undefined') module.exports = ClearSpringParser;
