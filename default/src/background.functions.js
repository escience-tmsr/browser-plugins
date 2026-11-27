const CAPTURE_TIMEOUT_MS = 15000;
const PAGE_LOAD_TIMEOUT_MS = 30000;
const PAGE_LOAD_PENDING_REASON = "waiting for the page to load";
const OBJECT_URL_LIFETIME_MS = 30000;
const DOI_RESOLVER_URL = "https://doi.org/";
const MAX_DOI_LENGTH = 100;
const SEARCH_PHRASES = ["PDF", "download"];
const FIRST_PAGE_NUMBER = 1;
const PROGRESS_STAGE_PAGE = "page";
const PROGRESS_STAGE_PDF_LINK = "pdf-link";
const PROGRESS_UPDATE_MESSAGE_TYPE = "progress-update";
const PAYWALL_URL_WORDS = ["paywall", "subscribe", "purchase", "checkout", "cart", "basket", "login", "signin", "account"];
const PDF_CONTENT_TYPE = "application/pdf";
const HTML_CONTENT_TYPE = "text/html";
const CSV_CONTENT_TYPE = "text/csv";
const LOG_FILENAME = "downloaded_pdfs.csv";
const MAIN_FRAME_REQUEST_TYPE = "main_frame";
const COMPLETE_DOWNLOAD_STATE = "complete";
const FINISHED_DOWNLOAD_STATES = new Set([COMPLETE_DOWNLOAD_STATE, "interrupted"]);
const ACCESS_DENIED_STATUS_CODES = new Set([401, 403]);

// global variables captureSession, downloadLog, jobPageCounter and pageLoadTimeoutId are declared in background-listeners.js
// browser, clearTimeout, setTimeout, Blob and URL are provided by the environment
// calls to functions preceded by self involve functions defined in other files

// startJob is an entry point function
function startJob(doi) {
  self.reportStatus("Entering startJob");
  const normalizedDoi = sanitizeDoi(doi);
  if (normalizedDoi) {
    return startJobForDoi(normalizedDoi);
  } else {
    return rejectInvalidDoi(doi);
  }
}

function startJobForDoi(normalizedDoi) {
  const doiUrl = DOI_RESOLVER_URL + normalizedDoi;
  jobPageCounter = 0;
  startPageLoadWatch(normalizedDoi, doiUrl);
  showStatusTable();
  return openDoiPageInBackgroundTab(normalizedDoi, doiUrl);
}

function rejectInvalidDoi(doi) {
  const invalidDoiMessage = `Invalid DOI: "${doi}"`;
  self.reportStatus(`Could not start job: ${invalidDoiMessage}`, true);
  return Promise.reject(new Error(invalidDoiMessage));
}

// a DOI page that fails to load runs no content script, so only this timeout can report it
function startPageLoadWatch(doi, doiUrl) {
  clearTimeout(pageLoadTimeoutId);
  recordProgressStage(doi, FIRST_PAGE_NUMBER, self.STAGE_PUBLISHER_PAGE, `${self.STATUS_PENDING}: ${PAGE_LOAD_PENDING_REASON}`, doiUrl);
  pageLoadTimeoutId = setTimeout(() => markPageLoadFailed(doi, doiUrl), PAGE_LOAD_TIMEOUT_MS);
}

function markPageLoadFailed(doi, doiUrl) {
  pageLoadTimeoutId = null;
  recordProgressStage(doi, FIRST_PAGE_NUMBER, self.STAGE_PUBLISHER_PAGE, `${self.STATUS_ACCESS_ERROR}: page did not load`, doiUrl);
  self.reportStatus(`❌ DOI page did not load: ${doiUrl}`, true);
}

function showStatusTable() {
  self.openOrFocusStatusTab().catch((error) => {
    self.reportStatus(`Could not open status table: ${readErrorMessage(error)}`, true);
  });
}

function openDoiPageInBackgroundTab(normalizedDoi, doiUrl) {
  return browser.tabs.create({ url: doiUrl, active: false })
    .then((createdTab) => storeJobForTab(normalizedDoi, doiUrl, createdTab))
    .catch((error) => {
      self.reportStatus(`Could not start job: ${readErrorMessage(error)}`, true);
    });
}

function storeJobForTab(normalizedDoi, doiUrl, createdTab) {
  self.reportStatus(`Opened DOI page in tab ${createdTab.id}. Looking for "${SEARCH_PHRASES}" link…`);
  return browser.storage.local.set({ job: createJob(normalizedDoi, doiUrl, createdTab.id) });
}

function createJob(normalizedDoi, doiUrl, tabId) {
  return { url: doiUrl, phrase: SEARCH_PHRASES, doi: normalizedDoi, usedUrls: [], tabId };
}

function readErrorMessage(error) {
  return error?.message || error;
}

// recordContentProgress is an entry point function
function recordContentProgress(progressMessage) {
  const contentPageNumber = jobPageCounter + 1;
  if (progressMessage.stage === PROGRESS_STAGE_PAGE) {
    cancelPageLoadTimeout();
    recordProgressStage(progressMessage.doi, contentPageNumber, self.STAGE_PUBLISHER_PAGE, self.STATUS_SUCCESS, progressMessage.url);
  } else if (progressMessage.stage === PROGRESS_STAGE_PDF_LINK) {
    recordProgressStage(progressMessage.doi, contentPageNumber, self.STAGE_PDF_LINK, readLinkStatus(progressMessage), progressMessage.url);
  }
}

function cancelPageLoadTimeout() {
  clearTimeout(pageLoadTimeoutId);
  pageLoadTimeoutId = null;
}

function readLinkStatus(progressMessage) {
  if (progressMessage.found) {
    return self.STATUS_SUCCESS;
  } else {
    return self.STATUS_NOT_FOUND;
  }
}

// armCaptureAndNavigate is an entry point function
function armCaptureAndNavigate(doi, tabId, expectedUrl) {
  self.reportStatus(`Entering armCaptureAndNavigate for ${expectedUrl}`);
  armCapture(doi, tabId, expectedUrl);
  return browser.tabs.update(tabId, { url: expectedUrl });
}

// armCaptureOnly is an entry point function
function armCaptureOnly(doi, tabId) {
  self.reportStatus("Entering armCaptureOnly");
  armCapture(doi, tabId, null);
  return Promise.resolve(true);
}

// arming capture only involves fetching PDF files, not HTML files
function armCapture(doi, tabId, expectedUrl) {
  closePreviousCapture(captureSession);
  jobPageCounter++;
  captureSession = createCaptureSession(doi, tabId, expectedUrl, jobPageCounter);
  captureSession.timeoutId = startCaptureTimeout(captureSession);
  const targetType = guessTargetType(expectedUrl, captureSession.pageCounter);
  self.reportStatus(`Armed capture; navigating to ${targetType}… (${captureSession.pageCounter})`);
  return targetType;
}

function closePreviousCapture(previousSession) {
  if (previousSession) {
    clearTimeout(previousSession.timeoutId);
    recordStoppedCapture(previousSession);
  }
}

function recordStoppedCapture(previousSession) {
  if (!previousSession.sawPdf) {
    recordCapture(`${self.STATUS_SKIPPED}: capture stopped by new capture on page ${jobPageCounter + 1}`,
                       readSessionUrl(previousSession), previousSession);
  }
}

function createCaptureSession(doi, tabId, expectedUrl, pageCounter) {
  return {
    tabId,
    doi,
    expectedUrl,
    sawPdf: false,
    timeoutId: null,
    pageCounter,
    lastMainUrl: null,
    lastMainStatus: null,
    lastMainContentType: null,
  };
}

function endCaptureSession() {
  captureSession = null;
}

function startCaptureTimeout(runningSession) {
  return setTimeout(() => handleCaptureTimeout(runningSession), CAPTURE_TIMEOUT_MS);
}

function handleCaptureTimeout(runningSession) {
  const sessionUrl = readSessionUrl(runningSession) || "";
  const missingPdfFailure = explainMissingPdf(runningSession, sessionUrl);
  if (missingPdfFailure) {
    recordCaptureFailure(missingPdfFailure.failureStatus, missingPdfFailure.failureReason, sessionUrl, runningSession);
    endCaptureSession();
  }
}

function explainMissingPdf(runningSession, sessionUrl) {
  const statusCode = runningSession.lastMainStatus;
  const contentType = runningSession.lastMainContentType || "";
  if (ACCESS_DENIED_STATUS_CODES.has(statusCode)) {
    return { failureStatus: self.STATUS_ACCESS_ERROR, failureReason: `Access denied (${statusCode}) — likely paywall/login required.` };
  } else if (contentType.includes(HTML_CONTENT_TYPE) && isPaywallUrl(sessionUrl)) {
    return { failureStatus: self.STATUS_ACCESS_ERROR, failureReason: "Redirected to a paywall/purchase/login page (no PDF served)." };
  } else if (contentType.includes(HTML_CONTENT_TYPE)) {
    return { failureStatus: self.STATUS_ACCESS_ERROR, failureReason: "Received HTML instead of PDF (likely paywall/login)." };
  } else if (!runningSession.sawPdf) {
    return { failureStatus: self.STATUS_NOT_FOUND, failureReason: "No PDF response detected (possible paywall/login or blocked access)." };
  } else {
    return null;
  }
}

function readSessionUrl(sessionWithUrls) {
  return sessionWithUrls.lastMainUrl || sessionWithUrls.expectedUrl;
}

function guessTargetType(expectedUrl, pageCounter) {
  if (pageCounter === 1 && expectedUrl !== null) {
    return guessTargetTypeFromUrl(expectedUrl);
  } else {
    return "unknown";
  }
}

function guessTargetTypeFromUrl(expectedUrl) {
  const lowerCaseUrl = expectedUrl.toLowerCase();
  if (lowerCaseUrl.includes("download") || lowerCaseUrl.includes("pdf")) {
    return "PDF";
  } else {
    return "HTML";
  }
}

// isCapturingPdfInTab is an entry point function
function isCapturingPdfInTab(captureSession, tabId) {
  return Boolean(captureSession && tabId === captureSession.tabId);
}

// storeDetailsInSessionData is an entry point function
function storeDetailsInSessionData(captureSession, responseDetails) {
  if (responseDetails.type === MAIN_FRAME_REQUEST_TYPE) {
    captureSession.lastMainUrl = responseDetails.url;
    captureSession.lastMainStatus = responseDetails.statusCode;
    captureSession.lastMainContentType = readHeaderValue(responseDetails, "content-type");
  }
}

// isPdfResponse is an entry point function
function isPdfResponse(responseDetails) {
  return readHeaderValue(responseDetails, "content-type").includes(PDF_CONTENT_TYPE);
}

// isAttachmentResponse is an entry point function
function isAttachmentResponse(responseDetails) {
  return readHeaderValue(responseDetails, "content-disposition").includes("attachment");
}

function readHeaderValue(responseDetails, headerName) {
  const responseHeaders = responseDetails.responseHeaders || [];
  const matchingHeader = responseHeaders.find((responseHeader) => responseHeader.name.toLowerCase() === headerName);
  return (matchingHeader?.value || "").toLowerCase();
}

// processIncomingPdfData is an entry point function
function processIncomingPdfData(pdfCaptureSession, responseDetails) {
  const pdfFilename = makePdfFilename(pdfCaptureSession.doi);
  const responseFilter = browser.webRequest.filterResponseData(responseDetails.requestId);
  const pdfChunks = [];
  responseFilter.ondata = (dataEvent) => {
    responseFilter.write(dataEvent.data);
    pdfChunks.push(dataEvent.data);
  };
  responseFilter.onstop = () => savePdfChunks(responseFilter, pdfChunks, pdfFilename, pdfCaptureSession);
  responseFilter.onerror = () => failBrokenTransfer(responseFilter, pdfFilename, pdfCaptureSession);
}

async function savePdfChunks(responseFilter, pdfChunks, pdfFilename, pdfCaptureSession) {
  try {
    responseFilter.disconnect();
    await downloadAsFile(new Blob(pdfChunks, { type: PDF_CONTENT_TYPE }), { filename: pdfFilename, saveAs: false });
  } catch (error) {
    failPdfDownload(pdfCaptureSession, pdfFilename, `Saving PDF failed: ${error.message}`);
  }
}

function failBrokenTransfer(responseFilter, pdfFilename, pdfCaptureSession) {
  if (isCurrentCaptureSession(pdfCaptureSession)) {
    failPdfDownload(pdfCaptureSession, pdfFilename, `PDF transfer stopped: ${responseFilter.error}`);
  }
}

function failPdfDownload(pdfCaptureSession, pdfFilename, failureReason) {
  recordDownload(`${self.STATUS_ACCESS_ERROR}: ${failureReason}`, pdfFilename, pdfCaptureSession);
  failCapture(failureReason);
  if (isCurrentCaptureSession(pdfCaptureSession)) {
    endCaptureSession();
  }
}

// processDownloadChange is an entry point function
function processDownloadChange(downloadDelta) {
  if (isFinishedDownload(downloadDelta)) {
    return browser.downloads.search({ id: downloadDelta.id })
      .then(([downloadItem]) => recordFinishedDownload(downloadDelta, downloadItem));
  } else {
    return Promise.resolve();
  }
}

function isFinishedDownload(downloadDelta) {
  return FINISHED_DOWNLOAD_STATES.has(downloadDelta.state?.current);
}

function recordFinishedDownload(downloadDelta, downloadItem) {
  if (downloadItem && captureSession !== null && isCaptureDownload(captureSession, downloadItem)) {
    recordDownloadOutcome(captureSession, downloadDelta, downloadItem);
    endCaptureSession();
  }
}

function isCaptureDownload(captureSession, downloadItem) {
  return downloadItem.mime.includes(PDF_CONTENT_TYPE) || downloadItem.filename.endsWith(".pdf")
    || downloadItem.url === captureSession.lastMainUrl;
}

function recordDownloadOutcome(finishedSession, downloadDelta, downloadItem) {
  if (downloadDelta.state.current === COMPLETE_DOWNLOAD_STATE) {
    recordCompletedDownload(finishedSession, downloadItem);
  } else {
    recordInterruptedDownload(finishedSession, downloadDelta, downloadItem);
  }
}

function recordCompletedDownload(finishedSession, downloadItem) {
  self.reportStatus(`✅ Saved PDF to ${downloadItem.filename}`);
  recordDownload(self.STATUS_SUCCESS, readFileBasename(downloadItem.filename), finishedSession);
  downloadLog = downloadLog.concat(finishedSession.doi, ",", downloadItem.filename, "\n");
}

function recordInterruptedDownload(finishedSession, downloadDelta, downloadItem) {
  const interruptReason = `Download interrupted (${readInterruptReason(downloadDelta, downloadItem)})`;
  recordDownload(`${self.STATUS_ACCESS_ERROR}: ${interruptReason}`, readFileBasename(downloadItem.filename), finishedSession);
  failCapture(interruptReason);
}

function readInterruptReason(downloadDelta, downloadItem) {
  return downloadDelta.error?.current || downloadItem.error || "unknown reason";
}

function readFileBasename(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function isCurrentCaptureSession(candidateSession) {
  return captureSession === candidateSession;
}

function recordCaptureFailure(failureStatus, failureReason, targetUrl, recordedSession) {
  recordCapture(`${failureStatus}: ${failureReason}`, targetUrl, recordedSession);
  failCapture(failureReason);
}

function failCapture(failureReason) {
  self.reportStatus(`❌ PDF download failed: ${failureReason}`, true);
}

// recordCapture is an entry point function
function recordCapture(stageStatus, targetUrl, recordedSession) {
  recordProgressStage(recordedSession.doi, recordedSession.pageCounter, self.STAGE_PDF_CAPTURE, stageStatus, targetUrl);
}

function recordDownload(stageStatus, pdfFilename, recordedSession) {
  recordProgressStage(recordedSession.doi, recordedSession.pageCounter, self.STAGE_PDF_DOWNLOAD, stageStatus, pdfFilename);
}

function recordProgressStage(doi, pageNumber, stageName, stageStatus, stageResult) {
  self.recordStage(doi, pageNumber, stageName, stageStatus, stageResult);
  sendProgressUpdate();
}

// the status tab may be closed, so a missing receiver is ignored
function sendProgressUpdate() {
  browser.runtime.sendMessage({ type: PROGRESS_UPDATE_MESSAGE_TYPE, html: self.renderProgressTableHtml() }).catch(() => {});
}

// saveLog is an entry point function
async function saveLog(downloadLogCsv) {
  await downloadAsFile(new Blob([downloadLogCsv], { type: CSV_CONTENT_TYPE }), { filename: LOG_FILENAME, conflictAction: "uniquify" });
  self.reportStatus("Saved logfile to Downloads directory");
}

async function downloadAsFile(fileBlob, downloadOptions) {
  const fileObjectUrl = URL.createObjectURL(fileBlob);
  await browser.downloads.download({ url: fileObjectUrl, ...downloadOptions });
  setTimeout(() => URL.revokeObjectURL(fileObjectUrl), OBJECT_URL_LIFETIME_MS);
}

function makePdfFilename(doi) {
  return `${replaceSlashes(sanitizeDoi(doi))}.pdf`;
}

function sanitizeDoi(doi) {
  return doi
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^(https?:\/\/)?doi.org\//i, "")
    .replace(/[^a-z0-9._/-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_DOI_LENGTH);
}

function replaceSlashes(doi) {
  return doi.replace(/\/+/g, "_");
}

function isPaywallUrl(url) {
  return PAYWALL_URL_WORDS.some((paywallWord) => url.includes(paywallWord));
}

const exportedBackgroundFunctions = {
  armCapture, armCaptureAndNavigate, armCaptureOnly, failCapture, isAttachmentResponse, isCapturingPdfInTab,
  isPaywallUrl, isPdfResponse, makePdfFilename, processDownloadChange, processIncomingPdfData, recordCapture,
  recordCaptureFailure, recordContentProgress, recordDownload, replaceSlashes, sanitizeDoi, saveLog,
  sendProgressUpdate, startJob, startPageLoadWatch, storeDetailsInSessionData,
};

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    CAPTURE_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, PAGE_LOAD_PENDING_REASON, PROGRESS_UPDATE_MESSAGE_TYPE,
    ...exportedBackgroundFunctions,
  };
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exportedBackgroundFunctions);
}
