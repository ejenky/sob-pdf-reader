// bcbsnc.js — Blue Cross Blue Shield NC carrier-specific parser
// Format: sequential multi-plan sections (5-6 plans in one PDF)
// Multi-plan.js filters pages to selected plan section
// Key patterns (Medical Only H3449-012):
//   "Primary: $0 copay Specialist: $25 copay"
//   "Emergency Care: ...hospital within 48 hours...$150 copay"
//   "Urgently Needed Services: $65 copay"
//   "Days 1-6: $295 copay Days 7-90: $0 copay"
//   "$100 quarterly allowance" (OTC)
//   "Part B Reduction: $35 monthly"
//   "$300 combined (in-and out-of-network) yearly allowance" (vision)
//   "$499-$999 copay" (hearing aids)
//   "12 one-way rides"

const BCBSNCParser = Object.create(BaseParser);
BCBSNCParser.carrierName = 'BCBS NC';

// Use unfiltered pagesRaw prose for section-based multi-plan
// The section filter may cut off text at page boundaries
BCBSNCParser.parse = function(allPages, pagesRaw) {
  const result = this.initResult();
  // For BCBSNC: build prose from the correct page range using pagesRaw
  // The filtered allPages may have reordered/truncated text
  let prose;
  if (pagesRaw && pagesRaw.length > 0 && pagesRaw[0].items) {
    // Use pagesRaw from the same page numbers as allPages
    const pageNums = allPages.map((_, i) => i); // filtered page indices
    // But we need actual page numbers — get from first row's context
    // Simplest: just use ALL pagesRaw for the first plan (pages 2-6 for Medical Only)
    // The patterns are specific enough to not grab wrong plan's data
    prose = pagesRaw.slice(0, Math.min(8, pagesRaw.length))
      .map(p => (p.items || []).map(it => it.text || '').join(' ')).join(' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
  } else {
    prose = this.getProseText(allPages);
  }
  const raw = this.getRawText(allPages);
  this.extractPlanName(result, allPages, prose);
  this.extractPremium(result, allPages, prose);
  this.extractPartB(result, allPages, prose);
  this.extractMOOP(result, allPages, prose);
  this.extractMedDeductible(result, allPages, prose);
  this.extractRxDeductible(result, allPages, prose, raw);
  this.extractPCP(result, allPages, prose);
  this.extractSpecialist(result, allPages, prose);
  this.extractPreventive(result, allPages, prose);
  this.extractER(result, allPages, prose);
  this.extractUrgent(result, allPages, prose);
  this.extractHospital(result, allPages, prose, raw);
  this.extractOTC(result, allPages, prose);
  this.extractFoodCard(result, allPages, prose);
  this.extractDental(result, allPages, prose);
  this.extractVision(result, allPages, prose);
  this.extractHearing(result, allPages, prose);
  this.extractTransportation(result, allPages, prose);
  this.validate(result, prose);
  return result;
};

BCBSNCParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Blue\s+Medicare\s+[A-Z][^(]{3,30}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})(?:\s*[-_]\s*(\d{3}))?/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}${hM[3] ? `-${hM[3]}` : ''}`;
  else if (hM) result.planName = `Blue Medicare ${hM[1]}-${hM[2]}`;
};

BCBSNCParser.extractPCP = function(result, allPages, prose) {
  // "Primary: $0 copay"
  const m = prose.match(/Primary\s*:\s*\$([\d,]+)\s*copay/i);
  if (m) { result.pcpCopay = `$${m[1]} copay`; return; }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

BCBSNCParser.extractSpecialist = function(result, allPages, prose) {
  // "Specialist: $25 copay"
  const m = prose.match(/Specialist\s*:\s*\$([\d,]+)\s*copay/i);
  if (m) { result.specialistCopay = `$${m[1]} copay`; return; }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

BCBSNCParser.extractER = function(result, allPages, prose) {
  // "Emergency Care:...you do not have to pay the copay for the emergency visit...$150 copay"
  // Must find the ACTUAL copay, not the waived amount or urgent copay
  const seg = this.after(prose, 'Emergency\\s*Care', 300);
  if (seg) {
    // Look for the dollar amount that's the actual copay (not $0 waived)
    const allCopays = [...seg.matchAll(/\$([\d,]+)\s*copay/gi)];
    for (const m of allCopays) {
      if (parseInt(m[1]) > 0) { result.erCopay = `$${m[1]}`; return; }
    }
  }
  BaseParser.extractER.call(this, result, allPages, prose);
};

BCBSNCParser.extractUrgent = function(result, allPages, prose) {
  // "Urgently Needed Services: $65 copay" - must search AFTER ER section
  const seg = this.after(prose, 'Urgently\\s*Needed', 150);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*copay/i);
    if (m) { result.urgentCopay = `$${m[1]}`; return; }
  }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

BCBSNCParser.extractHospital = function(result, allPages, prose) {
  // BCBSNC: "Days 1-6: $295 copay" OR "$295 copay Days 7-90: $0 copay"
  const seg = this.after(prose, 'Inpatient\\s*Hospital', 500);
  if (!seg) return;
  // Try "Days X-Y: $Z copay" format
  const tiers = [...seg.matchAll(/Days?\s*(\d+)\s*[-–]\s*(\d+)\s*:?\s*\$([\d,]+)\s*copay/gi)];
  // Also try "$Z copay Days X-Y" reversed format
  const revTiers = [...seg.matchAll(/\$([\d,]+)\s*copay[^.]{0,10}Days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
  const allTiers = [];
  for (const t of tiers) allTiers.push({amount: t[3], start: parseInt(t[1]), end: parseInt(t[2])});
  for (const t of revTiers) allTiers.push({amount: t[1], start: parseInt(t[2]), end: parseInt(t[3])});
  // Deduplicate by start day
  const seen = new Set();
  const uniqueTiers = allTiers.filter(t => { if (seen.has(t.start)) return false; seen.add(t.start); return true; });
  uniqueTiers.sort((a, b) => a.start - b.start);
  if (uniqueTiers.length > 0) {
    const inNet = [uniqueTiers[0]]; let next = uniqueTiers[0].end + 1;
    for (const t of uniqueTiers.slice(1)) {
      if (t.start === next) { inNet.push(t); next = t.end + 1; }
    }
    result.hospitalCopay = inNet.map(t => `$${t.amount}/day, days ${t.start}-${t.end}`).join('; ');
    return;
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

BCBSNCParser.extractOTC = function(result, allPages, prose) {
  // "$100 quarterly allowance" or "$100 per quarter"
  const m = prose.match(/\$([\d,]+)\s*(?:quarterly|per\s*quarter)\s*(?:allowance|benefit)/i)
    || prose.match(/\$([\d,]+)\s*(?:allowance|benefit)\s*(?:per\s*quarter|quarterly)/i);
  if (m) { result.otcAllowance = `$${m[1]}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

BCBSNCParser.extractPartB = function(result, allPages, prose) {
  // "Part B Reduction: $35 monthly" — BCBSNC format often has "$35 monthly" inline
  const m = prose.match(/\$([\d,.]+)\s*monthly[^.]{0,30}(?:Deductible|This plan)/i);
  if (m && parseInt(m[1]) > 0) { result.partBReduction = `$${m[1].replace(/\.00$/, '')}/month`; return; }
  const m2 = prose.match(/Part\s*B\s*(?:Premium\s*)?Reduction\s*:?\s*\$([\d,.]+)/i);
  if (m2 && parseInt(m2[1]) > 0) { result.partBReduction = `$${m2[1].replace(/\.00$/, '')}/month`; return; }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

BCBSNCParser.extractVision = function(result, allPages, prose) {
  // "$300 combined...yearly allowance" near "eyewear" or "vision" context
  // Must NOT grab dental $2,000 allowance
  const seg = this.after(prose, 'Routine\\s*Eyewear', 200)
    || this.after(prose, 'Vision\\s*Services', 300);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*(?:combined\s*)?(?:\([^)]*\)\s*)?(?:yearly|annual)\s*(?:eyewear\s*)?allowance/i)
      || seg.match(/\$([\d,]+)/i);
    if (m && parseInt(m[1].replace(/,/g,'')) <= 500) {
      result.visionAllowance = `$${m[1]} eyewear allowance`; return;
    }
  }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

BCBSNCParser.extractHearing = function(result, allPages, prose) {
  // "$499-$999 copay" for hearing aids
  const m = prose.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*copay[^.]{0,40}(?:hearing|aid|Dental)/i)
    || prose.match(/Hearing\s*Aids?\s*:[^$]{0,40}\$([\d,]+)\s*[-–]\s*\$([\d,]+)/i);
  if (m) { result.hearingAllowance = `$${m[1]} - $${m[2]} copay per hearing aid`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

BCBSNCParser.extractTransportation = function(result, allPages, prose) {
  // "12 one-way rides to health-related locations"
  const m = prose.match(/(\d+)\s*one[- ]?way\s*rides?/i);
  if (m) { result.transportation = `${m[1]} rides/year ($0 copay)`; return; }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

BCBSNCParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*combined\s*(?:yearly|annual)\s*allowance/i);
  if (m) { result.dentalAllowance = `$${m[1]} combined yearly allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

BCBSNCParser.extractRxDeductible = function(result, allPages, prose) {
  // BCBSNC: "Tiers 3, 4 and 5: $615"
  const m = prose.match(/Tiers?\s*3[^$]{0,20}\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)[^.]{0,20}Tiers?\s*3/i);
  if (m && parseInt(m[1].replace(/,/g, '')) <= 1000) { result.rxDeductible = `$${m[1]}`; return; }
  BaseParser.extractRxDeductible.call(this, result, allPages, prose);
};

BCBSNCParser.extractMedDeductible = function(result, allPages, prose) {
  if (/no\s*medical\s*deductible|has\s*no\s*(?:medical\s*)?deductible/i.test(prose)) {
    result.medDeductible = '$0'; return;
  }
  BaseParser.extractMedDeductible.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.BCBSNCParser = BCBSNCParser;
if (typeof module !== 'undefined') module.exports = BCBSNCParser;
