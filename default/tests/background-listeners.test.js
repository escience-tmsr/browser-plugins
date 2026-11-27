const { STATUS_MESSAGE_TYPE } = require("../src/status-report");
global.STATUS_MESSAGE_TYPE = STATUS_MESSAGE_TYPE;
const background = require("../background-listeners");
const {
  registerBackgroundListeners, handleResponseHeaders, handleMessage,
  GET_PROGRESS_MESSAGE_TYPE, RECORD_PROGRESS_MESSAGE_TYPE, TAB_ID_REQUEST_MESSAGE_TYPE, START_JOB_MESSAGE_TYPE,
  SAVE_LOG_MESSAGE_TYPE, ARM_CAPTURE_MESSAGE_TYPE, CAPTURE_LINK_MESSAGE_TYPE,
} = background;

const JOB_DOI = "10.1234/doi";
const SENDER_TAB_ID = 7;
const MESSAGE_TAB_ID = 8;
const PDF_URL = "https://publisher.example/article.pdf";
const RESPONSE_DETAILS = { tabId: SENDER_TAB_ID, url: PDF_URL };
const TIMEOUT_ID = 42;
const PAGE_COUNTER = 2;
const ALL_RESPONSES_FILTER = { urls: ["<all_urls>"] };
const RESPONSE_LISTENER_OPTIONS = ["blocking", "responseHeaders"];

function mockBackgroundEnvironment() {
  global.browser = {
    downloads: { onChanged: { addListener: jest.fn() } },
    runtime: { onMessage: { addListener: jest.fn() } },
    webRequest: { onHeadersReceived: { addListener: jest.fn() } },
  };
  Object.assign(self, {
    STATUS_SUCCESS: "success",
    armCaptureAndNavigate: jest.fn().mockResolvedValue(undefined),
    armCaptureOnly: jest.fn().mockResolvedValue(true),
    isCapturingPdfInTab: jest.fn().mockReturnValue(true),
    isPdfResponse: jest.fn().mockReturnValue(true),
    processDownloadChange: jest.fn().mockResolvedValue(undefined),
    processIncomingPdfData: jest.fn(),
    recordCapture: jest.fn(),
    recordContentProgress: jest.fn(),
    renderProgressTableHtml: jest.fn().mockReturnValue("<table></table>"),
    reportStatus: jest.fn(),
    retrievingAttachment: jest.fn().mockReturnValue(false),
    saveLog: jest.fn(),
    startJob: jest.fn().mockResolvedValue(undefined),
    storeDetailsInSessionData: jest.fn(),
  });
  jest.spyOn(global, "clearTimeout");
  background.captureSession = { sawPdf: false, timeoutId: TIMEOUT_ID, pageCounter: PAGE_COUNTER, lastMainUrl: null };
}

function handleMessageFromTab(message) {
  return handleMessage(message, { tab: { id: SENDER_TAB_ID } });
}

beforeEach(() => {
  mockBackgroundEnvironment();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registerBackgroundListeners", () => {
  test("connects each browser event to its handler", () => {
    registerBackgroundListeners();
    expect(browser.webRequest.onHeadersReceived.addListener)
      .toHaveBeenCalledWith(handleResponseHeaders, ALL_RESPONSES_FILTER, RESPONSE_LISTENER_OPTIONS);
    expect(browser.downloads.onChanged.addListener).toHaveBeenCalledWith(self.processDownloadChange);
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledWith(handleMessage);
  });
});

describe("handleResponseHeaders", () => {
  test("ignores a response outside a capture session", () => {
    self.isCapturingPdfInTab.mockReturnValue(false);
    handleResponseHeaders(RESPONSE_DETAILS);
    expect(self.isCapturingPdfInTab).toHaveBeenCalledWith(background.captureSession, SENDER_TAB_ID);
    expect(self.storeDetailsInSessionData).not.toHaveBeenCalled();
    expect(self.processIncomingPdfData).not.toHaveBeenCalled();
  });

  test("stores the details of a response that is not a pdf", () => {
    self.isPdfResponse.mockReturnValue(false);
    handleResponseHeaders(RESPONSE_DETAILS);
    expect(self.storeDetailsInSessionData).toHaveBeenCalledWith(RESPONSE_DETAILS);
    expect(background.captureSession.sawPdf).toBe(false);
    expect(self.processIncomingPdfData).not.toHaveBeenCalled();
  });

  test("captures a pdf response", () => {
    handleResponseHeaders(RESPONSE_DETAILS);
    expect(background.captureSession.sawPdf).toBe(true);
    expect(clearTimeout).toHaveBeenCalledWith(TIMEOUT_ID);
    expect(self.reportStatus).toHaveBeenCalledWith("PDF response detected; capturing…");
    expect(self.recordCapture).toHaveBeenCalledWith(self.STATUS_SUCCESS, PDF_URL);
    expect(self.processIncomingPdfData).toHaveBeenCalledWith(RESPONSE_DETAILS);
  });

  test("leaves a pdf attachment to the browser download", () => {
    self.retrievingAttachment.mockReturnValue(true);
    handleResponseHeaders(RESPONSE_DETAILS);
    expect(self.recordCapture).toHaveBeenCalledWith(self.STATUS_SUCCESS, PDF_URL);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringContaining(`(${PAGE_COUNTER})`));
    expect(self.processIncomingPdfData).not.toHaveBeenCalled();
  });
});

describe("handleMessage", () => {
  test("reports a status message without reporting its receipt", () => {
    handleMessageFromTab({ type: STATUS_MESSAGE_TYPE, text: "searching" });
    expect(self.reportStatus).toHaveBeenCalledTimes(1);
    expect(self.reportStatus).toHaveBeenCalledWith("status: searching");
  });

  test("answers a progress request with the progress table", async () => {
    await expect(handleMessageFromTab({ type: GET_PROGRESS_MESSAGE_TYPE })).resolves.toEqual({ html: "<table></table>" });
    expect(self.reportStatus).not.toHaveBeenCalled();
  });

  test("records the progress sent by a content script", async () => {
    const progressMessage = { type: RECORD_PROGRESS_MESSAGE_TYPE, stage: "page", doi: JOB_DOI };
    await expect(handleMessageFromTab(progressMessage)).resolves.toBeUndefined();
    expect(self.recordContentProgress).toHaveBeenCalledWith(progressMessage);
    expect(self.reportStatus).not.toHaveBeenCalled();
  });

  test("answers a tab id request with the id of the sender's tab", async () => {
    await expect(handleMessageFromTab({ type: TAB_ID_REQUEST_MESSAGE_TYPE })).resolves.toEqual({ tabId: SENDER_TAB_ID });
    await expect(handleMessage({ type: TAB_ID_REQUEST_MESSAGE_TYPE }, {})).resolves.toEqual({ tabId: null });
    expect(self.reportStatus).not.toHaveBeenCalled();
  });

  test("starts a job and reports the receipt", () => {
    handleMessageFromTab({ type: START_JOB_MESSAGE_TYPE, doi: JOB_DOI });
    expect(self.reportStatus).toHaveBeenCalledWith(`received message: ${START_JOB_MESSAGE_TYPE}`);
    expect(self.startJob).toHaveBeenCalledWith(JOB_DOI);
  });

  test("saves the download log", () => {
    handleMessageFromTab({ type: SAVE_LOG_MESSAGE_TYPE });
    expect(self.saveLog).toHaveBeenCalledWith("");
  });

  test("arms a capture for the tab in the message", () => {
    handleMessageFromTab({ type: ARM_CAPTURE_MESSAGE_TYPE, doi: JOB_DOI, tabId: MESSAGE_TAB_ID });
    expect(self.armCaptureOnly).toHaveBeenCalledWith(JOB_DOI, MESSAGE_TAB_ID);
  });

  test("reports an unknown message as an error", () => {
    expect(handleMessageFromTab({ type: "unknown" })).toBeUndefined();
    handleMessage(undefined, {});
    expect(self.reportStatus).toHaveBeenNthCalledWith(1, "onMessage: cannot process message: unknown", true);
    expect(self.reportStatus).toHaveBeenNthCalledWith(2, "onMessage: cannot process message: undefined", true);
  });
});

describe("handleMessage for a capture link request", () => {
  test("captures the link in the tab from the message", () => {
    handleMessageFromTab({ type: CAPTURE_LINK_MESSAGE_TYPE, doi: JOB_DOI, tabId: MESSAGE_TAB_ID, pdfUrl: PDF_URL });
    expect(self.armCaptureAndNavigate).toHaveBeenCalledWith(JOB_DOI, MESSAGE_TAB_ID, PDF_URL);
  });

  test("captures the link in the sender's tab when the message has no tab id", () => {
    handleMessageFromTab({ type: CAPTURE_LINK_MESSAGE_TYPE, doi: JOB_DOI, pdfUrl: PDF_URL });
    expect(self.armCaptureAndNavigate).toHaveBeenCalledWith(JOB_DOI, SENDER_TAB_ID, PDF_URL);
  });

  test("captures the link without crashing when there is no capture session", () => {
    background.captureSession = null;
    handleMessageFromTab({ type: CAPTURE_LINK_MESSAGE_TYPE, doi: JOB_DOI, pdfUrl: PDF_URL });
    expect(self.armCaptureAndNavigate).toHaveBeenCalledWith(JOB_DOI, SENDER_TAB_ID, PDF_URL);
  });

  test("skips a link that was already visited", () => {
    background.captureSession.lastMainUrl = PDF_URL;
    handleMessageFromTab({ type: CAPTURE_LINK_MESSAGE_TYPE, doi: JOB_DOI, pdfUrl: PDF_URL });
    expect(self.armCaptureAndNavigate).not.toHaveBeenCalled();
    expect(self.reportStatus).toHaveBeenCalledWith(`skipping already processed url: ${PDF_URL}`);
  });

  test("reports an error when no tab id is known", () => {
    handleMessage({ type: CAPTURE_LINK_MESSAGE_TYPE, doi: JOB_DOI, pdfUrl: PDF_URL }, {});
    expect(self.armCaptureAndNavigate).not.toHaveBeenCalled();
    expect(self.reportStatus).toHaveBeenCalledWith("Cannot download: missing tabId.", true);
  });
});
