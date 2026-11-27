const {
  findElementByPhrase, followPdfLinkOrButton, runStoredJob, recordProgress, reportStatus,
  PROGRESS_STAGE_PAGE, PROGRESS_STAGE_LINK,
  LINK_FOUND, BUTTON_FOUND, NO_LINK_OR_BUTTON_FOUND, LINK_CAPTURE_ERROR,
  PAGE_SEARCH_SCHEDULED, PAGE_ALREADY_PROCESSED, NO_JOB_FOR_THIS_TAB,
  RECORD_PROGRESS_MESSAGE_TYPE, CAPTURE_LINK_MESSAGE_TYPE, ARM_CAPTURE_MESSAGE_TYPE,
} = require("../src/content.functions");

const JOB_DOI = "10.1234/doi";
const LINK_URL = "https://publisher.example/article.pdf";

describe("runStoredJob", () => {
  const myTabId = 67;
  let job = {};

  beforeEach(()=> {
    jest.clearAllMocks();
    job = {
      "tabId": myTabId, 
      "doi": JOB_DOI,
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

  afterEach(() => {
    jest.useRealTimers();
  });

  test("reports the page it landed on", async() => {
    await runStoredJob(myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered runJob"));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered processNewPage"));
    expect(self.recordProgress).toHaveBeenCalledWith(PROGRESS_STAGE_PAGE, JOB_DOI, { url: location.href });
  });

  test("skips page if it is already processed", async() => {
    job.usedUrls.push(location.href);
    const result = await runStoredJob(myTabId);
    expect(result).toBe(PAGE_ALREADY_PROCESSED);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered runJob"));
    expect(self.reportStatus).toHaveBeenCalledWith("Skipping: already processed this page.");
    expect(self.reportStatus).not.toHaveBeenCalledWith(expect.stringMatching("^Entered processNewPage"));
  });

  test("run successfully", async() => {
    const result = await runStoredJob(myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered runJob"));
    expect(result).toBe(PAGE_SEARCH_SCHEDULED);
    expect(self.reportStatus).toHaveBeenCalledTimes(3);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered processNewPage"));
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(1);
   });

  test("ignores a job for another tab", async() => {
    const otherTabId = myTabId + 1;
    const result = await runStoredJob(otherTabId);
    expect(result).toBe(NO_JOB_FOR_THIS_TAB);
  });
  
  test("running job fails", async() => {
    jest.useFakeTimers();
    self.followPdfLinkOrButton = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    await runStoredJob(myTabId);
    jest.runAllTimers();
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered searchPage"));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error while searching link"));
  });

  test("reports a search that fails after it has started", async() => {
    jest.useFakeTimers();
    self.followPdfLinkOrButton = jest.fn().mockRejectedValue(new Error("page changed"));
    await runStoredJob(myTabId);
    await jest.runAllTimersAsync();
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered searchPage"));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error while searching link: page changed"));
  });

  test("cannot read job variable", async() => {
    global.browser.storage.local.get = jest.fn().mockRejectedValue(new Error("error"));
    const result = await runStoredJob(myTabId);
    expect(result).toBe(NO_JOB_FOR_THIS_TAB);
    expect(self.reportStatus).toHaveBeenCalledWith("Entered readStoredJob");
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("Error reading job"));
  });
});

describe("reportStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("report status", () => {
    global.browser = {"runtime": {"sendMessage": jest.fn()}};
    jest.spyOn(console, "log").mockImplementation(() => {});
    const statusText = "statusText";
    reportStatus(statusText);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});

describe("recordProgress", () => {
  test("sends the stage, doi and details to the background", async () => {
    global.browser = {"runtime": {"sendMessage": jest.fn().mockResolvedValue()}};
    await recordProgress(PROGRESS_STAGE_LINK, JOB_DOI, { found: true, url: LINK_URL });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: RECORD_PROGRESS_MESSAGE_TYPE, stage: PROGRESS_STAGE_LINK, doi: JOB_DOI, found: true, url: LINK_URL });
  });

  test("resolves when the background does not answer", async () => {
    global.browser = {"runtime": {"sendMessage": jest.fn().mockRejectedValue(new Error("error"))}};
    await expect(recordProgress(PROGRESS_STAGE_PAGE, JOB_DOI, { url: LINK_URL })).resolves.toBeUndefined();
  });

  test("resolves when messaging is not available", async () => {
    global.browser = {};
    await expect(recordProgress(PROGRESS_STAGE_PAGE, JOB_DOI, { url: LINK_URL })).resolves.toBeUndefined();
  });
});

describe("findElementByPhrase", () => {
  let htmlData = document.createElement("a");
  htmlData.title = "innerText.outerText";

  beforeEach(() => {
    jest.clearAllMocks();
    self.reportStatus = jest.fn();
    document.querySelectorAll = jest.fn().mockReturnValue([htmlData]);
  });

  test("search for non-matching phrases", () => {
    const searchPhrases = ["ABC", "def"];
    const result = findElementByPhrase(searchPhrases);
    expect(result).toBe(null);
    expect(document.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(self.reportStatus).toHaveBeenCalledTimes(searchPhrases.length * 2);
    searchPhrases.forEach(phrase => {
      expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching(phrase.toLowerCase()));
    });
  });
  
  test("search for matching phrases", () => {
    const searchPhrases = ["innerText", "outerText"];
    let result = findElementByPhrase(searchPhrases);
    expect(result).not.toBe(null);
    expect(self.reportStatus).toHaveBeenCalledTimes(2);
  });

  test("finds a link without a title by its text", () => {
    const linkWithoutTitle = document.createElement("a");
    linkWithoutTitle.textContent = "Download PDF";
    document.querySelectorAll = jest.fn().mockReturnValue([linkWithoutTitle]);
    const foundElement = findElementByPhrase(["download"]);
    expect(foundElement).toBe(linkWithoutTitle);
  });
});

describe("followPdfLinkOrButton", () => {
  const job = {"phrase": "abc", "doi": JOB_DOI}
  const myTabId = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {"runtime": {"sendMessage": jest.fn().mockResolvedValue()}};
    self.recordProgress = recordProgress;
    self.reportStatus = jest.fn();
  });

  function sentMessageTypes() {
    return browser.runtime.sendMessage.mock.calls.map(([msg]) => msg.type);
  }

  test("a found link is recorded with its url", async() => {
    const htmlData = document.createElement("a");
    htmlData.href = LINK_URL;
    self.findElementByPhrase = jest.fn().mockReturnValue(htmlData);
    await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered handleFoundElement"));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: RECORD_PROGRESS_MESSAGE_TYPE, stage: PROGRESS_STAGE_LINK, doi: JOB_DOI, found: true, url: LINK_URL });
    expect(sentMessageTypes()).toEqual([RECORD_PROGRESS_MESSAGE_TYPE, CAPTURE_LINK_MESSAGE_TYPE]);
  });

  // the capture, for this tab only, does not register opening the PDF in another tab
  test("a found button is recorded without a url", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(document.createElement("button"));
    await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered handleFoundElement"));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: RECORD_PROGRESS_MESSAGE_TYPE, stage: PROGRESS_STAGE_LINK, doi: JOB_DOI, found: true, url: null });
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered clickButton"));
    expect(sentMessageTypes()).toEqual([RECORD_PROGRESS_MESSAGE_TYPE, ARM_CAPTURE_MESSAGE_TYPE]);
  });

  test("a missing link is recorded as not found", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(null);
    await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered reportMissingElement"));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: RECORD_PROGRESS_MESSAGE_TYPE, stage: PROGRESS_STAGE_LINK, doi: JOB_DOI, found: false, url: null });
  });

  test("detect phrase in hyperlink: success", async() => {
    let htmlData = document.createElement("a");
    htmlData.innerText = "innerText";
    htmlData.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(htmlData);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledTimes(3);
    expect(result).toBe(LINK_FOUND);
  });
  
  test("detect phrase in hyperlink: error", async() => {
    let htmlData = document.createElement("a");
    htmlData.innerText = "innerText";
    htmlData.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(htmlData);
    browser.runtime.sendMessage = jest.fn().mockRejectedValue(new Error("error"));
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(result).toBe(LINK_CAPTURE_ERROR);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered requestLinkCapture"));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Error asking add-on to capture PDF"));
    expect(self.reportStatus).toHaveBeenCalledTimes(4);
  });
  
  test("detect phrase in button: success", async() => {
    const htmlData = document.createElement("button");
    self.findElementByPhrase = jest.fn().mockReturnValue(htmlData);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered clickButton"));
    expect(result).toBe(BUTTON_FOUND);
  });
  
  test("detect phrase in button: error", async() => {
    let htmlData = document.createElement("button");
    htmlData["click"] = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    self.findElementByPhrase = jest.fn().mockReturnValue(htmlData);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered clickButton"));
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Failed clicking element"));
  });
  
  test("phrase not found in hyperlink or button", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(null);
    const result = await followPdfLinkOrButton(job, myTabId);
    expect(self.reportStatus).toHaveBeenCalledWith(expect.stringMatching("^Entered reportMissingElement"));
    expect(result).toBe(NO_LINK_OR_BUTTON_FOUND);
  });
});
