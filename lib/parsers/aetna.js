// aetna.js — Aetna Medicare carrier-specific parser
// Handles: PPO (3-column), HMO (2-column), C-SNP, D-SNP
// Labels: "Plan deductible", "MOOP", "PCP", "Specialist",
//   "Emergency and urgent care (inside the U.S.)", "Inpatient (unlimited number of days)"
//   "Extra Supports Wallet" (C-SNP/D-SNP), "OTC Wallet" (D-SNP)

const AetnaParser = Object.create(BaseParser);
AetnaParser.carrierName = 'Aetna';

AetnaParser.extractPlanName = function(result, allPages, prose) {
  // Aetna: "Aetna Medicare Signature (PPO)" on page 1, H-number on page 1-2
  let hNum = null;
  for (const page of allPages.slice(0, 2)) {
    for (const row of page.rows) {
      const text = [row.label, row.inNetwork].join(' ').replace(/[\u2010-\u2015]/g, '-');
      const hM = text.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
      if (hM && !hNum) hNum = `${hM[1]}-${hM[2]}`;
    }
  }
  // Plan name from top rows
  const topRows = allPages[0].rows.filter(r => r.y < 200).sort((a, b) => a.y - b.y);
  for (const row of topRows) {
    const text = (row.label || row.inNetwork || '').trim().replace(/[\u2010-\u2015]/g, '-');
    if (text.length < 5 || /summary|we're|you may|call|TTY|\.com|a\.m|monday|friday/i.test(text)) continue;
    if (/Aetna\s*Medicare/i.test(text)) {
      result.planName = hNum && !text.includes(hNum) ? `${text} ${hNum}` : text;
      return;
    }
  }
  if (hNum) result.planName = hNum;
};

AetnaParser.extractMOOP = function(result, allPages, prose) {
  // Aetna: exact "MOOP" label row
  for (const page of allPages) {
    for (let i = 0; i < page.rows.length; i++) {
      const label = (page.rows[i].label || '').trim();
      if (!/^MOOP$/i.test(label)) continue;
      let allText = '';
      for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
        allText += ' ' + [page.rows[j].inNetwork, page.rows[j].outOfNetwork].filter(Boolean).join(' ');
      }
      allText = allText.replace(/[\u2010-\u2015]/g, '-');
      const inNetM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-network/i);
      const combinedM = allText.match(/\$([\d,]+)\s*(?:for\s*)?in-?\s*and\s*out-?of-?network\s*(?:services\s*)?combined/i);
      if (inNetM && combinedM) {
        result.moop = `$${inNetM[1]} in-network / $${combinedM[1]} in- and out-of-network combined`;
      } else {
        const dollars = Normalizer.extractDollars(allText).filter(d => d.value >= 1000);
        if (dollars.length >= 2) result.moop = `$${dollars[0].raw} in-network / $${dollars[1].raw} in- and out-of-network combined`;
        else if (dollars.length === 1) result.moop = `$${dollars[0].raw}`;
      }
      if (result.moop !== 'Not found') return;
    }
  }
};

AetnaParser.extractMedDeductible = function(result, allPages, prose) {
  const row = this.findRow(allPages, /^Plan\s*deductible/i);
  if (row) {
    const val = row.inNetwork || '';
    if (/\$0/i.test(val)) { result.medDeductible = '$0'; return; }
    const d = this.firstDollar(val);
    if (d) { result.medDeductible = `$${d}`; return; }
  }
  if (/must\s*continue\s*to\s*pay|does\s*not\s*have/i.test(prose)) result.medDeductible = '$0';
};

AetnaParser.extractER = function(result, allPages, prose) {
  // Aetna combined: "Emergency and urgent care (inside the U.S.)"
  // Value: "$115 copay for emergency care\n$40 copay for urgent care"
  for (const page of allPages) {
    for (let i = 0; i < page.rows.length; i++) {
      const label = (page.rows[i].label || '').replace(/[\u2010-\u2015]/g, '-');
      if (/emergency\s*and\s*urgent/i.test(label) && !/outside/i.test(label)) {
        let allText = '';
        for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
          const rLabel = (page.rows[j].label || '').replace(/[\u2010-\u2015]/g, '-');
          if (j > i && /outside/i.test(rLabel)) break;
          allText += ' ' + [rLabel, page.rows[j].inNetwork].filter(Boolean).join(' ');
        }
        const erM = allText.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?emergency\s*care/i);
        if (erM) result.erCopay = `$${erM[1]}`;
        return;
      }
    }
  }
  // Fallback to base
  BaseParser.extractER.call(this, result, allPages, prose);
};

AetnaParser.extractUrgent = function(result, allPages, prose) {
  // Same combined section as ER
  for (const page of allPages) {
    for (let i = 0; i < page.rows.length; i++) {
      const label = (page.rows[i].label || '').replace(/[\u2010-\u2015]/g, '-');
      if (/emergency\s*and\s*urgent/i.test(label) && !/outside/i.test(label)) {
        let allText = '';
        for (let j = i; j < Math.min(i + 4, page.rows.length); j++) {
          const rLabel = (page.rows[j].label || '').replace(/[\u2010-\u2015]/g, '-');
          if (j > i && /outside/i.test(rLabel)) break;
          allText += ' ' + [rLabel, page.rows[j].inNetwork].filter(Boolean).join(' ');
        }
        const ucM = allText.match(/\$([\d,]+)\s*copay\s*(?:for\s*)?urgent\s*care/i);
        if (ucM) result.urgentCopay = `$${ucM[1]}`;
        return;
      }
    }
  }
  BaseParser.extractUrgent.call(this, result, allPages, prose);
};

AetnaParser.extractSpecialist = function(result, allPages, prose) {
  const row = this.findRow(allPages, /^Specialist$/i);
  if (row && row.inNetwork) {
    result.specialistCopay = Normalizer.copay(row.inNetwork);
    return;
  }
  BaseParser.extractSpecialist.call(this, result, allPages, prose);
};

AetnaParser.extractPCP = function(result, allPages, prose) {
  const row = this.findRow(allPages, /^PCP$/i);
  if (row && row.inNetwork) {
    result.pcpCopay = Normalizer.copay(row.inNetwork);
    return;
  }
  BaseParser.extractPCP.call(this, result, allPages, prose);
};

AetnaParser.extractHospital = function(result, allPages, prose) {
  // Use sequential day logic on prose text
  const seg = this.after(prose, 'Inpatient', 800);
  if (!seg) return;
  const stopIdx = seg.search(/\bOutpatient\b/i);
  const section = stopIdx > 0 ? seg.substring(0, stopIdx) : seg;

  const perDayAmts = [...section.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day/gi)];
  const dayRanges = [...section.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
  const dayBeyond = [...section.matchAll(/days?\s*(\d+)\s*and\s*beyond/gi)];
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
    }
  }
  // D-SNP: $0 copay
  if (result.hospitalCopay === 'Not found' && /Inpatient[^|]*\$0\s*copay/i.test(section)) {
    result.hospitalCopay = '$0 copay';
  }
};

AetnaParser.extractOTC = function(result, allPages, prose) {
  // D-SNP: "Over-the-Counter (OTC) Wallet" with "$165 monthly"
  const otcM = prose.match(/Over[- ]?the[- ]?Counter\s*\(OTC\)\s*Wallet[^$]{0,60}\$([\d,]+)\s*monthly/i);
  if (otcM) { result.otcAllowance = `$${otcM[1]}/month`; return; }
  // C-SNP: "Extra Supports Wallet" with "$30 monthly"
  const extM = prose.match(/Extra\s*Supports?\s*Wallet[^$]{0,60}\$([\d,]+)\s*monthly/i);
  if (extM) { result.otcAllowance = `$${extM[1]}/month (Extra Supports Wallet)`; return; }
};

AetnaParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/allowance\)?\s*of\s*\$([\d,]+)\s*(?:for\s*)?covered\s*(?:dental\s*)?services/i)
    || prose.match(/\$([\d,]+)\s*(?:for\s*)?covered\s*services[^.]{0,30}dental/i);
  if (m) { result.dentalAllowance = `$${m[1]} annual allowance ($0 copay)`; return; }
  if (/dental[^.]{0,40}\$0\s*copay/i.test(prose)) result.dentalAllowance = '$0 copay for covered services';
};

AetnaParser.extractVision = function(result, allPages, prose) {
  // Aetna: "annual benefit amount (allowance) of $100 for covered prescription eyewear"
  const m = prose.match(/allowance\)?\s*of\s*\$([\d,]+)\s*(?:for\s*)?covered\s*prescription\s*eyewear/i)
    || prose.match(/\$([\d,]+)\s*(?:for\s*)?covered\s*prescription\s*eyewear/i);
  if (m) {
    // Make sure we get the eyewear allowance, not the eye exam copay
    const amt = parseInt(m[1].replace(/,/g,''));
    if (amt >= 50) { result.visionAllowance = `$${m[1]}`; return; }
  }
  // Search for the Contacts and eyeglasses row specifically
  for (const page of allPages) {
    for (const row of page.rows) {
      const label = (row.label || '').toLowerCase();
      if (/contacts|eyeglasses|eyewear/i.test(label)) {
        const val = row.inNetwork || '';
        const d = val.match(/\$([\d,]+)/);
        if (d && parseInt(d[1].replace(/,/g,'')) >= 50) {
          result.visionAllowance = `$${d[1]}`;
          return;
        }
      }
    }
  }
};

AetnaParser.extractHearing = function(result, allPages, prose) {
  // Aetna: tiered copays Level 1-6
  const levels = [...prose.matchAll(/Level\s*\d[^:]*:\s*\$([\d,]+)\s*copay\s*per\s*ear/gi)];
  if (levels.length > 0) {
    const amounts = levels.map(m => parseInt(m[1].replace(/,/g, '')));
    const min = Math.min(...amounts), max = Math.max(...amounts);
    result.hearingAllowance = `$${min.toLocaleString()} - $${max.toLocaleString()}/ear/year (tiered by level)`;
    return;
  }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

AetnaParser.extractTransportation = function(result, allPages, prose) {
  // Check "Routine, non-emergency transportation" — often split across rows
  if (/non-emergency\s*transportation[^.]{0,40}Not\s*Covered/i.test(prose) ||
      /Routine[^.]{0,40}transportation[^.]{0,40}Not\s*Covered/i.test(prose)) {
    result.transportation = 'Not covered'; return;
  }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

AetnaParser.validate = function(result, prose) {
  BaseParser.validate.call(this, result, prose);
  // C-SNP/D-SNP: combine OTC + Food
  const isSNP = /c\s*-?\s*snp|d\s*-?\s*snp/i.test(result.planName);
  if (isSNP && result.otcAllowance && result.otcAllowance !== 'Not found') {
    const m = result.otcAllowance.match(/\$([\d,]+)/);
    if (m) {
      const period = /month/i.test(result.otcAllowance) ? '/month' : '';
      result.otcAllowance = `$${m[1]}${period} (Extra Supports Wallet) Food If Applicable`;
    }
    result.foodFlexCard = '__HIDE__';
  }
  // Part B: check "must continue to pay"
  if (result.partBReduction === 'Not found' && /must\s*continue\s*to\s*pay.*Part\s*B/i.test(prose)) {
    result.partBReduction = 'N/A';
  }
};

if (typeof window !== 'undefined') window.AetnaParser = AetnaParser;
if (typeof module !== 'undefined') module.exports = AetnaParser;
