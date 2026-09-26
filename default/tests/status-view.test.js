const { STATUS_SUCCESS, STATUS_NOT_FOUND } = require("../src/progress");
const { PROGRESS_ELEMENT_ID, LOG_ELEMENT_ID } = require("../src/status-view");

const DOI = "10.1000/example";
const PAGE_URL = "moz-extension://extension-id/status-view.html";
const OTHER_URL = "http://example.com";
const OTHER_TAB = { id: 7, windowId: 3, url: OTHER_URL };
const STATUS_TAB = { id: 2, windowId: 4, url: PAGE_URL };
const SUCCESS_CLASS = "status-success";
const TABLE_HTML = `<table><tbody><tr><td class="${SUCCESS_CLASS}">${STATUS_SUCCESS}</td></tr></tbody></table>`;
const NEW_TABLE_HTML = `<table><tbody><tr><td>${STATUS_NOT_FOUND}</td></tr></tbody></table>`;
const LOG_TEXT = "PDF response detected; capturing…";
const LOG_TEXTS = [LOG_TEXT, `✅ Saved PDF to ${DOI.replace("/", "_")}.pdf`];
const UNSAFE_TEXT = "<b>not bold</b>";

let statusView;

function setUpStatusPage() {
  document.body.innerHTML = `<div id="${PROGRESS_ELEMENT_ID}"></div><div id="${LOG_ELEMENT_ID}"></div>`;
}

function progressElement() {
  return document.getElementById(PROGRESS_ELEMENT_ID);
}

function logElement() {
  return document.getElementById(LOG_ELEMENT_ID);
}

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = "";
  global.browser = {
    runtime: {
      getURL: jest.fn().mockReturnValue(PAGE_URL),
      onMessage: { addListener: jest.fn() },
      sendMessage: jest.fn().mockResolvedValue({ html: TABLE_HTML }),
    },
    tabs: {
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    windows: { update: jest.fn().mockResolvedValue({}) },
  };
  statusView = require("../src/status-view");
});

describe("openOrFocusStatusTab", () => {
  test("creates the status tab when none is open", async () => {
    browser.tabs.query.mockResolvedValue([OTHER_TAB]);
    await statusView.openOrFocusStatusTab();
    expect(browser.runtime.getURL).toHaveBeenCalledWith(statusView.STATUS_VIEW_PAGE);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: PAGE_URL });
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  test("focuses an already-open status tab instead of creating a new one", async () => {
    browser.tabs.query.mockResolvedValue([OTHER_TAB, STATUS_TAB]);
    await statusView.openOrFocusStatusTab();
    expect(browser.windows.update).toHaveBeenCalledWith(STATUS_TAB.windowId, { focused: true });
    expect(browser.tabs.update).toHaveBeenCalledWith(STATUS_TAB.id, { active: true });
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
});

describe("handleStatusViewMessage", () => {
  beforeEach(setUpStatusPage);

  test("progress-update replaces the table content", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    statusView.handleStatusViewMessage({ type: "progress-update", html: NEW_TABLE_HTML });
    expect(progressElement().querySelectorAll("table").length).toBe(1);
    expect(progressElement().querySelector("td").textContent).toBe(STATUS_NOT_FOUND);
  });

  test("progress-update keeps the status classes of the rendered table", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(progressElement().querySelector("td").className).toBe(SUCCESS_CLASS);
  });

  test("status appends a line to the log panel", () => {
    LOG_TEXTS.forEach((text) => statusView.handleStatusViewMessage({ type: "status", text }));
    const lines = [...logElement().children].map((line) => line.textContent);
    expect(lines).toEqual(LOG_TEXTS);
  });

  test("status text is shown as text, not parsed as HTML", () => {
    statusView.handleStatusViewMessage({ type: "status", text: UNSAFE_TEXT });
    expect(logElement().querySelector("b")).toBeNull();
    expect(logElement().textContent).toBe(UNSAFE_TEXT);
  });

  test("other or missing messages change nothing", () => {
    statusView.handleStatusViewMessage({ type: "start-job", doi: DOI });
    statusView.handleStatusViewMessage(undefined);
    expect(progressElement().childNodes.length).toBe(0);
    expect(logElement().childNodes.length).toBe(0);
  });

  test("returns nothing, so it never answers another listener's message", () => {
    expect(statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT })).toBeUndefined();
  });
});

describe("outside the status page", () => {
  test("messages are ignored when the page elements are missing", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(document.body.childNodes.length).toBe(0);
  });

  test("loading the script does not register listeners", () => {
    expect(browser.runtime.onMessage.addListener).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("initStatusView", () => {
  beforeEach(setUpStatusPage);

  test("registers the message listener and pulls the current table", async () => {
    await statusView.initStatusView();
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledWith(statusView.handleStatusViewMessage);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "get-progress" });
    expect(progressElement().querySelector("td").textContent).toBe(STATUS_SUCCESS);
  });

  test("runs automatically when the script loads on the status page", () => {
    jest.resetModules();
    require("../src/status-view");
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  test("keeps the table empty when the background has no answer", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    await statusView.initStatusView();
    expect(progressElement().childNodes.length).toBe(0);
  });
});
