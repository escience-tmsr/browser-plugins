const CAPTURE_TIMEOUT_MS = 15000;
const PAGE_LOAD_TIMEOUT_MS = 30000;
const PAGE_LOAD_PENDING_REASON = "waiting for the page to load";
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
  const session = captureSession;
  // The browser downloads this PDF itself, and processDownloadChange records how that
  // ends. Its data is not needed here, and Firefox cannot filter a response that becomes
  // a download (the filter fails with "Invalid request ID").
  if (session.expectBrowserDownload) return;

  const dataFlow = browser.webRequest.filterResponseData(details.requestId);
  const chunks = [];

  dataFlow.ondata = (e) => {
    dataFlow.write(e.data);
    chunks.push(e.data);
  };

  const filename = `${self.removeSlashes(self.sanitizeDOI(session.doi))}.pdf`;
  const failDownload = (reason) => {
    self.recordDownload(`${self.STATUS_ACCESS_ERROR}: ${reason}`, filename, session);
    self.failCapture(reason);
    if (captureSession === session) captureSession = null;
  };
  dataFlow.onstop = async () => {
    try {
      dataFlow.disconnect();
      const blob = new Blob(chunks, { type: "application/pdf" });
      const objUrl = URL.createObjectURL(blob);
      await browser.downloads.download({ url: objUrl, filename, saveAs: false });
      setTimeout(() => URL.revokeObjectURL(objUrl), 30000);
    } catch (e) {
      failDownload(`Saving PDF failed: ${e.message}`);
    }
  };
  // The response broke off before it was complete, e.g. because the page load was stopped.
  // Only while this capture is still the current one: a newer capture is not ended by it.
  dataFlow.onerror = () => {
    if (captureSession !== session) return;
    failDownload(`PDF transfer stopped: ${dataFlow.error}`);
  };
}

function isCaptureDownload(item) {
  return item.mime.includes("application/pdf") || item.filename.endsWith(".pdf")
    || item.url === captureSession.lastMainUrl;
}

// Record the outcome of a browser download of the captured PDF: saved, or interrupted
// (cancelled by the user, or a network or disk error). Either way the capture ends.
// A download that started in a tab watched for a download by hand is recorded there
// instead, even while a capture is armed.
async function processDownloadChange(delta) {
  const state = delta.state?.current;
  if (state !== "complete" && state !== "interrupted") return;

  const [item] = await browser.downloads.search({ id: delta.id });
  if (!item) return;
  // Firefox sends the reason with the change; the download item may not have it.
  const reason = `Download interrupted (${delta.error?.current || item.error || "unknown reason"})`;
  if (await self.recordAssistedDownload(item, state, reason)) return;
  if (captureSession === null || !isCaptureDownload(item)) return;
  const basename = fileNameOfPath(item.filename);
  if (state === "complete") {
    self.sendStatus(`✅ Saved PDF to ${item.filename}`);
    self.recordDownload(self.STATUS_SUCCESS, basename, captureSession, item.filename);
  } else {
    self.recordDownload(`${self.STATUS_ACCESS_ERROR}: ${reason}`, basename);
    self.failCapture(reason);
  }
  captureSession = null;
}


function armCaptureBase(doi, tabId, expectedUrl) {
  if (captureSession) {
    // The previous capture led to an HTML page instead of a PDF, and a link on that
    // page is being followed now: that page is the next page of the job.
    clearTimeout(captureSession.timeoutId);
    if (! captureSession.sawPdf) {
      self.recordCapture(`${self.STATUS_SKIPPED}: HTML page, searched as page ${jobPageCounter + 1}`,
                         captureSession.lastMainUrl || captureSession.expectedUrl, captureSession);
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
  self.seedPageLoadRow(normalizedDoi, url);
  // Keep the status tab in view: open the DOI page in a background tab, where it
  // loads and runs the content script as usual.
  self.openOrFocusStatusTab().catch(err => {
    self.sendStatus(`Could not open status table: ${err && err.message ? err.message : err}`, isError = true);
  });
  // The tab opens empty and only loads the DOI page once the job, with the tab's id, is
  // stored: checkRobotsBeforeRequest recognises the job's requests by that id, and would
  // miss the first one if the tab opened on the DOI page directly.
  return browser.tabs.create({ url: "about:blank", active: false }).then(tab => {
    const job = {
      url,
      phrase,
      doi: normalizedDoi,
      usedUrls: [],
      tabId: tab.id
    };

    self.sendStatus(`Opened DOI page in tab ${tab.id}. Looking for "${phrase}" link…`);
    return browser.storage.local.set({ job }).then(() => browser.tabs.update(tab.id, { url }));
  }).catch(err => {
    self.sendStatus(`Could not start job: ${err && err.message ? err.message : err}`, isError = true);
  });
}

// Blocking onBeforeRequest handler for page requests (main_frame): cancel a request in
// the job's tab that robots.txt does not allow (see docs/robots_txt_plan.md, section 3).
// Redirect targets arrive here as requests of their own. Requests in other tabs pass.
async function checkRobotsBeforeRequest(requestDetails) {
  const { job: storedJob } = await browser.storage.local.get("job");
  if (!storedJob || requestDetails.tabId !== storedJob.tabId) return {};
  let accessStatus;
  try {
    accessStatus = await self.robotsAccessAllowed(requestDetails.url);
  } catch (checkError) {
    // Without an answer the request is not known to be allowed, so it is cancelled.
    accessStatus = { accessAllowed: false, blockReason: `robots.txt check failed: ${checkError.message}` };
  }
  if (accessStatus.accessAllowed) return {};
  self.sendStatus(`🚫 Not visiting ${requestDetails.url}: ${accessStatus.blockReason}`, isError = true);
  // originUrl is the page that triggered the request, if a web page did.
  const requestedByPage = /^https?:/.test(requestDetails.originUrl || "");
  self.recordRobotsBlock(storedJob.doi, requestDetails.url, accessStatus.blockReason, requestedByPage);
  return { cancel: true };
}

// Record a request that robots.txt blocked in the progress table, as ACCESS_ERROR with
// the block reason (see docs/robots_txt_plan.md, section 5). Where the block goes:
// - a capture is armed (a followed link or a clicked button led here): its capture
//   cells, and the capture ends without waiting for its timeout;
// - a page went on to the blocked page by itself (a script or a meta refresh): the
//   capture cells of that page's row. Firefox stays on that page, whose content script
//   may still report it as loaded, in the page cells, before or after the block;
// - otherwise (the DOI page, its redirects, or an address typed in the tab): the page
//   cells of the current row if it is still waiting for its page, whose "page did not
//   load" timeout is then cancelled; if not, the page cells of a new row.
function recordRobotsBlock(jobDoi, blockedUrl, blockReason, requestedByPage) {
  const blockStatus = `${self.STATUS_ACCESS_ERROR}: ${blockReason}`;
  if (captureSession) {
    clearTimeout(captureSession.timeoutId);
    self.recordCapture(blockStatus, blockedUrl);
    captureSession = null;
    return;
  }
  if (requestedByPage) {
    self.recordPdfCapture(jobDoi, jobPageCounter + 1, blockStatus, blockedUrl);
    self.sendProgressUpdate();
    return;
  }
  if (pageLoadTimeoutId === null) {
    jobPageCounter++;
  }
  clearTimeout(pageLoadTimeoutId);
  pageLoadTimeoutId = null;
  self.recordPublisherPageAccess(jobDoi, jobPageCounter + 1, blockStatus, blockedUrl);
  self.sendProgressUpdate();
}

// Tabs opened from the progress table, watched for a PDF the user downloads by hand (see
// docs/assisted_download_plan.md, section 3). Kept in browser.storage.local, like the
// job, so they survive the extension being reloaded (tab numbers stay the same until
// Firefox restarts), as
// { [tabId]: { doi, clickedPageCounter, manualPageLabel, clickedUrl, pdfResponses } }.
const ASSISTED_TABS_KEY = "assistedTabs";
// Downloads that started in a watched tab, until they end (see attributeAssistedDownload),
// as { [downloadId]: { doi, clickedPageCounter, manualPageLabel, clickedUrl,
// expectedFileNames } }.
const ASSISTED_DOWNLOADS_KEY = "assistedDownloads";
// Added to the clicked row's page number to number the row of a manual take-over.
const MANUAL_PAGE_SUFFIX = " (by hand)";

// Changes to the stored watched tabs and downloads, one after the other: each reads a
// stored object and writes it back, and two at the same time would lose one change.
let assistedStorageUpdate = Promise.resolve();

// Apply changeStoredObject to the object stored under storageKey; it returns false when
// it changed nothing, so nothing needs to be written.
function updateAssistedStorage(storageKey, changeStoredObject) {
  assistedStorageUpdate = assistedStorageUpdate.then(async () => {
    const { [storageKey]: storedObject } = await browser.storage.local.get(storageKey);
    const assistedObject = storedObject || {};
    if (changeStoredObject(assistedObject) === false) return;
    await browser.storage.local.set({ [storageKey]: assistedObject });
  }).catch((updateError) => {
    self.sendStatus(`Could not update the watched tabs: ${updateError.message}`, isError = true);
  });
  return assistedStorageUpdate;
}

function updateAssistedTabs(changeAssistedTabs) {
  return updateAssistedStorage(ASSISTED_TABS_KEY, changeAssistedTabs);
}

function updateAssistedDownloads(changeAssistedDownloads) {
  return updateAssistedStorage(ASSISTED_DOWNLOADS_KEY, changeAssistedDownloads);
}

// Watch a tab the status tab opened for an address in the row (doi, pageCounter).
// Clicking an address in a manual row continues that row.
function watchAssistedTab(tabId, doi, pageCounter, clickedUrl) {
  const clickedPage = String(pageCounter);
  const clickedPageCounter = clickedPage.endsWith(MANUAL_PAGE_SUFFIX)
    ? clickedPage.slice(0, -MANUAL_PAGE_SUFFIX.length) : clickedPage;
  const manualPageLabel = clickedPageCounter + MANUAL_PAGE_SUFFIX;
  self.sendStatus(`👀 Watching tab ${tabId} for a PDF of ${doi}, to record in row "${manualPageLabel}"`);
  return updateAssistedTabs((assistedTabs) => {
    assistedTabs[tabId] = { doi, clickedPageCounter, manualPageLabel, clickedUrl, pdfResponses: [] };
  });
}

// tabs.onCreated: a tab opened from a watched tab, such as a publisher's "View PDF" tab,
// is watched for the same row.
function watchTabOpenedFromAssistedTab(createdTab) {
  if (createdTab.openerTabId === undefined) return Promise.resolve();
  return updateAssistedTabs((assistedTabs) => {
    const openerEntry = assistedTabs[createdTab.openerTabId];
    if (!openerEntry) return false;
    assistedTabs[createdTab.id] = { ...openerEntry, pdfResponses: [] };
  });
}

// tabs.onRemoved: a closed tab is no longer watched.
function forgetAssistedTab(closedTabId) {
  return updateAssistedTabs((assistedTabs) => {
    if (!(closedTabId in assistedTabs)) return false;
    delete assistedTabs[closedTabId];
  });
}

// runtime.onStartup: Firefox numbers tabs and downloads anew after a restart, so the
// stored ones could match unrelated tabs and downloads.
function clearAssistedTabs() {
  const clearStoredObject = (storedObject) => {
    if (Object.keys(storedObject).length === 0) return false;
    for (const storedKey of Object.keys(storedObject)) delete storedObject[storedKey];
  };
  updateAssistedDownloads(clearStoredObject);
  return updateAssistedTabs(clearStoredObject);
}

// Status texts of a manual take-over, after SUCCESS, PENDING or ACCESS_ERROR (see
// docs/assisted_download_plan.md, section 1).
const OPENED_BY_HAND = "opened by hand";
const VIEWED_BY_HAND = "viewed by hand";
const VIEWED_NOT_DOWNLOADED = "viewed, not downloaded yet";
const DOWNLOADED_BY_HAND = "downloaded by hand";
// Firefox's own PDF viewer saves a PDF from an address starting with this, without a
// referrer, so such a download cannot be matched by its address (plan, section 2).
const PDF_VIEWER_DOWNLOAD_PREFIX = "blob:resource://pdf.js/";
// The kinds of requests that can show a PDF: in a tab, or inside a page.
const PDF_RESPONSE_TYPES = new Set(["main_frame", "sub_frame", "object"]);

function fileNameOfPath(filePath) {
  return filePath.split(/[\\/]/).pop();
}

// The name Firefox gives a PDF it saves: the file name in the response's
// Content-Disposition header (encoded as filename*=UTF-8''... or plain), or else the last
// part of the address.
function pdfResponseFileName(responseDetails) {
  const headers = responseDetails.responseHeaders || [];
  const contentDisposition = headers.find((header) => header.name.toLowerCase() === "content-disposition")?.value || "";
  const encodedName = contentDisposition.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  const plainName = contentDisposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  const addressPath = responseDetails.url.split(/[?#]/)[0];
  const nameText = encodedName ? encodedName[1] : plainName ? (plainName[1] ?? plainName[2]) : fileNameOfPath(addressPath);
  try {
    return decodeURIComponent(nameText.trim());
  } catch (_) {
    return nameText.trim();
  }
}

// Firefox adds " (1)", " (2)", ... to the name of a file that exists already.
function withoutDuplicateNumber(fileName) {
  return fileName.replace(/\s?\(\d+\)(?=\.[^.]*$|$)/, "");
}

// Create the row of a manual take-over if it does not exist yet (plan, section 1). When
// the clicked row's publisher page was accessible, its publisher page cells are copied,
// and the manual part starts with the capture; otherwise it starts with the page itself.
function ensureManualRow(watchedEntry) {
  const { doi, clickedPageCounter, manualPageLabel, clickedUrl } = watchedEntry;
  if (self.recordedRow(doi, manualPageLabel)?.pageStatus) return;
  const clickedRow = self.recordedRow(doi, clickedPageCounter);
  if (clickedRow?.pageStatus?.startsWith(self.STATUS_SUCCESS)) {
    self.recordPublisherPageAccess(doi, manualPageLabel, clickedRow.pageStatus, clickedRow.pageResult);
  } else {
    self.recordPublisherPageAccess(doi, manualPageLabel, `${self.STATUS_SUCCESS}: ${OPENED_BY_HAND}`, clickedUrl);
  }
}

// onHeadersReceived, for every response: a PDF in a watched tab is remembered, to match
// its download later, and, unless the website forces a download, recorded as viewed in
// the manual row (plan, section 3). A row whose PDF was already saved is left as it is.
async function rememberAssistedPdfResponse(responseDetails) {
  if (!PDF_RESPONSE_TYPES.has(responseDetails.type) || !retrievingPdfFile(responseDetails)) return;
  const pdfResponse = { pdfUrl: responseDetails.url, pdfFileName: pdfResponseFileName(responseDetails) };
  let watchedEntry = null;
  await updateAssistedTabs((assistedTabs) => {
    watchedEntry = assistedTabs[responseDetails.tabId] || null;
    if (!watchedEntry) return false;
    watchedEntry.pdfResponses.push(pdfResponse);
  });
  if (!watchedEntry || retrievingAttachment(responseDetails)) return;
  const { doi, manualPageLabel } = watchedEntry;
  if (self.recordedRow(doi, manualPageLabel)?.downloadStatus === `${self.STATUS_SUCCESS}: ${DOWNLOADED_BY_HAND}`) return;
  ensureManualRow(watchedEntry);
  self.recordPdfCapture(doi, manualPageLabel, `${self.STATUS_SUCCESS}: ${VIEWED_BY_HAND}`, pdfResponse.pdfUrl);
  self.recordPdfDownload(doi, manualPageLabel, `${self.STATUS_PENDING}: ${VIEWED_NOT_DOWNLOADED}`, null);
  self.sendStatus(`📄 PDF shown in tab ${responseDetails.tabId} for ${doi}`);
  self.sendProgressUpdate();
}

// downloads.onCreated: decide which watched tab a download belongs to, while the tab it
// was started from is still the active one (plan, section 3):
// - a download of a PDF response of a watched tab belongs to that tab, as when a website
//   forces a download;
// - a download from Firefox's PDF viewer belongs to the active tab, if that is watched
//   and has seen a PDF. Its file name is checked when the download ends, against the
//   names of the PDFs the tab has seen.
async function attributeAssistedDownload(downloadItem) {
  let assistedTabs = {};
  await updateAssistedTabs((storedTabs) => {
    assistedTabs = storedTabs;
    return false;
  });
  let watchedEntry = Object.values(assistedTabs)
    .find((assistedEntry) => assistedEntry.pdfResponses.some((pdfResponse) => pdfResponse.pdfUrl === downloadItem.url));
  let expectedFileNames = [];
  if (!watchedEntry && downloadItem.url.startsWith(PDF_VIEWER_DOWNLOAD_PREFIX)) {
    const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const activeEntry = activeTab ? assistedTabs[activeTab.id] : undefined;
    if (activeEntry?.pdfResponses.length) {
      watchedEntry = activeEntry;
      expectedFileNames = activeEntry.pdfResponses.map((pdfResponse) => pdfResponse.pdfFileName);
    }
  }
  if (!watchedEntry) return;
  const { doi, clickedPageCounter, manualPageLabel, clickedUrl } = watchedEntry;
  return updateAssistedDownloads((assistedDownloads) => {
    assistedDownloads[downloadItem.id] = { doi, clickedPageCounter, manualPageLabel, clickedUrl, expectedFileNames };
  });
}

// When a download ends: record a download that started in a watched tab in the manual
// row. Resolves to true when the download belonged to a watched tab, recorded or not,
// so it is not taken for the job's capture.
async function recordAssistedDownload(downloadItem, downloadState, interruptReason) {
  let attributedDownload = null;
  await updateAssistedDownloads((assistedDownloads) => {
    attributedDownload = assistedDownloads[downloadItem.id] || null;
    if (!attributedDownload) return false;
    delete assistedDownloads[downloadItem.id];
  });
  if (!attributedDownload) return false;
  const { doi, manualPageLabel, expectedFileNames } = attributedDownload;
  const savedFileName = fileNameOfPath(downloadItem.filename);
  if (downloadState === "complete" && expectedFileNames.length > 0
      && !expectedFileNames.includes(withoutDuplicateNumber(savedFileName))) {
    self.sendStatus(`Not recording ${savedFileName} for ${doi}: it is not named like a PDF shown in the watched tab`);
    return true;
  }
  ensureManualRow(attributedDownload);
  if (downloadState === "complete") {
    self.recordPdfDownload(doi, manualPageLabel, `${self.STATUS_SUCCESS}: ${DOWNLOADED_BY_HAND}`, savedFileName,
                           downloadItem.filename);
    self.sendStatus(`📥 PDF downloaded by hand for ${doi}: ${savedFileName}`);
  } else {
    self.recordPdfDownload(doi, manualPageLabel, `${self.STATUS_ACCESS_ERROR}: ${interruptReason}`, savedFileName);
  }
  self.sendProgressUpdate();
  return true;
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

// savedPath: the full path of a saved PDF, for the CSV of saved PDFs.
function recordDownload(status, filename, session = captureSession, savedPath = null) {
  self.recordPdfDownload(session.doi, session.pageCounter, status, filename, savedPath);
  self.sendProgressUpdate();
}

function recordCaptureFailure(status, reason, targetUrl) {
  self.recordCapture(`${status}: ${reason}`, targetUrl);
  self.failCapture(reason);
}

// A first page that fails to load (bad DOI, 404, network error) shows a browser error
// page where no content script runs, so its failure would never be reported. Show a
// pending placeholder row right away, and mark it failed unless the content script
// confirms the page in time (see recordContentProgress).
function seedPageLoadRow(doi, doiUrl) {
  clearTimeout(pageLoadTimeoutId);
  self.recordPublisherPageAccess(doi, 1, `${self.STATUS_PENDING}: ${PAGE_LOAD_PENDING_REASON}`, doiUrl);
  self.sendProgressUpdate();
  pageLoadTimeoutId = setTimeout(() => {
    pageLoadTimeoutId = null;
    self.recordPublisherPageAccess(doi, 1, `${self.STATUS_ACCESS_ERROR}: page did not load`, doiUrl);
    self.sendProgressUpdate();
    self.sendStatus(`❌ DOI page did not load: ${doiUrl}`, isError = true);
  }, PAGE_LOAD_TIMEOUT_MS);
}

// Record a page load or link search reported by the content script. It belongs to the
// page after the ones already captured (see armCaptureBase).
function recordContentProgress(msg) {
  const pageCounter = jobPageCounter + 1;
  if (msg.stage === "page") {
    clearTimeout(pageLoadTimeoutId);
    pageLoadTimeoutId = null;
    self.recordPublisherPageAccess(msg.doi, pageCounter, self.STATUS_SUCCESS, msg.url);
  } else if (msg.stage === "link") {
    const status = msg.found ? self.STATUS_SUCCESS : self.STATUS_NOT_FOUND;
    self.recordPdfLinkFound(msg.doi, pageCounter, status, msg.url);
  } else {
    return;
  }
  self.sendProgressUpdate();
}

if (typeof module !== "undefined") {
  module.exports = { CAPTURE_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, PAGE_LOAD_PENDING_REASON, armCaptureAndNavigate, armCaptureBase, armCaptureOnly,
                     checkRobotsBeforeRequest, clearAssistedTabs, failCapture, forgetAssistedTab,
                     MANUAL_PAGE_SUFFIX, inRetrievePdfSession, looksPaywalledUrl, processDownloadChange,
                     processIncomingPdfData, recordCapture,
                     recordCaptureFailure, recordContentProgress, recordDownload, recordRobotsBlock, removeSlashes, retrievingAttachment,
                     retrievingPdfFile, sanitizeDOI, seedPageLoadRow, sendProgressUpdate, startJob,
                     storeDetailsInSessionData, watchAssistedTab, watchTabOpenedFromAssistedTab,
                     DOWNLOADED_BY_HAND, OPENED_BY_HAND, PDF_VIEWER_DOWNLOAD_PREFIX, VIEWED_BY_HAND,
                     VIEWED_NOT_DOWNLOADED, attributeAssistedDownload, pdfResponseFileName,
                     recordAssistedDownload, rememberAssistedPdfResponse, withoutDuplicateNumber };
}
if (typeof self !== "undefined") {
  self.armCaptureAndNavigate = armCaptureAndNavigate;
  self.attributeAssistedDownload = attributeAssistedDownload;
  self.recordAssistedDownload = recordAssistedDownload;
  self.rememberAssistedPdfResponse = rememberAssistedPdfResponse;
  self.armCaptureBase = armCaptureBase;
  self.armCaptureOnly = armCaptureOnly;
  self.checkRobotsBeforeRequest = checkRobotsBeforeRequest;
  self.clearAssistedTabs = clearAssistedTabs;
  self.forgetAssistedTab = forgetAssistedTab;
  self.failCapture = failCapture;
  self.inRetrievePdfSession = inRetrievePdfSession;
  self.looksPaywalledUrl = looksPaywalledUrl;
  self.processDownloadChange = processDownloadChange;
  self.processIncomingPdfData = processIncomingPdfData;
  self.recordCapture = recordCapture;
  self.recordCaptureFailure = recordCaptureFailure;
  self.recordContentProgress = recordContentProgress;
  self.recordDownload = recordDownload;
  self.recordRobotsBlock = recordRobotsBlock;
  self.removeSlashes = removeSlashes;
  self.retrievingAttachment = retrievingAttachment;
  self.retrievingPdfFile = retrievingPdfFile;
  self.sanitizeDOI = sanitizeDOI;
  self.seedPageLoadRow = seedPageLoadRow;
  self.sendProgressUpdate = sendProgressUpdate;
  self.startJob = startJob;
  self.storeDetailsInSessionData = storeDetailsInSessionData;
  self.watchAssistedTab = watchAssistedTab;
  self.watchTabOpenedFromAssistedTab = watchTabOpenedFromAssistedTab;
}
