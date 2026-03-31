// healthspring.js — HealthSpring/Cigna carrier-specific parser
// Format: tabular, single-plan
// Key patterns:
//   "Routine Eyewear $0 until you've spent your $275 yearly allowance"
//   "$140 allowance each quarter for eligible OTC items"
//   "$325 copay per day for days 1-6"
//   "Up to $130 per month" Part B reduction

const HealthSpringParser = Object.create(BaseParser);
HealthSpringParser.carrierName = 'HealthSpring';

HealthSpringParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(HealthSpring\s+[A-Z][^(]{3,30}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})(?:\s*[-_]\s*(\d{3}))?/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
  else if (hM) result.planName = `HealthSpring ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
};

HealthSpringParser.extractPartB = function(result, allPages, prose) {
  const m = prose.match(/[Uu]p\s*to\s*\$([\d,.]+)\s*per\s*month[^.]{0,40}Part\s*B/i)
    || prose.match(/Part\s*B\s*premium[^$]{0,30}\$([\d,.]+)\s*(?:per\s*month|\/month|monthly)/i)
    || prose.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?Part\s*B\s*premium\s*(?:reduction|giveback)/i);
  if (m) { result.partBReduction = `$${m[1].replace(/\.00$/, '')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

HealthSpringParser.extractHospital = function(result, allPages, prose) {
  // "$325 copay per day for days 1-6. $0 copay per day for days 7-90."
  const seg = this.after(prose, 'Inpatient', 600);
  if (!seg) return;
  const perDayAmts = [...seg.matchAll(/\$([\d,]+)\s*copay\s*per\s*day/gi)];
  const dayRanges = [...seg.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
  const dayBeyond = [...seg.matchAll(/days?\s*(\d+)\s*and\s*beyond/gi)];
  for (const m of dayBeyond) dayRanges.push(Object.assign([...m], {index: m.index, 1: m[1], 2: '999'}));
  dayRanges.sort((a, b) => a.index - b.index);
  if (perDayAmts.length > 0 && dayRanges.length > 0) {
    const tiers = [];
    for (const range of dayRanges) {
      let best = null;
      for (const amt of perDayAmts) { if (amt.index < range.index) best = amt; }
      if (best) tiers.push({amount: best[1], start: parseInt(range[1]), end: parseInt(range[2]||'999')});
    }
    if (tiers.length > 0) {
      const inNet = [tiers[0]]; let next = tiers[0].end + 1;
      for (const t of tiers.slice(1)) { if (t.start === next) { inNet.push(t); next = t.end + 1; } }
      result.hospitalCopay = inNet.map(t => {
        const e = t.end >= 999 ? '+' : `-${t.end}`;
        return `$${t.amount}/day, days ${t.start}${e}`;
      }).join('; ');
      return;
    }
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

HealthSpringParser.extractOTC = function(result, allPages, prose) {
  // "$140 allowance each quarter for eligible OTC items"
  const m = prose.match(/\$([\d,]+)\s*(?:allowance\s*)?(?:each|every|per)\s*quarter\s*(?:for\s*)?(?:eligible\s*)?OTC/i)
    || prose.match(/OTC\s*(?:Allowance)?[^$]{0,40}\$([\d,]+)\s*(?:allowance\s*)?(?:each|every|per)\s*quarter/i);
  if (m) { result.otcAllowance = `$${m[1]}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

HealthSpringParser.extractVision = function(result, allPages, prose) {
  // "$0 until you've spent your $275 yearly allowance" or "$275 eyewear allowance"
  const m = prose.match(/\$([\d,]+)\s*(?:yearly|annual)\s*(?:eyewear\s*)?allowance/i)
    || prose.match(/spent\s*your\s*\$([\d,]+)\s*(?:yearly|annual)\s*allowance/i);
  if (m) { result.visionAllowance = `$${m[1]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

HealthSpringParser.extractHearing = function(result, allPages, prose) {
  const range = prose.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*copay\s*(?:per\s*)?(?:prescription\s*)?(?:hearing\s*aid|device)/i)
    || prose.match(/\$([\d,]+)\s*copay\s*per\s*(?:OTC\s*)?hearing\s*aid[^.]{0,40}\$([\d,]+)\s*copay/i);
  if (range) { result.hearingAllowance = `$${range[1]} - $${range[2]} copay per hearing aid`; return; }
  // Single copay
  const single = prose.match(/\$([\d,]+)\s*copay\s*per\s*(?:prescription\s*)?hearing\s*aid/i);
  if (single && parseInt(single[1].replace(/,/g,'')) >= 100) {
    result.hearingAllowance = `$${single[1]} copay per hearing aid`;
    return;
  }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

HealthSpringParser.extractDental = function(result, allPages, prose) {
  // HealthSpring uses DHMO via Cigna Dental — may not have a dollar cap
  const m = prose.match(/dental[^.]{0,80}\$([\d,]+)\s*(?:annual\s*)?(?:allowance|maximum|benefit\s*limit)/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  // Check for DHMO with no cap
  if (/dental[^.]{0,40}\$0\s*copay/i.test(prose) || /Cigna\s*Dental/i.test(prose)) {
    result.dentalAllowance = '$0 copay (DHMO)';
  }
};

HealthSpringParser.extractTransportation = function(result, allPages, prose) {
  // HealthSpring: only has "Emergency Transportation" ($50,000 max), no routine transport
  if (/Emergency\s*Transportation/i.test(prose) && !/routine\s*transport/i.test(prose)) {
    result.transportation = 'Not covered';
    return;
  }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.HealthSpringParser = HealthSpringParser;
if (typeof module !== 'undefined') module.exports = HealthSpringParser;
