// background.js - Medicare SOB Extractor
// Watches for PDF tabs and badges the extension icon

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const url = tab.url.toLowerCase();
    const isPDF = url.endsWith('.pdf') || url.includes('.pdf?') || url.includes('.pdf#') || url.includes('content-type=application/pdf');

    if (isPDF) {
      chrome.action.setBadgeText({ text: 'PDF', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    const url = tab.url.toLowerCase();
    const isPDF = url.endsWith('.pdf') || url.includes('.pdf?') || url.includes('.pdf#') || url.includes('content-type=application/pdf');

    if (isPDF) {
      chrome.action.setBadgeText({ text: 'PDF', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch (e) {}
});
