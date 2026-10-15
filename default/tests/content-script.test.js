const TAB_ID = 7;
const TAB_ID_REQUEST = { type: "what-is-my-tabid" };
const NO_TAB_ID_STATUS = "[default-extension] no tabId available, doing nothing";

// content-script.js starts as soon as it is loaded, like in a page, so the browser
// and the functions from src/content.functions.js are mocked before loading it.
// The background does not answer the tab id request made while loading, so that
// request cannot schedule a job check in the middle of a test.
function mockPageEnvironment() {
  const neverAnswered = new Promise(() => {});
  global.browser = { runtime: { sendMessage: jest.fn().mockReturnValue(neverAnswered) } };
  global.maybeRunJob = jest.fn();
  global.sendStatus = jest.fn();
  jest.spyOn(console, "log").mockImplementation(() => {});
}

function answerTabIdRequestsWith(tabIdAnswer) {
  browser.runtime.sendMessage.mockResolvedValue(tabIdAnswer);
}

function loadContentScript() {
  let contentScript;
  jest.isolateModules(() => {
    contentScript = require("../content-script");
  });
  return contentScript;
}

let contentScript;

beforeEach(() => {
  jest.useFakeTimers();
  mockPageEnvironment();
  contentScript = loadContentScript();
  jest.clearAllMocks();  // forget the calls made while loading
  answerTabIdRequestsWith({ tabId: TAB_ID });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("loading the script", () => {
  test("asks the background for the tab id", () => {
    loadContentScript();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(TAB_ID_REQUEST);
  });
});

describe("requestOwnTabId", () => {
  test("returns the tab id from the background's answer", async () => {
    await expect(contentScript.requestOwnTabId()).resolves.toBe(TAB_ID);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(TAB_ID_REQUEST);
  });

  test("returns null when the answer has no tab id", async () => {
    answerTabIdRequestsWith({ tabId: null });
    await expect(contentScript.requestOwnTabId()).resolves.toBeNull();
  });

  test("returns null when there is no answer", async () => {
    answerTabIdRequestsWith(undefined);
    await expect(contentScript.requestOwnTabId()).resolves.toBeNull();
  });
});

describe("scheduleMaybeRunJob", () => {
  test("checks for a job only after the start delay", () => {
    contentScript.scheduleMaybeRunJob(TAB_ID);
    jest.advanceTimersByTime(contentScript.JOB_START_DELAY_MS - 1);
    expect(maybeRunJob).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(maybeRunJob).toHaveBeenCalledWith(TAB_ID);
  });
});

describe("startContentScript", () => {
  test("checks for a job in its own tab", async () => {
    await contentScript.startContentScript();
    jest.runAllTimers();
    expect(maybeRunJob).toHaveBeenCalledWith(TAB_ID);
    expect(sendStatus).not.toHaveBeenCalled();
  });

  test("reports and does nothing else when there is no tab id", async () => {
    answerTabIdRequestsWith({});
    await contentScript.startContentScript();
    jest.runAllTimers();
    expect(sendStatus).toHaveBeenCalledWith(NO_TAB_ID_STATUS);
    expect(maybeRunJob).not.toHaveBeenCalled();
  });

  test("reports an error when the background cannot be asked", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    await contentScript.startContentScript();
    jest.runAllTimers();
    expect(sendStatus).toHaveBeenCalledWith("[default-extension] error getting tabId: Error: no receiver");
    expect(maybeRunJob).not.toHaveBeenCalled();
  });
});
