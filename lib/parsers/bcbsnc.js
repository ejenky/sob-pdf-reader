// bcbsnc.js — Blue Cross Blue Shield NC carrier-specific parser
// Format: sequential multi-plan sections (handled by multi-plan.js page filtering)

const BCBSNCParser = Object.create(BaseParser);
BCBSNCParser.carrierName = 'BCBS NC';

BCBSNCParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Blue\s+Medicare\s+[A-Z][^(]{3,30}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})(?:\s*[-_]\s*(\d{3}))?/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
  else if (hM) result.planName = `Blue Medicare ${hM[1]}-${hM[2]}`;
};

BCBSNCParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*combined\s*(?:yearly|annual)\s*allowance/i);
  if (m) { result.dentalAllowance = `$${m[1]} combined yearly allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.BCBSNCParser = BCBSNCParser;
if (typeof module !== 'undefined') module.exports = BCBSNCParser;
