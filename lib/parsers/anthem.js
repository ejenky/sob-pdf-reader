// anthem.js — Anthem/Wellpoint carrier-specific parser
// Format: flowing prose text with Q&A format
// Key patterns:
//   "How much is my premium (monthly payment)?" → "$0.00 per month"
//   "$6,460.00 per year from doctors and facilities in our plan" (MOOP)
//   "PCPs in our plan: $0.00 copay"
//   "Specialist visit: Doctors in our plan: $45.00 copay"
//   "Urgent care: $30.00 copay"
//   "Days 1-6: $350.00 per day" (hospital)
//   "$200.00 deductible per year for Part D prescription drugs"

const AnthemParser = Object.create(BaseParser);
AnthemParser.carrierName = 'Anthem/Wellpoint';

AnthemParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Wellpoint\s+Medicare\s+[A-Z][^(]{3,40}\([^)]+\))/i)
    || prose.match(/(Anthem\s+Medicare\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  if (m) {
    const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i) || prose.match(/(H\d{4})(\d{3})\b/i);
    result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
    return;
  }
  BaseParser.extractPlanName.call(this, result, allPages, prose);
};

AnthemParser.extractPremium = function(result, allPages, prose) {
  // "How much is my premium (monthly payment)? $0.00 per month"
  const m = prose.match(/\$([\d,.]+)\s*per\s*month/i);
  if (m) { result.planPremium = `$${m[1].replace(/\.00$/, '')}/month`; return; }
  BaseParser.extractPremium.call(this, result, allPages, prose);
};

AnthemParser.extractMOOP = function(result, allPages, prose) {
  // "$6,460.00 per year from doctors and facilities in our plan"
  const m = prose.match(/\$([\d,.]+)\s*per\s*year\s*(?:from\s*)?(?:doctors|providers|facilities)/i);
  if (m) {
    const val = parseInt(m[1].replace(/[,.]/g, ''));
    if (val >= 1000) { result.moop = `$${m[1].replace(/\.00$/, '')}`; return; }
  }
  // "out-of-pocket limit $X"
  const m2 = prose.match(/out[- ]?of[- ]?pocket\s*(?:cost\s*)?(?:limit|maximum)[^$]{0,30}\$([\d,.]+)/i);
  if (m2 && parseInt(m2[1].replace(/[,.]/g, '')) >= 1000) {
    result.moop = `$${m2[1].replace(/\.00$/, '')}`;
  }
};

AnthemParser.extractPCP = function(result, allPages, prose) {
  // "PCPs in our plan: $0.00 copay"
  const m = prose.match(/PCP[s]?\s*(?:in\s*our\s*plan)?\s*:?\s*\$([\d,.]+)\s*copay/i);
  if (m) { result.pcpCopay = `$${m[1].replace(/\.00$/, '')} copay`; return; }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

AnthemParser.extractSpecialist = function(result, allPages, prose) {
  // "Specialist visit: Doctors in our plan: $45.00 copay"
  const m = prose.match(/Specialist\s*(?:visit)?\s*:?[^$]{0,40}\$([\d,.]+)\s*copay/i);
  if (m) { result.specialistCopay = `$${m[1].replace(/\.00$/, '')} copay`; return; }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

AnthemParser.extractER = function(result, allPages, prose) {
  // "Emergency room services Doctors and facilities in our plan: $130.00 copay"
  const m = prose.match(/[Ee]mergency\s*(?:room|care)\s*(?:services)?[^$]{0,60}\$([\d,.]+)\s*copay/i);
  if (m) { result.erCopay = `$${m[1].replace(/\.00$/, '')}`; return; }
  BaseParser.extractER.call(this, result, allPages, prose);
};

AnthemParser.extractUrgent = function(result, allPages, prose) {
  // Anthem: "Urgently Needed Services $30.00 copay"
  // Must search for "Urgently Needed" specifically (NOT "Urgent Care" which is in the ER section header)
  const seg = this.after(prose, 'Urgently\\s*Needed', 200);
  if (seg) {
    const m = seg.match(/\$([\d,.]+)\s*copay/i);
    if (m) { result.urgentCopay = `$${m[1].replace(/\.00$/, '')}`; return; }
  }
  // Fallback: look for "$X copay" after "urgent" but before next section
  const m2 = prose.match(/urgent\s*care[^$]{0,20}\$([\d,.]+)\s*copay/i);
  if (m2 && parseInt(m2[1].replace(/[,.]/g, '')) < parseInt((result.erCopay || '999').replace(/\$/g, ''))) {
    result.urgentCopay = `$${m2[1].replace(/\.00$/, '')}`;
  }
};

AnthemParser.extractMedDeductible = function(result, allPages, prose) {
  // Check "does not have a medical deductible" FIRST
  if (/does\s*not\s*have\s*(?:a\s*)?(?:medical\s*)?deductible/i.test(prose)) { result.medDeductible = '$0'; return; }
  if (/medical\s*(?:plan\s*)?deductible\s*\$0/i.test(prose)) { result.medDeductible = '$0'; return; }
  // Only match dollar amount if it's NOT preceded by "does not have"
  const seg = this.after(prose, 'medical\\s*(?:plan\\s*)?deductible', 100);
  if (seg && !/does\s*not\s*have/i.test(seg)) {
    const m = seg.match(/\$([\d,.]+)/i);
    if (m) { result.medDeductible = `$${m[1].replace(/\.00$/, '')}`; return; }
  }
  result.medDeductible = '$0';
};

AnthemParser.extractRxDeductible = function(result, allPages, prose) {
  // "$200.00 deductible per year for Part D prescription drugs"
  const m = prose.match(/\$([\d,.]+)\s*deductible\s*(?:per\s*year\s*)?(?:for\s*)?Part\s*D/i)
    || prose.match(/Part\s*D[^$]{0,30}\$([\d,.]+)\s*deductible/i);
  if (m) { result.rxDeductible = `$${m[1].replace(/\.00$/, '')}`; return; }
  BaseParser.extractRxDeductible.call(this, result, allPages, prose);
};

AnthemParser.extractHospital = function(result, allPages, prose) {
  // "Days 1-6: $350.00 per day, per admission"
  const seg = this.after(prose, 'Inpatient\\s*(?:Hospital|hospital)', 800);
  if (!seg) return;
  const tiers = [...seg.matchAll(/Days?\s*(\d+)\s*[-–]\s*(\d+)\s*:\s*\$([\d,.]+)\s*per\s*day/gi)];
  if (tiers.length > 0) {
    const inNet = [tiers[0]]; let next = parseInt(tiers[0][2]) + 1;
    for (const t of tiers.slice(1)) {
      if (parseInt(t[1]) === next) { inNet.push(t); next = parseInt(t[2]) + 1; }
    }
    result.hospitalCopay = inNet.map(m => `$${m[3].replace(/\.00$/, '')}/day, days ${m[1]}-${m[2]}`).join('; ');
    return;
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

AnthemParser.extractOTC = function(result, allPages, prose) {
  // "$25 every quarter" or "$25.00 per quarter"
  const m = prose.match(/\$([\d,.]+)\s*(?:every|per)\s*quarter/i);
  if (m) { result.otcAllowance = `$${m[1].replace(/\.00$/, '')}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

AnthemParser.extractDental = function(result, allPages, prose) {
  // "Dental Combined Allowance: $2,250"
  const m = prose.match(/[Dd]ental\s*(?:Combined\s*)?(?:Allowance|Maximum)\s*:?\s*\$([\d,.]+)/i)
    || prose.match(/\$([\d,.]+)\s*(?:combined\s*)?(?:yearly|annual)\s*(?:dental\s*)?(?:allowance|maximum)/i);
  if (m) { result.dentalAllowance = `$${m[1].replace(/\.00$/, '')} combined allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

AnthemParser.extractVision = function(result, allPages, prose) {
  // "up to $300 for eyeglasses or contact lenses"
  const m = prose.match(/(?:up\s*to\s*)?\$([\d,.]+)\s*(?:for\s*)?(?:eyeglasses|eyewear|contact\s*lenses|frames)/i)
    || prose.match(/(?:eyeglasses|eyewear|frames)[^$]{0,40}\$([\d,.]+)/i);
  if (m) { result.visionAllowance = `$${(m[1]||m[2]).replace(/\.00$/, '')} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

AnthemParser.extractTransportation = function(result, allPages, prose) {
  if (/transportation[^.]{0,60}not\s*covered/i.test(prose) || /non-emergency\s*transport[^.]{0,40}not\s*(?:covered|available)/i.test(prose)) {
    result.transportation = 'Not covered'; return;
  }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.AnthemParser = AnthemParser;
if (typeof module !== 'undefined') module.exports = AnthemParser;
