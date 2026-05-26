const { findElementByPhrase, performAction, sendStatus }  = require("../src/content.functions");

describe("sendStatus", () => {
  test("report status", () => {
    global.browser = {"runtime": {"sendMessage": jest.fn()}};
    global.console = {"log": jest.fn()};
    const text = "text";
    sendStatus(text);
    expect(self.browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(self.console.log).toHaveBeenCalledTimes(1);
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
    self.sendStatus = jest.fn();
    let result = findElementByPhrase(phrases);
    expect(result).toBe(null);
    expect(document.querySelectorAll).toHaveBeenCalledTimes(phrases.length);
    expect(self.sendStatus).toHaveBeenCalledTimes(phrases.length * 2);
    phrases.forEach(phrase => {
      expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching(phrase.toLowerCase()));
    });
  });
  
  test("search for matching phrases", () => {
    const phrases = ["innerText", "outerText"];
    result = findElementByPhrase(phrases);
    expect(result).not.toBe(null);
    expect(self.sendStatus).toHaveBeenCalledTimes(2);
  });
});

describe("performAction", () => {
  const job = {"phrase": "abc"}
  const myTabId = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {"runtime": {"sendMessage": jest.fn().mockResolvedValue()}};
  });

  test("detect phrase in hyperlink: success", async() => {
    let data = document.createElement("a");
    data.innerText = "outerText";
    data.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    self.sendStatus = jest.fn();
    const result = await performAction(job, myTabId);
    expect(self.sendStatus).toHaveBeenCalledTimes(2);
    expect(result).toBe("link found");
  });
  
  test("detect phrase in hyperlink: error", async() => {
    let data = document.createElement("a");
    data.innerText = "outerText";
    data.href = "href";
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    browser.runtime.sendMessage = jest.fn().mockRejectedValue(new Error("error"));
    const result = await performAction(job, myTabId);
    expect(result).toBe("error");
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Error asking"));
    expect(self.sendStatus).toHaveBeenCalledTimes(3);
  });
  
  test("detect phrase in button: success", async() => {
    const data = document.createElement("button");
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    const result = await performAction(job, myTabId);
    expect(result).toBe("button found");
  });
  
  test("detect phrase in button: error", async() => {
    let data = document.createElement("button");
    data["click"] = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    self.findElementByPhrase = jest.fn().mockReturnValue(data);
    const result = await performAction(job, myTabId);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Failed clicking"));
  });
  
  test("phrase not found in hyperlink or button", async() => {
    self.findElementByPhrase = jest.fn().mockReturnValue(null);
    result = await performAction(job, myTabId);
    expect(result).toBe("not found");
  });
});

describe("maybeRunJob", () => {
  const myTabId = 67;
  let job = {};

  beforeEach(()=> {
    jest.clearAllMocks();
    job = {
      "tabId": myTabId, 
      "usedUrls": [],
    }          
    global.browser = {"storage": {"local": {
      "get": jest.fn().mockResolvedValue({"job": job}),
      "set": jest.fn().mockResolvedValue(),
    }}};
    self.sendStatus = jest.fn();
    self.performAction = jest.fn();
  });

  test("run successfully", async() => {
    const result = await maybeRunJob(myTabId);
    expect(result).toBe("finished job");
    expect(self.sendStatus).toHaveBeenCalledTimes(2);
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(1);
   });

  test("job already processed", async() => {
    job.usedUrls.push(global.location.href);
    global.browser.storage.local.get = jest.fn().mockResolvedValue({"job": job});
    const result = await maybeRunJob(myTabId);
    expect(result).toBe("processed job");
   });

  test("invalid myTabId", async() => {
    const result = await maybeRunJob(myTabId + "invalid");
    expect(result).toBe("invalid job");
  });
  
  test("running job fails", async() => {
    jest.useFakeTimers();
    self.performAction = jest.fn().mockImplementation(() => {
      throw new Error("error");
    });
    const result = await maybeRunJob(myTabId);
    jest.runAllTimers();
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("^Error while searching link"));
    jest.useRealTimers();
  });

  test("cannot read job variable", async() => {
    global.browser.storage.local.get = jest.fn().mockRejectedValue(new Error("error"));
    const result = await maybeRunJob(myTabId);
    expect(self.sendStatus).toHaveBeenCalledWith(expect.stringMatching("error reading job"));
  });
});
