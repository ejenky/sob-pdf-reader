// anthem.js — Anthem/Wellpoint carrier-specific parser
// Format: flowing prose text, not tabular
// Labels: "How much is my premium?", colon-separated per-day costs

const AnthemParser = Object.create(BaseParser);
AnthemParser.carrierName = 'Anthem/Wellpoint';

AnthemParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Wellpoint\s+Medicare\s+[A-Z][^(]{3,40}\([^)]+\))/i)
    || prose.match(/(Anthem\s+[A-Z][^(]{3,40}\([^)]+\))/i);
  if (m) {
    const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i) || prose.match(/(H\d{4})(\d{3})\b/i);
    result.planName = m[1].trim() + (hM ? ` ${hM[1]}-${hM[2]}` : '');
    return;
  }
  BaseParser.extractPlanName.call(this, result, allPages, prose);
};

AnthemParser.extractPremium = function(result, allPages, prose) {
  const m = prose.match(/(?:premium|monthly\s*payment)\s*\??\s*\$([\d,.]+)\s*(?:per\s*month|\/month)/i);
  if (m) { result.planPremium = `$${m[1].replace(/\.00$/,'')}/month`; return; }
  BaseParser.extractPremium.call(this, result, allPages, prose);
};

AnthemParser.extractMedDeductible = function(result, allPages, prose) {
  // Anthem: "Medical plan deductible $0.00 per year"
  if (/medical\s*(?:plan\s*)?deductible\s*\$0/i.test(prose)) { result.medDeductible = '$0'; return; }
  BaseParser.extractMedDeductible.call(this, result, allPages, prose);
};

AnthemParser.extractHospital = function(result, allPages, prose) {
  // Anthem: "Days 1-6: $350.00 per day, per admission" format
  const seg = this.after(prose, 'Inpatient\\s*(?:Hospital|hospital)', 600);
  if (!seg) return;
  const tiers = [...seg.matchAll(/Days?\s*(\d+)\s*[-–]\s*(\d+)\s*:\s*\$([\d,.]+)\s*per\s*day/gi)];
  if (tiers.length > 0) {
    result.hospitalCopay = tiers.map(m => `$${m[3].replace(/\.00$/,'')}/day, days ${m[1]}-${m[2]}`).join('; ');
    return;
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

AnthemParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/(?:Dental|dental)\s*(?:Combined\s*)?(?:Allowance|allowance|Maximum|maximum)\s*:?\s*\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:combined\s*)?(?:yearly|annual)\s*(?:dental\s*)?(?:allowance|maximum)/i);
  if (m) { result.dentalAllowance = `$${m[1]} combined allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

AnthemParser.extractTransportation = function(result, allPages, prose) {
  if (/transportation[^.]{0,60}not\s*covered/i.test(prose) || /non-emergency\s*transport[^.]{0,40}not\s*available/i.test(prose)) {
    result.transportation = 'Not covered'; return;
  }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.AnthemParser = AnthemParser;
if (typeof module !== 'undefined') module.exports = AnthemParser;
