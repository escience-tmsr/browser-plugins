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
  const filename = `${self.removeSlashes(self.sanitizeDOI(session.doi))}.pdf`;
  dataFlow.onstop = async () => {
    try {
      dataFlow.disconnect();
      if (! session.expectBrowserDownload) {
        const blob = new Blob(chunks, { type: "application/pdf" });
        const objUrl = URL.createObjectURL(blob);
        await browser.downloads.download({ url: objUrl, filename, saveAs: false });
        setTimeout(() => URL.revokeObjectURL(objUrl), 30000);
      }
    } catch (e) {
      const reason = `Saving PDF failed: ${e.message}`;
      self.recordDownload(`${self.STATUS_ACCESS_ERROR}: ${reason}`, filename, session);
      self.failCapture(reason);
    }
  };
}


function armCaptureBase(doi, tabId, expectedUrl) {
  if (captureSession) {
    // The previous capture led to an HTML page instead of a PDF, and a link on that
    // page is being followed now: that page is the next page of the job.
    clearTimeout(captureSession.timeoutId);
    if (! captureSession.sawPdf) {
      self.recordCapture(`${self.STATUS_SKIPPED}: HTML page, searched as page ${jobPageCounter + 1}`,
                         captureSession.lastMainUrl || captureSession.expectedUrl);
    }
  }
  // The k-th capture of a job always follows a link found on page k (page 1 being the
  // page startJob opened), so counting captures counts pages.
  jobPageCounter++;
  captureSession = {
    tabId,
    doi,
    expectedUrl,
    sawPdf: false,
    timeoutId: null,
    pageCounter: jobPageCounter,
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
      recordCaptureFailure(self.STATUS_ACCESS_ERROR, `Access denied (${sc}) — likely paywall/login required.`, url);
      captureSession = null;
    } else if (ct.includes("text/html") && self.looksPaywalledUrl(url)) {
      recordCaptureFailure(self.STATUS_ACCESS_ERROR, "Redirected to a paywall/purchase/login page (no PDF served).", url);
      captureSession = null;
    } else if (ct.includes("text/html")) {
      recordCaptureFailure(self.STATUS_ACCESS_ERROR, "Received HTML instead of PDF (likely paywall/login).", url);
      captureSession = null;
    } else if (! captureSession.sawPdf) {
      recordCaptureFailure(self.STATUS_NOT_FOUND, "No PDF response detected (possible paywall/login or blocked access).", url);
      captureSession = null;
    }
  }, CAPTURE_TIMEOUT_MS);
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

  jobPageCounter = 0;
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

// Push the current progress table to the status tab, if it is open.
function sendProgressUpdate() {
  browser.runtime.sendMessage({ type: "progress-update", html: self.toHtml() }).catch(() => {});
}

function recordCapture(status, targetUrl, session = captureSession) {
  self.recordPdfCapture(session.doi, session.pageCounter, status, targetUrl);
  self.sendProgressUpdate();
}

function recordDownload(status, filename, session = captureSession) {
  self.recordPdfDownload(session.doi, session.pageCounter, status, filename);
  self.sendProgressUpdate();
}

function recordCaptureFailure(status, reason, targetUrl) {
  self.recordCapture(`${status}: ${reason}`, targetUrl);
  self.failCapture(reason);
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

module.exports = { CAPTURE_TIMEOUT_MS, armCaptureAndNavigate, armCaptureBase, armCaptureOnly, failCapture, inRetrievePdfSession,
                   looksPaywalledUrl, processIncomingPdfData, recordCapture, recordCaptureFailure, recordDownload,
                   removeSlashes, retrievingAttachment, retrievingPdfFile, sanitizeDOI, saveLog,
                   sendProgressUpdate, startJob, storeDetailsInSessionData };
if (typeof self !== "undefined") {
  self.armCaptureAndNavigate = armCaptureAndNavigate;
  self.armCaptureBase = armCaptureBase;
  self.armCaptureOnly = armCaptureOnly;
  self.failCapture = failCapture;
  self.inRetrievePdfSession = inRetrievePdfSession;
  self.looksPaywalledUrl = looksPaywalledUrl;
  self.processIncomingPdfData = processIncomingPdfData;
  self.recordCapture = recordCapture;
  self.recordCaptureFailure = recordCaptureFailure;
  self.recordDownload = recordDownload;
  self.removeSlashes = removeSlashes;
  self.retrievingAttachment = retrievingAttachment;
  self.retrievingPdfFile = retrievingPdfFile;
  self.sanitizeDOI = sanitizeDOI;
  self.saveLog = saveLog;
  self.sendProgressUpdate = sendProgressUpdate;
  self.startJob = startJob;
  self.storeDetailsInSessionData = storeDetailsInSessionData;
}
