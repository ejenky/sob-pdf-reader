// molina.js — Molina Healthcare carrier-specific parser
// Format: tabular, single-plan
// Key patterns:
//   "Primary care providers $0 copay" / "Specialists* $40 copay"
//   "Emergency Care $100 copay" / "Urgent Care $25 copay"
//   "Inpatient Hospital* $325 copay per day for days 1-6"
//   "Part B Rebate $2 per month"
//   "coverage amount of $4,000" (dental)
//   "Up to $350 per year" (vision)
//   "2 pre-selected hearing aids every 2 years"
//   "$50 every month for Transportation Services" (combined OTC+transport)

const MolinaParser = Object.create(BaseParser);
MolinaParser.carrierName = 'Molina';

// Use pagesRaw prose for Molina since Chrome extension prose may reorder text
MolinaParser.parse = function(allPages, pagesRaw) {
  const result = this.initResult();
  let prose = this.getProseText(allPages);
  if (pagesRaw && pagesRaw.length > 0 && pagesRaw[0] && pagesRaw[0].items) {
    const rawProse = pagesRaw.map(p => (p.items || []).map(it => it.text || '').join(' ')).join(' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
    if (rawProse.length > prose.length) prose = rawProse;
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

MolinaParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Molina\s+Medicare\s+[A-Z][^(]{3,30}\(\s*HMO[^)]*\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
  if (m) result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
  else if (hM) result.planName = `Molina ${hM[1]}-${hM[2]}`;
};

MolinaParser.extractPCP = function(result, allPages, prose) {
  // Molina: "Primary care providers $0 copay"
  const m = prose.match(/Primary\s*care\s*providers?\s*\$([\d,]+)\s*copay/i);
  if (m) { result.pcpCopay = `$${m[1]} copay`; return; }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

MolinaParser.extractSpecialist = function(result, allPages, prose) {
  // Molina: "Specialists* $40 copay"
  const m = prose.match(/Specialist[s]?\s*\*?\s*\$([\d,]+)\s*copay/i)
    || prose.match(/Specialist[s]?\s+\*\s+\$([\d,]+)\s*copay/i);
  if (m) { result.specialistCopay = `$${m[1]} copay`; return; }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

MolinaParser.extractER = function(result, allPages, prose) {
  // Molina: "Emergency Care Copayment waived... $100 copay"
  const seg = this.after(prose, 'Emergency\\s*Care', 200);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*copay/i);
    if (m && parseInt(m[1]) > 0) { result.erCopay = `$${m[1]}`; return; }
  }
  BaseParser.extractER.call(this, result, allPages, prose);
};

MolinaParser.extractUrgent = function(result, allPages, prose) {
  // Molina: "Urgent Care $25 copay"
  const m = prose.match(/Urgent\s*Care\s*\$([\d,]+)\s*copay/i);
  if (m) { result.urgentCopay = `$${m[1]}`; return; }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

MolinaParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/Part\s*B\s*Rebate[^$]{0,20}\$([\d,.]+)\s*per\s*month/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/, '')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

MolinaParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/coverage\s*amount\s*(?:of\s*)?\$([\d,]+)/i);
  if (m) {
    const amt = parseInt(m[1].replace(/,/g, ''));
    if (amt >= 500 && amt <= 10000) { result.dentalAllowance = `$${m[1]} annual maximum`; return; }
  }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

MolinaParser.extractVision = function(result, allPages, prose) {
  const m = prose.match(/[Uu]p\s*to\s*\$([\d,]+)\s*per\s*year/i)
    || prose.match(/Eyewear\s*allowance[^$]{0,20}[Uu]p\s*to\s*\$([\d,]+)/i);
  if (m) { result.visionAllowance = `$${m[1] || m[2]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

MolinaParser.extractHearing = function(result, allPages, prose) {
  const desc = prose.match(/(?:[Uu]p\s*to\s*)?(\d)\s*(?:pre[- ]?selected\s*)?hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i)
    || prose.match(/(\d)\s*hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i);
  if (desc) { result.hearingAllowance = `${desc[1]} hearing aids every ${desc[2]} years`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

MolinaParser.extractTransportation = function(result, allPages, prose) {
  // Molina: "$50 every month for Transportation Services" (combined with OTC on debit card)
  const m = prose.match(/\$([\d,]+)\s*(?:every|per)\s*month\s*(?:for\s*)?Transportation/i);
  if (m) { result.transportation = `$${m[1]}/month (combined card)`; return; }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

MolinaParser.extractMedDeductible = function(result, allPages, prose) {
  if (/[Nn]o\s+deductible/i.test(prose)) { result.medDeductible = '$0'; return; }
  BaseParser.extractMedDeductible.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.MolinaParser = MolinaParser;
if (typeof module !== 'undefined') module.exports = MolinaParser;
