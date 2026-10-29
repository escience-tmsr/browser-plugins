// constants

const TAB_ID = 7;
const TAB_ID_REQUEST = { type: "what-is-my-tabid" };
const REQUEST_ERROR = "no receiver";
const NO_TAB_ID_STATUS = "[default-extension] no tabId available, doing nothing";
const TAB_ERROR_STATUS = `[default-extension] error getting tabId: Error: ${REQUEST_ERROR}`;

// test helper functions

function mockPageEnvironment() {
  global.browser = { runtime: { sendMessage: jest.fn().mockResolvedValue({ tabId: TAB_ID }) } };
  global.maybeRunJob = jest.fn();
  global.sendStatus = jest.fn();
  jest.spyOn(console, "log").mockImplementation(() => {});
}

function setAnswerSendMessageCallInRequestOwnTabId(tabIdAnswer) {
  browser.runtime.sendMessage.mockResolvedValue(tabIdAnswer);
}

function setErrorSendMessageCallInRequestOwnTabId(errorMessage) {
  browser.runtime.sendMessage.mockRejectedValue(new Error(errorMessage));
}

function loadAndStartContentScript() {
  let loadedModule;
  jest.isolateModules(() => {
    loadedModule = require("../content-script");
  });
  return loadedModule;
}

// hooks, run before each test starts and after each test finishes

beforeEach(() => {
  jest.useFakeTimers();
  mockPageEnvironment();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// test functions

describe("requestOwnTabId", () => {
  test("returns the tab id from the background's answer", async () => {
    const contentScript = loadAndStartContentScript();
    await expect(contentScript.requestOwnTabId()).resolves.toBe(TAB_ID);
  });

  test("returns null when the answer has no tab id", async () => {
    setAnswerSendMessageCallInRequestOwnTabId({ tabId: null });
    const contentScript = loadAndStartContentScript();
    await expect(contentScript.requestOwnTabId()).resolves.toBeNull();
  });

  test("returns null when there is no answer", async () => {
    setAnswerSendMessageCallInRequestOwnTabId(undefined);
    const contentScript = loadAndStartContentScript();
    await expect(contentScript.requestOwnTabId()).resolves.toBeNull();
  });
});

describe("scheduleMaybeRunJob", () => {
  test("checks for a maybeRunJob start but only after the start delay passed", () => {
    const contentScript = loadAndStartContentScript();
    contentScript.scheduleMaybeRunJob(TAB_ID);
    jest.advanceTimersByTime(contentScript.JOB_START_DELAY_MS - 1);
    expect(maybeRunJob).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(maybeRunJob).toHaveBeenCalledWith(TAB_ID);
  });
});

describe("startContentScript", () => {
  test("checks for a correct startup: tab_id request and maybeRunJob call", async () => {
    loadAndStartContentScript();
    await jest.runAllTimersAsync();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(TAB_ID_REQUEST);
    expect(maybeRunJob).toHaveBeenCalledWith(TAB_ID);
    expect(sendStatus).not.toHaveBeenCalled();
  });

  test("reports and does nothing else when there is no tab id", async () => {
    setAnswerSendMessageCallInRequestOwnTabId({});
    loadAndStartContentScript();
    await jest.runAllTimersAsync();
    expect(sendStatus).toHaveBeenCalledWith(NO_TAB_ID_STATUS);
    expect(maybeRunJob).not.toHaveBeenCalled();
  });

  test("reports an error when requestOwnTabId fails", async () => {
    setErrorSendMessageCallInRequestOwnTabId(REQUEST_ERROR);
    loadAndStartContentScript();
    await jest.runAllTimersAsync();
    expect(sendStatus).toHaveBeenCalledWith(TAB_ERROR_STATUS);
    expect(maybeRunJob).not.toHaveBeenCalled();
  });
});
