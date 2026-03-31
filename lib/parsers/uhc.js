// uhc.js — UnitedHealthcare carrier-specific parser
// Format: tabular with "Medical benefits" section headers (not "Benefit | Your costs")
// Labels: "Emergency care", "Urgently needed services", "Inpatient hospital care"
// "OTC and food credit", "$X credit every month"

const UHCParser = Object.create(BaseParser);
UHCParser.carrierName = 'UHC';

UHCParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(UHC\s+[A-Z][^(]{3,40}\([^)]+\))/i)
    || prose.match(/(UnitedHealthcare\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  if (m) {
    const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
    result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
    return;
  }
  BaseParser.extractPlanName.call(this, result, allPages, prose);
};

UHCParser.extractMOOP = function(result, allPages, prose) {
  // UHC: "Maximum out-of-pocket amount (does not include prescription drugs) $4,900"
  const m = prose.match(/Maximum\s*out[- ]?of[- ]?pocket\s*(?:amount)?[^$]{0,80}\$([\d,]+)/i);
  if (m && parseInt(m[1].replace(/,/g,'')) >= 1000) { result.moop = `$${m[1]}`; return; }
  BaseParser.extractMOOP.call(this, result, allPages, prose);
};

UHCParser.extractMedDeductible = function(result, allPages, prose) {
  if (/does\s*not\s*have\s*(?:a\s*)?(?:medical\s*)?deductible/i.test(prose)) { result.medDeductible = '$0'; return; }
  const m = prose.match(/Annual\s*medical\s*deductible[^$]{0,30}\$([\d,]+)/i);
  if (m) { result.medDeductible = `$${m[1]}`; return; }
  result.medDeductible = '$0';
};

UHCParser.extractER = function(result, allPages, prose) {
  // UHC: "Emergency care $130 copay ($0 copay for emergency care outside...)"
  const m = prose.match(/Emergency\s*care\s*\$([\d,]+)\s*copay/i);
  if (m) { result.erCopay = `$${m[1]}`; return; }
  BaseParser.extractER.call(this, result, allPages, prose);
};

UHCParser.extractUrgent = function(result, allPages, prose) {
  // UHC: "Urgently needed services $50 copay ($0 copay for...)"
  const m = prose.match(/Urgently\s*needed\s*services\s*\$([\d,]+)\s*copay/i);
  if (m) { result.urgentCopay = `$${m[1]}`; return; }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

UHCParser.extractOTC = function(result, allPages, prose) {
  // UHC: "OTC and food credit $117 credit every month"
  const m = prose.match(/OTC\s*and\s*food\s*credit\s*\$([\d,]+)\s*credit\s*every\s*month/i)
    || prose.match(/\$([\d,]+)\s*credit\s*every\s*month\s*for\s*over[- ]the[- ]counter/i);
  if (m) { result.otcAllowance = `$${m[1]}/month`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

UHCParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*allowance\s*(?:for\s*)?(?:all\s*)?covered\s*dental/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

UHCParser.extractVision = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*allowance\s*every\s*(\d+)\s*years?\s*(?:for\s*)?\d?\s*pair/i)
    || prose.match(/Routine\s*eyewear\s*\$([\d,]+)\s*allowance\s*every\s*(\d+)\s*years?/i);
  if (m) { result.visionAllowance = `$${m[1]} eyewear allowance every ${m[2]} years`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

UHCParser.extractHearing = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*(?:copay|[-–])\s*\$([\d,]+)\s*copay\s*(?:for\s*each\s*)?(?:OTC\s*)?hearing\s*aid/i);
  if (m) { result.hearingAllowance = `$${m[1]} - $${m[2]} copay per hearing aid`; return; }
  const single = prose.match(/\$([\d,]+)\s*copay\s*(?:for\s*each\s*)?prescription\s*hearing\s*aid/i);
  if (single && parseInt(single[1].replace(/,/g,'')) >= 100) { result.hearingAllowance = `$${single[1]} copay per hearing aid`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

UHCParser.extractTransportation = function(result, allPages, prose) {
  const m = prose.match(/(\d+)\s*one[- ]?way\s*trips?\s*(?:to|for)/i);
  if (m) { result.transportation = `${m[1]} trips/year ($0 copay)`; return; }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.UHCParser = UHCParser;
if (typeof module !== 'undefined') module.exports = UHCParser;
