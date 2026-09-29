// The dedicated status tab (status-view.html): a live progress table plus a running
// log of the one-line status messages the popup shows.
//
// The popup closes as soon as the tracked tab gets focus, so the table lives in its own
// extension tab instead, opened once and reused (see docs/visualize_progress_plan.md,
// section 1). This file is also loaded by the popup, which only uses
// openOrFocusStatusTab(): the listeners are registered only on the status page itself.

const STATUS_VIEW_PAGE = "status-view.html";
const PROGRESS_ELEMENT_ID = "progress";
const LOG_ELEMENT_ID = "log";
// How close to the bottom (in pixels) still counts as "at the bottom", to allow for
// fractional scroll positions.
const SCROLL_BOTTOM_TOLERANCE_PX = 5;
// Each scrolling area (id PROGRESS_ELEMENT_ID or LOG_ELEMENT_ID) has a count in its
// heading (id + COUNT_ID_SUFFIX) and a "new entries" button (id + NEW_ENTRIES_ID_SUFFIX);
// its container gets SCROLLED_CLASS, which shows a shadow, while it is scrolled down.
const COUNT_ID_SUFFIX = "-count";
const NEW_ENTRIES_ID_SUFFIX = "-new";
const SCROLLED_CLASS = "scrolled";

// What the entries of each scrolling area are, and how to count them.
const PANES = {
  [PROGRESS_ELEMENT_ID]: { one: "row", many: "rows", count: (element) => element.querySelectorAll("tbody tr").length },
  [LOG_ELEMENT_ID]: { one: "line", many: "lines", count: (element) => element.children.length },
};

// Entries added below the view while the viewer was scrolled up, per scrolling area.
const unseenEntries = { [PROGRESS_ELEMENT_ID]: 0, [LOG_ELEMENT_ID]: 0 };

async function openOrFocusStatusTab() {
  const url = browser.runtime.getURL(STATUS_VIEW_PAGE);
  const tabs = await browser.tabs.query({});
  const tab = tabs.find((t) => t.url === url);
  if (tab) {
    await browser.windows.update(tab.windowId, { focused: true });
    return browser.tabs.update(tab.id, { active: true });
  }
  return browser.tabs.create({ url });
}

function isScrolledToBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_BOTTOM_TOLERANCE_PX;
}

function scrollToBottom(element) {
  element.scrollTop = element.scrollHeight;
}

function entriesLabel(count, pane, prefix = "") {
  return `${count} ${prefix}${count === 1 ? pane.one : pane.many}`;
}

// Bring a scrolling area's indicators up to date: the count in its heading, the shadow
// under the heading, and the "new entries" button.
function refreshIndicators(element) {
  const pane = PANES[element.id];
  const countElement = document.getElementById(element.id + COUNT_ID_SUFFIX);
  if (countElement) {
    countElement.textContent = `(${entriesLabel(pane.count(element), pane)})`;
  }
  element.parentElement.classList.toggle(SCROLLED_CLASS, element.scrollTop > 0);
  if (isScrolledToBottom(element)) {
    unseenEntries[element.id] = 0;
  }
  const button = document.getElementById(element.id + NEW_ENTRIES_ID_SUFFIX);
  if (button) {
    button.hidden = unseenEntries[element.id] === 0;
    button.textContent = `▼ ${entriesLabel(unseenEntries[element.id], pane, "new ")}`;
  }
}

// Apply an update to a scrolling area and keep showing its bottom, unless the viewer
// has scrolled up to read something: then the view stays where it is, and the new
// entries are counted on the "new entries" button.
function updateAndFollowBottom(element, update) {
  const pane = PANES[element.id];
  const following = isScrolledToBottom(element);
  const countBefore = pane.count(element);
  update();
  if (following) {
    scrollToBottom(element);
  } else {
    unseenEntries[element.id] += Math.max(0, pane.count(element) - countBefore);
  }
  refreshIndicators(element);
}

// Keep the indicators up to date while the viewer scrolls, and let the "new entries"
// button jump back to the bottom.
function watchScrolling(element) {
  element.addEventListener("scroll", () => refreshIndicators(element));
  const button = document.getElementById(element.id + NEW_ENTRIES_ID_SUFFIX);
  if (button) {
    button.addEventListener("click", () => {
      scrollToBottom(element);
      refreshIndicators(element);
    });
  }
  refreshIndicators(element);
}

function replaceProgressTable(html) {
  const element = document.getElementById(PROGRESS_ELEMENT_ID);
  if (!element) return;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  updateAndFollowBottom(element, () => element.replaceChildren(...parsed.body.childNodes));
}

function appendLogLine(text) {
  const element = document.getElementById(LOG_ELEMENT_ID);
  if (!element) return;
  const line = document.createElement("div");
  line.textContent = text;
  updateAndFollowBottom(element, () => element.appendChild(line));
}

// The mouse button (MouseEvent.button) that opens a link in a background tab.
const MIDDLE_MOUSE_BUTTON = 1;

// Open an address clicked in the progress table in a new tab, and ask the background to
// watch that tab for a PDF the user downloads by hand, for the clicked row (see
// docs/assisted_download_plan.md, section 3). The tab is opened here rather than by the
// link itself, as only then is its id known. A middle click or Ctrl-click opens it in
// the background, as the browser would.
async function openAssistedTab(clickEvent) {
  const clickedLink = clickEvent.target.closest?.("a");
  if (!clickedLink || !/^https?:\/\//i.test(clickedLink.href)) return;
  if (clickEvent.type === "auxclick" && clickEvent.button !== MIDDLE_MOUSE_BUTTON) return;
  const clickedRow = clickedLink.closest("tr");
  if (!clickedRow?.dataset.doi) return;
  clickEvent.preventDefault();
  const openInBackground = clickEvent.button === MIDDLE_MOUSE_BUTTON || clickEvent.ctrlKey || clickEvent.metaKey;
  const assistedTab = await browser.tabs.create({ url: clickedLink.href, active: !openInBackground });
  return browser.runtime.sendMessage({
    type: "watch-assisted-tab",
    tabId: assistedTab.id,
    doi: clickedRow.dataset.doi,
    pageCounter: clickedRow.dataset.pageCounter,
    clickedUrl: clickedLink.href,
  }).catch(() => {});
}

// The "Download CSV" button in the Progress heading, and the file it saves.
const CSV_BUTTON_ID = "progress-csv";
const CSV_FILE_PREFIX = "doi-progress-";
// How long the CSV's temporary address stays valid, for Firefox to save the file.
const CSV_ADDRESS_LIFETIME_MS = 30000;

// The CSV's file name, after the local date: doi-progress-2026-09-29.csv.
function csvFileName(downloadDate) {
  const dateParts = [downloadDate.getFullYear(), downloadDate.getMonth() + 1, downloadDate.getDate()];
  return `${CSV_FILE_PREFIX}${dateParts.map((datePart) => String(datePart).padStart(2, "0")).join("-")}.csv`;
}

// "Download CSV": ask the background for the DOIs and their saved PDFs as CSV, and save
// it through a download link, so Firefox saves it like any other download.
async function downloadProgressCsv() {
  const csvResponse = await browser.runtime.sendMessage({ type: "get-progress-csv" }).catch(() => null);
  if (!csvResponse?.csv) {
    appendLogLine("Could not get the progress table as CSV.");
    return;
  }
  const csvAddress = URL.createObjectURL(new Blob([csvResponse.csv], { type: "text/csv" }));
  const downloadLink = document.createElement("a");
  downloadLink.href = csvAddress;
  downloadLink.download = csvFileName(new Date());
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  setTimeout(() => URL.revokeObjectURL(csvAddress), CSV_ADDRESS_LIFETIME_MS);
}

function handleStatusViewMessage(msg) {
  if (msg?.type === "progress-update") {
    replaceProgressTable(msg.html);
  } else if (msg?.type === "status") {
    appendLogLine(msg.text);
  }
}

// Pull-on-open: ask the background for the table as it is now, so a freshly
// (re)opened tab does not stay empty until the next recording call.
function requestCurrentProgress() {
  return browser.runtime.sendMessage({ type: "get-progress" })
    .then((response) => {
      if (response?.html) replaceProgressTable(response.html);
    })
    .catch(() => {});
}

function initStatusView() {
  for (const id of Object.keys(PANES)) {
    const element = document.getElementById(id);
    if (element) watchScrolling(element);
  }
  // On the container, not on the links, as the table is replaced on every update.
  const progressElement = document.getElementById(PROGRESS_ELEMENT_ID);
  if (progressElement) {
    progressElement.addEventListener("click", openAssistedTab);
    progressElement.addEventListener("auxclick", openAssistedTab);
  }
  document.getElementById(CSV_BUTTON_ID)?.addEventListener("click", downloadProgressCsv);
  browser.runtime.onMessage.addListener(handleStatusViewMessage);
  return requestCurrentProgress();
}

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    STATUS_VIEW_PAGE,
    PROGRESS_ELEMENT_ID,
    LOG_ELEMENT_ID,
    SCROLL_BOTTOM_TOLERANCE_PX,
    COUNT_ID_SUFFIX,
    NEW_ENTRIES_ID_SUFFIX,
    SCROLLED_CLASS,
    openOrFocusStatusTab,
    replaceProgressTable,
    appendLogLine,
    MIDDLE_MOUSE_BUTTON,
    openAssistedTab,
    CSV_BUTTON_ID,
    csvFileName,
    downloadProgressCsv,
    handleStatusViewMessage,
    requestCurrentProgress,
    initStatusView,
  };
}

/* istanbul ignore next */
if (typeof document !== "undefined" && document.getElementById(PROGRESS_ELEMENT_ID)) {
  initStatusView();
}
