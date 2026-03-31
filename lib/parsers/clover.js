// clover.js — Clover Health carrier-specific parser
// Format: side-by-side dual-column (handled by multi-plan.js filtering)

const CloverParser = Object.create(BaseParser);
CloverParser.carrierName = 'Clover';

CloverParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Clover\s+Health\s+[A-Z][^(]{3,20}\([^)]+\))/i);
  if (m) result.planName = m[1].trim();
};

CloverParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,.]+)\s*(?:subsidy|buy[- ]?down|credit)[^.]{0,40}Part\s*B/i)
    || prose.match(/Part\s*B[^$]{0,30}\$([\d,.]+)\s*(?:subsidy|buy[- ]?down|credit)/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/,'')}/month`; return; }
  result.partBReduction = 'N/A';
};

if (typeof window !== 'undefined') window.CloverParser = CloverParser;
if (typeof module !== 'undefined') module.exports = CloverParser;
