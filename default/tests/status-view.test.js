const PAGE_URL = "moz-extension://extension-id/status-view.html";
const OTHER_URL = "http://example.com";
const TABLE_HTML = '<table><tbody><tr><td class="status-success">SUCCESS</td></tr></tbody></table>';
const NEW_TABLE_HTML = "<table><tbody><tr><td>NOT_FOUND</td></tr></tbody></table>";
const LOG_TEXT = "PDF response detected; capturing…";
const UNSAFE_TEXT = "<b>not bold</b>";

let statusView;

function setUpStatusPage() {
  document.body.innerHTML = '<div id="progress"></div><div id="log"></div>';
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
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({ id: 2 }),
    },
    windows: { update: jest.fn().mockResolvedValue({}) },
  };
  statusView = require("../src/status-view");
});

describe("openOrFocusStatusTab", () => {
  test("creates the status tab when none is open", async () => {
    browser.tabs.query.mockResolvedValue([{ id: 7, windowId: 3, url: OTHER_URL }]);
    await statusView.openOrFocusStatusTab();
    expect(browser.runtime.getURL).toHaveBeenCalledWith(statusView.STATUS_VIEW_PAGE);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: PAGE_URL });
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });

  test("focuses an already-open status tab instead of creating a new one", async () => {
    browser.tabs.query.mockResolvedValue([
      { id: 7, windowId: 3, url: OTHER_URL },
      { id: 2, windowId: 4, url: PAGE_URL },
    ]);
    await statusView.openOrFocusStatusTab();
    expect(browser.windows.update).toHaveBeenCalledWith(4, { focused: true });
    expect(browser.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
});

describe("handleStatusViewMessage", () => {
  beforeEach(setUpStatusPage);

  test("progress-update replaces the table content", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    statusView.handleStatusViewMessage({ type: "progress-update", html: NEW_TABLE_HTML });
    const progress = document.getElementById("progress");
    expect(progress.querySelectorAll("table").length).toBe(1);
    expect(progress.querySelector("td").textContent).toBe("NOT_FOUND");
  });

  test("progress-update keeps the status classes of the rendered table", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(document.querySelector("#progress td").className).toBe("status-success");
  });

  test("status appends a line to the log panel", () => {
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    const lines = document.getElementById("log").children;
    expect(lines.length).toBe(2);
    expect(lines[1].textContent).toBe(LOG_TEXT);
  });

  test("status text is shown as text, not parsed as HTML", () => {
    statusView.handleStatusViewMessage({ type: "status", text: UNSAFE_TEXT });
    const log = document.getElementById("log");
    expect(log.querySelector("b")).toBeNull();
    expect(log.textContent).toBe(UNSAFE_TEXT);
  });

  test("other or missing messages change nothing", () => {
    statusView.handleStatusViewMessage({ type: "start-job", doi: "10.1000/example" });
    statusView.handleStatusViewMessage(undefined);
    expect(document.getElementById("progress").childNodes.length).toBe(0);
    expect(document.getElementById("log").childNodes.length).toBe(0);
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
    expect(document.querySelector("#progress td").textContent).toBe("SUCCESS");
  });

  test("runs automatically when the script loads on the status page", () => {
    jest.resetModules();
    require("../src/status-view");
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  test("keeps the table empty when the background has no answer", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    await statusView.initStatusView();
    expect(document.getElementById("progress").childNodes.length).toBe(0);
  });
});
