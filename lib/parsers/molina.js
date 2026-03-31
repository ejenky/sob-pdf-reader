// molina.js — Molina Healthcare carrier-specific parser
// Format: tabular, single-plan
// Labels: "Inpatient Hospital" ($325/day), "Part B Rebate" ($2/month),
//   Dental "$4,000 coverage amount", Vision "Up to $350 per year"

const MolinaParser = Object.create(BaseParser);
MolinaParser.carrierName = 'Molina';

MolinaParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Molina\s+Medicare\s+[A-Z][^(]{3,30}\(\s*HMO[^)]*\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
  if (m) result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
  else if (hM) result.planName = `Molina ${hM[1]}-${hM[2]}`;
};

MolinaParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/Part\s*B\s*Rebate[^$]{0,20}\$([\d,.]+)\s*per\s*month/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/,'')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

MolinaParser.extractDental = function(result, allPages, prose) {
  // Molina: "coverage amount of $4,000"
  const m = prose.match(/coverage\s*amount\s*(?:of\s*)?\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:annual\s*)?(?:plan\s*)?(?:maximum\s*)?(?:benefit\s*)?(?:coverage|allowance)/i);
  if (m) {
    const amt = parseInt(m[1].replace(/,/g,''));
    if (amt >= 500 && amt <= 10000) { result.dentalAllowance = `$${m[1]} annual maximum`; return; }
  }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

MolinaParser.extractVision = function(result, allPages, prose) {
  const m = prose.match(/[Uu]p\s*to\s*\$([\d,]+)\s*per\s*year[^.]{0,30}(?:eyewear|vision|frames|contacts)?/i)
    || prose.match(/\$([\d,]+)\s*(?:per\s*year|annual)[^.]{0,30}(?:eyewear|vision)/i)
    || prose.match(/[Ee]yewear\s*allowance[^$]{0,20}[Uu]p\s*to\s*\$([\d,]+)/i);
  if (m) { result.visionAllowance = `$${m[1]||m[2]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

MolinaParser.extractHearing = function(result, allPages, prose) {
  // Molina: "You get up to 2 pre-selected hearing aids every 2 years"
  const desc = prose.match(/(?:up\s*to\s*)?(\d)\s*(?:pre[- ]?selected\s*)?hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i)
    || prose.match(/(\d)\s*hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i);
  if (desc) { result.hearingAllowance = `${desc[1]} hearing aids every ${desc[2]} years`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

MolinaParser.extractMedDeductible = function(result, allPages, prose) {
  if (/[Nn]o\s+deductible/i.test(prose)) { result.medDeductible = '$0'; return; }
  BaseParser.extractMedDeductible.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.MolinaParser = MolinaParser;
if (typeof module !== 'undefined') module.exports = MolinaParser;
