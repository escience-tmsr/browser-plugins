const { reportStatus, showStatusOnBadge, LOG_PREFIX, STATUS_ELEMENT_ID, BADGE_TEXT, BADGE_NORMAL_COLOR, POPUP_NORMAL_COLOR, ERROR_COLOR } = require("../src/status");

// constants

const STATUS_TEXT = "Opened DOI page";
const ERROR_TEXT = "Could not start job";
const LOGGED_STATUS_TEXT = `${LOG_PREFIX}${STATUS_TEXT}`;
const LOGGED_ERROR_TEXT = `${LOG_PREFIX}${ERROR_TEXT}`;

// test helper functions

// The browser APIs that status.js uses, and the console, which is kept quiet.
function mockExtensionEnvironment() {
  global.browser = {
    runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    browserAction: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  };
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

// The popup's status line; the background page has none.
function addPopupStatusElement() {
  const statusElement = document.createElement("p");
  statusElement.id = STATUS_ELEMENT_ID;
  document.body.appendChild(statusElement);
  return statusElement;
}

function removePageElements() {
  document.body.innerHTML = "";
}

// hooks, run before each test starts and after each test finishes

beforeEach(() => {
  mockExtensionEnvironment();
});

afterEach(() => {
  removePageElements();
  jest.restoreAllMocks();
});

// test functions

describe("reportStatus", () => {
  test("logs a status, sends it and shows a green badge", () => {
    reportStatus(STATUS_TEXT);
    expect(console.log).toHaveBeenCalledWith(LOGGED_STATUS_TEXT);
    expect(console.error).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "status", text: STATUS_TEXT, isError: false });
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: BADGE_TEXT });
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_NORMAL_COLOR });
  });

  test("logs an error as an error, sends it as an error and shows a red badge", () => {
    reportStatus(ERROR_TEXT, true);
    expect(console.error).toHaveBeenCalledWith(LOGGED_ERROR_TEXT);
    expect(console.log).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "status", text: ERROR_TEXT, isError: true });
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: ERROR_COLOR });
  });

  test("shows a status in the popup's status line", () => {
    const statusElement = addPopupStatusElement();
    reportStatus(STATUS_TEXT);
    expect(statusElement.textContent).toBe(STATUS_TEXT);
    expect(statusElement.style.color).toBe(POPUP_NORMAL_COLOR);
  });

  test("shows an error in red in the popup's status line", () => {
    const statusElement = addPopupStatusElement();
    reportStatus(ERROR_TEXT, true);
    expect(statusElement.textContent).toBe(ERROR_TEXT);
    expect(statusElement.style.color).toBe(ERROR_COLOR);
  });

  test("shows a status after an error in the normal color again", () => {
    const statusElement = addPopupStatusElement();
    reportStatus(ERROR_TEXT, true);
    reportStatus(STATUS_TEXT);
    expect(statusElement.style.color).toBe(POPUP_NORMAL_COLOR);
  });

  test("shows an error in red again after a normal status", () => {
    const statusElement = addPopupStatusElement();
    reportStatus(STATUS_TEXT);
    reportStatus(ERROR_TEXT, true);
    expect(statusElement.style.color).toBe(ERROR_COLOR);
  });

  test("still logs and sends a status when nobody receives the message", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    reportStatus(STATUS_TEXT);
    await Promise.resolve();  // let the failed message be handled
    expect(console.log).toHaveBeenCalledWith(LOGGED_STATUS_TEXT);
  });

  test("does not stop the status when the badge cannot be set", () => {
    delete browser.browserAction;
    expect(() => reportStatus(STATUS_TEXT)).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(LOGGED_STATUS_TEXT);
  });
});

describe("showStatusOnBadge", () => {
  test("shows the badge text on a green badge for a status", () => {
    showStatusOnBadge(BADGE_TEXT, false);
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: BADGE_TEXT });
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_NORMAL_COLOR });
  });

  test("shows a red badge for an error", () => {
    showStatusOnBadge(BADGE_TEXT, true);
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: ERROR_COLOR });
  });
});
