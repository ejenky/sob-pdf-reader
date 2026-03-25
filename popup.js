// popup.js — Medicare SOB Extractor v1.2
// Orchestrator: ties PDF loading, spatial extraction, and SOB parsing together

// ─── State Management ────────────────────────────────────────────────────────
let currentTabUrl = null;
let extractedData = null;
const states = ['no-pdf', 'setup', 'ready', 'loading', 'error', 'results'];

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
async function extractFromPDF(url) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

  setProgress('Fetching PDF from URL...', 10);
  const loadingTask = pdfjsLib.getDocument({ url: url, verbosity: 0 });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  setProgress(`Loading ${totalPages} pages...`, 20);

  const allPages = [];

  for (let i = 1; i <= totalPages; i++) {
    const pct = 20 + Math.round((i / totalPages) * 50);
    setProgress(`Extracting page ${i} of ${totalPages}...`, pct);

    const page = await pdf.getPage(i);

    // Use spatial table extraction (the key accuracy improvement)
    const pageData = await TableExtract.extractPageStructured(page);
    allPages.push(pageData);
  }

  setProgress('Parsing benefit data (structured)...', 75);

  // Parse using the structured data
  const result = SOBParser.parse(allPages);

  setProgress('Finalizing...', 95);

  return result;
}

// ─── UI: Display Results ──────────────────────────────────────────────────────
const DISPLAY_FIELDS = [
  // Section: Costs & Premiums
  { section: 'COSTS & PREMIUMS' },
  { key: 'planPremium', label: 'Plan Premium' },
  { key: 'partBReduction', label: 'Part B Reduction' },
  { key: 'moop', label: 'MOOP (Max Out-of-Pocket)' },
  { key: 'medDeductible', label: 'Medical Deductible' },
  { key: 'rxDeductible', label: 'Rx Deductible' },

  // Section: Medical Visits
  { section: 'MEDICAL VISITS' },
  { key: 'pcpCopay', label: 'PCP Copay' },
  { key: 'specialistCopay', label: 'Specialist Copay' },
  { key: 'preventiveCare', label: 'Preventive Care' },
  { key: 'erCopay', label: 'Emergency Room' },
  { key: 'urgentCopay', label: 'Urgent Care' },
  { key: 'hospitalCopay', label: 'Hospital (Inpatient)' },

  // Section: Extra Benefits
  { section: 'EXTRA BENEFITS' },
  { key: 'otcAllowance', label: 'OTC Allowance' },
  { key: 'foodFlexCard', label: 'Food/Flex Card' },
  { key: 'dentalAllowance', label: 'Dental' },
  { key: 'visionAllowance', label: 'Vision' },
  { key: 'hearingAllowance', label: 'Hearing' },
  { key: 'transportation', label: 'Transportation' }
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

  let text = 'MEDICARE PLAN BENEFIT SUMMARY\n';
  text += `Plan: ${data.planName || 'Unknown'}\n`;
  text += `Extracted: ${date}\n\n`;

  for (const field of DISPLAY_FIELDS) {
    if (field.section) {
      text += `\n--- ${field.section} ---\n`;
      continue;
    }
    const val = data[field.key] || 'Not found';
    if (val === '__HIDE__') continue;
    text += `${field.label}: ${val}\n`;
  }

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

  showState('loading');
  setStatus('Extracting benefits...', 'blue');
  setProgress('Starting extraction...', 0);

  try {
    const data = await extractFromPDF(currentTabUrl);
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
  document.getElementById('btn-retry').addEventListener('click', doExtract);
  document.getElementById('btn-reextract').addEventListener('click', doExtract);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
});
