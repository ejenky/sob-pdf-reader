// clover.js — Clover Health carrier-specific parser
// Format: side-by-side dual-column PPO (Plan 004 left, Plan 007 right)
// Uses unfiltered pagesRaw prose since column filter drops shared labels
// Key patterns (Plan 004):
//   "$0 per month" premium, "$9,250/$13,900" MOOP
//   "PCP visit: $0 copay", "Specialist visit: $10 copay"
//   "$115 copay per visit" ER, "$35 copay" urgent
//   "Days 1-6: $399 copay per day", "Days 7-365: $0 copay per day"
//   "$2,000 every year for covered services" dental
//   "$300 combined...vision allowance" vision
//   "$499-$999 copay" hearing (TruHearing)
//   "$110 per quarter" OTC, "$150 for Tiers 3-5" Rx ded
//   "$20 subsidy...Part B" Part B reduction

const CloverParser = Object.create(BaseParser);
CloverParser.carrierName = 'Clover';

// Use unfiltered prose from pagesRaw for all extractions
CloverParser.parse = function(allPages, pagesRaw) {
  const result = this.initResult();
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

CloverParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Clover\s+Health\s+[A-Z][^(]{3,20}\([^)]+\))/i);
  if (m) result.planName = m[1].trim();
};

CloverParser.extractPremium = function(result, allPages, prose) {
  if (/[Nn]o\s*plan\s*premium/i.test(prose) || /\$0\s*per\s*month/i.test(prose)) {
    result.planPremium = '$0/month'; return;
  }
  BaseParser.extractPremium.call(this, result, allPages, prose);
};

CloverParser.extractMOOP = function(result, allPages, prose) {
  // "$9,250 for in-network providers"
  const m = prose.match(/\$([\d,]+)\s*for\s*in[- ]?network\s*providers/i);
  const combined = prose.match(/\$([\d,]+)\s*for\s*in[- ]?\s*and\s*out/i);
  if (m && combined) {
    result.moop = `$${m[1]} in-network / $${combined[1]} combined`;
  } else if (m) {
    result.moop = `$${m[1]}`;
  }
};

CloverParser.extractPCP = function(result, allPages, prose) {
  const m = prose.match(/PCP\s*(?:visit)?\s*:?\s*\$([\d,]+)\s*copay/i)
    || prose.match(/Primary\s*care\s*(?:physician)?\s*(?:visit)?\s*:?\s*\$([\d,]+)\s*copay/i);
  if (m) { result.pcpCopay = `$${m[1]} copay`; return; }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

CloverParser.extractSpecialist = function(result, allPages, prose) {
  const m = prose.match(/Specialist\s*(?:visit)?\s*:?\s*\$([\d,]+)\s*copay/i);
  if (m) { result.specialistCopay = `$${m[1]} copay`; return; }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

CloverParser.extractER = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*copay\s*per\s*visit[^.]{0,30}(?:emergency|ER)/i)
    || prose.match(/Emergency\s*Care[^$]{0,40}\$([\d,]+)\s*copay/i);
  if (m) { result.erCopay = `$${m[1]||m[2]}`; return; }
  BaseParser.extractER.call(this, result, allPages, prose);
};

CloverParser.extractUrgent = function(result, allPages, prose) {
  // Clover: "Urgently Needed Services In-Network...: $35 copay"
  const m = prose.match(/Urgently\s*Needed[^$]{0,60}\$([\d,]+)\s*copay/i);
  if (m) { result.urgentCopay = `$${m[1]}`; return; }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

CloverParser.extractHospital = function(result, allPages, prose) {
  // "Days 1-6: $399 copay per day" / "Days 7-365: $0 copay per day"
  const seg = this.after(prose, 'Inpatient', 400) || this.after(prose, 'Days 1', 400);
  if (!seg) return;
  const tiers = [...seg.matchAll(/Days?\s*(\d+)\s*[-–]\s*(\d+)\s*:?\s*\$([\d,]+)\s*copay\s*per\s*day/gi)];
  if (tiers.length > 0) {
    const inNet = [tiers[0]]; let next = parseInt(tiers[0][2]) + 1;
    for (const t of tiers.slice(1)) {
      if (parseInt(t[1]) === next) { inNet.push(t); next = parseInt(t[2]) + 1; }
    }
    result.hospitalCopay = inNet.map(t => `$${t[3]}/day, days ${t[1]}-${t[2]}`).join('; ');
    return;
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

CloverParser.extractOTC = function(result, allPages, prose) {
  const m = prose.match(/[Uu]p\s*to\s*\$([\d,]+)\s*per\s*quarter\s*(?:allowance)?/i)
    || prose.match(/\$([\d,]+)\s*per\s*quarter\s*(?:allowance\s*)?(?:for\s*)?(?:approved\s*)?OTC/i);
  if (m) { result.otcAllowance = `$${m[1]}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

CloverParser.extractDental = function(result, allPages, prose) {
  // "Our plan pays up to $2,000 every year for covered services"
  const m = prose.match(/pays?\s*up\s*to\s*\$([\d,]+)\s*(?:every|per)\s*(?:year|calendar)/i)
    || prose.match(/\$([\d,]+)\s*(?:annual|yearly|combined)\s*(?:maximum|allowance|benefit)/i);
  if (m) {
    const amt = parseInt(m[1].replace(/,/g, ''));
    if (amt >= 500 && amt <= 10000) { result.dentalAllowance = `$${m[1]} annual maximum`; return; }
  }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

CloverParser.extractVision = function(result, allPages, prose) {
  // "$300 (combined in and out-of-network) vision allowance per calendar year"
  const m = prose.match(/\$([\d,]+)\s*\(?combined[^)]*\)?\s*(?:vision\s*)?allowance/i)
    || prose.match(/\$([\d,]+)\s*(?:combined\s*)?[^.]{0,40}vision\s*allowance/i)
    || prose.match(/vision\s*allowance[^$]{0,40}\$([\d,]+)/i);
  if (m) {
    const amt = parseInt((m[1] || m[2] || '').replace(/,/g, ''));
    if (amt >= 100) { result.visionAllowance = `$${m[1]||m[2]} eyewear allowance`; return; }
  }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

CloverParser.extractHearing = function(result, allPages, prose) {
  // "$499 copay for Standard aids through a TruHearing provider"
  // "$699 copay for Advanced aids"
  // "$999 copay for Premium aids"
  const m = prose.match(/\$([\d,]+)\s*copay\s*for\s*Standard\s*aids/i);
  const m2 = prose.match(/\$([\d,]+)\s*copay\s*for\s*(?:Advanced|Premium)\s*aids/i);
  if (m && m2) { result.hearingAllowance = `$${m[1]} - $${m2[1]} copay per hearing aid`; return; }
  if (m) { result.hearingAllowance = `$${m[1]} copay per hearing aid`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

CloverParser.extractPartB = function(result, allPages, prose) {
  // "$20 subsidy...towards your Part B premium"
  const m = prose.match(/\$([\d,.]+)\s*(?:subsidy|buy[- ]?down|credit)[^.]{0,40}Part\s*B/i)
    || prose.match(/Part\s*B[^$]{0,40}\$([\d,.]+)\s*(?:subsidy|buy[- ]?down|credit)/i);
  if (m) { result.partBReduction = `$${(m[1]||m[2]).replace(/\.00$/, '')}/month`; return; }
  result.partBReduction = 'N/A';
};

CloverParser.extractRxDeductible = function(result, allPages, prose) {
  // "$150 for your Tier 3, 4, and 5 drugs"
  const m = prose.match(/\$([\d,]+)\s*(?:for\s*)?(?:your\s*)?Tier\s*3/i)
    || prose.match(/\$([\d,]+)\s*(?:deductible\s*)?(?:for\s*)?Part\s*D/i);
  if (m && parseInt(m[1].replace(/,/g, '')) <= 1000) { result.rxDeductible = `$${m[1]}`; return; }
  BaseParser.extractRxDeductible.call(this, result, allPages, prose);
};

CloverParser.extractMedDeductible = function(result, allPages, prose) {
  if (/[Nn]o\s*deductible\s*(?:for\s*)?medical/i.test(prose)) { result.medDeductible = '$0'; return; }
  result.medDeductible = '$0';
};

if (typeof window !== 'undefined') window.CloverParser = CloverParser;
if (typeof module !== 'undefined') module.exports = CloverParser;
