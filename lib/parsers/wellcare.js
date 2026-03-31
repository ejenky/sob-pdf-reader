// wellcare.js — Wellcare carrier-specific parser
// Format: triple-column multi-plan (filtered by multi-plan.js)
// Key patterns:
//   "Urgently Needed Services $40 copay" (NOT $50,000 emergency transport)
//   "$250 deductible for select Part B services" (med deductible)
//   "$615 for Part D" (Rx deductible)
//   "$2,015 copay * per stay" (hospital for Giveback plan)
//   "$40 give back every month" (Part B)

const WellcareParser = Object.create(BaseParser);
WellcareParser.carrierName = 'Wellcare';

WellcareParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Wellcare\s+(?:Giveback|Simple|Assist)\s+(?:Open\s*)?\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_,]?\s*(?:Plan\s*)?(\d{3})/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}`;
  else if (m) result.planName = m[1].trim();
  else if (hM) result.planName = `Wellcare ${hM[1]}-${hM[2]}`;
};

WellcareParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,.]+)\s*(?:give\s*back|giveback)\s*(?:every|per)\s*month/i)
    || prose.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?(?:Part\s*B\s*)?(?:give\s*back|premium\s*reduction)/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/, '')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

WellcareParser.extractUrgent = function(result, allPages, prose) {
  // "Urgently Needed Services $40 copay" — NOT "Worldwide Urgent Care $115"
  const m = prose.match(/Urgently\s*Needed\s*Services\s*\$([\d,]+)\s*copay/i);
  if (m) { result.urgentCopay = `$${m[1]}`; return; }
  // Fallback: look for urgent care with reasonable copay (< $200)
  const seg = this.after(prose, 'Urgent', 150);
  if (seg) {
    const m2 = seg.match(/\$([\d,]+)\s*copay/i);
    if (m2 && parseInt(m2[1]) <= 200) { result.urgentCopay = `$${m2[1]}`; return; }
  }
};

WellcareParser.extractMedDeductible = function(result, allPages, prose) {
  // "$250 deductible for select Part B services"
  const m = prose.match(/\$([\d,]+)\s*deductible\s*(?:for\s*)?(?:select\s*)?Part\s*B/i);
  if (m) { result.medDeductible = `$${m[1]}`; return; }
  // Generic deductible row
  const m2 = prose.match(/[Dd]eductible\s*\$([\d,]+)\s*deductible/i);
  if (m2 && parseInt(m2[1]) < 1000) { result.medDeductible = `$${m2[1]}`; return; }
  BaseParser.extractMedDeductible.call(this, result, allPages, prose);
};

WellcareParser.extractRxDeductible = function(result, allPages, prose) {
  // "$615 for Part D" — must distinguish from med deductible
  const m = prose.match(/\$([\d,]+)\s*(?:for\s*)?Part\s*D/i);
  if (m && parseInt(m[1].replace(/,/g, '')) <= 1000) { result.rxDeductible = `$${m[1]}`; return; }
  BaseParser.extractRxDeductible.call(this, result, allPages, prose);
};

WellcareParser.extractDental = function(result, allPages, prose) {
  // Wellcare Giveback: "additional dental services with no annual limit"
  if (/no\s*annual\s*(?:limit|cap)[^.]{0,40}dental/i.test(prose) ||
      /dental[^.]{0,60}no\s*annual\s*(?:limit|cap)/i.test(prose)) {
    result.dentalAllowance = '$0 copay (no annual limit)';
    return;
  }
  // Plan 113 has "$1,000 per plan year"
  const m = prose.match(/\$([\d,]+)\s*(?:per\s*plan\s*year|annual)[^.]{0,30}dental/i)
    || prose.match(/dental[^.]{0,60}\$([\d,]+)\s*(?:per\s*plan\s*year|annual)/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

WellcareParser.extractHearing = function(result, allPages, prose) {
  // "Hearing Aid Allowance Up to a $750"
  const m = prose.match(/Hearing\s*Aid\s*Allowance[^$]{0,30}[Uu]p\s*to\s*(?:a\s*)?\$([\d,]+)/i)
    || prose.match(/[Uu]p\s*to\s*(?:a\s*)?\$([\d,]+)[^.]{0,30}hearing\s*aid/i);
  if (m && parseInt(m[1].replace(/,/g, '')) >= 100) {
    result.hearingAllowance = `$${m[1]} hearing aid benefit`;
    return;
  }
  // "Not covered" for plans without hearing
  if (/hearing\s*aid[s]?\s*(?:are\s*)?not\s*covered/i.test(prose)) {
    result.hearingAllowance = 'Not covered';
    return;
  }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.WellcareParser = WellcareParser;
if (typeof module !== 'undefined') module.exports = WellcareParser;
