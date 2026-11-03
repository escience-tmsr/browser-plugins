const {
  findElementByPhrase, followPdfLinkOrButton, maybeRunJob, recordProgress, reportStatus,
  PROGRESS_STAGE_PAGE, PROGRESS_STAGE_LINK,
  ACTION_RESULT_LINK_FOUND, ACTION_RESULT_BUTTON_FOUND, ACTION_RESULT_NOT_FOUND, ACTION_RESULT_ERROR,
  JOB_RESULT_FINISHED, JOB_RESULT_PROCESSED, JOB_RESULT_INVALID,
} = require("../src/content.functions");

const DOI = "10.1234/doi";
const LINK_URL = "https://publisher.example/article.pdf";

describe("reportStatus", () => {
  test("report status", () => {
    global.browser = {"runtime": {"sendMessage": jest.fn()}};
    global.console = {"log": jest.fn()};
    const text = "text";
    reportStatus(text);
    expect(self.browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(self.console.log).toHaveBeenCalledTimes(1);
  });
});

describe("recordProgress", () => {
  test("sends the stage, doi and details to the background", async () => {
    global.browser = {"runtime": {"sendMessage": jest.fn().mockResolvedValue()}};
    await recordProgress(PROGRESS_STAGE_LINK, DOI, { found: true, url: LINK_URL });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "record-progress", stage: PROGRESS_STAGE_LINK, doi: DOI, found: true, url: LINK_URL });
  });

  test("resolves when the background does not answer", async () => {
    global.browser = {"runtime": {"sendMessage": jest.fn().mockRejectedValue(new Error("error"))}};
    await expect(recordProgress(PROGRESS_STAGE_PAGE, DOI, { url: LINK_URL })).resolves.toBeUndefined();
  });

  test("resolves when messaging is not available", async () => {
    global.browser = {};
    await expect(recordProgress(PROGRESS_STAGE_PAGE, DOI, { url: LINK_URL })).resolves.toBeUndefined();
  });
});

describe("findElementByPhrase", () => {
  let data = document.createElement("a");
  data.title = "innerText.outerText";

  beforeEach(() => {
    jest.clearAllMocks();
    document.querySelectorAll = jest.fn().mockReturnValue([data]);
  });

  test("search for non-matching phrases", () => {
    const phrases = ["ABC", "def"];
    self.reportStatus = jest.fn();
    let result = findElementByPhrase(phrases);
    expect(result).toBe(null);
    expect(document.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(self.reportStatus).toHaveBeenCalledTimes(phrases.length * 2);
    phrases.forEach(phrase => {
      expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching(phrase.toLowerCase()));
    });
  });
  
  test("search for matching phrases", () => {
    const phrases = ["innerText", "outerText"];
    result = findElementByPhrase(phrases);
    expect(result).not.toBe(null);
    expect(self.reportStatus).toHaveBeenCalledTimes(2);
  });
});

describe("followPdfLinkOrButton", () => {
  const job = {"phrase": "abc", "doi": DOI}
  const myTabId = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {"runtime": {"sendMessage": jest.fn().mockResolvedValue()}};
    self.recordProgress = recordProgress;
  });

  // The message types sent to the background, in order.
  function sentMessageTypes() {
    return browser.runtime.sendMessage.mock.calls.map(([msg]) => msg.type);
  }

  test("a found link is recorded with its url before the capture is requested", async() => {
    const data = document.createElement("a");
    data.href = LINK_URL;
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    self.reportStatus = jest.fn();
    await followPdfLinkOrButton(job, myTabId);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "record-progress", stage: PROGRESS_STAGE_LINK, doi: DOI, found: true, url: LINK_URL });
    expect(sentMessageTypes()).toEqual(["record-progress", "download_pdf_via_tab_capture"]);
  });

  // The capture is armed for this tab only: a button that opens the PDF in a new tab
  // (window.open, or a form with target="_blank") is not captured, and the capture is
  // recorded as failed when it times out. See the comment on clickButton.
  test("a found button is recorded without a url before the capture is armed", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(document.createElement("button"));
    await followPdfLinkOrButton(job, myTabId);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "record-progress", stage: PROGRESS_STAGE_LINK, doi: DOI, found: true, url: null });
    expect(sentMessageTypes()).toEqual(["record-progress", "arm_capture_for_tab"]);
  });

  test("a missing link is recorded as not found", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(null);
    await followPdfLinkOrButton(job, myTabId);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "record-progress", stage: PROGRESS_STAGE_LINK, doi: DOI, found: false, url: null });
  });

  test("detect phrase in hyperlink: success", async() => {
    let data = document.createElement("a");
    data.innerText = "outerText";
    data.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    self.reportStatus = jest.fn();
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledTimes(2);
    expect(result).toBe(ACTION_RESULT_LINK_FOUND);
  });
  
  test("detect phrase in hyperlink: error", async() => {
    let data = document.createElement("a");
    data.innerText = "outerText";
    data.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    browser.runtime.sendMessage = jest.fn().mockRejectedValue(new Error("error"));
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(result).toBe(ACTION_RESULT_ERROR);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error asking"));
    expect(self.reportStatus).toHaveBeenCalledTimes(3);
  });
  
  test("detect phrase in button: success", async() => {
    const data = document.createElement("button");
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(result).toBe(ACTION_RESULT_BUTTON_FOUND);
  });
  
  test("detect phrase in button: error", async() => {
    let data = document.createElement("button");
    data["click"] = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Failed clicking"));
  });
  
  test("phrase not found in hyperlink or button", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(null);
    result = await followPdfLinkOrButton(job, myTabId);
    expect(result).toBe(ACTION_RESULT_NOT_FOUND);
  });
});

describe("maybeRunJob", () => {
  const myTabId = 67;
  let job = {};

  beforeEach(()=> {
    jest.clearAllMocks();
    job = {
      "tabId": myTabId, 
      "doi": DOI,
      "usedUrls": [],
    }          
    global.browser = {"storage": {"local": {
      "get": jest.fn().mockResolvedValue({"job": job}),
      "set": jest.fn().mockResolvedValue(),
    }}};
    self.reportStatus = jest.fn();
    self.followPdfLinkOrButton = jest.fn();
    self.recordProgress = jest.fn().mockResolvedValue();
  });

  test("reports the page it landed on", async() => {
    await maybeRunJob(myTabId);
    expect(self.recordProgress).toHaveBeenCalledWith(PROGRESS_STAGE_PAGE, DOI, { url: global.location.href });
  });

  test("does not report a page it already processed", async() => {
    job.usedUrls.push(global.location.href);
    await maybeRunJob(myTabId);
    expect(self.recordProgress).not.toHaveBeenCalled();
  });

  test("run successfully", async() => {
    const result = await maybeRunJob(myTabId);
    expect(result).toBe(JOB_RESULT_FINISHED);
    expect(self.reportStatus).toHaveBeenCalledTimes(2);
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(1);
   });

  test("job already processed", async() => {
    job.usedUrls.push(global.location.href);
    global.browser.storage.local.get = jest.fn().mockResolvedValue({"job": job});
    const result = await maybeRunJob(myTabId);
    expect(result).toBe(JOB_RESULT_PROCESSED);
   });

  test("invalid myTabId", async() => {
    const result = await maybeRunJob(myTabId + "invalid");
    expect(result).toBe(JOB_RESULT_INVALID);
  });
  
  test("running job fails", async() => {
    jest.useFakeTimers();
    self.followPdfLinkOrButton = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    const result = await maybeRunJob(myTabId);
    jest.runAllTimers();
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error while searching link"));
    jest.useRealTimers();
  });

  test("reports a search that fails after it has started", async() => {
    jest.useFakeTimers();
    self.followPdfLinkOrButton = jest.fn().mockRejectedValue(new Error("page changed"));
    await maybeRunJob(myTabId);
    await jest.runAllTimersAsync();
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error while searching link: page changed"));
    jest.useRealTimers();
  });

  test("cannot read job variable", async() => {
    global.browser.storage.local.get = jest.fn().mockRejectedValue(new Error("error"));
    const result = await maybeRunJob(myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("error reading job"));
  });
});
