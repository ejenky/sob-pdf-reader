# Medicare SOB Extractor — Chrome Extension

Automatically detects Medicare Summary of Benefits PDFs in your browser and extracts 18 key plan fields to your clipboard with one click.

## v1.2 — Accuracy Improvements

- **Spatial table extraction**: Reconstructs PDF table structure using X/Y coordinates instead of raw text concatenation. This fixes the #1 accuracy issue where column values get jumbled.
- **Fuzzy label matching**: Uses a field definition registry with keyword patterns instead of rigid regex, improving cross-carrier compatibility.
- **Multi-pass parsing**: Structured extraction first, then fallback regex for any missing fields.
- **Proper column separation**: In-network and out-of-network values are correctly distinguished.
- **Extra benefits parsing**: Complete OTC, dental, vision, hearing, transportation, and food/flex card extraction.

## Extracted Fields

| Category | Fields |
|---|---|
| **Costs** | Plan Premium, Part B Reduction, MOOP, Medical Deductible, Rx Deductible |
| **Visits** | PCP Copay, Specialist Copay, Preventive Care, ER Copay, Urgent Care Copay, Hospital Copay |
| **Benefits** | OTC, Food/Flex Card, Dental, Vision, Hearing, Transportation |

## Installation (One-Time Setup)

### Step 1: Download PDF.js

```bash
chmod +x setup.sh
./setup.sh
```

### Step 2: Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select this folder
5. The extension is ready

## Architecture

```
popup.js              — Orchestrator: ties UI to extraction pipeline
lib/table-extract.js  — Spatial table reconstruction from PDF.js text items
lib/sob-parser.js     — Medicare SOB field extraction with fuzzy matching
lib/normalizer.js     — Dollar/copay/coinsurance normalization
lib/pdf.min.js        — PDF.js library (downloaded by setup.sh)
lib/pdf.worker.min.js — PDF.js worker (downloaded by setup.sh)
```

### How It Works

1. **PDF.js** extracts raw text items with X/Y coordinates from each page
2. **table-extract.js** clusters items by Y-coordinate (rows) and X-coordinate (columns) to reconstruct the table structure
3. **sob-parser.js** matches row labels against field definitions using fuzzy keyword patterns
4. **normalizer.js** standardizes dollar amounts, copays, coinsurance, and allowances across different carrier formats

## Supported Carriers

Tested with SOB formats from:
- Aetna / CVS Health
- UnitedHealthcare / AARP
- Humana
- Cigna / Evernorth
- WellCare / Centene
- Devoted Health
- Blue Cross Blue Shield

## Notes

- All processing is local (no API calls, no telemetry)
- The extension only reads PDFs from URLs you're already viewing
