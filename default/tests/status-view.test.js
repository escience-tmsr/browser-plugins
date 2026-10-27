const { STATUS_SUCCESS, STATUS_NOT_FOUND } = require("../src/progress");
const {
  STATUS_VIEW_PAGE, PROGRESS_ELEMENT_ID, LOG_ELEMENT_ID, SCROLL_BOTTOM_TOLERANCE_PX,
  COUNT_ID_SUFFIX, NEW_ENTRIES_ID_SUFFIX, SCROLLED_CLASS, MIDDLE_MOUSE_BUTTON, CSV_BUTTON_ID,
} = require("../src/status-view");

const DOI = "10.1000/example";
const EXTENSION_BASE_URL = "moz-extension://extension-id/";
const GET_URL_STATUS_VIEW_PAGE = EXTENSION_BASE_URL + STATUS_VIEW_PAGE;
const OTHER_URL = "http://example.com";
const OTHER_TAB = { id: 7, windowId: 3, url: OTHER_URL };
const STATUS_TAB = { id: 2, windowId: 4, url: GET_URL_STATUS_VIEW_PAGE };
const SUCCESS_CLASS = "status-success";
const TABLE_HTML = `<table><tbody><tr><td class="${SUCCESS_CLASS}">${STATUS_SUCCESS}</td></tr></tbody></table>`;
const NEW_TABLE_HTML = `<table><tbody><tr><td>${STATUS_NOT_FOUND}</td></tr></tbody></table>`;
const LOG_TEXT = "PDF response detected; capturing…";
const LOG_TEXTS = [LOG_TEXT, `✅ Saved PDF to ${DOI.replace("/", "_")}.pdf`];
const UNSAFE_TEXT = "<b>not bold</b>";

let statusView;

// The same structure as status-view.html: a heading with a count, and a container
// with the scrolling area and its "new entries" button.
function paneHtml(id) {
  return `<h2><span id="${id}${COUNT_ID_SUFFIX}"></span></h2>
    <div><div id="${id}"></div><button id="${id}${NEW_ENTRIES_ID_SUFFIX}" hidden></button></div>`;
}

function setUpStatusPage() {
  document.body.innerHTML = paneHtml(PROGRESS_ELEMENT_ID) + paneHtml(LOG_ELEMENT_ID) +
    `<button id="${CSV_BUTTON_ID}"></button>`;
}

function firstCell(html) {
  return new DOMParser().parseFromString(html, "text/html").querySelector("td");
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
      getURL: jest.fn((path) => EXTENSION_BASE_URL + path),
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
    expect(browser.runtime.getURL).toHaveBeenCalledWith(STATUS_VIEW_PAGE);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: GET_URL_STATUS_VIEW_PAGE });
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
    expect(progressElement().querySelector("td").textContent).toBe(firstCell(NEW_TABLE_HTML).textContent);
  });

  test("progress-update keeps the status classes of the rendered table", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(progressElement().querySelector("td").className).toBe(firstCell(TABLE_HTML).className);
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

describe("following the bottom of the table and the log", () => {
  // jsdom does not lay out pages, so each scrolling area gets its size by hand:
  // CONTENT_HEIGHT of content, of which VIEW_HEIGHT is visible.
  const CONTENT_HEIGHT = 500;
  const VIEW_HEIGHT = 100;
  const BOTTOM = CONTENT_HEIGHT - VIEW_HEIGHT;  // scrollTop when scrolled to the bottom
  const SCROLLED_UP = 0;

  function setScrollPosition(element, scrollTop) {
    Object.defineProperty(element, "scrollHeight", { value: CONTENT_HEIGHT, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: VIEW_HEIGHT, configurable: true });
    Object.defineProperty(element, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  }

  beforeEach(setUpStatusPage);

  test("a new table is scrolled to the bottom when the table was at the bottom", () => {
    setScrollPosition(progressElement(), BOTTOM);
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(progressElement().scrollTop).toBe(CONTENT_HEIGHT);
  });

  test("a new table keeps the scroll position when the viewer scrolled up", () => {
    setScrollPosition(progressElement(), SCROLLED_UP);
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(progressElement().scrollTop).toBe(SCROLLED_UP);
  });

  test("a new log line is scrolled into view when the log was at the bottom", () => {
    setScrollPosition(logElement(), BOTTOM);
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(logElement().scrollTop).toBe(CONTENT_HEIGHT);
  });

  test("a new log line keeps the scroll position when the viewer scrolled up", () => {
    setScrollPosition(logElement(), SCROLLED_UP);
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(logElement().scrollTop).toBe(SCROLLED_UP);
  });

  test("a position just above the bottom still counts as the bottom", () => {
    setScrollPosition(logElement(), BOTTOM - SCROLL_BOTTOM_TOLERANCE_PX);
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(logElement().scrollTop).toBe(CONTENT_HEIGHT);
  });

  test("a position further above the bottom does not", () => {
    const position = BOTTOM - SCROLL_BOTTOM_TOLERANCE_PX - 1;
    setScrollPosition(logElement(), position);
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(logElement().scrollTop).toBe(position);
  });
});

describe("scroll indicators", () => {
  // As above: CONTENT_HEIGHT of content, of which VIEW_HEIGHT is visible.
  const CONTENT_HEIGHT = 500;
  const VIEW_HEIGHT = 100;
  const BOTTOM = CONTENT_HEIGHT - VIEW_HEIGHT;
  const TOP = 0;
  const TWO_ROWS_HTML = TABLE_HTML.replace("</tbody>", "<tr><td></td></tr></tbody>");

  function setScrollPosition(element, scrollTop) {
    Object.defineProperty(element, "scrollHeight", { value: CONTENT_HEIGHT, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: VIEW_HEIGHT, configurable: true });
    Object.defineProperty(element, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  }

  function scrollTo(element, scrollTop) {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll"));
  }

  function countText(id) {
    return document.getElementById(id + COUNT_ID_SUFFIX).textContent;
  }

  function newEntriesButton(id) {
    return document.getElementById(id + NEW_ENTRIES_ID_SUFFIX);
  }

  function hasShadow(element) {
    return element.parentElement.classList.contains(SCROLLED_CLASS);
  }

  function sendLogLines() {
    LOG_TEXTS.forEach((text) => statusView.handleStatusViewMessage({ type: "status", text }));
  }

  beforeEach(async () => {
    setUpStatusPage();
    browser.runtime.sendMessage.mockResolvedValue({});  // start with an empty table
    await statusView.initStatusView();
  });

  test("the headings count the table rows and log lines", () => {
    statusView.handleStatusViewMessage({ type: "progress-update", html: TWO_ROWS_HTML });
    sendLogLines();
    expect(countText(PROGRESS_ELEMENT_ID)).toBe("(2 rows)");
    expect(countText(LOG_ELEMENT_ID)).toBe(`(${LOG_TEXTS.length} lines)`);
  });

  test("a count of one uses the singular", () => {
    statusView.handleStatusViewMessage({ type: "status", text: LOG_TEXT });
    expect(countText(LOG_ELEMENT_ID)).toBe("(1 line)");
  });

  test("the shadow shows while the content is scrolled down", () => {
    setScrollPosition(logElement(), TOP);
    scrollTo(logElement(), BOTTOM);
    expect(hasShadow(logElement())).toBe(true);
    scrollTo(logElement(), TOP);
    expect(hasShadow(logElement())).toBe(false);
  });

  test("following the bottom scrolls the content down, which shows the shadow", () => {
    setScrollPosition(progressElement(), BOTTOM);
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(hasShadow(progressElement())).toBe(true);
  });

  test("new log lines below the view are counted on the button", () => {
    setScrollPosition(logElement(), TOP);
    sendLogLines();
    expect(newEntriesButton(LOG_ELEMENT_ID).hidden).toBe(false);
    expect(newEntriesButton(LOG_ELEMENT_ID).textContent).toBe(`▼ ${LOG_TEXTS.length} new lines`);
  });

  test("new table rows below the view are counted on the button", () => {
    setScrollPosition(progressElement(), TOP);
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(newEntriesButton(PROGRESS_ELEMENT_ID).textContent).toBe("▼ 1 new row");
    statusView.handleStatusViewMessage({ type: "progress-update", html: TWO_ROWS_HTML });
    expect(newEntriesButton(PROGRESS_ELEMENT_ID).textContent).toBe("▼ 2 new rows");
  });

  test("a table update without new rows adds nothing to the button", () => {
    setScrollPosition(progressElement(), TOP);
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    statusView.handleStatusViewMessage({ type: "progress-update", html: TABLE_HTML });
    expect(newEntriesButton(PROGRESS_ELEMENT_ID).textContent).toBe("▼ 1 new row");
  });

  test("the button stays hidden while the view follows the bottom", () => {
    setScrollPosition(logElement(), BOTTOM);
    sendLogLines();
    expect(newEntriesButton(LOG_ELEMENT_ID).hidden).toBe(true);
  });

  test("clicking the button jumps to the bottom and hides it", () => {
    setScrollPosition(logElement(), TOP);
    sendLogLines();
    newEntriesButton(LOG_ELEMENT_ID).click();
    expect(logElement().scrollTop).toBe(CONTENT_HEIGHT);
    expect(newEntriesButton(LOG_ELEMENT_ID).hidden).toBe(true);
  });

  test("scrolling back to the bottom hides the button", () => {
    setScrollPosition(logElement(), TOP);
    sendLogLines();
    scrollTo(logElement(), BOTTOM);
    expect(newEntriesButton(LOG_ELEMENT_ID).hidden).toBe(true);
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
    expect(progressElement().querySelector("td").textContent).toBe(firstCell(TABLE_HTML).textContent);
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

describe("opening an address from the table in a watched tab", () => {
  const CLICKED_URL = "https://www.sciencedirect.com/science/article/pii/S0000000000000000";
  const ASSISTED_TAB_ID = 12;
  const PAGE_COUNTER = "1";
  const LEFT_MOUSE_BUTTON = 0;
  const RIGHT_MOUSE_BUTTON = 2;
  const WATCH_MESSAGE = {
    type: "watch-assisted-tab", tabId: ASSISTED_TAB_ID, doi: DOI, pageCounter: PAGE_COUNTER, clickedUrl: CLICKED_URL,
  };

  // A table like the one progress.js renders, with one linked address.
  const LINKED_TABLE_HTML = `<table><tbody><tr data-doi="${DOI}" data-page-counter="${PAGE_COUNTER}">` +
    `<td><a href="${CLICKED_URL}" target="_blank">${CLICKED_URL}</a></td><td>${STATUS_SUCCESS}</td>` +
    "</tr></tbody></table>";

  // Dispatch a mouse event on the table's link or its first plain cell; returns the event.
  async function clickInTable(eventType, eventOptions, onLink = true) {
    const clickTarget = onLink ? progressElement().querySelector("a") : progressElement().querySelectorAll("td")[1];
    const mouseEvent = new MouseEvent(eventType, { bubbles: true, cancelable: true, ...eventOptions });
    clickTarget.dispatchEvent(mouseEvent);
    await Promise.resolve();  // let the handler's tabs.create resolve
    await Promise.resolve();
    return mouseEvent;
  }

  beforeEach(async () => {
    setUpStatusPage();
    browser.runtime.sendMessage.mockResolvedValue({ html: LINKED_TABLE_HTML });
    browser.tabs.create.mockResolvedValue({ id: ASSISTED_TAB_ID });
    await statusView.initStatusView();
    browser.runtime.sendMessage.mockClear();
  });

  test("a click opens the address in an active tab and has it watched for the clicked row", async () => {
    const mouseEvent = await clickInTable("click", { button: LEFT_MOUSE_BUTTON });
    expect(mouseEvent.defaultPrevented).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: CLICKED_URL, active: true });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(WATCH_MESSAGE);
  });

  test.each([
    ["a middle click", "auxclick", { button: MIDDLE_MOUSE_BUTTON }],
    ["a Ctrl-click", "click", { button: LEFT_MOUSE_BUTTON, ctrlKey: true }],
  ])("%s opens the address in a background tab", async (clickName, eventType, eventOptions) => {
    await clickInTable(eventType, eventOptions);
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: CLICKED_URL, active: false });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(WATCH_MESSAGE);
  });

  test("a right click is left to the browser, for its context menu", async () => {
    const mouseEvent = await clickInTable("auxclick", { button: RIGHT_MOUSE_BUTTON });
    expect(mouseEvent.defaultPrevented).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  test("a click outside a link does nothing", async () => {
    await clickInTable("click", { button: LEFT_MOUSE_BUTTON }, false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  test("still works after the table has been replaced", async () => {
    statusView.replaceProgressTable(LINKED_TABLE_HTML);
    await clickInTable("click", { button: LEFT_MOUSE_BUTTON });
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(WATCH_MESSAGE);
  });
});

describe("downloading the table as CSV", () => {
  const CSV_TEXT = '"DOI","pdf download result (file)"\r\n"10.1000/example","/home/user/Downloads/a.pdf"\r\n';
  const CSV_ADDRESS = "blob:moz-extension://extension-id/csv";
  const DOWNLOAD_DATE = new Date(2026, 8, 29, 23, 59);

  let clickedLinks;

  // The text of a Blob; the test environment's Blob has no text() method.
  function blobText(textBlob) {
    return new Promise((resolve) => {
      const blobReader = new FileReader();
      blobReader.onload = () => resolve(blobReader.result);
      blobReader.readAsText(textBlob);
    });
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: DOWNLOAD_DATE });
    setUpStatusPage();
    await statusView.initStatusView();
    browser.runtime.sendMessage.mockResolvedValue({ csv: CSV_TEXT });
    global.URL.createObjectURL = jest.fn().mockReturnValue(CSV_ADDRESS);
    global.URL.revokeObjectURL = jest.fn();
    clickedLinks = [];
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordClick() {
      clickedLinks.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("names the file after the local date", () => {
    expect(statusView.csvFileName(DOWNLOAD_DATE)).toBe("doi-progress-2026-09-29.csv");
  });

  test("the button saves the background's CSV as a file", async () => {
    document.getElementById(CSV_BUTTON_ID).click();
    await jest.advanceTimersByTimeAsync(0);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "get-progress-csv" });
    const [csvBlob] = URL.createObjectURL.mock.calls[0];
    expect(csvBlob.type).toBe("text/csv");
    jest.useRealTimers();
    expect(await blobText(csvBlob)).toBe(CSV_TEXT);
    expect(clickedLinks).toEqual([{ href: CSV_ADDRESS, download: "doi-progress-2026-09-29.csv" }]);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  test("frees the file's temporary address after a while", async () => {
    await statusView.downloadProgressCsv();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(CSV_ADDRESS);
  });

  test("reports in the log when the background has no answer", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no receiver"));
    await statusView.downloadProgressCsv();
    expect(clickedLinks).toEqual([]);
    expect(logElement().textContent).toBe("Could not get the progress table as CSV.");
  });
});
