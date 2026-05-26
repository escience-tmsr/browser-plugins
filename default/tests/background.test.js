const { armCaptureBase, failCapture, inRetrievePdfSession, looksPaywalledUrl, processIncomingPdfData, removeSlashes, retrievingAttachment, retrievingPdfFile, sanitizeDOI, startJob, storeDetailsInSessionData }  = require("../src/background.functions");

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
      sanitizeDOI: (doi) => doi,
      removeSlashes: (s) => s.replace(/\//g, "_"),
      failCapture: jest.fn(),
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
      "doi": "10.1234/doi",
      "expectBrowserDownload": true
    };
    processIncomingPdfData({ requestId: "req-2" });
    await fakeFilter.onstop();
    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  test("seems redundant?", async () => {
    global.captureSession = {
      "doi": "10.1234/doi",
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
});

describe("startJob", () => {
  const doi = "10.1234/foo.bar";
  const url = "https://doi.org/" + doi;

  beforeEach(() => {
    jest.clearAllMocks();
    global.self = {
      sanitizeDOI: (doi) => doi,
      sendStatus: jest.fn(),
    }
    global.browser = {
      tabs: { create: jest.fn() },
      storage: { local: { set: jest.fn().mockResolvedValue(undefined) } }
    }
    browser.tabs.create.mockResolvedValue(doi);
  });

  test("default usage", async() => {
    await startJob(doi);
    const [ returnValue ] = global.browser.storage.local.set.mock.calls[0];
    expect(returnValue.job.url).toBe(url);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url });
  });

  test("test reaction to job error", async() => {
    global.browser.storage.local.set = jest.fn().mockImplementation(() => {
      throw new Error("something went wrong!");
    });
    await startJob(doi);
    expect(self.sendStatus).toHaveBeenCalledTimes(3);
  });
});

describe("armCaptureOnly", () => {
  test("armCaptureOnly", async() => {
    global.self = { 
      armCaptureBase: jest.fn(),
      sendStatus: jest.fn(), 
    }
    const doi = "doi";
    const tabId = 123;
    const expectedUrl = "https://domain/dir";
    const result = await armCaptureOnly(doi, tabId, expectedUrl);
    expect(result).toBe(true);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    expect(self.armCaptureBase).toHaveBeenCalledWith(doi, tabId, expectedUrl);
  });
});

describe("armCaptureAndNavigate", () => {
  test("armCaptureAndNavigate", () => {
    global.self = {
      armCaptureBase: jest.fn(),
      sendStatus: jest.fn(), 
    };
    global.browser = {tabs: {update: jest.fn(), }};
    const doi = "doi";
    const tabId = 123;
    const expectedUrl = "https://domain/dir";
    const result = armCaptureAndNavigate(doi, tabId, expectedUrl);
    expect(self.sendStatus).toHaveBeenCalledTimes(1);
    expect(self.armCaptureBase).toHaveBeenCalledWith(doi, tabId, expectedUrl);
    expect(browser.tabs.update).toHaveBeenCalledWith(tabId, {"url": expectedUrl});
  });
});

describe("armCaptureBase", () => {
  const doi = "doi";
  const tabId = 123;
  let expectedUrl = "";

  beforeEach(() => {
    jest.clearAllMocks();
    global.self = {
      failCapture: jest.fn(),
      sendStatus: jest.fn(),
    };
    global.captureSession = {}
    expectedUrl = "https://domain/dir";
  });

  test("without automatic download", async () => {
    const returnedFileType = armCaptureBase(doi, tabId, expectedUrl);
    expect(global.captureSession).not.toBe(null);
    expect(global.captureSession.tabId).toBe(tabId);
    expect(global.captureSession.doi).toBe(doi);
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
    const returnedFileType = armCaptureBase(doi, tabId, expectedUrl);
    expect(returnedFileType).toBe("PDF");
  });

  test("missing expected url", async () => {
    const returnedFileType = armCaptureBase(doi, tabId, null);
    expect(returnedFileType).toBe("unknown");
   });

  test("download that takes too much time", async () => {
    jest.useFakeTimers();
    const returnedFileType = armCaptureBase(doi, tabId, expectedUrl);
    expect(self.failCapture).toHaveBeenCalledTimes(0);
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`No PDF response`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
  });

  test("reading html page", async () => {
    jest.useFakeTimers();
    global.captureSession = {}
    const returnedFileType = await armCaptureBase(doi, tabId, expectedUrl);
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
    global.captureSession = {}
    returnedFileType = await armCaptureBase(doi, tabId, expectedUrl);
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
    global.captureSession = {}
    returnedFileType = await armCaptureBase(doi, tabId, expectedUrl);
    global.captureSession.lastMainStatus = 401;
    self.failCapture.mockClear();
    jest.runAllTimers();
    expect(self.failCapture).toHaveBeenCalledTimes(1);
    expect(self.failCapture).toHaveBeenCalledWith(expect.stringMatching(`^Access denied`));
    expect(global.captureSession).toBe(null);
    jest.useRealTimers();
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
