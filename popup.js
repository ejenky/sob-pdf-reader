// popup.js — Medicare SOB Extractor v1.2
// Orchestrator: ties PDF loading, spatial extraction, and SOB parsing together

// ─── State Management ────────────────────────────────────────────────────────
let currentTabUrl = null;
let extractedData = null;
let detectedPlans = [];
let cachedPagesRaw = null;
let cachedPdf = null;
const states = ['no-pdf', 'setup', 'ready', 'plan-select', 'loading', 'error', 'results'];

function showState(name) {
  states.forEach(s => {
    const el = document.getElementById(`state-${s}`);
    if (el) el.classList.toggle('active', s === name);
  });
}

function setStatus(text, dotClass = '') {
  document.getElementById('status-text').textContent = text;
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot' + (dotClass ? ` ${dotClass}` : '');
}

function setProgress(msg, pct) {
  document.getElementById('progress-msg').textContent = msg;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

// ─── PDF Detection ────────────────────────────────────────────────────────────
function isPdfUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.endsWith('.pdf') ||
    lower.includes('.pdf?') ||
    lower.includes('.pdf#') ||
    lower.includes('application/pdf') ||
    lower.includes('content-type=pdf')
  );
}

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus('Cannot access this tab', 'red');
      showState('no-pdf');
      return;
    }

    currentTabUrl = tab.url;

    // Check PDF.js is available
    if (typeof pdfjsLib === 'undefined') {
      setStatus('PDF.js library not found — run setup.sh', 'red');
      showState('setup');
      return;
    }

    if (isPdfUrl(tab.url)) {
      document.getElementById('pdf-badge').textContent = 'PDF';
      document.getElementById('pdf-badge').className = 'header-badge detected';
      document.getElementById('pdf-url').textContent = tab.url;
      setStatus('Medicare SOB PDF detected', 'green');
      showState('ready');
    } else {
      document.getElementById('pdf-badge').textContent = 'NO PDF';
      document.getElementById('pdf-badge').className = 'header-badge';
      setStatus(`Not a PDF: ${tab.url.substring(0, 50)}...`, '');
      showState('no-pdf');
    }
  } catch (e) {
    setStatus('Error accessing tab: ' + e.message, 'red');
    showState('no-pdf');
  }
}

// ─── PDF Extraction Pipeline ──────────────────────────────────────────────────

/**
 * Extract raw page items for multi-plan detection
 */
async function extractPageRaw(page, pageNum) {
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const textContent = await page.getTextContent();
  const items = textContent.items
    .filter(item => item.str && item.str.trim())
    .map(item => ({
      text: item.str.trim().replace(/[\u2010-\u2015\u2212]/g, '-'),
      x: item.transform[4],
      y: pageHeight - item.transform[5],
      width: item.width,
      height: item.height,
      fontSize: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12
    }));
  return { items, pageWidth, pageHeight, pageNum };
}

/**
 * Phase 1: Load PDF and detect multiple plans.
 * Returns detected plans array (empty for single-plan PDFs).
 */
async function loadAndDetectPlans(url) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

  setProgress('Fetching PDF from URL...', 10);
  const loadingTask = pdfjsLib.getDocument({ url: url, verbosity: 0 });
  cachedPdf = await loadingTask.promise;
  const totalPages = cachedPdf.numPages;

  setProgress(`Scanning ${totalPages} pages for plans...`, 20);

  // Extract raw items for multi-plan detection
  cachedPagesRaw = [];
  for (let i = 1; i <= totalPages; i++) {
    const pct = 20 + Math.round((i / totalPages) * 30);
    setProgress(`Scanning page ${i} of ${totalPages}...`, pct);
    const page = await cachedPdf.getPage(i);
    const rawPage = await extractPageRaw(page, i - 1);
    cachedPagesRaw.push(rawPage);
  }

  setProgress('Detecting plans...', 55);

  // Detect multiple plans
  return MultiPlan.detectMultiplePlans(cachedPagesRaw);
}

/**
 * Phase 2: Extract benefits from PDF, optionally filtering for a specific plan.
 */
async function extractFromPDF(url, selectedPlan) {
  if (!cachedPdf) {
    // If no cached PDF, load fresh (shouldn't happen in normal flow)
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
    setProgress('Fetching PDF from URL...', 10);
    const loadingTask = pdfjsLib.getDocument({ url: url, verbosity: 0 });
    cachedPdf = await loadingTask.promise;
  }

  const totalPages = cachedPdf.numPages;
  setProgress(`Extracting ${totalPages} pages...`, 60);

  const allPages = [];
  for (let i = 1; i <= totalPages; i++) {
    const pct = 60 + Math.round((i / totalPages) * 25);
    setProgress(`Extracting page ${i} of ${totalPages}...`, pct);
    const page = await cachedPdf.getPage(i);
    const pageData = await TableExtract.extractPageStructured(page);
    allPages.push(pageData);
  }

  setProgress('Parsing benefit data...', 88);

  // Filter for selected plan if provided
  let pagesToParse = allPages;
  if (selectedPlan) {
    pagesToParse = MultiPlan.filterForPlan(allPages, selectedPlan, cachedPagesRaw);
  }

  // Parse using the structured data
  const result = SOBParser.parse(pagesToParse);

  setProgress('Finalizing...', 95);

  return result;
}

// ─── UI: Display Results ──────────────────────────────────────────────────────
// Display fields — matches the Step 18 Quick Benefits Recap sales script order
const DISPLAY_FIELDS = [
  // Extra Benefits (Read Sales Call Notes) — presented first
  { section: 'EXTRA BENEFITS' },
  { key: 'hearingAllowance', label: 'Hearing' },
  { key: 'foodFlexCard', label: 'Food Card' },
  { key: 'dentalAllowance', label: 'Dental' },
  { key: 'visionAllowance', label: 'Vision' },
  { key: 'transportation', label: 'Transportation' },
  { key: 'otcAllowance', label: 'OTC' },

  // Must Present All Medical Copays
  { section: 'MEDICAL COPAYS & CO-INSURANCES' },
  { key: 'planPremium', label: 'Plan Premium' },
  { key: 'moop', label: 'MOOP' },
  { key: 'urgentCopay', label: 'Urgent Care Copay' },
  { key: 'erCopay', label: 'Emergency Room Copay' },
  { key: 'hospitalCopay', label: 'Hospital Copay' },
  { key: 'pcpCopay', label: 'PCP Copay' },
  { key: 'specialistCopay', label: 'Specialist Copay' },
  { key: 'preventiveCare', label: 'Preventive Care' },

  // Must Present If Applicable
  { section: 'IF APPLICABLE' },
  { key: 'partBReduction', label: 'Part B Premium Reduction' },
  { key: 'medDeductible', label: 'Medical Deductible' },
  { key: 'rxDeductible', label: 'Rx Deductible' }
];

function renderResults(data) {
  extractedData = data;

  document.getElementById('plan-name-display').textContent = data.planName || 'Unknown Plan';

  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';

  for (const field of DISPLAY_FIELDS) {
    if (field.section) {
      const header = document.createElement('div');
      header.className = 'section-header';
      header.textContent = field.section;
      grid.appendChild(header);
      continue;
    }

    // Skip hidden fields (e.g. Food/Flex on Extra Supports Wallet plans)
    if (data[field.key] === '__HIDE__') continue;

    const row = document.createElement('div');
    row.className = 'result-row';

    const label = document.createElement('div');
    label.className = 'result-label';
    label.textContent = field.label;

    const value = document.createElement('div');
    value.className = 'result-value';
    const val = data[field.key] || 'Not found';
    value.textContent = val;

    // Color-code values
    if (val === 'Not found') {
      value.classList.add('warn');
    } else if (val === 'N/A' || val === 'Not covered') {
      value.classList.add('na');
    } else if (val.includes('$0') && !val.includes('-')) {
      value.classList.add('highlight');
    }

    row.appendChild(label);
    row.appendChild(value);
    grid.appendChild(row);
  }

  showState('results');
  setStatus(`Extracted ${countFound(data)} of ${countFields()} fields`, 'green');
}

function countFound(data) {
  return DISPLAY_FIELDS.filter(f => f.key && data[f.key] && data[f.key] !== 'Not found' && data[f.key] !== '__HIDE__').length;
}

function countFields() {
  return DISPLAY_FIELDS.filter(f => f.key).length;
}

// ─── Clipboard ────────────────────────────────────────────────────────────────
function formatForClipboard(data) {
  const now = new Date();
  const date = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

  let text = `STEP 18 - QUICK BENEFITS RECAP\n`;
  text += `Plan: ${data.planName || 'Unknown'}\n`;
  text += `Extracted: ${date}\n\n`;

  // Extra Benefits (Read Sales Call Notes)
  text += `--- EXTRA BENEFITS ---\n`;
  text += `Hearing: ${data.hearingAllowance || 'Not found'}\n`;
  if (data.foodFlexCard && data.foodFlexCard !== '__HIDE__') {
    text += `Food Card: ${data.foodFlexCard || 'Not found'}\n`;
  }
  text += `Dental: ${data.dentalAllowance || 'Not found'}\n`;
  text += `Vision: ${data.visionAllowance || 'Not found'}\n`;
  text += `Transportation: ${data.transportation || 'Not found'}\n`;
  text += `OTC: ${data.otcAllowance || 'Not found'}\n`;

  // Must Present All Medical Copays
  text += `\n--- MEDICAL COPAYS & CO-INSURANCES ---\n`;
  text += `Plan Premium: ${data.planPremium || 'Not found'}\n`;
  text += `MOOP: ${data.moop || 'Not found'}\n`;
  text += `Urgent Care Copay: ${data.urgentCopay || 'Not found'}\n`;
  text += `Emergency Room Copay: ${data.erCopay || 'Not found'}\n`;
  text += `Hospital Copay: ${data.hospitalCopay || 'Not found'}\n`;
  text += `PCP Copay: ${data.pcpCopay || 'Not found'}\n`;
  text += `Specialist Copay: ${data.specialistCopay || 'Not found'}\n`;
  text += `Preventive Care: ${data.preventiveCare || 'Not found'}\n`;

  // Must Present If Applicable
  text += `\n--- IF APPLICABLE ---\n`;
  text += `Part B Premium Reduction: ${data.partBReduction || 'N/A'}\n`;
  text += `Medical Deductible: ${data.medDeductible || '$0'}\n`;
  text += `Rx Deductible: ${data.rxDeductible || '$0'}\n`;

  return text;
}

async function copyToClipboard() {
  if (!extractedData) return;

  try {
    const text = formatForClipboard(extractedData);
    await navigator.clipboard.writeText(text);

    const label = document.getElementById('copy-label');
    label.textContent = 'Copied!';
    document.getElementById('btn-copy').classList.add('copied');
    setTimeout(() => {
      label.textContent = 'Copy to Clipboard';
      document.getElementById('btn-copy').classList.remove('copied');
    }, 2000);
  } catch (e) {
    // Fallback: use textarea
    const textarea = document.createElement('textarea');
    textarea.value = formatForClipboard(extractedData);
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    const label = document.getElementById('copy-label');
    label.textContent = 'Copied!';
    setTimeout(() => { label.textContent = 'Copy to Clipboard'; }, 2000);
  }
}

// ─── Main Extract Action ──────────────────────────────────────────────────────
async function doExtract() {
  if (!currentTabUrl) return;

  // Reset cached data
  detectedPlans = [];
  cachedPagesRaw = null;
  cachedPdf = null;

  showState('loading');
  setStatus('Scanning PDF...', 'blue');
  setProgress('Starting scan...', 0);

  try {
    // Phase 1: Load and detect plans
    detectedPlans = await loadAndDetectPlans(currentTabUrl);

    if (detectedPlans.length > 1) {
      // Multi-plan PDF — show plan selection UI
      const selector = document.getElementById('plan-selector');
      selector.innerHTML = '';
      for (let i = 0; i < detectedPlans.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = detectedPlans[i].name;
        selector.appendChild(option);
      }
      setStatus(`${detectedPlans.length} plans detected — select one`, 'green');
      showState('plan-select');
    } else {
      // Single-plan PDF — extract immediately
      setStatus('Extracting benefits...', 'blue');
      const data = await extractFromPDF(currentTabUrl, null);
      setProgress('Done!', 100);
      renderResults(data);
    }
  } catch (e) {
    console.error('Extraction error:', e);
    document.getElementById('error-msg').textContent = `Error: ${e.message || e}`;
    setStatus('Extraction failed', 'red');
    showState('error');
  }
}

async function doExtractSelectedPlan() {
  const selector = document.getElementById('plan-selector');
  const planIndex = parseInt(selector.value);
  const selectedPlan = detectedPlans[planIndex];

  if (!selectedPlan) return;

  showState('loading');
  setStatus(`Extracting ${selectedPlan.name}...`, 'blue');
  setProgress('Extracting plan data...', 55);

  try {
    const data = await extractFromPDF(currentTabUrl, selectedPlan);
    setProgress('Done!', 100);
    renderResults(data);
  } catch (e) {
    console.error('Extraction error:', e);
    document.getElementById('error-msg').textContent = `Error: ${e.message || e}`;
    setStatus('Extraction failed', 'red');
    showState('error');
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkCurrentTab();

  document.getElementById('btn-extract').addEventListener('click', doExtract);
  document.getElementById('btn-extract-plan').addEventListener('click', doExtractSelectedPlan);
  document.getElementById('btn-retry').addEventListener('click', doExtract);
  document.getElementById('btn-reextract').addEventListener('click', doExtract);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
});
