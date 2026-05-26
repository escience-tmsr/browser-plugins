let captureSession = null;
let downloadLog = "";

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!self.inRetrievePdfSession(details.tabId)) return;
    self.storeDetailsInSessionData(details);

    if (!self.retrievingPdfFile(details)) return;

    captureSession.sawPdf = true;
    clearTimeout(captureSession.timeoutId);
    self.sendStatus("PDF response detected; capturing…");

    if (retrievingAttachment(details)) {
      captureSession.expectBrowserDownload = true;
      sendStatus(`Server forces PDF download; will use browser download to avoid duplicate (${captureSession.pageCounter})`);
    };

    self.processIncomingPdfData(details);
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

browser.downloads.onChanged.addListener((delta) => {
  if (!delta.state || delta.state.current !== "complete") return;

  browser.downloads.search({ id: delta.id }).then(([item]) => {
    if (!item) return;
    if (captureSession !== null && (item.mime.includes("application/pdf") || item.filename.endsWith(".pdf"))) {
      self.sendStatus(`✅ Saved PDF to ${item.filename}`);
      downloadLog = downloadLog.concat(captureSession.doi, ",", item.filename, "\n");
      captureSession = null;
    }
  });
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;

  if (msg.type === "status") {
    sendStatus(`status: ${msg.text}`);
    return;
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
