const { reportStatus, BADGE_TEXT, ERROR_COLOR, LOG_PREFIX, NORMAL_COLOR, STATUS_MESSAGE_TYPE } = require("../src/status-report");

// constants

const STATUS_TEXT = "Opened DOI page";
const ERROR_TEXT = "Could not start job";
const LOGGED_STATUS_TEXT = `${LOG_PREFIX} ${STATUS_TEXT}`;
const LOGGED_ERROR_TEXT = `${LOG_PREFIX} ${ERROR_TEXT}`;

// test helper functions

function mockExtensionEnvironment() {
  global.browser = {
    runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    browserAction: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  };
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

// hooks, run before each test starts and after each test finishes

beforeEach(() => {
  mockExtensionEnvironment();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// test functions

describe("reportStatus", () => {
  test("logs a status, sends it and shows a green badge", () => {
    reportStatus(STATUS_TEXT);
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: BADGE_TEXT });
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: NORMAL_COLOR });
    expect(console.log).toHaveBeenCalledWith(LOGGED_STATUS_TEXT);
    expect(console.error).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: STATUS_MESSAGE_TYPE, text: STATUS_TEXT, isError: false });
  });

  test("logs an error as an error, sends it as an error and shows a red badge", () => {
    reportStatus(ERROR_TEXT, true);
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: ERROR_COLOR });
    expect(console.error).toHaveBeenCalledWith(LOGGED_ERROR_TEXT);
    expect(console.log).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: STATUS_MESSAGE_TYPE, text: ERROR_TEXT, isError: true });
  });

  test("does not fail when nobody receives the message", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    await expect(reportStatus(STATUS_TEXT)).resolves.toBeUndefined();
  });

  test("does not stop the status when the badge cannot be set", () => {
    delete browser.browserAction;
    reportStatus(STATUS_TEXT);
    expect(console.log).toHaveBeenCalledWith(LOGGED_STATUS_TEXT);
  });
});
