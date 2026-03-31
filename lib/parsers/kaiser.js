// kaiser.js — Kaiser Permanente carrier-specific parser
// Format: tabular, single-plan
// Labels: "Doctor's visits" (PCP $0), "Inpatient hospital services",
//   OTC "$25 quarterly benefit limit", Vision "more than $200", Hearing "more than $1,000"

const KaiserParser = Object.create(BaseParser);
KaiserParser.carrierName = 'Kaiser';

KaiserParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Kaiser\s+Permanente\s+Medicare\s+Advantage\s+[A-Z][^(]{3,30}(?:\([^)]+\))?)/i)
    || prose.match(/(Kaiser\s+Permanente\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]?\s*(\d{3})/i);
  if (m) result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
  else if (hM) result.planName = `Kaiser ${hM[1]}-${hM[2]}`;
};

KaiserParser.extractPCP = function(result, allPages, prose) {
  // Kaiser: "Doctor's visits $0 Primary care providers"
  const m = prose.match(/Doctor.?s?\s*visits?\s*\$([\d,]+)/i);
  if (m) { result.pcpCopay = `$${m[1]} copay`; return; }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

KaiserParser.extractMOOP = function(result, allPages, prose) {
  const m = prose.match(/(?:maximum\s*out[- ]?of[- ]?pocket|Your\s*maximum)[^$]{0,40}\$([\d,]+)/i);
  if (m && parseInt(m[1].replace(/,/g,'')) >= 1000) { result.moop = `$${m[1]}`; return; }
  BaseParser.extractMOOP.call(this, result, allPages, prose);
};

KaiserParser.extractOTC = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*quarterly\s*benefit\s*limit/i)
    || prose.match(/up\s*to\s*(?:the\s*)?\$([\d,]+)\s*quarterly/i);
  if (m && parseInt(m[1]) > 0) { result.otcAllowance = `$${m[1]}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

KaiserParser.extractVision = function(result, allPages, prose) {
  const m = prose.match(/eyewear\s*(?:costs?\s*)?more\s*than\s*\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:allowance|limit)[^.]{0,30}eyewear/i);
  if (m) { result.visionAllowance = `$${m[1]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

KaiserParser.extractHearing = function(result, allPages, prose) {
  const m = prose.match(/hearing\s*aid\s*(?:purchase\s*)?(?:(?:costs?\s*)?more\s*than|allowance[^$]{0,20})\s*\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:allowance|limit)[^.]{0,30}hearing/i);
  if (m && parseInt(m[1].replace(/,/g,'')) >= 100) {
    result.hearingAllowance = `$${m[1]}/ear hearing aid benefit`;
    return;
  }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

KaiserParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?limit[^.]{0,40}dental/i)
    || prose.match(/dental[^.]{0,60}\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?limit/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.KaiserParser = KaiserParser;
if (typeof module !== 'undefined') module.exports = KaiserParser;
