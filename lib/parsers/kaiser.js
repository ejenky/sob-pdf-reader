// kaiser.js — Kaiser Permanente carrier-specific parser
// Format: tabular, single-plan
// Labels: "Doctor's visits" (PCP $0), "Inpatient hospital services",
//   OTC "$25 quarterly benefit limit", Vision "more than $200", Hearing "more than $1,000"

const KaiserParser = Object.create(BaseParser);
KaiserParser.carrierName = 'Kaiser';

// Kaiser's proseText from table-extract may reorder text. Use pagesRaw when available.
KaiserParser.parse = function(allPages, pagesRaw) {
  const result = this.initResult();
  let prose = this.getProseText(allPages);
  if (pagesRaw && pagesRaw.length > 0 && pagesRaw[0] && pagesRaw[0].items) {
    const rawProse = pagesRaw.map(p => (p.items || []).map(it => it.text || '').join(' ')).join(' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-');
    // Supplement with rawProse — search both
    prose = prose + ' ' + rawProse;
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

KaiserParser.extractSpecialist = function(result, allPages, prose) {
  // Kaiser: "Specialists*† $40 per visit" — extra spaces and symbols from PDF.js
  const m = prose.match(/Specialist[s]?\s*[*†\s]{0,10}\$([\d,]+)\s*(?:per\s*visit|copay)/i)
    || prose.match(/Specialist[s]?[^$]{0,30}\$([\d,]+)\s*(?:per\s*visit|copay)/i);
  if (m) { result.specialistCopay = `$${m[1]} copay`; return; }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

KaiserParser.extractHospital = function(result, allPages, prose) {
  // Kaiser: "$360 per day for days 1-5 of your stay and $0 for the rest of your stay"
  const seg = this.after(prose, 'Inpatient\\s*hospital', 400);
  if (seg) {
    const m = seg.match(/\$([\d,]+)\s*per\s*day\s*(?:for\s*)?days?\s*(\d+)\s*[-–]\s*(\d+)/i);
    if (m) {
      let hosp = `$${m[1]}/day, days ${m[2]}-${m[3]}`;
      // Check for "and $0 for the rest" pattern
      if (/\$0\s*(?:for\s*)?(?:the\s*)?rest\s*of/i.test(seg)) {
        const nextDay = parseInt(m[3]) + 1;
        hosp += `; $0/day, days ${nextDay}+`;
      }
      result.hospitalCopay = hosp;
      return;
    }
  }
  BaseParser.extractHospital.call(this, result, allPages, prose);
};

KaiserParser.extractDental = function(result, allPages, prose) {
  // Kaiser: "$500 (annual benefit limit)"
  const m = prose.match(/\$([\d,]+)\s*\(?annual\s*benefit\s*limit/i)
    || prose.match(/\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?limit[^.]{0,40}dental/i)
    || prose.match(/dental[^.]{0,60}\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?limit/i)
    || prose.match(/paid\s*\$([\d,]+)\s*\(?annual\s*benefit/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

KaiserParser.extractPartB = function(result, allPages, prose) {
  // Kaiser typically has no Part B giveback
  if (!/giveback|give\s*back|reduction|rebate|buy[- ]?down/i.test(prose)) {
    result.partBReduction = 'N/A';
    return;
  }
  BaseParser.extractPartB.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.KaiserParser = KaiserParser;
if (typeof module !== 'undefined') module.exports = KaiserParser;
