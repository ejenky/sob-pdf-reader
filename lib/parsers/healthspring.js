// healthspring.js — HealthSpring/Cigna carrier-specific parser
// Format: tabular, single-plan
// Labels: standard "Benefit | Your costs" tables

const HealthSpringParser = Object.create(BaseParser);
HealthSpringParser.carrierName = 'HealthSpring';

HealthSpringParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(HealthSpring\s+[A-Z][^(]{3,30}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})(?:\s*[-_]\s*(\d{3}))?/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
  else if (hM) result.planName = `HealthSpring ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
};

HealthSpringParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/Part\s*B\s*premium[^$]{0,30}\$([\d,.]+)\s*(?:per\s*month|\/month|monthly)/i)
    || prose.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?Part\s*B\s*premium\s*(?:reduction|giveback)/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/,'')}/month`; return; }
  // HealthSpring: "Up to $130 per month"
  const up = prose.match(/[Uu]p\s*to\s*\$([\d,.]+)\s*per\s*month[^.]{0,40}Part\s*B/i);
  if (up) { result.partBReduction = `$${up[1].replace(/\.00$/,'')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

HealthSpringParser.extractHearing = function(result, allPages, prose) {
  const range = prose.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*(?:copay|per)[^.]{0,40}(?:hearing\s*aid|device)/i)
    || prose.match(/hearing\s*aid[^.]{0,80}\$([\d,]+)\s*[-–]\s*\$([\d,]+)/i);
  if (range) { result.hearingAllowance = `$${range[1]} - $${range[2]} copay per hearing aid`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

HealthSpringParser.extractDental = function(result, allPages, prose) {
  // HealthSpring uses DHMO via Cigna Dental — may not have a dollar cap
  const m = prose.match(/dental[^.]{0,80}\$([\d,]+)\s*(?:annual\s*)?(?:allowance|maximum|benefit\s*limit)/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  // If no dollar allowance found, note it's DHMO coverage
  if (/dental[^.]{0,40}\$0\s*copay/i.test(prose) || /dental[^.]{0,40}covered\s*services/i.test(prose)) {
    result.dentalAllowance = '$0 copay (DHMO)';
  }
};

if (typeof window !== 'undefined') window.HealthSpringParser = HealthSpringParser;
if (typeof module !== 'undefined') module.exports = HealthSpringParser;
