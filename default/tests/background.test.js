const {
  CAPTURE_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, PAGE_LOAD_PENDING_REASON,
  armCapture, armCaptureAndNavigate, armCaptureOnly, failCapture, isAttachmentResponse, isCapturingPdfInTab,
  isPaywallUrl, isPdfResponse, makePdfFilename, processDownloadChange, processIncomingPdfData, recordCapture,
  recordCaptureFailure, recordContentProgress, recordDownload, replaceSlashes, sanitizeDoi, saveLog, sendProgressUpdate,
  startJob, startPageLoadWatch, storeDetailsInSessionData,
} = require("../src/background.functions");
const {
  STATUS_SUCCESS, STATUS_NOT_FOUND, STATUS_ACCESS_ERROR, STATUS_SKIPPED, STATUS_PENDING,
  STAGE_PUBLISHER_PAGE, STAGE_PDF_LINK, STAGE_PDF_CAPTURE, STAGE_PDF_DOWNLOAD,
} = require("../src/progress-table");
const STATUS_CONSTANTS = { STATUS_SUCCESS, STATUS_NOT_FOUND, STATUS_ACCESS_ERROR, STATUS_SKIPPED, STATUS_PENDING };
const STAGE_CONSTANTS = { STAGE_PUBLISHER_PAGE, STAGE_PDF_LINK, STAGE_PDF_CAPTURE, STAGE_PDF_DOWNLOAD };

const DOI = "10.1234/doi";
const DOI_URL = "https://doi.org/" + DOI;
const TAB_ID = 123;
const PROGRESS_TABLE_HTML = "<table></table>";

const pdfFilename = makePdfFilename;

function mockOtherBackgroundScripts() {
  global.self = {
    ...STATUS_CONSTANTS,
    ...STAGE_CONSTANTS,
    openOrFocusStatusTab: jest.fn().mockResolvedValue({}),
    recordStage: jest.fn(),
    renderProgressTableHtml: jest.fn().mockReturnValue(PROGRESS_TABLE_HTML),
    reportStatus: jest.fn(),
  };
  global.browser = { runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
}

function resetBackgroundState() {
  global.captureSession = null;
  global.downloadLog = "";
  global.jobPageCounter = 0;
  global.pageLoadTimeoutId = null;
}

function expectCaptureFailureReported(failureReasonPattern) {
  expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching(`^❌ PDF download failed: ${failureReasonPattern}`), true);
}

function countReportedErrors() {
  return self.reportStatus.mock.calls.filter(([, isError]) => isError).length;
}

beforeEach(() => {
  mockOtherBackgroundScripts();
  resetBackgroundState();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("sanitizeDoi", () => {
  test("removes non-essential characters from DOI", () => {
    expect(sanitizeDoi("doi: https://doi.org/10.1613/jair.1.20161"))
      .toBe("10.1613/jair.1.20161");
  });

  test("strips doi.org prefix", () => {
    expect(sanitizeDoi("https://doi.org/10.1613/jair.1.20161"))
      .toBe("10.1613/jair.1.20161");
  });
});

describe("replaceSlashes", () => {
  test("replaces slashes in a DOI by underscores", () => {
    expect(replaceSlashes("10.1613/jair.1.20161"))
      .toBe("10.1613_jair.1.20161");
  });
});

describe("isPaywallUrl", () => {
  test("text with paywall words 1/2", () => {
    expect(isPaywallUrl("https://domain/some_paywall_file"))
      .toBe(true);
  });

  test("text with paywall words 2/2", () => {
    expect(isPaywallUrl("https://domain/some_account_file"))
      .toBe(true);
  });

  test("text without paywall words", () => {
    expect(isPaywallUrl("https://domain/no_special_file"))
      .toBe(false);
  });
});

describe("isCapturingPdfInTab", () => {
  test("is not capturing without a capture session", () => {
    expect(isCapturingPdfInTab(null, 1))
      .toBe(false);
  });

  test("is capturing in the session's tab", () => {
    expect(isCapturingPdfInTab({ tabId: 1 }, 1))
      .toBe(true);
  });

  test("is not capturing in another tab than the session's", () => {
    expect(isCapturingPdfInTab({ tabId: 2 }, 1))
      .toBe(false);
  });
});

describe("isPdfResponse", () => {
  test("is not a pdf response without headers", () => {
    expect(isPdfResponse({ responseHeaders: null }))
      .toBe(false);
  });

  test("is a pdf response with a pdf content type", () => {
    expect(isPdfResponse({
           responseHeaders: [ { name: "Content-type",
                                value: "application/pdf" } ]
           }))
      .toBe(true);
  });
});

describe("storeDetailsInSessionData", () => {
  const responseDetails = {
    type: "main_frame",
    url: "url",
    statusCode: "statusCode",
    responseHeaders: [{ name: "Content-type", value: "Content-type" }],
  };

  test("stores the details of a main frame response in the session", () => {
    const sessionData = {};
    storeDetailsInSessionData(sessionData, responseDetails);
    expect(sessionData.lastMainUrl).toBe(responseDetails.url);
    expect(sessionData.lastMainStatus).toBe(responseDetails.statusCode);
    expect(sessionData.lastMainContentType).toBe("content-type");
  });

  test("ignores the details of a response that is not a main frame", () => {
    const sessionData = {};
    storeDetailsInSessionData(sessionData, { ...responseDetails, type: "image" });
    expect(sessionData).toEqual({});
  });
});

describe("isAttachmentResponse", () => {
  test("is not an attachment response without headers", () => {
    expect(isAttachmentResponse({ responseHeaders: null }))
      .toBe(false);
  });

  test("is an attachment response with an attachment disposition", () => {
    expect(isAttachmentResponse({
           responseHeaders: [ { name: "Content-disposition",
                                value: "attachment" } ]
           }))
      .toBe(true);
  });
});

describe("processIncomingPdfData", () => {
  let fakeFilter = {};

  beforeEach(() => {
    fakeFilter = {
      disconnect: jest.fn(),
      onstop: jest.fn(),
      write: jest.fn(),
    };
    global.browser.webRequest = { filterResponseData: jest.fn().mockReturnValue(fakeFilter) };
    global.browser.downloads = { download: jest.fn().mockResolvedValue(123) };
    global.URL = { createObjectURL: jest.fn().mockReturnValue("blob:fake"), revokeObjectURL: jest.fn() };
  });

  test("streams the PDF data and saves it as a download", async () => {
    global.captureSession = { doi: "10.1234/foo.bar" };
    processIncomingPdfData(global.captureSession, { requestId: "req-1" });
    expect(browser.webRequest.filterResponseData).toHaveBeenCalledWith("req-1");

    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5]);
    fakeFilter.ondata({ data: chunk1 });
    fakeFilter.ondata({ data: chunk2 });
    await fakeFilter.onstop();

    expect(fakeFilter.write).toHaveBeenCalledTimes(2);
    expect(fakeFilter.write).toHaveBeenNthCalledWith(1, chunk1);
    expect(fakeFilter.write).toHaveBeenNthCalledWith(2, chunk2);
    expect(fakeFilter.disconnect).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith({
      url: "blob:fake",
      filename: "10.1234_foo.bar.pdf",
      saveAs: false,
    });
    expect(self.reportStatus).not.toHaveBeenCalled();
  });

  test("a download that throws is reported as a failed capture", async () => {
    global.captureSession = { doi: DOI, pageCounter: 1 };
    global.browser.downloads.download = jest.fn().mockImplementation(() => {
      throw new Error("something went wrong!");
    });
    processIncomingPdfData(global.captureSession, { requestId: "req-4" });
    await fakeFilter.onstop();
    expectCaptureFailureReported("Saving PDF failed: something went wrong!");
  });

  test("a failed save is recorded in the download stage of the capture's row", async () => {
    const SAVE_SESSION = { doi: DOI, pageCounter: 2 };
    const SAVE_ERROR = "disk full";
    global.captureSession = SAVE_SESSION;
    global.browser.downloads.download = jest.fn().mockRejectedValue(new Error(SAVE_ERROR));
    processIncomingPdfData(global.captureSession, { requestId: "req-5" });
    global.captureSession = null;  // a later event may already have ended the session
    await fakeFilter.onstop();
    expect(self.recordStage).toHaveBeenCalledWith(DOI, SAVE_SESSION.pageCounter, STAGE_PDF_DOWNLOAD,
      `${STATUS_ACCESS_ERROR}: Saving PDF failed: ${SAVE_ERROR}`, pdfFilename(DOI));
  });

  test("a failed save ends the capture", async () => {
    global.captureSession = { doi: DOI, pageCounter: 1 };
    global.browser.downloads.download = jest.fn().mockRejectedValue(new Error("disk full"));
    processIncomingPdfData(global.captureSession, { requestId: "req-6" });
    await fakeFilter.onstop();
    expect(global.captureSession).toBe(null);
  });

  test("a response that breaks off is recorded as a failed download and ends the capture", () => {
    const TRANSFER_SESSION = { doi: DOI, pageCounter: 2 };
    const TRANSFER_ERROR = "Channel redirected";
    global.captureSession = TRANSFER_SESSION;
    processIncomingPdfData(global.captureSession, { requestId: "req-7" });
    fakeFilter.error = TRANSFER_ERROR;
    fakeFilter.onerror();
    const transferReason = `PDF transfer stopped: ${TRANSFER_ERROR}`;
    expect(self.recordStage).toHaveBeenCalledWith(DOI, TRANSFER_SESSION.pageCounter, STAGE_PDF_DOWNLOAD,
      `${STATUS_ACCESS_ERROR}: ${transferReason}`, pdfFilename(DOI));
    expectCaptureFailureReported(transferReason);
    expect(global.captureSession).toBe(null);
  });

  test("a response that breaks off after its capture ended reports nothing", () => {
    global.captureSession = { doi: DOI, pageCounter: 1 };
    processIncomingPdfData(global.captureSession, { requestId: "req-8" });
    global.captureSession = null;  // e.g. already ended by a capture timeout
    fakeFilter.onerror();
    expect(self.recordStage).not.toHaveBeenCalled();
    expect(self.reportStatus).not.toHaveBeenCalled();
  });

  test("a response that breaks off does not end a newer capture", () => {
    global.captureSession = { doi: DOI, pageCounter: 1 };
    processIncomingPdfData(global.captureSession, { requestId: "req-9" });
    const newerSession = { doi: DOI, pageCounter: 2 };
    global.captureSession = newerSession;
    fakeFilter.onerror();
    expect(global.captureSession).toBe(newerSession);
    expect(self.recordStage).not.toHaveBeenCalled();
  });
});

describe("processDownloadChange", () => {
  const SAVED_PATH = "/home/user/Downloads/" + pdfFilename(DOI);
  const PDF_URL = "https://publisher.example/article.pdf";
  const DOWNLOAD_ID = 42;
  const CANCELLED = "USER_CANCELED";

  function downloadItem(fields) {
    return { id: DOWNLOAD_ID, mime: "application/pdf", filename: SAVED_PATH, url: PDF_URL, ...fields };
  }

  function stateChange(state) {
    return { id: DOWNLOAD_ID, state: { current: state } };
  }

  beforeEach(() => {
    global.browser.downloads = { search: jest.fn().mockResolvedValue([downloadItem()]) };
    global.captureSession = { doi: DOI, pageCounter: 1, lastMainUrl: PDF_URL };
  });

  test("a completed download is recorded, logged, and ends the capture", async () => {
    await processDownloadChange(stateChange("complete"));
    expect(browser.downloads.search).toHaveBeenCalledWith({ id: DOWNLOAD_ID });
    expect(self.recordStage).toHaveBeenCalledWith(DOI, 1, STAGE_PDF_DOWNLOAD, STATUS_SUCCESS, pdfFilename(DOI));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching(SAVED_PATH));
    expect(global.downloadLog).toBe(`${DOI},${SAVED_PATH}\n`);
    expect(global.captureSession).toBe(null);
  });

  test("an interrupted download is recorded as failed with its reason, and ends the capture", async () => {
    browser.downloads.search.mockResolvedValue([downloadItem({ error: CANCELLED })]);
    await processDownloadChange(stateChange("interrupted"));
    const interruptReason = `Download interrupted (${CANCELLED})`;
    expect(self.recordStage).toHaveBeenCalledWith(DOI, 1, STAGE_PDF_DOWNLOAD,
      `${STATUS_ACCESS_ERROR}: ${interruptReason}`, pdfFilename(DOI));
    expectCaptureFailureReported(`Download interrupted \\(${CANCELLED}\\)`);
    expect(global.downloadLog).toBe("");
    expect(global.captureSession).toBe(null);
  });

  test("the reason is taken from the change when the download item has none", async () => {
    await processDownloadChange({ ...stateChange("interrupted"), error: { current: CANCELLED } });
    expectCaptureFailureReported(`Download interrupted \\(${CANCELLED}\\)`);
  });

  test("an interrupted download without any reason is recorded with an unknown reason", async () => {
    await processDownloadChange(stateChange("interrupted"));
    expectCaptureFailureReported("Download interrupted \\(unknown reason\\)");
  });

  test("an interrupted download of the captured address counts even without a PDF type or name", async () => {
    browser.downloads.search.mockResolvedValue([downloadItem({ mime: "", filename: "", error: CANCELLED })]);
    await processDownloadChange(stateChange("interrupted"));
    expect(countReportedErrors()).toBe(1);
    expect(global.captureSession).toBe(null);
  });

  test("a download that is still running is ignored", async () => {
    await processDownloadChange(stateChange("in_progress"));
    await processDownloadChange({ id: DOWNLOAD_ID });
    expect(browser.downloads.search).not.toHaveBeenCalled();
  });

  test("a download without an active capture is ignored", async () => {
    global.captureSession = null;
    await processDownloadChange(stateChange("complete"));
    expect(self.recordStage).not.toHaveBeenCalled();
    expect(global.downloadLog).toBe("");
  });

  test("a download that is not the captured PDF is ignored", async () => {
    browser.downloads.search.mockResolvedValue([
      downloadItem({ mime: "text/csv", filename: "downloaded_pdfs.csv", url: "blob:other" })]);
    await processDownloadChange(stateChange("complete"));
    expect(self.recordStage).not.toHaveBeenCalled();
    expect(global.captureSession).not.toBe(null);
  });
});

describe("startJob", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.browser.tabs = { create: jest.fn().mockResolvedValue({ id: TAB_ID }) };
    global.browser.storage = { local: { set: jest.fn().mockResolvedValue(undefined) } };
  });

  test("opens the DOI page and stores the job for its tab", async () => {
    await startJob(DOI);
    const [ storedValues ] = browser.storage.local.set.mock.calls[0];
    expect(storedValues.job).toEqual(expect.objectContaining({ url: DOI_URL, doi: DOI, tabId: TAB_ID }));
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: DOI_URL, active: false });
  });

  test("opens the status tab and keeps it in view", async () => {
    await startJob(DOI);
    expect(self.openOrFocusStatusTab).toHaveBeenCalledTimes(1);
    expect(browser.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  test("still starts the job when the status tab cannot be opened", async () => {
    self.openOrFocusStatusTab.mockRejectedValue(new Error("no tabs"));
    await startJob(DOI);
    await Promise.resolve();  // let the rejection handler run
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: DOI_URL, active: false });
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Could not open status table"), true);
  });

  test("reports an error without a message by its value", async () => {
    browser.tabs.create.mockRejectedValue("no tab created");
    await startJob(DOI);
    expect(self.reportStatus).toHaveBeenCalledWith("Could not start job: no tab created", true);
  });

  test("rejects a DOI that has no valid characters without opening a tab", async () => {
    await expect(startJob("???")).rejects.toThrow('Invalid DOI: "???"');
    expect(self.reportStatus).toHaveBeenCalledWith('Could not start job: Invalid DOI: "???"', true);
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(self.recordStage).not.toHaveBeenCalled();
  });

  test("shows a placeholder row for the DOI page", async () => {
    await startJob(DOI);
    expect(self.recordStage).toHaveBeenCalledWith(
      DOI, 1, STAGE_PUBLISHER_PAGE, `${STATUS_PENDING}: ${PAGE_LOAD_PENDING_REASON}`, DOI_URL);
  });

  test("starts counting pages from zero again", async () => {
    global.jobPageCounter = 3;
    await startJob(DOI);
    expect(global.jobPageCounter).toBe(0);
  });

  test("reports a job that cannot be stored", async () => {
    global.browser.storage.local.set = jest.fn().mockImplementation(() => {
      throw new Error("something went wrong!");
    });
    await startJob(DOI);
    expect(self.reportStatus).toHaveBeenCalledWith("Could not start job: something went wrong!", true);
  });
});

describe("armCaptureOnly", () => {
  test("arms a capture for the tab without an expected url", async () => {
    const result = await armCaptureOnly(DOI, TAB_ID);
    expect(result).toBe(true);
    expect(self.reportStatus).toHaveBeenCalledWith("Entering armCaptureOnly");
    expect(global.captureSession).toEqual(expect.objectContaining({ doi: DOI, tabId: TAB_ID, expectedUrl: null }));
  });
});

describe("armCaptureAndNavigate", () => {
  test("arms a capture for the expected url and navigates the tab to it", () => {
    global.browser.tabs = { update: jest.fn() };
    const expectedUrl = "https://domain/dir";
    armCaptureAndNavigate(DOI, TAB_ID, expectedUrl);
    expect(self.reportStatus).toHaveBeenCalledWith(`Entering armCaptureAndNavigate for ${expectedUrl}`);
    expect(global.captureSession).toEqual(expect.objectContaining({ doi: DOI, tabId: TAB_ID, expectedUrl }));
    expect(browser.tabs.update).toHaveBeenCalledWith(TAB_ID, { url: expectedUrl });
  });
});

describe("armCapture", () => {
  let expectedUrl = "";

  beforeEach(() => {
    jest.useFakeTimers();
    expectedUrl = "https://domain/dir";
  });

  test("starts a capture session for the first page", () => {
    const returnedFileType = armCapture(DOI, TAB_ID, expectedUrl);
    expect(global.captureSession).toEqual(expect.objectContaining(
      { tabId: TAB_ID, doi: DOI, expectedUrl, sawPdf: false, pageCounter: 1 }));
    expect(returnedFileType).toBe("HTML");
    expect(self.reportStatus).toHaveBeenCalledTimes(1);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Armed capture"));
  });

  test("expects a PDF for a download url", () => {
    expectedUrl = "download?file=abc.pdf";
    expect(armCapture(DOI, TAB_ID, expectedUrl)).toBe("PDF");
  });

  test("has an unknown target type without an expected url", () => {
    expect(armCapture(DOI, TAB_ID, null)).toBe("unknown");
  });

  test("reports a capture without any PDF response when it times out", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    expect(countReportedErrors()).toBe(0);
    jest.runAllTimers();
    expectCaptureFailureReported("No PDF response");
    expect(global.captureSession).toBe(null);
  });

  test("reports an html page instead of a PDF when it times out", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.lastMainContentType = "text/html";
    jest.runAllTimers();
    expectCaptureFailureReported("Received HTML");
    expect(global.captureSession).toBe(null);
  });

  test("reports an html page with a paywall url as a redirect when it times out", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.lastMainContentType = "text/html";
    global.captureSession.lastMainUrl = "https://domain/login";
    jest.runAllTimers();
    expectCaptureFailureReported("Redirected");
    expect(global.captureSession).toBe(null);
  });

  test("reports a denied access when it times out", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.lastMainStatus = 401;
    jest.runAllTimers();
    expectCaptureFailureReported("Access denied");
    expect(global.captureSession).toBe(null);
  });

  test("a failed capture is recorded with its status and target url", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.lastMainStatus = 403;
    jest.runAllTimers();
    expect(self.recordStage).toHaveBeenCalledWith(
      DOI, 1, STAGE_PDF_CAPTURE, expect.stringMatching(`^${STATUS_ACCESS_ERROR}: Access denied`), expectedUrl);
  });

  test("a capture without any PDF response is recorded as not found", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    jest.runAllTimers();
    expect(self.recordStage).toHaveBeenCalledWith(
      DOI, 1, STAGE_PDF_CAPTURE, expect.stringMatching(`^${STATUS_NOT_FOUND}: No PDF response`), expectedUrl);
  });

  test("a failed capture without any known url is recorded with an empty url", () => {
    armCapture(DOI, TAB_ID, null);
    jest.runAllTimers();
    expect(self.recordStage).toHaveBeenCalledWith(
      DOI, 1, STAGE_PDF_CAPTURE, expect.stringMatching(`^${STATUS_NOT_FOUND}`), "");
  });

  test("a timeout after a PDF was seen records no failure", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.sawPdf = true;
    jest.runAllTimers();
    expect(countReportedErrors()).toBe(0);
    expect(self.recordStage).not.toHaveBeenCalled();
    expect(global.captureSession).not.toBe(null);
  });

  test("each capture of a job gets the next page number", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    expect(global.captureSession.pageCounter).toBe(1);
    armCapture(DOI, TAB_ID, expectedUrl);
    expect(global.captureSession.pageCounter).toBe(2);
    expect(global.jobPageCounter).toBe(2);
  });

  test("captures after the first one have an unknown target type", () => {
    expect(armCapture(DOI, TAB_ID, expectedUrl)).toBe("HTML");
    expect(armCapture(DOI, TAB_ID, expectedUrl)).toBe("unknown");
  });

  test("a new capture records the previous page's capture as skipped", () => {
    const LANDING_URL = "https://domain/landing";
    armCapture(DOI, TAB_ID, expectedUrl);
    const previousSession = global.captureSession;
    previousSession.lastMainUrl = LANDING_URL;
    armCapture(DOI, TAB_ID, expectedUrl);
    expect(self.recordStage).toHaveBeenCalledWith(DOI, previousSession.pageCounter, STAGE_PDF_CAPTURE,
      `${STATUS_SKIPPED}: capture stopped by new capture on page ${previousSession.pageCounter + 1}`, LANDING_URL);
  });

  test("a new capture does not overwrite a previous capture that saw a PDF", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    global.captureSession.sawPdf = true;
    armCapture(DOI, TAB_ID, expectedUrl);
    expect(self.recordStage).not.toHaveBeenCalled();
  });

  test("a new capture cancels the previous capture's timeout", () => {
    armCapture(DOI, TAB_ID, expectedUrl);
    jest.advanceTimersByTime(CAPTURE_TIMEOUT_MS / 2);
    armCapture(DOI, TAB_ID, expectedUrl);
    jest.advanceTimersByTime(CAPTURE_TIMEOUT_MS / 2);
    expect(countReportedErrors()).toBe(0);
    expect(global.captureSession).not.toBe(null);
    jest.runAllTimers();
    expect(countReportedErrors()).toBe(1);
  });
});

describe("recording functions", () => {
  const otherSession = { doi: "10.1234/other", pageCounter: 3 };
  const PDF_URL = "https://domain/a.pdf";
  const REASON = "paywall";

  test("sendProgressUpdate sends the current table to the status tab", () => {
    sendProgressUpdate();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "progress-update", html: PROGRESS_TABLE_HTML });
  });

  test("sendProgressUpdate ignores a missing status tab", () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    expect(() => sendProgressUpdate()).not.toThrow();
  });

  test("recordCapture records in the given session's row and pushes the table", () => {
    recordCapture(STATUS_SUCCESS, PDF_URL, otherSession);
    expect(self.recordStage).toHaveBeenCalledWith(
      otherSession.doi, otherSession.pageCounter, STAGE_PDF_CAPTURE, STATUS_SUCCESS, PDF_URL);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("recordDownload records in the given session's row and pushes the table", () => {
    recordDownload(STATUS_SUCCESS, pdfFilename(otherSession.doi), otherSession);
    expect(self.recordStage).toHaveBeenCalledWith(
      otherSession.doi, otherSession.pageCounter, STAGE_PDF_DOWNLOAD, STATUS_SUCCESS, pdfFilename(otherSession.doi));
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("recordCaptureFailure records the status with its reason and reports the failure", () => {
    recordCaptureFailure(STATUS_ACCESS_ERROR, REASON, PDF_URL, otherSession);
    expect(self.recordStage).toHaveBeenCalledWith(
      otherSession.doi, otherSession.pageCounter, STAGE_PDF_CAPTURE, `${STATUS_ACCESS_ERROR}: ${REASON}`, PDF_URL);
    expectCaptureFailureReported(REASON);
  });
});

describe("page-load and link-search recording", () => {
  const PAGE_URL = "https://publisher.example/article";
  const PDF_URL = "https://publisher.example/article.pdf";

  beforeEach(() => {
    jest.useFakeTimers();
  });

  test("startPageLoadWatch shows page 1 as pending until it is confirmed", () => {
    startPageLoadWatch(DOI, DOI_URL);
    expect(self.recordStage).toHaveBeenCalledWith(
      DOI, 1, STAGE_PUBLISHER_PAGE, `${STATUS_PENDING}: ${PAGE_LOAD_PENDING_REASON}`, DOI_URL);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("startPageLoadWatch marks page 1 as failed when it is not confirmed in time", () => {
    startPageLoadWatch(DOI, DOI_URL);
    jest.advanceTimersByTime(PAGE_LOAD_TIMEOUT_MS);
    expect(self.recordStage).toHaveBeenLastCalledWith(
      DOI, 1, STAGE_PUBLISHER_PAGE, `${STATUS_ACCESS_ERROR}: page did not load`, DOI_URL);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching(DOI_URL), true);
  });

  test("startPageLoadWatch cancels the timeout of an earlier job", () => {
    const OTHER_DOI = "10.1234/other";
    startPageLoadWatch(OTHER_DOI, "https://doi.org/" + OTHER_DOI);
    startPageLoadWatch(DOI, DOI_URL);
    jest.runAllTimers();
    expect(self.recordStage).not.toHaveBeenCalledWith(
      OTHER_DOI, 1, STAGE_PUBLISHER_PAGE, expect.stringMatching(`^${STATUS_ACCESS_ERROR}`), expect.anything());
  });

  test("a confirmed page load is recorded and cancels the page-load timeout", () => {
    startPageLoadWatch(DOI, DOI_URL);
    recordContentProgress({ stage: "page", doi: DOI, url: PAGE_URL });
    expect(self.recordStage).toHaveBeenLastCalledWith(DOI, 1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    jest.runAllTimers();
    expect(self.recordStage).toHaveBeenLastCalledWith(DOI, 1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
  });

  test("a page load belongs to the page after the ones already captured", () => {
    global.jobPageCounter = 2;
    recordContentProgress({ stage: "page", doi: DOI, url: PAGE_URL });
    expect(self.recordStage).toHaveBeenCalledWith(DOI, global.jobPageCounter + 1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
  });

  test("a found link is recorded with its url", () => {
    recordContentProgress({ stage: "pdf-link", doi: DOI, found: true, url: PDF_URL });
    expect(self.recordStage).toHaveBeenCalledWith(DOI, 1, STAGE_PDF_LINK, STATUS_SUCCESS, PDF_URL);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("a found button is recorded without a url", () => {
    recordContentProgress({ stage: "pdf-link", doi: DOI, found: true, url: null });
    expect(self.recordStage).toHaveBeenCalledWith(DOI, 1, STAGE_PDF_LINK, STATUS_SUCCESS, null);
  });

  test("a missing link is recorded as not found", () => {
    recordContentProgress({ stage: "pdf-link", doi: DOI, found: false, url: null });
    expect(self.recordStage).toHaveBeenCalledWith(DOI, 1, STAGE_PDF_LINK, STATUS_NOT_FOUND, null);
  });

  test("an unknown stage records nothing", () => {
    recordContentProgress({ stage: "other", doi: DOI });
    expect(self.recordStage).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("failCapture", () => {
  test("reports the failure with its reason as an error", () => {
    failCapture("text");
    expectCaptureFailureReported("text");
  });
});

describe("saveLog", () => {
  const LOG_OBJECT_URL = "blob:log";

  beforeEach(() => {
    global.browser.downloads = { download: jest.fn().mockResolvedValue(1) };
    global.URL = { createObjectURL: jest.fn().mockReturnValue(LOG_OBJECT_URL), revokeObjectURL: jest.fn() };
  });

  test("saves the log as a csv file and reports it once the download has started", async () => {
    await saveLog("col1,col2\n1,2");
    expect(browser.downloads.download).toHaveBeenCalledWith(
      { url: LOG_OBJECT_URL, filename: "downloaded_pdfs.csv", conflictAction: "uniquify" });
    expect(self.reportStatus).toHaveBeenCalledWith("Saved logfile to Downloads directory");
  });

  test("releases the log's object url some time after the download has started", async () => {
    jest.useFakeTimers();
    await saveLog("col1,col2\n1,2");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(LOG_OBJECT_URL);
  });

  test("passes a failed download on to the sender instead of reporting success", async () => {
    browser.downloads.download.mockRejectedValue(new Error("disk full"));
    await expect(saveLog("col1,col2\n1,2")).rejects.toThrow("disk full");
    expect(self.reportStatus).not.toHaveBeenCalled();
  });
});
