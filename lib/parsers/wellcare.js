// wellcare.js — Wellcare carrier-specific parser
// Format: triple-column multi-plan (handled by multi-plan.js filtering before this runs)

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
  const m = prose.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?(?:Part\s*B\s*)?(?:give\s*back|premium\s*reduction)/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/,'')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.WellcareParser = WellcareParser;
if (typeof module !== 'undefined') module.exports = WellcareParser;
