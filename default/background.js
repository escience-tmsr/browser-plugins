let captureSession = null;
let downloadLog = "";
let jobPageCounter = 0;
let pageLoadTimeoutId = null;

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    // A PDF in a tab watched for a download by hand; see docs/assisted_download_plan.md.
    self.rememberAssistedPdfResponse(details);
    if (!self.inRetrievePdfSession(details.tabId)) return;
    self.storeDetailsInSessionData(details);

    if (!self.retrievingPdfFile(details)) return;

    captureSession.sawPdf = true;
    clearTimeout(captureSession.timeoutId);
    self.sendStatus("PDF response detected; capturing…");
    self.recordCapture(self.STATUS_SUCCESS, details.url);

    if (retrievingAttachment(details)) {
      captureSession.expectBrowserDownload = true;
      sendStatus(`Server forces PDF download; will use browser download to avoid duplicate (${captureSession.pageCounter})`);
    };

    self.processIncomingPdfData(details);
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

// Cancel page requests in the job's tab that robots.txt does not allow.
browser.webRequest.onBeforeRequest.addListener(
  (requestDetails) => self.checkRobotsBeforeRequest(requestDetails),
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

// Tabs opened from the progress table, and tabs opened from those, are watched for a
// PDF the user downloads by hand; see docs/assisted_download_plan.md.
browser.tabs.onCreated.addListener((createdTab) => self.watchTabOpenedFromAssistedTab(createdTab));
browser.tabs.onRemoved.addListener((closedTabId) => self.forgetAssistedTab(closedTabId));
browser.runtime.onStartup.addListener(() => self.clearAssistedTabs());
browser.downloads.onCreated.addListener((downloadItem) => self.attributeAssistedDownload(downloadItem));

browser.downloads.onChanged.addListener((delta) => {
  self.processDownloadChange(delta);
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;

  if (msg.type === "status") {
    sendStatus(`status: ${msg.text}`);
    return;
  }

  if (msg.type === "get-progress") {
    // sent by the status tab when it opens: do not report
    return Promise.resolve({ html: self.toHtml() });
  }

  if (msg.type === "get-progress-csv") {
    // sent by the status tab's "Download CSV" button: do not report
    return Promise.resolve({ csv: self.toCsv() });
  }

  if (msg.type === "watch-assisted-tab") {
    // sent by the status tab when an address in the table is clicked
    return self.watchAssistedTab(msg.tabId, msg.doi, msg.pageCounter, msg.clickedUrl);
  }

  if (msg.type === "record-progress") {
    // sent by the content script for the progress table: do not report
    self.recordContentProgress(msg);
    return Promise.resolve();
  }

  if (msg.type !== "what-is-my-tabid") {
    sendStatus(`received message: ${msg.type}`);
  } else {
    // message sent for every tab: do not report
    const tabId = sender && sender.tab ? sender.tab.id : null;
    return Promise.resolve({ tabId });
  }

  if (msg.type === "start-job") return self.startJob(msg.doi);

  if (msg.type === "save-log") return self.saveLog(downloadLog);

  if (msg.type === "arm_capture_for_tab") return armCaptureOnly(msg.doi, msg.tabId, msg.expectedUrl ?? null);

  if (msg.type === "open-url" && msg.url) {
    self.sendStatus("Opening link in new tab…");
    return browser.tabs.create({ url: msg.url });
  }

  if (msg.type === "download_pdf_via_tab_capture" && msg.pdfUrl) {
    const tabId = msg.tabId || (sender && sender.tab ? sender.tab.id : null);
    const doi = msg.doi || null;

    if (!tabId) {
      self.sendStatus("Cannot download: missing tabId.", isError = false);
      return;
    }
    if (captureSession !== null && msg.pdfUrl === captureSession.lastMainUrl) {
      self.sendStatus(`skipping already processed url: ${msg.pdfUrl}`);
      return;
    }
    return armCaptureAndNavigate(doi, tabId, msg.pdfUrl);
  }

  self.sendStatus(`onMessage: cannot process message: ${msg.type}`, isError = false);
});
