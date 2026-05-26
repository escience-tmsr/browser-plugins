const CAPTURE_TIMEOUT_MS = 15000;
const phrase = ["PDF", "download"]
const IGNORE_WEBREQUEST_ERRORS = new Set([
  "NS_BINDING_ABORTED",
  "NS_ERROR_TRACKING_URI",
  "NS_ERROR_DOM_BAD_URI",
]);

function inRetrievePdfSession(tabId) {
  return Boolean(captureSession && tabId === captureSession.tabId);
}

function retrievingPdfFile(details) {
  const headers = details.responseHeaders || [];
  const contentType = (headers.find(h => h.name.toLowerCase() === "content-type")?.value || "").toLowerCase();
  return contentType.includes("application/pdf");
}

function storeDetailsInSessionData(details) {
  if (details.type === "main_frame") {
    captureSession.lastMainUrl = details.url;
    captureSession.lastMainStatus = details.statusCode;
    const headers = details.responseHeaders || [];
    const contentType = (headers.find(h => h.name.toLowerCase() === "content-type")?.value || "").toLowerCase();
    captureSession.lastMainContentType = contentType;
  }
}

function retrievingAttachment(details) {
  const headers = details.responseHeaders || [];
  const contentDisposition = (headers.find(h => h.name.toLowerCase() === "content-disposition")?.value || "").toLowerCase();
  return contentDisposition.includes("attachment");
}

function processIncomingPdfData(details) {
  const dataFlow = browser.webRequest.filterResponseData(details.requestId);
  const chunks = [];

  dataFlow.ondata = (e) => {
    dataFlow.write(e.data);
    chunks.push(e.data);
  };

  const session = captureSession;
  dataFlow.onstop = async () => {
    try {
      dataFlow.disconnect();
      if (! session.expectBrowserDownload) {
        const blob = new Blob(chunks, { type: "application/pdf" });
        const objUrl = URL.createObjectURL(blob);
        const filename = `${self.removeSlashes(self.sanitizeDOI(session.doi))}.pdf`;
        await browser.downloads.download({ url: objUrl, filename, saveAs: false });
        setTimeout(() => URL.revokeObjectURL(objUrl), 30000);
      }
    } catch (e) {
      self.failCapture(`Saving PDF failed: ${e.message}`);
    }
  };
}


function armCaptureBase(doi, tabId, expectedUrl) {
  captureSession = {
    tabId,
    doi,
    expectedUrl,
    sawPdf: false,
    timeoutId: null,
    pageCounter: 0,
    lastMainUrl: null,
    lastMainStatus: null,
    lastMainContentType: null,
  };
  captureSession.timeoutId = setTimeout(() => {
    if (! captureSession) return "cannot happen";

    const sc = captureSession.lastMainStatus || "";
    const ct = captureSession.lastMainContentType || "";
    const url = captureSession.lastMainUrl || captureSession.expectedUrl || "";

    if (sc === 401 || sc === 403) {
      self.failCapture(`Access denied (${sc}) — likely paywall/login required.`);
      captureSession = null;
    } else if (ct.includes("text/html") && self.looksPaywalledUrl(url)) {
      self.failCapture("Redirected to a paywall/purchase/login page (no PDF served).");
      captureSession = null;
    } else if (ct.includes("text/html")) {
      self.failCapture("Received HTML instead of PDF (likely paywall/login).");
      captureSession = null;
    } else if (! captureSession.sawPdf) {
      self.failCapture("No PDF response detected (possible paywall/login or blocked access).");
      captureSession = null;
    }
  }, CAPTURE_TIMEOUT_MS);
  captureSession.pageCounter++;
  if (captureSession.pageCounter > 1 || expectedUrl === null) {
    targetType = "unknown";
  } else {
    if (expectedUrl.toLowerCase().includes("download") || expectedUrl.toLowerCase().includes("pdf")) {
      targetType = "PDF";
    } else {
      targetType = "HTML";
    }
  }
  self.sendStatus(`Armed capture; navigating to ${targetType}… (${captureSession.pageCounter})`);
  return targetType;
}

function armCaptureAndNavigate(doi, tabId, expectedUrl) {
  self.sendStatus(`Entering armCaptureAndNavigate for ${expectedUrl}`);
  self.armCaptureBase(doi, tabId, expectedUrl);
  return browser.tabs.update(tabId, { url: expectedUrl });
}

function armCaptureOnly(doi, tabId, expectedUrl = null) {
  self.sendStatus(`Entering armCaptureOnly for ${expectedUrl}`);
  self.armCaptureBase(doi, tabId, expectedUrl);
  return Promise.resolve(true);
}

function sanitizeDOI(doi) {
  return doi
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^(https?:\/\/)?doi.org\//i, "")
    .replace(/[^a-z0-9._/-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function removeSlashes(doi) {
  return doi.replace(/\/+/g, "_");
}

function startJob(doi) {
  self.sendStatus("Entering startJob");
  const normalizedDoi = sanitizeDOI(doi) || null;
  const url = "https://doi.org/" + normalizedDoi;

  return browser.tabs.create({ url }).then(tab => {
    const job = {
      url,
      phrase,
      doi: normalizedDoi,
      usedUrls: [],
      tabId: tab.id
    };

    self.sendStatus(`Opened DOI page in tab ${tab.id}. Looking for "${phrase}" link…`);
    return browser.storage.local.set({ job });
  }).catch(err => {
    self.sendStatus(`Could not start job: ${err && err.message ? err.message : err}`, isError = true);
  });
}

function looksPaywalledUrl(u) {
  return ["paywall","subscribe","purchase","checkout","cart","basket","login","signin","account"]
    .some(k => u.includes(k));
}

function failCapture(reason) {
  self.sendStatus(`❌ PDF download failed: ${reason}`, isError = true);
  return
}

function saveLog(downloadLogCsv) {
  const blob = new Blob([downloadLogCsv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  browser.downloads.download({
    url,
    filename: "my_table.csv",
    conflictAction: "uniquify"
  });
  self.sendStatus("Saved logfile to Downloads directory");
}

module.exports = { armCaptureAndNavigate, armCaptureBase, armCaptureOnly, failCapture, inRetrievePdfSession,
                   looksPaywalledUrl, processIncomingPdfData, removeSlashes, retrievingAttachment, retrievingPdfFile, 
                   sanitizeDOI, saveLog, startJob, storeDetailsInSessionData };
if (typeof self !== "undefined") {
  self.armCaptureAndNavigate = armCaptureAndNavigate;
  self.armCaptureBase = armCaptureBase;
  self.armCaptureOnly = armCaptureOnly;
  self.failCapture = failCapture;
  self.inRetrievePdfSession = inRetrievePdfSession;
  self.looksPaywalledUrl = looksPaywalledUrl;
  self.processIncomingPdfData = processIncomingPdfData;
  self.removeSlashes = removeSlashes;
  self.retrievingAttachment = retrievingAttachment;
  self.retrievingPdfFile = retrievingPdfFile;
  self.sanitizeDOI = sanitizeDOI;
  self.saveLog = saveLog;
  self.startJob = startJob;
  self.storeDetailsInSessionData = storeDetailsInSessionData;
}
