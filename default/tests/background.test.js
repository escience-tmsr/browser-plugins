const { CAPTURE_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, PAGE_LOAD_PENDING_REASON, armCaptureBase, checkRobotsBeforeRequest, clearAssistedTabs, failCapture, forgetAssistedTab, MANUAL_PAGE_SUFFIX, inRetrievePdfSession, looksPaywalledUrl, processDownloadChange, processIncomingPdfData, recordCapture, recordCaptureFailure, recordContentProgress, recordDownload, recordRobotsBlock, removeSlashes, retrievingAttachment, retrievingPdfFile, sanitizeDOI, seedPageLoadRow, sendProgressUpdate, startJob, storeDetailsInSessionData, watchAssistedTab, watchTabOpenedFromAssistedTab }  = require("../src/background.functions");
const { STATUS_SUCCESS, STATUS_NOT_FOUND, STATUS_ACCESS_ERROR, STATUS_SKIPPED, STATUS_PENDING } = require("../src/progress");
const STATUS_CONSTANTS = { STATUS_SUCCESS, STATUS_NOT_FOUND, STATUS_ACCESS_ERROR, STATUS_SKIPPED, STATUS_PENDING };

// DOI used throughout these tests, and the doi.org address startJob opens for it.
const DOI = "10.1234/doi";
const DOI_URL = "https://doi.org/" + DOI;
// The tab startJob opens for a job, which first shows an empty page.
const JOB_TAB_ID = 7;
const EMPTY_PAGE_URL = "about:blank";

// The file name processIncomingPdfData saves a DOI's PDF under.
function pdfFilename(doi) {
  return `${removeSlashes(doi)}.pdf`;
}

describe("sanitizeDOI", () => {
  test("removes non-essential characters from DOI", () => {
    expect(sanitizeDOI("doi: https://doi.org/10.1613/jair.1.20161"))
      .toBe("10.1613/jair.1.20161");
  });
  
  test("strips doi.org prefix", () => {
    expect(sanitizeDOI("https://doi.org/10.1613/jair.1.20161"))
      .toBe("10.1613/jair.1.20161");
  });
});

describe("removeSlashes", () => {
  test("removes slashes from DOI", () => {
    expect(removeSlashes("10.1613/jair.1.20161"))
      .toBe("10.1613_jair.1.20161");
  });
});

describe("looksPaywalledUrl", () => {
  test("text with paywall words 1/2", () => {
    expect(looksPaywalledUrl("https://domain/some_paywall_file"))
      .toBe(true);
  });
  
  test("text with paywall words 2/2", () => {
    expect(looksPaywalledUrl("https://domain/some_account_file"))
      .toBe(true);
  });
  
  test("text without paywall words", () => {
    expect(looksPaywalledUrl("https://domain/no_special_file"))
      .toBe(false);
  });
});

describe("inRetrievePdfSession", () => {
  test("not in retrieve PDF session", () => {
    captureSession = null;
    expect(inRetrievePdfSession(1))
      .toBe(false);
  });
  
  test(" in retrieve PDF session", () => {
    captureSession = { tabId: 1 };
    expect(inRetrievePdfSession(1))
      .toBe(true);
  });
});

describe("retrievingPdfFile", () => {
  test("not retrieving PDF file", () => {
    expect(retrievingPdfFile({ responseHeaders: null }))
      .toBe(false);
  });
  
  test("retrieving PDF file", () => {
    expect(retrievingPdfFile({
           responseHeaders: [ { name: "Content-type", 
                                value: "application/pdf" } ]
           }))
      .toBe(true);
  });
});

describe("storeDetailsInSessionData", () => {
  test("storeDetailsInSessionData", () => {
    details = { type: "main_frame", 
                url: "url",
                statusCode: "statusCode",
                responseHeaders: [ { name: "Content-type",
                                     value: "Content-type" } ] };
    captureSession = {};
    storeDetailsInSessionData(details);
    expect(captureSession.lastMainUrl).toBe(details.url);
    expect(captureSession.lastMainStatus).toBe(details.statusCode);
    expect(captureSession.lastMainContentType).toBe("content-type");
  });
});

describe("retrievingAttachment", () => {
  test("not retrieving attachment", () => {
    expect(retrievingAttachment({ responseHeaders: null }))
      .toBe(false);
  });
  
  test("retrieving attachment", () => {
    expect(retrievingAttachment({
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
    global.browser = {
      webRequest: { filterResponseData: jest.fn().mockReturnValue(fakeFilter) },
      downloads: { download: jest.fn().mockResolvedValue(123) }
    };
    global.self = {
      ...STATUS_CONSTANTS,
      sanitizeDOI: (doi) => doi,
      removeSlashes: (s) => s.replace(/\//g, "_"),
      failCapture: jest.fn(),
      recordDownload: jest.fn(),
    };
  });

  test("stream PDF data, trigger a download when expectBrowserDownload is false", async () => {
    global.captureSession = {
      "expectBrowserDownload": false,
      "doi": "10.1234/foo.bar",
    }
    global.URL = {
      "createObjectURL": jest.fn().mockReturnValue("blob:fake"),
      "revokeObjectURL": jest.fn()
    }
  
    processIncomingPdfData({ requestId: "req-1" });
  
    expect(browser.webRequest.filterResponseData).toHaveBeenCalledWith("req-1");
  
    // test fakeFilter
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
      filename: "10.1234_foo.bar.pdf", // DOI with '/' replaced by '_' + ".pdf"
      saveAs: false,
    });
    expect(self.failCapture).not.toHaveBeenCalled();
  });
  
  test("setting expectBrowserDownload prevents browser download", async () => {
    global.captureSession = {
      "doi": DOI,
      "expectBrowserDownload": true
    };
    processIncomingPdfData({ requestId: "req-2" });
    await fakeFilter.onstop();
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  test("a PDF the browser downloads itself is not filtered", () => {
    global.captureSession = { doi: DOI, pageCounter: 1, expectBrowserDownload: true };
    processIncomingPdfData({ requestId: "req-2b" });
    expect(browser.webRequest.filterResponseData).not.toHaveBeenCalled();
  });

  test("seems redundant?", async () => {
    global.captureSession = {
      "doi": DOI,
      "expectBrowserDownload": false
    };
    processIncomingPdfData({ requestId: "req-3" });
    await fakeFilter.onstop();
    expect(browser.downloads.download).toHaveBeenCalled();
  });

  test("test response to download error", async () => {
    global.browser.downloads.download = jest.fn().mockImplementation(() => {
      throw new Error("something went wrong!");
    });
    self.failCapture.mockClear();
    processIncomingPdfData({ requestId: "req-4" });
    await fakeFilter.onstop();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
  });

  test("a failed save is recorded in the download stage of the capture's row", async () => {
    const SAVE_SESSION = { doi: DOI, pageCounter: 2, expectBrowserDownload: false };
    const SAVE_ERROR = "disk full";
    global.captureSession = SAVE_SESSION;
    global.URL = { createObjectURL: jest.fn(), revokeObjectURL: jest.fn() };
    global.browser.downloads.download = jest.fn().mockRejectedValue(new Error(SAVE_ERROR));
    processIncomingPdfData({ requestId: "req-5" });
    global.captureSession = null;  // a later event may already have ended the session
    await fakeFilter.onstop();
    expect(self.recordDownload).toHaveBeenCalledWith(
      `${STATUS_ACCESS_ERROR}: Saving PDF failed: ${SAVE_ERROR}`, pdfFilename(SAVE_SESSION.doi), SAVE_SESSION);
  });

  test("a failed save ends the capture", async () => {
    global.captureSession = { doi: DOI, pageCounter: 1, expectBrowserDownload: false };
    global.URL = { createObjectURL: jest.fn(), revokeObjectURL: jest.fn() };
    global.browser.downloads.download = jest.fn().mockRejectedValue(new Error("disk full"));
    processIncomingPdfData({ requestId: "req-6" });
    await fakeFilter.onstop();
    expect(global.captureSession).toBe(null);
  });

  test("a response that breaks off is recorded as a failed download and ends the capture", () => {
    const TRANSFER_SESSION = { doi: DOI, pageCounter: 2, expectBrowserDownload: false };
    const TRANSFER_ERROR = "Channel redirected";
    global.captureSession = TRANSFER_SESSION;
    processIncomingPdfData({ requestId: "req-7" });
    fakeFilter.error = TRANSFER_ERROR;
    fakeFilter.onerror();
    const reason = `PDF transfer stopped: ${TRANSFER_ERROR}`;
    expect(self.recordDownload).toHaveBeenCalledWith(
      `${STATUS_ACCESS_ERROR}: ${reason}`, pdfFilename(TRANSFER_SESSION.doi), TRANSFER_SESSION);
    expect(self.failCapture).toHaveBeenCalledWith(reason);
    expect(global.captureSession).toBe(null);
  });

  test("a response that breaks off after its capture ended reports nothing", () => {
    global.captureSession = { doi: DOI, pageCounter: 1, expectBrowserDownload: false };
    processIncomingPdfData({ requestId: "req-8" });
    global.captureSession = null;  // e.g. already ended by a capture timeout
    fakeFilter.onerror();
    expect(self.recordDownload).not.toHaveBeenCalled();
    expect(self.failCapture).not.toHaveBeenCalled();
  });

  test("a response that breaks off does not end a newer capture", () => {
    global.captureSession = { doi: DOI, pageCounter: 1, expectBrowserDownload: false };
    processIncomingPdfData({ requestId: "req-9" });
    const newerSession = { doi: DOI, pageCounter: 2 };
    global.captureSession = newerSession;
    fakeFilter.onerror();
    expect(global.captureSession).toBe(newerSession);
    expect(self.recordDownload).not.toHaveBeenCalled();
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
    global.self = {
      ...STATUS_CONSTANTS,
      failCapture: jest.fn(),
      recordDownload: jest.fn(),
      sendStatus: jest.fn(),
    };
    global.browser = { downloads: { search: jest.fn().mockResolvedValue([downloadItem()]) } };
    global.captureSession = { doi: DOI, pageCounter: 1, lastMainUrl: PDF_URL };
    global.downloadLog = "";
  });

  test("a completed download is recorded, logged, and ends the capture", async () => {
    await processDownloadChange(stateChange("complete"));
    expect(browser.downloads.search).toHaveBeenCalledWith({ id: DOWNLOAD_ID });
    expect(self.recordDownload).toHaveBeenCalledWith(STATUS_SUCCESS, pdfFilename(DOI));
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching(SAVED_PATH));
    expect(global.downloadLog).toBe(`${DOI},${SAVED_PATH}\n`);
    expect(global.captureSession).toBe(null);
  });

  test("an interrupted download is recorded as failed with its reason, and ends the capture", async () => {
    browser.downloads.search.mockResolvedValue([downloadItem({ error: CANCELLED })]);
    await processDownloadChange(stateChange("interrupted"));
    const reason = `Download interrupted (${CANCELLED})`;
    expect(self.recordDownload).toHaveBeenCalledWith(`${STATUS_ACCESS_ERROR}: ${reason}`, pdfFilename(DOI));
    expect(self.failCapture).toHaveBeenCalledWith(reason);
    expect(global.downloadLog).toBe("");
    expect(global.captureSession).toBe(null);
  });

  test("the reason is taken from the change when the download item has none", async () => {
    await processDownloadChange({ ...stateChange("interrupted"), error: { current: CANCELLED } });
    expect(self.failCapture).toHaveBeenCalledWith(`Download interrupted (${CANCELLED})`);
  });

  test("an interrupted download of the captured address counts even without a PDF type or name", async () => {
    browser.downloads.search.mockResolvedValue([downloadItem({ mime: "", filename: "", error: CANCELLED })]);
    await processDownloadChange(stateChange("interrupted"));
    expect(self.failCapture).toHaveBeenCalledTimes(1);
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
    expect(self.recordDownload).not.toHaveBeenCalled();
    expect(global.downloadLog).toBe("");
  });

  test("a download that is not the captured PDF is ignored", async () => {
    browser.downloads.search.mockResolvedValue([
      downloadItem({ mime: "text/csv", filename: "my_table.csv", url: "blob:other" })]);
    await processDownloadChange(stateChange("complete"));
    expect(self.recordDownload).not.toHaveBeenCalled();
    expect(global.captureSession).not.toBe(null);
  });
});

describe("startJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.self = {
      openOrFocusStatusTab: jest.fn().mockResolvedValue({}),
      sanitizeDOI: (doi) => doi,
      seedPageLoadRow: jest.fn(),
      sendStatus: jest.fn(),
    }
    global.browser = {
      tabs: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      storage: { local: { set: jest.fn().mockResolvedValue(undefined) } }
    }
    browser.tabs.create.mockResolvedValue({ id: JOB_TAB_ID });
  });

  test("default usage", async() => {
    await startJob(DOI);
    const [ returnValue ] = global.browser.storage.local.set.mock.calls[0];
    expect(returnValue.job.url).toBe(DOI_URL);
    expect(returnValue.job.tabId).toBe(JOB_TAB_ID);
    expect(browser.tabs.update).toHaveBeenCalledWith(JOB_TAB_ID, { url: DOI_URL });
  });

  test("opens an empty tab and loads the DOI page only after storing the job", async() => {
    await startJob(DOI);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: EMPTY_PAGE_URL, active: false });
    const storeOrder = browser.storage.local.set.mock.invocationCallOrder[0];
    const loadOrder = browser.tabs.update.mock.invocationCallOrder[0];
    expect(storeOrder).toBeLessThan(loadOrder);
  });

  test("does not load the DOI page when the job cannot be stored", async() => {
    browser.storage.local.set.mockRejectedValue(new Error("storage full"));
    await startJob(DOI);
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Could not start job"), true);
  });

  test("opens the status tab and keeps it in view", async() => {
    await startJob(DOI);
    expect(self.openOrFocusStatusTab).toHaveBeenCalledTimes(1);
    expect(browser.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  test("still starts the job when the status tab cannot be opened", async() => {
    self.openOrFocusStatusTab.mockRejectedValue(new Error("no tabs"));
    await startJob(DOI);
    await Promise.resolve();  // let the rejection handler run
    expect(browser.tabs.update).toHaveBeenCalledWith(JOB_TAB_ID, { url: DOI_URL });
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Could not open status table"), true);
  });

  test("shows a placeholder row for the DOI page", async() => {
    await startJob(DOI);
    expect(self.seedPageLoadRow).toHaveBeenCalledWith(DOI, DOI_URL);
  });

  test("starts counting pages from zero again", async() => {
    global.jobPageCounter = 3;
    await startJob(DOI);
    expect(global.jobPageCounter).toBe(0);
  });

  test("test reaction to job error", async() => {
    global.browser.storage.local.set = jest.fn().mockImplementation(() => {
      throw new Error("something went wrong!");
    });
    await startJob(DOI);
    expect(self.sendStatus).toHaveBeenCalledTimes(3);
  });
});

describe("checkRobotsBeforeRequest", () => {
  const OTHER_TAB_ID = 8;
  const PAGE_URL = "https://publisher.example.org/article/1";
  const BLOCK_REASON = "blocked by robots.txt";

  const TRIGGERING_PAGE_URL = "https://linkinghub.example.org/retrieve/1";

  function pageRequest(tabId, originUrl = undefined) {
    return { tabId, url: PAGE_URL, type: "main_frame", originUrl };
  }

  beforeEach(() => {
    global.self = {
      recordRobotsBlock: jest.fn(),
      robotsAccessAllowed: jest.fn().mockResolvedValue({ accessAllowed: true, blockReason: null }),
      sendStatus: jest.fn(),
    };
    global.browser = {
      storage: { local: { get: jest.fn().mockResolvedValue({ job: { doi: DOI, tabId: JOB_TAB_ID } }) } },
    };
  });

  test("lets an allowed request in the job's tab pass", async() => {
    await expect(checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID))).resolves.toEqual({});
    expect(self.robotsAccessAllowed).toHaveBeenCalledWith(PAGE_URL);
    expect(self.sendStatus).not.toHaveBeenCalled();
    expect(self.recordRobotsBlock).not.toHaveBeenCalled();
  });

  test("cancels a disallowed request in the job's tab and reports why", async() => {
    self.robotsAccessAllowed.mockResolvedValue({ accessAllowed: false, blockReason: BLOCK_REASON });
    await expect(checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID))).resolves.toEqual({ cancel: true });
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringContaining(PAGE_URL), true);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringContaining(BLOCK_REASON), true);
    expect(self.recordRobotsBlock).toHaveBeenCalledWith(DOI, PAGE_URL, BLOCK_REASON, false);
  });

  test("tells recordRobotsBlock whether a web page triggered the request", async() => {
    self.robotsAccessAllowed.mockResolvedValue({ accessAllowed: false, blockReason: BLOCK_REASON });
    await checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID, TRIGGERING_PAGE_URL));
    expect(self.recordRobotsBlock).toHaveBeenLastCalledWith(DOI, PAGE_URL, BLOCK_REASON, true);
    await checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID, "moz-extension://extension-id/background.html"));
    expect(self.recordRobotsBlock).toHaveBeenLastCalledWith(DOI, PAGE_URL, BLOCK_REASON, false);
  });

  test("cancels the request when the check itself fails", async() => {
    self.robotsAccessAllowed.mockRejectedValue(new Error("unexpected"));
    await expect(checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID))).resolves.toEqual({ cancel: true });
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringContaining("robots.txt check failed: unexpected"), true);
  });

  test("lets requests in other tabs pass without a check", async() => {
    await expect(checkRobotsBeforeRequest(pageRequest(OTHER_TAB_ID))).resolves.toEqual({});
    expect(self.robotsAccessAllowed).not.toHaveBeenCalled();
  });

  test("lets requests pass without a check when there is no job", async() => {
    browser.storage.local.get.mockResolvedValue({});
    await expect(checkRobotsBeforeRequest(pageRequest(JOB_TAB_ID))).resolves.toEqual({});
    expect(self.robotsAccessAllowed).not.toHaveBeenCalled();
  });
});

describe("recordRobotsBlock", () => {
  const BLOCKED_URL = "https://www.sciencedirect.com/science/article/pii/S0000000000000000";
  const BLOCK_REASON = "blocked by robots.txt";
  const BLOCK_STATUS = `${STATUS_ACCESS_ERROR}: ${BLOCK_REASON}`;
  const CAPTURED_PAGE_COUNTER = 2;

  beforeEach(() => {
    jest.useFakeTimers();
    global.self = {
      ...STATUS_CONSTANTS,
      recordCapture: jest.fn(),
      recordPdfCapture: jest.fn(),
      recordPublisherPageAccess: jest.fn(),
      sendProgressUpdate: jest.fn(),
      sendStatus: jest.fn(),
    };
    global.captureSession = null;
    global.jobPageCounter = 0;
    global.pageLoadTimeoutId = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const LOADED_PAGE_URL = "https://linkinghub.elsevier.com/retrieve/pii/S0000000000000000";

  test("records a block before the first page loaded on its pending row", () => {
    seedPageLoadRow(DOI, DOI_URL);
    recordRobotsBlock(DOI, BLOCKED_URL, BLOCK_REASON, false);
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 1, BLOCK_STATUS, BLOCKED_URL);
    jest.runAllTimers();  // the "page did not load" timeout must not overwrite the block
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 1, BLOCK_STATUS, BLOCKED_URL);
  });

  test("records a block not triggered by a page after the page loaded as a new row", () => {
    seedPageLoadRow(DOI, DOI_URL);
    recordContentProgress({ stage: "page", doi: DOI, url: LOADED_PAGE_URL });
    recordRobotsBlock(DOI, BLOCKED_URL, BLOCK_REASON, false);
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 2, BLOCK_STATUS, BLOCKED_URL);
    expect(self.sendProgressUpdate).toHaveBeenCalled();
  });

  // A page that moves on by itself stays in the tab when that is blocked, and its content
  // script reports it as loaded before or after the block: neither may overwrite the other.
  test.each([
    ["before", () => {
      recordContentProgress({ stage: "page", doi: DOI, url: LOADED_PAGE_URL });
      recordRobotsBlock(DOI, BLOCKED_URL, BLOCK_REASON, true);
    }],
    ["after", () => {
      recordRobotsBlock(DOI, BLOCKED_URL, BLOCK_REASON, true);
      recordContentProgress({ stage: "page", doi: DOI, url: LOADED_PAGE_URL });
    }],
  ])("records a block triggered by a page reported %s it, in that page's capture cells", (reportOrder, reportAndBlock) => {
    seedPageLoadRow(DOI, DOI_URL);
    reportAndBlock();
    jest.runAllTimers();
    expect(self.recordPdfCapture).toHaveBeenCalledWith(DOI, 1, BLOCK_STATUS, BLOCKED_URL);
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 1, STATUS_SUCCESS, LOADED_PAGE_URL);
  });

  test("records a block during a capture in the capture cells and ends the capture", () => {
    const captureTimeout = jest.fn();
    global.captureSession = { doi: DOI, pageCounter: CAPTURED_PAGE_COUNTER, timeoutId: setTimeout(captureTimeout, CAPTURE_TIMEOUT_MS) };
    recordRobotsBlock(DOI, BLOCKED_URL, BLOCK_REASON, true);
    expect(self.recordCapture).toHaveBeenCalledWith(BLOCK_STATUS, BLOCKED_URL);
    expect(self.recordPublisherPageAccess).not.toHaveBeenCalled();
    expect(global.captureSession).toBeNull();
    jest.runAllTimers();
    expect(captureTimeout).not.toHaveBeenCalled();
  });
});

describe("watched tabs for downloads by hand", () => {
  const ASSISTED_TAB_ID = 12;
  const PDF_TAB_ID = 13;
  const OTHER_TAB_ID = 14;
  const CLICKED_PAGE_COUNTER = "1";
  const MANUAL_PAGE_LABEL = CLICKED_PAGE_COUNTER + MANUAL_PAGE_SUFFIX;
  const CLICKED_URL = "https://www.sciencedirect.com/science/article/pii/S0000000000000000";
  const WATCHED_ENTRY = {
    doi: DOI, clickedPageCounter: CLICKED_PAGE_COUNTER, manualPageLabel: MANUAL_PAGE_LABEL,
    clickedUrl: CLICKED_URL, pdfResponses: [],
  };

  // Stands in for browser.storage.local, keeping copies like the real storage does.
  let storedItems;

  function copyOf(storedValue) {
    return JSON.parse(JSON.stringify(storedValue));
  }

  function storedAssistedTabs() {
    return storedItems.assistedTabs;
  }

  beforeEach(() => {
    storedItems = {};
    global.self = { sendStatus: jest.fn() };
    global.browser = {
      storage: {
        local: {
          get: jest.fn(async (storageKey) => (storageKey in storedItems ? { [storageKey]: copyOf(storedItems[storageKey]) } : {})),
          set: jest.fn(async (newItems) => { Object.assign(storedItems, copyOf(newItems)); }),
        },
      },
    };
  });

  test("watches a tab opened from the table for a new row numbered after the clicked row", async () => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    expect(storedAssistedTabs()).toEqual({ [ASSISTED_TAB_ID]: WATCHED_ENTRY });
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringContaining(`row "${MANUAL_PAGE_LABEL}"`));
  });

  test("continues a manual row when an address in that row is clicked", async () => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, MANUAL_PAGE_LABEL, CLICKED_URL);
    expect(storedAssistedTabs()[ASSISTED_TAB_ID]).toEqual(WATCHED_ENTRY);
  });

  test("watches a tab opened from a watched tab for the same row", async () => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    await watchTabOpenedFromAssistedTab({ id: PDF_TAB_ID, openerTabId: ASSISTED_TAB_ID });
    expect(storedAssistedTabs()[PDF_TAB_ID]).toEqual(WATCHED_ENTRY);
  });

  test.each([
    ["an unwatched tab", { id: PDF_TAB_ID, openerTabId: OTHER_TAB_ID }],
    ["no tab", { id: PDF_TAB_ID }],
  ])("does not watch a tab opened from %s", async (openerName, createdTab) => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    browser.storage.local.set.mockClear();
    await watchTabOpenedFromAssistedTab(createdTab);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(storedAssistedTabs()).not.toHaveProperty(String(PDF_TAB_ID));
  });

  test("forgets a watched tab when it is closed, and ignores other closed tabs", async () => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    await forgetAssistedTab(OTHER_TAB_ID);
    expect(storedAssistedTabs()).toHaveProperty(String(ASSISTED_TAB_ID));
    await forgetAssistedTab(ASSISTED_TAB_ID);
    expect(storedAssistedTabs()).toEqual({});
  });

  test("forgets all watched tabs when Firefox starts", async () => {
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    await clearAssistedTabs();
    expect(storedAssistedTabs()).toEqual({});
  });

  test("keeps both of two changes made at the same time", async () => {
    await Promise.all([
      watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL),
      watchAssistedTab(OTHER_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL),
    ]);
    expect(Object.keys(storedAssistedTabs()).sort()).toEqual([String(ASSISTED_TAB_ID), String(OTHER_TAB_ID)]);
  });

  test("reports a failing storage, and goes on with the next change", async () => {
    browser.storage.local.set.mockRejectedValueOnce(new Error("storage full"));
    await watchAssistedTab(ASSISTED_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    expect(self.sendStatus).toHaveBeenCalledWith("Could not update the watched tabs: storage full", true);
    await watchAssistedTab(OTHER_TAB_ID, DOI, CLICKED_PAGE_COUNTER, CLICKED_URL);
    expect(storedAssistedTabs()).toHaveProperty(String(OTHER_TAB_ID));
  });
});

describe("armCaptureOnly", () => {
  test("armCaptureOnly", async() => {
    global.self = { 
      armCaptureBase: jest.fn(),
      sendStatus: jest.fn(), 
    }
    const tabId = 123;
    const expectedUrl = "https://domain/dir";
    const result = await armCaptureOnly(DOI, tabId, expectedUrl);
    expect(result).toBe(true);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    expect(self.armCaptureBase).toHaveBeenCalledWith(DOI, tabId, expectedUrl);
  });
});

describe("armCaptureAndNavigate", () => {
  test("armCaptureAndNavigate", () => {
    global.self = {
      armCaptureBase: jest.fn(),
      sendStatus: jest.fn(), 
    };
    global.browser = {tabs: {update: jest.fn(), }};
    const tabId = 123;
    const expectedUrl = "https://domain/dir";
    const result = armCaptureAndNavigate(DOI, tabId, expectedUrl);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    expect(self.armCaptureBase).toHaveBeenCalledWith(DOI, tabId, expectedUrl);
    expect(browser.tabs.update).toHaveBeenCalledWith(tabId, {"url": expectedUrl});
  });
});

describe("armCaptureBase", () => {
  const tabId = 123;
  let expectedUrl = "";

  beforeEach(() => {
    jest.clearAllMocks();
    global.self = {
      ...STATUS_CONSTANTS,
      failCapture: jest.fn(),
      recordCapture: jest.fn(),
      sendStatus: jest.fn(),
    };
    global.captureSession = null;
    global.jobPageCounter = 0;
    expectedUrl = "https://domain/dir";
  });

  test("without automatic download", async () => {
    const returnedFileType = armCaptureBase(DOI, tabId, expectedUrl);
    expect(global.captureSession).not.toBe(null);
    expect(global.captureSession.tabId).toBe(tabId);
    expect(global.captureSession.doi).toBe(DOI);
    expect(global.captureSession.expectedUrl).toBe(expectedUrl);
    expect(global.captureSession.sawPdf).toBe(false);
    //expect(global.captureSession.timeoutId).toBe(null);
    expect(global.captureSession.pageCounter).toBe(1);
    expect(returnedFileType).toBe("HTML");
    expect(self.failCapture).toHaveBeenCalledTimes(0);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Armed capture"));
  });

  test("with automatic download", async () => {
    expectedUrl = "download?file=abc.pdf";
    const returnedFileType = armCaptureBase(DOI, tabId, expectedUrl);
    expect(returnedFileType).toBe("PDF");
  });

  test("missing expected url", async () => {
    const returnedFileType = armCaptureBase(DOI, tabId, null);
    expect(returnedFileType).toBe("unknown");
   });

  test("download that takes too much time", async () => {
    jest.useFakeTimers();
    const returnedFileType = armCaptureBase(DOI, tabId, expectedUrl);
    expect(self.failCapture).toHaveBeenCalledTimes(0);
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`No PDF response`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
  });

  test("reading html page", async () => {
    jest.useFakeTimers();
    const returnedFileType = await armCaptureBase(DOI, tabId, expectedUrl);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    global.captureSession.lastMainContentType = "text/html";
    self.looksPaywalledUrl = jest.fn().mockReturnValue(false);
    self.failCapture.mockClear();
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`^Received HTML`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
  });

  test("fethcing html page takes two much time", async () => {
    jest.useFakeTimers();
    returnedFileType = await armCaptureBase(DOI, tabId, expectedUrl);
    global.captureSession.lastMainContentType = "text/html";
    self.looksPaywalledUrl = jest.fn().mockReturnValue(true);
    self.failCapture.mockClear();
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`^Redirected`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
  });

  test("take care of incorrect status code", async () => {
    jest.useFakeTimers();
    returnedFileType = await armCaptureBase(DOI, tabId, expectedUrl);
    global.captureSession.lastMainStatus = 401;
    self.failCapture.mockClear();
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`^Access denied`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
  });

  test("a failed capture is recorded with its status and target url", () => {
    jest.useFakeTimers();
    armCaptureBase(DOI, tabId, expectedUrl);
    global.captureSession.lastMainStatus = 403;
    jest.runAllTimers();
    expect(self.recordCapture).toHaveBeenCalledWith(
      expect.stringMatching(`^${STATUS_ACCESS_ERROR}: Access denied`), expectedUrl);
    jest.useRealTimers();
  });

  test("a capture without any PDF response is recorded as not found", () => {
    jest.useFakeTimers();
    armCaptureBase(DOI, tabId, expectedUrl);
    jest.runAllTimers();
    expect(self.recordCapture).toHaveBeenCalledWith(
      expect.stringMatching(`^${STATUS_NOT_FOUND}: No PDF response`), expectedUrl);
    jest.useRealTimers();
  });

  test("each capture of a job gets the next page number", () => {
    armCaptureBase(DOI, tabId, expectedUrl);
    expect(global.captureSession.pageCounter).toBe(1);
    armCaptureBase(DOI, tabId, expectedUrl);
    expect(global.captureSession.pageCounter).toBe(2);
    expect(global.jobPageCounter).toBe(2);
  });

  test("captures after the first one have an unknown target type", () => {
    expect(armCaptureBase(DOI, tabId, expectedUrl)).toBe("HTML");
    expect(armCaptureBase(DOI, tabId, expectedUrl)).toBe("unknown");
  });

  test("a new capture records the previous page's capture as skipped", () => {
    const LANDING_URL = "https://domain/landing";
    armCaptureBase(DOI, tabId, expectedUrl);
    const previousSession = global.captureSession;
    previousSession.lastMainUrl = LANDING_URL;
    armCaptureBase(DOI, tabId, expectedUrl);
    expect(self.recordCapture).toHaveBeenCalledWith(
      `${STATUS_SKIPPED}: HTML page, searched as page ${previousSession.pageCounter + 1}`,
      LANDING_URL, previousSession);
  });

  test("a new capture does not overwrite a previous capture that saw a PDF", () => {
    armCaptureBase(DOI, tabId, expectedUrl);
    global.captureSession.sawPdf = true;
    armCaptureBase(DOI, tabId, expectedUrl);
    expect(self.recordCapture).not.toHaveBeenCalled();
  });

  test("a new capture cancels the previous capture's timeout", () => {
    jest.useFakeTimers();
    armCaptureBase(DOI, tabId, expectedUrl);
    jest.advanceTimersByTime(CAPTURE_TIMEOUT_MS / 2);
    armCaptureBase(DOI, tabId, expectedUrl);
    jest.advanceTimersByTime(CAPTURE_TIMEOUT_MS / 2);
    expect(self.failCapture).not.toHaveBeenCalled();
    expect(global.captureSession).not.toBe(null);
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe("recording functions", () => {
  const session = { doi: DOI, pageCounter: 2 };
  const otherSession = { doi: "10.1234/other", pageCounter: 3 };
  const html = "<table></table>";
  const PDF_URL = "https://domain/a.pdf";
  const REASON = "paywall";

  beforeEach(() => {
    global.self = {
      failCapture: jest.fn(),
      recordCapture: jest.fn(),
      recordPdfCapture: jest.fn(),
      recordPdfDownload: jest.fn(),
      sendProgressUpdate: jest.fn(),
      toHtml: jest.fn().mockReturnValue(html),
    };
    global.browser = { runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
    global.captureSession = session;
  });

  test("sendProgressUpdate sends the current table to the status tab", () => {
    sendProgressUpdate();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "progress-update", html });
  });

  test("sendProgressUpdate ignores a missing status tab", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    expect(() => sendProgressUpdate()).not.toThrow();
  });

  test("recordCapture records in the current session's row and pushes the table", () => {
    recordCapture(STATUS_SUCCESS, PDF_URL);
    expect(self.recordPdfCapture).toHaveBeenCalledWith(
      session.doi, session.pageCounter, STATUS_SUCCESS, PDF_URL);
    expect(self.sendProgressUpdate).toHaveBeenCalledTimes(1);
  });

  test("recordCapture can record in another session's row", () => {
    recordCapture(STATUS_SUCCESS, PDF_URL, otherSession);
    expect(self.recordPdfCapture).toHaveBeenCalledWith(
      otherSession.doi, otherSession.pageCounter, STATUS_SUCCESS, PDF_URL);
  });

  test("recordDownload records in the current session's row and pushes the table", () => {
    recordDownload(STATUS_SUCCESS, pdfFilename(session.doi));
    expect(self.recordPdfDownload).toHaveBeenCalledWith(
      session.doi, session.pageCounter, STATUS_SUCCESS, pdfFilename(session.doi));
    expect(self.sendProgressUpdate).toHaveBeenCalledTimes(1);
  });

  test("recordDownload can record in another session's row", () => {
    recordDownload(STATUS_SUCCESS, pdfFilename(otherSession.doi), otherSession);
    expect(self.recordPdfDownload).toHaveBeenCalledWith(
      otherSession.doi, otherSession.pageCounter, STATUS_SUCCESS, pdfFilename(otherSession.doi));
  });

  test("recordCaptureFailure records the status with its reason and reports the failure", () => {
    recordCaptureFailure(STATUS_ACCESS_ERROR, REASON, PDF_URL);
    expect(self.recordCapture).toHaveBeenCalledWith(`${STATUS_ACCESS_ERROR}: ${REASON}`, PDF_URL);
    expect(self.failCapture).toHaveBeenCalledWith(REASON);
  });
});

describe("page-load and link-search recording", () => {
  const PAGE_URL = "https://publisher.example/article";
  const PDF_URL = "https://publisher.example/article.pdf";

  beforeEach(() => {
    jest.useFakeTimers();
    global.self = {
      ...STATUS_CONSTANTS,
      recordPublisherPageAccess: jest.fn(),
      recordPdfLinkFound: jest.fn(),
      sendProgressUpdate: jest.fn(),
      sendStatus: jest.fn(),
    };
    global.jobPageCounter = 0;
    global.pageLoadTimeoutId = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("seedPageLoadRow shows page 1 as pending until it is confirmed", () => {
    seedPageLoadRow(DOI, DOI_URL);
    expect(self.recordPublisherPageAccess).toHaveBeenCalledWith(
      DOI, 1, `${STATUS_PENDING}: ${PAGE_LOAD_PENDING_REASON}`, DOI_URL);
    expect(self.sendProgressUpdate).toHaveBeenCalledTimes(1);
  });

  test("seedPageLoadRow marks page 1 as failed when it is not confirmed in time", () => {
    seedPageLoadRow(DOI, DOI_URL);
    jest.advanceTimersByTime(PAGE_LOAD_TIMEOUT_MS);
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(
      DOI, 1, `${STATUS_ACCESS_ERROR}: page did not load`, DOI_URL);
    expect(self.sendProgressUpdate).toHaveBeenCalledTimes(2);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching(DOI_URL), true);
  });

  test("seedPageLoadRow cancels the timeout of an earlier job", () => {
    const OTHER_DOI = "10.1234/other";
    seedPageLoadRow(OTHER_DOI, "https://doi.org/" + OTHER_DOI);
    seedPageLoadRow(DOI, DOI_URL);
    jest.runAllTimers();
    expect(self.recordPublisherPageAccess).not.toHaveBeenCalledWith(
      OTHER_DOI, 1, expect.stringMatching(`^${STATUS_ACCESS_ERROR}`), expect.anything());
  });

  test("a confirmed page load is recorded and cancels the page-load timeout", () => {
    seedPageLoadRow(DOI, DOI_URL);
    recordContentProgress({ stage: "page", doi: DOI, url: PAGE_URL });
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 1, STATUS_SUCCESS, PAGE_URL);
    jest.runAllTimers();
    expect(self.recordPublisherPageAccess).toHaveBeenLastCalledWith(DOI, 1, STATUS_SUCCESS, PAGE_URL);
  });

  test("a page load belongs to the page after the ones already captured", () => {
    global.jobPageCounter = 2;
    recordContentProgress({ stage: "page", doi: DOI, url: PAGE_URL });
    expect(self.recordPublisherPageAccess).toHaveBeenCalledWith(DOI, global.jobPageCounter + 1, STATUS_SUCCESS, PAGE_URL);
  });

  test("a found link is recorded with its url", () => {
    recordContentProgress({ stage: "link", doi: DOI, found: true, url: PDF_URL });
    expect(self.recordPdfLinkFound).toHaveBeenCalledWith(DOI, 1, STATUS_SUCCESS, PDF_URL);
    expect(self.sendProgressUpdate).toHaveBeenCalledTimes(1);
  });

  test("a found button is recorded without a url", () => {
    recordContentProgress({ stage: "link", doi: DOI, found: true, url: null });
    expect(self.recordPdfLinkFound).toHaveBeenCalledWith(DOI, 1, STATUS_SUCCESS, null);
  });

  test("a missing link is recorded as not found", () => {
    recordContentProgress({ stage: "link", doi: DOI, found: false, url: null });
    expect(self.recordPdfLinkFound).toHaveBeenCalledWith(DOI, 1, STATUS_NOT_FOUND, null);
  });

  test("an unknown stage records nothing", () => {
    recordContentProgress({ stage: "other", doi: DOI });
    expect(self.recordPublisherPageAccess).not.toHaveBeenCalled();
    expect(self.recordPdfLinkFound).not.toHaveBeenCalled();
    expect(self.sendProgressUpdate).not.toHaveBeenCalled();
  });
});

describe("failCapture", () => {
  test("failCapture", () => {
    global.self = { sendStatus: jest.fn(), };
    const text = "text";
    failCapture(text);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
  });
});

describe("saveLog", () => {
  test("saveLog", () => {
    global.self = { sendStatus: jest.fn(), };
    global.browser = { "downloads": { "download": jest.fn(), }}
    const csvTextData = "col1,col2\n1,2";
    saveLog(csvTextData);
    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
  });
});
