const GET_PROGRESS_MESSAGE_TYPE = "get-progress";
const RECORD_PROGRESS_MESSAGE_TYPE = "record-progress";
const TAB_ID_REQUEST_MESSAGE_TYPE = "what-is-my-tabid";
// STATUS_MESSAGE_TYPE defined in src/status-report.js, loaded via manifest.json
const UNREPORTED_MESSAGE_TYPES = new Set([
  STATUS_MESSAGE_TYPE, GET_PROGRESS_MESSAGE_TYPE, RECORD_PROGRESS_MESSAGE_TYPE, TAB_ID_REQUEST_MESSAGE_TYPE,
]);
const START_JOB_MESSAGE_TYPE = "start-job";
const SAVE_LOG_MESSAGE_TYPE = "save-log";
const ARM_CAPTURE_MESSAGE_TYPE = "arm_capture_for_tab";
const CAPTURE_LINK_MESSAGE_TYPE = "download_pdf_via_tab_capture";
const MESSAGE_HANDLERS = new Map([
  [STATUS_MESSAGE_TYPE, handleStatusMessage],
  [GET_PROGRESS_MESSAGE_TYPE, handleGetProgressMessage],
  [RECORD_PROGRESS_MESSAGE_TYPE, handleRecordProgressMessage],
  [TAB_ID_REQUEST_MESSAGE_TYPE, handleTabIdRequestMessage],
  [START_JOB_MESSAGE_TYPE, handleStartJobMessage],
  [SAVE_LOG_MESSAGE_TYPE, handleSaveLogMessage],
  [ARM_CAPTURE_MESSAGE_TYPE, handleArmCaptureMessage],
  [CAPTURE_LINK_MESSAGE_TYPE, handleCaptureLinkMessage],
]);

const ALL_RESPONSES_FILTER = { urls: ["<all_urls>"] };
const RESPONSE_LISTENER_OPTIONS = ["blocking", "responseHeaders"];

let captureSession = null;
let downloadLog = "";
let jobPageCounter = 0;
let pageLoadTimeoutId = null;

// main entry point, called from penultimate line
function registerBackgroundListeners() {
  browser.webRequest.onHeadersReceived.addListener(handleResponseHeaders, ALL_RESPONSES_FILTER, RESPONSE_LISTENER_OPTIONS);
  // function calls preceded by self involve functions defined elsewhere
  browser.downloads.onChanged.addListener(self.processDownloadChange);
  browser.runtime.onMessage.addListener(handleMessage);
}

function handleResponseHeaders(responseDetails) {
  if (self.isCapturingPdfInTab(captureSession, responseDetails.tabId)) {
    self.storeDetailsInSessionData(responseDetails);
    captureIfPdfResponse(responseDetails);
  }
}

function captureIfPdfResponse(responseDetails) {
  if (self.isPdfResponse(responseDetails)) {
    captureIncomingPdf(responseDetails);
  }
}

function captureIncomingPdf(responseDetails) {
  markPdfDetected(responseDetails.url);
  if (self.retrievingAttachment(responseDetails)) {
    reportBrowserDownload();
  } else {
    self.processIncomingPdfData(responseDetails);
  }
}

function markPdfDetected(pdfUrl) {
  captureSession.sawPdf = true;
  clearTimeout(captureSession.timeoutId);
  self.reportStatus("PDF response detected; capturing…");
  self.recordCapture(self.STATUS_SUCCESS, pdfUrl);
}

// Firefox cannot filter the data of a response that becomes a download
function reportBrowserDownload() {
  self.reportStatus(`Server forces PDF download; will use browser download to avoid duplicate (${captureSession.pageCounter})`);
}

function handleMessage(message, sender) {
  const messageHandler = MESSAGE_HANDLERS.get(message?.type);
  if (messageHandler) {
    reportReceivedMessage(message.type);
    return messageHandler(message, sender);
  } else {
    self.reportStatus(`onMessage: cannot process message: ${message?.type}`, true);
  }
}

function reportReceivedMessage(messageType) {
  if (!UNREPORTED_MESSAGE_TYPES.has(messageType)) {
    self.reportStatus(`received message: ${messageType}`);
  }
}

function handleStatusMessage(message) {
  self.reportStatus(`status: ${message.text}`);
}

function handleGetProgressMessage() {
  return Promise.resolve({ html: self.renderProgressTableHtml() });
}

function handleRecordProgressMessage(message) {
  self.recordContentProgress(message);
  return Promise.resolve();
}

function handleTabIdRequestMessage(message, sender) {
  return Promise.resolve({ tabId: readSenderTabId(sender) });
}

function handleStartJobMessage(message) {
  return self.startJob(message.doi);
}

function handleSaveLogMessage() {
  return self.saveLog(downloadLog);
}

function handleArmCaptureMessage(message) {
  return self.armCaptureOnly(message.doi, message.tabId);
}

function handleCaptureLinkMessage(message, sender) {
  const tabId = message.tabId || readSenderTabId(sender);
  if (tabId && !isPreviouslyVisitedUrl(message.pdfUrl)) {
    return self.armCaptureAndNavigate(message.doi, tabId, message.pdfUrl);
  } else {
    reportRejectedCaptureLink(tabId, message.pdfUrl);
  }
}

function reportRejectedCaptureLink(tabId, pdfUrl) {
  if (tabId) {
    self.reportStatus(`skipping already processed url: ${pdfUrl}`);
  } else {
    self.reportStatus("Cannot download: missing tabId.", true);
  }
}

function readSenderTabId(sender) {
  return sender?.tab?.id ?? null;
}

function isPreviouslyVisitedUrl(pdfUrl) {
  return captureSession?.lastMainUrl === pdfUrl;
}

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    registerBackgroundListeners, handleResponseHeaders, handleMessage,
    GET_PROGRESS_MESSAGE_TYPE, RECORD_PROGRESS_MESSAGE_TYPE, TAB_ID_REQUEST_MESSAGE_TYPE,
    START_JOB_MESSAGE_TYPE, SAVE_LOG_MESSAGE_TYPE, ARM_CAPTURE_MESSAGE_TYPE, CAPTURE_LINK_MESSAGE_TYPE,
    get captureSession() { return captureSession; },
    set captureSession(session) { captureSession = session; },
  };
}
/* istanbul ignore next */
if (typeof browser !== "undefined" && browser.webRequest) {
  registerBackgroundListeners();
}
