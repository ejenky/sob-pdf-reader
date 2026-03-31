// clearspring.js — ClearSpring Health carrier-specific parser
// Format: side-by-side dual-column (handled by multi-plan.js filtering)

const ClearSpringParser = Object.create(BaseParser);
ClearSpringParser.carrierName = 'ClearSpring';

ClearSpringParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Clear\s*Spring\s+Health\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}`;
  else if (hM) result.planName = `ClearSpring ${hM[1]}-${hM[2]}`;
};

ClearSpringParser.extractMedDeductible = function(result, allPages, prose) {
  result.medDeductible = '$0'; // ClearSpring plans typically have $0 deductible
};

if (typeof window !== 'undefined') window.ClearSpringParser = ClearSpringParser;
if (typeof module !== 'undefined') module.exports = ClearSpringParser;
