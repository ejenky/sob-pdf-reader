// base-parser.js — Shared base for all carrier-specific parsers
// Provides default field extraction methods and shared helpers

const BaseParser = {
  carrierName: 'Base',

  initResult() {
    return {
      planName: 'Unknown Plan', planPremium: 'Not found', partBReduction: 'Not found',
      moop: 'Not found', medDeductible: 'Not found', rxDeductible: 'Not found',
      pcpCopay: 'Not found', specialistCopay: 'Not found', preventiveCare: '$0 copay',
      erCopay: 'Not found', urgentCopay: 'Not found', hospitalCopay: 'Not found',
      otcAllowance: 'Not found', foodFlexCard: '$0', dentalAllowance: 'Not found',
      visionAllowance: 'Not found', hearingAllowance: 'Not found', transportation: 'Not found'
    };
  },

  parse(allPages, pagesRaw) {
    const result = this.initResult();
    const prose = this.getProseText(allPages);
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
  },

  // ── Helpers ──────────────────────────────────────────────────────────
  getProseText(allPages) {
    return allPages.map(p => p.proseText || '').join(' ').replace(/[\u2010-\u2015\u2212]/g, '-');
  },
  getRawText(allPages) {
    return allPages.map(p => p.rawText || '').join('\n').replace(/[\u2010-\u2015\u2212]/g, '-');
  },
  findRow(allPages, labelRe, antiRe) {
    for (const page of allPages) {
      for (const row of page.rows) {
        const label = (row.label || '').replace(/[\u2010-\u2015]/g, '-');
        if (labelRe.test(label)) {
          if (antiRe && antiRe.test(label)) continue;
          return row;
        }
      }
    }
    return null;
  },
  findAllRows(allPages, labelRe, antiRe) {
    const results = [];
    for (const page of allPages) {
      for (const row of page.rows) {
        const label = (row.label || '').replace(/[\u2010-\u2015]/g, '-');
        if (labelRe.test(label) && !(antiRe && antiRe.test(label))) results.push(row);
      }
    }
    return results;
  },
  after(text, keyword, maxChars = 500) {
    const idx = text.search(new RegExp(keyword, 'i'));
    if (idx === -1) return null;
    return text.substring(idx, idx + maxChars);
  },
  firstDollar(text) {
    const m = text && text.match(/\$([\d,]+(?:\.\d+)?)/);
    return m ? m[1].replace(/\.00$/, '') : null;
  },

  // ── Default extraction methods (carriers override as needed) ──────
  extractPlanName(result, allPages, prose) {
    // Try H-number from rows
    for (const page of allPages.slice(0, 2)) {
      for (const row of page.rows) {
        const text = [row.label, row.inNetwork].join(' ').replace(/[\u2010-\u2015]/g, '-');
        const hM = text.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
        if (hM) { result.planName = `${hM[1]}-${hM[2]}`; return; }
      }
    }
  },
  extractPremium(result, allPages, prose) {
    const m = prose.match(/(?:Monthly\s*(?:Plan\s*)?Premium)[^$]{0,30}\$([\d,.]+)/i);
    if (m) { result.planPremium = `$${m[1].replace(/\.00$/, '')}/month`; return; }
    if (/\$0\s*(?:Plan\s*)?Premium|\$0\.\s*You\s*must/i.test(prose)) result.planPremium = '$0/month';
  },
  extractPartB(result, allPages, prose) {
    const m = prose.match(/Part\s*B\s*(?:premium\s*)?(?:reduction|giveback|rebate|buy[- ]?down|subsidy)[^$]{0,30}\$([\d,.]+)/i)
      || prose.match(/\$([\d,.]+)\s*(?:per\s*month\s*)?(?:Part\s*B|premium)\s*(?:reduction|giveback|rebate)/i)
      || prose.match(/Part\s*B\s*Rebate[^$]{0,20}\$([\d,.]+)/i);
    if (m) { result.partBReduction = `$${m[1].replace(/\.00$/, '')}/month`; return; }
    if (/must\s*continue\s*to\s*pay.*Part\s*B/i.test(prose)) result.partBReduction = 'N/A';
  },
  extractMOOP(result, allPages, prose) {
    const m = prose.match(/(?:MOOP|Maximum\s*out[- ]?of[- ]?pocket|Annual\s*Maximum|out-of-pocket\s*(?:limit|amount|responsibility))[^$]{0,80}\$([\d,]+)/i);
    if (m && parseInt(m[1].replace(/,/g, '')) >= 1000) result.moop = `$${m[1]}`;
  },
  extractMedDeductible(result, allPages, prose) {
    if (/does\s*not\s*have\s*(?:a\s*)?(?:medical\s*)?deductible|no\s*(?:medical\s*)?deductible/i.test(prose)) {
      result.medDeductible = '$0'; return;
    }
    const row = this.findRow(allPages, /^Plan\s*deductible|^Annual\s*medical\s*deductible|deductible\s*\(medical\)/i, /drug|rx|prescription|part\s*d/i);
    if (row) {
      const val = row.inNetwork || '';
      if (/does\s*not\s*have|no\s*deductible/i.test(val)) { result.medDeductible = '$0'; return; }
      const d = this.firstDollar(val);
      if (d) { result.medDeductible = `$${d}`; return; }
    }
  },
  extractRxDeductible(result, allPages, prose, raw) {
    const m = prose.match(/has\s*a\s*\$([\d,]+)\s*(?:prescription\s*)?(?:drug\s*)?deductible/i)
      || prose.match(/deductible\s*(?:limit|amount)\s*(?:of\s*)?\$([\d,]+)/i)
      || prose.match(/deductible\s*amount\s*is\s*\$([\d,]+)/i)
      || prose.match(/\$([\d,]+)\s*(?:prescription\s*)?(?:drug\s*)?deductible/i);
    if (m) { const v = m[1] || m[2]; if (parseInt(v.replace(/,/g,'')) <= 1000) { result.rxDeductible = `$${v}`; return; } }
    if (/no\s*(?:drug\s*|prescription\s*)?deductible|deductible[^.]{0,20}\$0/i.test(prose)) result.rxDeductible = '$0';
  },
  extractPCP(result, allPages, prose) {
    const m = prose.match(/(?:PCP|Primary\s*care)[^$]{0,30}\$([\d,]+)\s*(?:copay|per\s*visit)/i)
      || prose.match(/(?:PCP|Primary\s*care)[^$]{0,30}You\s*pay\s*\$([\d,]+)/i);
    if (m) { result.pcpCopay = `$${m[1]} copay`; return; }
    const row = this.findRow(allPages, /^PCP$/i);
    if (row && row.inNetwork) result.pcpCopay = Normalizer.copay(row.inNetwork);
  },
  extractSpecialist(result, allPages, prose) {
    const m = prose.match(/Specialist[s]?\s*\$([\d,]+)\s*(?:copay|per\s*visit)/i)
      || prose.match(/Specialist[^$]{0,30}\$([\d,]+)\s*(?:copay|per\s*visit)/i)
      || prose.match(/Specialist[^$]{0,30}You\s*pay\s*\$([\d,]+)/i);
    if (m) result.specialistCopay = `$${m[1]} copay`;
  },
  extractPreventive(result, allPages, prose) {
    result.preventiveCare = '$0 copay'; // Always $0 on Medicare Advantage
  },
  extractER(result, allPages, prose) {
    const m = prose.match(/Emergency\s*(?:care|room)[^$]{0,20}\$([\d,]+)\s*(?:copay)?/i)
      || prose.match(/Emergency\s*(?:care|room)[^$]{0,20}You\s*pay\s*\$([\d,]+)/i);
    if (m && parseInt(m[1]) > 0) result.erCopay = `$${m[1]}`;
  },
  extractUrgent(result, allPages, prose) {
    const m = prose.match(/Urgent(?:ly)?\s*(?:needed\s*)?(?:care|services)[^$]{0,20}\$([\d,]+)\s*(?:copay|per\s*visit)?/i)
      || prose.match(/Urgent(?:ly)?\s*(?:needed\s*)?(?:care|services)[^$]{0,20}You\s*pay\s*\$([\d,]+)/i);
    if (m) result.urgentCopay = `$${m[1]}`;
  },
  extractHospital(result, allPages, prose, raw) {
    // Search prose for per-day or per-stay patterns near "Inpatient"
    const seg = this.after(prose, 'Inpatient\\s*(?:hospital)?', 600);
    if (!seg) return;
    // Check for per-stay first
    const stayM = seg.match(/\$([\d,]+)\s*(?:copay\s*)?per\s*stay/i);
    if (stayM) {
      const dayRange = seg.match(/days?\s*(\d+)\s*[-–]\s*(\d+)/i);
      result.hospitalCopay = `$${stayM[1]} per stay${dayRange ? `, days ${dayRange[1]}-${dayRange[2]}` : ''}`;
      return;
    }
    // Per-day with sequential logic
    const perDayAmts = [...seg.matchAll(/\$([\d,]+)\s*(?:copay\s*)?per\s*day/gi)];
    const dayRanges = [...seg.matchAll(/days?\s*(\d+)\s*[-–]\s*(\d+)/gi)];
    const dayBeyond = [...seg.matchAll(/days?\s*(\d+)\s*and\s*beyond/gi)];
    for (const m of dayBeyond) { dayRanges.push(Object.assign([...m], {index: m.index, 1: m[1], 2: '999'})); }
    dayRanges.sort((a, b) => a.index - b.index);
    if (perDayAmts.length > 0 && dayRanges.length > 0) {
      const tiers = [];
      for (const range of dayRanges) {
        let best = null;
        for (const amt of perDayAmts) { if (amt.index < range.index) best = amt; }
        if (best) tiers.push({amount: best[1], start: parseInt(range[1]), end: parseInt(range[2] || '999')});
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
  },
  extractOTC(result, allPages, prose) {
    const m = prose.match(/OTC[^$]{0,60}\$([\d,]+)\s*(?:\/|per\s*|every\s*)(?:quarter|month)/i)
      || prose.match(/over[- ]the[- ]counter[^$]{0,60}\$([\d,]+)\s*(?:\/|per\s*|every\s*)(?:quarter|month)/i)
      || prose.match(/\$([\d,]+)\s*(?:\/|per\s*|every\s*)quarter\s*(?:for\s*)?(?:over|OTC)/i);
    if (m) {
      const period = /month/i.test(m[0]) ? '/month' : '/quarter';
      result.otcAllowance = `$${m[1]}${period}`;
    }
  },
  extractFoodCard(result, allPages, prose) { /* default: $0 from initResult */ },
  extractDental(result, allPages, prose) {
    const m = prose.match(/\$([\d,]+)\s*(?:combined\s*)?(?:annual\s*)?(?:allowance|maximum)[^.]{0,40}dental/i)
      || prose.match(/dental[^.]{0,80}\$([\d,]+)\s*(?:combined\s*)?(?:annual\s*)?(?:allowance|maximum|coverage\s*amount)/i)
      || prose.match(/\$([\d,]+)\s*allowance\s*(?:every\s*year|per\s*year|annual)[^.]{0,40}dental/i)
      || prose.match(/pays?\s*up\s*to\s*\$([\d,]+)\s*(?:every|per)\s*(?:year|calendar)[^.]{0,40}dental/i);
    if (m) {
      const amt = parseInt((m[1]||'').replace(/,/g,''));
      if (amt >= 100 && amt <= 10000) { result.dentalAllowance = `$${m[1]} allowance`; return; }
    }
    if (/dental[^.]{0,40}\$0\s*copay/i.test(prose)) result.dentalAllowance = '$0 copay';
  },
  extractVision(result, allPages, prose) {
    const m = prose.match(/\$([\d,]+)\s*(?:annual\s*)?(?:benefit\s*)?(?:allowance)[^.]{0,40}(?:eyewear|eyeglasses|frames|contacts|prescription)/i)
      || prose.match(/(?:eyewear|frames|contacts)\s*(?:allowance|benefit)[^$]{0,40}\$([\d,]+)/i)
      || prose.match(/\$([\d,]+)\s*allowance\s*(?:every\s*\d+\s*years?|per\s*year|annual)/i)
      || prose.match(/(?:eyewear|vision).*?(?:more\s*than|up\s*to)\s*\$([\d,]+)/i);
    if (m) {
      const amt = m[1] || m[2];
      const period = m[0].match(/every\s*(\d+)\s*years?/i);
      result.visionAllowance = `$${amt} eyewear allowance${period ? ` every ${period[1]} years` : ''}`;
    }
  },
  extractHearing(result, allPages, prose) {
    const m = prose.match(/hearing\s*aid[^.]{0,80}\$([\d,]+)\s*(?:benefit|allowance|max)/i)
      || prose.match(/\$([\d,]+)\s*(?:benefit\s*)?(?:allowance\s*)?(?:towards|for|per\s*ear)\s*hearing\s*aid/i)
      || prose.match(/hearing\s*aid[^.]{0,80}more\s*than\s*\$([\d,]+)/i)
      || prose.match(/Up\s*to\s*(?:a\s*)?\$([\d,]+)[^.]{0,40}hearing\s*aid/i);
    if (m) {
      const amt = parseInt((m[1]||m[2]||'').replace(/,/g,''));
      if (amt >= 100) {
        const perEar = /per\s*ear/i.test(prose.substring(Math.max(0, prose.indexOf(m[0])), prose.indexOf(m[0]) + 150));
        result.hearingAllowance = `$${m[1]||m[2]}${perEar ? '/ear' : ''} hearing aid benefit`;
      }
    }
    // Tiered copay range
    if (result.hearingAllowance === 'Not found') {
      const range = prose.match(/\$([\d,]+)\s*[-–]\s*\$([\d,]+)\s*(?:copay|per)[^.]{0,40}hearing\s*aid/i);
      if (range) result.hearingAllowance = `$${range[1]} - $${range[2]} copay per hearing aid`;
    }
    // "X hearing aids every Y years"
    if (result.hearingAllowance === 'Not found') {
      const desc = prose.match(/(?:up\s*to\s*)?(\d)\s*(?:pre[- ]?selected\s*)?hearing\s*aids?\s*(?:every|per)\s*(\d)\s*years?/i);
      if (desc) result.hearingAllowance = `${desc[1]} hearing aids every ${desc[2]} years`;
    }
  },
  extractTransportation(result, allPages, prose) {
    if (/transportation[^.]{0,60}not\s*covered/i.test(prose) || /non-emergency\s*transportation[^.]{0,40}Not\s*Covered/i.test(prose)) {
      result.transportation = 'Not covered'; return;
    }
    const trips = prose.match(/(\d+)\s*(?:one[- ]?way\s*)?(?:rides?|trips?)\s*(?:per\s*(?:year|calendar)|every\s*year|annually)/i);
    if (trips) {
      const miles = prose.match(/(?:limit|up\s*to)\s*(\d+)\s*miles/i);
      result.transportation = `${trips[1]} trips/year${miles ? `, ${miles[1]} miles` : ''} ($0 copay)`;
    }
  },

  validate(result, prose) {
    // Preventive is always $0
    if (!/^\$0/.test(result.preventiveCare)) result.preventiveCare = '$0 copay';
    // MOOP must be >= $1000
    if (result.moop !== 'Not found') {
      const v = Normalizer.extractDollars(result.moop);
      if (v.length > 0 && v[0].value < 1000) result.moop = 'Not found';
    }
    // Premium cleanup
    if (result.planPremium) result.planPremium = result.planPremium.replace(/\.\s*\/month/, '/month');
    // Sanitize junk
    for (const k of ['rxDeductible', 'medDeductible', 'erCopay', 'urgentCopay', 'specialistCopay']) {
      if (result[k] && !/^\$|^Not |^N\/A|^\d/i.test(result[k])) result[k] = 'Not found';
    }
  }
};

if (typeof window !== 'undefined') window.BaseParser = BaseParser;
if (typeof module !== 'undefined') module.exports = BaseParser;
