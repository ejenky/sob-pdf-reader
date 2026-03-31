// generic.js — Fallback parser for unknown carriers
// Uses BaseParser defaults which cover common patterns across all carriers

const GenericParser = Object.create(BaseParser);
GenericParser.carrierName = 'Generic';

if (typeof window !== 'undefined') window.GenericParser = GenericParser;
if (typeof module !== 'undefined') module.exports = GenericParser;
