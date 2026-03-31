// zing.js — Zing Health carrier-specific parser
// Format: tabular, single-plan, "You pay $X" value format
// Labels: "Monthly Plan Premium", "Inpatient Hospital", "Specialists",
//   "Emergency Care", "Urgently Needed Services", "Over-the-Counter (OTC) Allowance"

const ZingParser = Object.create(BaseParser);
ZingParser.carrierName = 'Zing';

ZingParser.extractPlanName = function(result, allPages, prose) {
  const m = prose.match(/(Zing\s+[A-Z][^(]{3,30}\([^)]+\))/i);
  const hM = prose.match(/(H\d{4})\s*[-_]\s*(\d{3})/i);
  if (m && hM) result.planName = `${m[1].trim()} ${hM[1]}-${hM[2]}`;
  else if (hM) result.planName = `${hM[1]}-${hM[2]}`;
};

ZingParser.extractOTC = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*\/\s*quarter\s*(?:for\s*)?over[- ]the[- ]counter/i)
    || prose.match(/OTC\s*(?:Allowance)?[^$]{0,30}\$([\d,]+)\s*\/?\s*quarter/i);
  if (m) { result.otcAllowance = `$${m[1]}/quarter`; return; }
  BaseParser.extractOTC.call(this, result, allPages, prose);
};

ZingParser.extractFoodCard = function(result, allPages, prose) {
  const m = prose.match(/Flex\s*Card[^$]{0,30}\$([\d,]+)\s*(?:debit\s*card\s*)?(?:allowance)?/i);
  if (m) { result.foodFlexCard = `$${m[1]}`; return; }
  // Food benefit for chronically ill
  const food = prose.match(/food\s*items[^$]{0,40}\$([\d,]+)/i)
    || prose.match(/\$([\d,]+)\s*(?:per\s*month|\/month)[^.]{0,40}food/i);
  if (food) { result.foodFlexCard = `$${food[1]}`; return; }
};

ZingParser.extractDental = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*benefit\s*allowance\s*(?:every\s*year|per\s*year|annual)[^.]{0,40}(?:dental|diagnostic)/i);
  if (m) { result.dentalAllowance = `$${m[1]} allowance`; return; }
  BaseParser.extractDental.call(this, result, allPages, prose);
};

ZingParser.extractVision = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*benefit\s*allowance\s*towards\s*(?:Eyeglass|eyewear)/i);
  if (m) { result.visionAllowance = `$${m[1]} eyewear allowance`; return; }
  BaseParser.extractVision.call(this, result, allPages, prose);
};

ZingParser.extractHearing = function(result, allPages, prose) {
  const m = prose.match(/\$([\d,]+)\s*benefit\s*allowance\s*towards\s*hearing\s*aids?\s*per\s*ear\s*(?:every\s*(\d+)\s*years?)?/i);
  if (m) { result.hearingAllowance = `$${m[1]}/ear hearing aid benefit${m[2] ? ` every ${m[2]} years` : ''}`; return; }
  BaseParser.extractHearing.call(this, result, allPages, prose);
};

ZingParser.extractTransportation = function(result, allPages, prose) {
  const m = prose.match(/(\d+)\s*one[- ]?way\s*trips?\s*per\s*year[^.]{0,30}(?:(\d+)\s*miles)?/i);
  if (m) { result.transportation = `${m[1]} trips/year${m[2] ? `, ${m[2]} miles` : ''} ($0 copay)`; return; }
  BaseParser.extractTransportation.call(this, result, allPages, prose);
};

if (typeof window !== 'undefined') window.ZingParser = ZingParser;
if (typeof module !== 'undefined') module.exports = ZingParser;
