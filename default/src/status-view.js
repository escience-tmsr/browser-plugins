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
// its scroll box (the area's parent) gets SCROLLED_CLASS, which shows a shadow under the
// heading, while the area is scrolled down.
const COUNT_ID_SUFFIX = "-count";
const NEW_ENTRIES_ID_SUFFIX = "-new";
const SCROLLED_CLASS = "scrolled";

// What the entries of each scrolling area are called, and how to count them.
const ENTRY_KINDS = {
  [PROGRESS_ELEMENT_ID]: {
    singularName: "row",
    pluralName: "rows",
    // Only the data rows: the heading row is in the table's thead.
    countEntries: (scrollArea) => scrollArea.querySelectorAll("tbody tr").length,
  },
  [LOG_ELEMENT_ID]: {
    singularName: "line",
    pluralName: "lines",
    countEntries: (scrollArea) => scrollArea.children.length,
  },
};

// The number of entries each scrolling area had when the viewer last saw its bottom.
// Entries beyond that number arrived while the viewer was scrolled up: they are unseen.
const seenEntryCounts = { [PROGRESS_ELEMENT_ID]: 0, [LOG_ELEMENT_ID]: 0 };

async function openOrFocusStatusTab() {
  const statusPageUrl = browser.runtime.getURL(STATUS_VIEW_PAGE);
  const openTabs = await browser.tabs.query({});
  const statusTab = openTabs.find((openTab) => openTab.url === statusPageUrl);
  if (statusTab) {
    await browser.windows.update(statusTab.windowId, { focused: true });
    return browser.tabs.update(statusTab.id, { active: true });
  }
  return browser.tabs.create({ url: statusPageUrl });
}

// Scroll position, in pixels, from the browser's layout of a scrolling area:
// - clientHeight: the height of the visible part. Mostly constant.
// - scrollTop: how far the content has been scrolled down, i.e. the height of the part
//   above the visible part. It is 0 at the top and changes when the viewer scrolls.
// - scrollHeight: the height of all content. It grows when rows or lines are added.
// So scrollHeight >= scrollTop + clientHeight, and the difference is hidden below.

function hiddenHeightBelow(scrollArea) {
  return scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight;
}

function isScrolledToBottom(scrollArea) {
  return hiddenHeightBelow(scrollArea) <= SCROLL_BOTTOM_TOLERANCE_PX;
}

function isScrolledDownFromTop(scrollArea) {
  return scrollArea.scrollTop > 0;
}

function scrollToBottom(scrollArea) {
  scrollArea.scrollTop = scrollArea.scrollHeight - scrollArea.clientHeight;
}

function entryKindOf(scrollArea) {
  return ENTRY_KINDS[scrollArea.id];
}

function countEntries(scrollArea) {
  return entryKindOf(scrollArea).countEntries(scrollArea);
}

// For example "7 rows", "1 line" or, with labelPrefix "new ", "3 new lines".
function entriesLabel(entryCount, entryKind, labelPrefix = "") {
  const entryName = entryCount === 1 ? entryKind.singularName : entryKind.pluralName;
  return `${entryCount} ${labelPrefix}${entryName}`;
}

function unseenNewEntryCount(scrollArea) {
  // Never negative, also not if a replaced progress table had fewer rows.
  return Math.max(0, countEntries(scrollArea) - seenEntryCounts[scrollArea.id]);
}

function hasUnseenNewEntries(scrollArea) {
  return unseenNewEntryCount(scrollArea) > 0;
}

function markEntriesAsSeen(scrollArea) {
  seenEntryCounts[scrollArea.id] = countEntries(scrollArea);
}

function headingCountElement(scrollArea) {
  return document.getElementById(scrollArea.id + COUNT_ID_SUFFIX);
}

function newEntriesButton(scrollArea) {
  return document.getElementById(scrollArea.id + NEW_ENTRIES_ID_SUFFIX);
}

// The count in the heading, for example "(7 rows)".
function setHeadingText(scrollArea) {
  const countElement = headingCountElement(scrollArea);
  if (!countElement) return;
  countElement.textContent = `(${entriesLabel(countEntries(scrollArea), entryKindOf(scrollArea))})`;
}

// The shadow under the heading shows that there are entries above the visible part.
// It is drawn by the CSS on the scroll box, which does not scroll itself, so the
// shadow stays in place under the heading.
function updateScrolledShadow(scrollArea) {
  const scrollBox = scrollArea.parentElement;
  scrollBox.classList.toggle(SCROLLED_CLASS, isScrolledDownFromTop(scrollArea));
}

// The button, for example "▼ 3 new lines", is shown only while there are unseen entries.
function updateNewEntriesButton(scrollArea) {
  const button = newEntriesButton(scrollArea);
  if (!button) return;
  button.hidden = !hasUnseenNewEntries(scrollArea);
  button.textContent = `▼ ${entriesLabel(unseenNewEntryCount(scrollArea), entryKindOf(scrollArea), "new ")}`;
}

// Bring a scrolling area's indicators up to date after its content or scroll position
// has changed: the count in its heading, the shadow under the heading, and the
// "new entries" button. Entries count as seen once the viewer is at the bottom.
function refreshIndicators(scrollArea) {
  setHeadingText(scrollArea);
  updateScrolledShadow(scrollArea);
  if (isScrolledToBottom(scrollArea)) {
    markEntriesAsSeen(scrollArea);
  }
  updateNewEntriesButton(scrollArea);
}

// Apply an update to a scrolling area and keep showing its bottom, unless the viewer
// has scrolled up to read something: then the view stays where it is, and the new
// entries are counted on the "new entries" button.
function updateAndFollowBottom(scrollArea, applyUpdate) {
  const wasAtBottom = isScrolledToBottom(scrollArea);
  applyUpdate();
  if (wasAtBottom) {
    scrollToBottom(scrollArea);
  }
  refreshIndicators(scrollArea);
}

function jumpToBottom(scrollArea) {
  scrollToBottom(scrollArea);
  refreshIndicators(scrollArea);
}

// Keep the indicators up to date while the viewer scrolls, and let the "new entries"
// button jump back to the bottom.
function watchScrolling(scrollArea) {
  scrollArea.addEventListener("scroll", () => refreshIndicators(scrollArea));
  const button = newEntriesButton(scrollArea);
  if (button) {
    button.addEventListener("click", () => jumpToBottom(scrollArea));
  }
  refreshIndicators(scrollArea);
}

function replaceProgressTable(tableHtml) {
  const progressArea = document.getElementById(PROGRESS_ELEMENT_ID);
  if (!progressArea) return;
  const parsedTable = new DOMParser().parseFromString(tableHtml, "text/html");
  updateAndFollowBottom(progressArea, () => progressArea.replaceChildren(...parsedTable.body.childNodes));
}

function appendLogLine(lineText) {
  const logArea = document.getElementById(LOG_ELEMENT_ID);
  if (!logArea) return;
  const logLine = document.createElement("div");
  logLine.textContent = lineText;
  updateAndFollowBottom(logArea, () => logArea.appendChild(logLine));
}

function handleStatusViewMessage(statusViewMessage) {
  if (statusViewMessage?.type === "progress-update") {
    replaceProgressTable(statusViewMessage.html);
  } else if (statusViewMessage?.type === "status") {
    appendLogLine(statusViewMessage.text);
  }
}

// Pull-on-open: ask the background for the table as it is now, so a freshly
// (re)opened tab does not stay empty until the next recording call.
function requestCurrentProgress() {
  return browser.runtime.sendMessage({ type: "get-progress" })
    .then((progressResponse) => {
      if (progressResponse?.html) replaceProgressTable(progressResponse.html);
    })
    .catch(() => {});
}

function initStatusView() {
  for (const scrollAreaId of Object.keys(ENTRY_KINDS)) {
    const scrollArea = document.getElementById(scrollAreaId);
    if (scrollArea) watchScrolling(scrollArea);
  }
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
    handleStatusViewMessage,
    requestCurrentProgress,
    initStatusView,
  };
}

/* istanbul ignore next */
if (typeof document !== "undefined" && document.getElementById(PROGRESS_ELEMENT_ID)) {
  initStatusView();
}
