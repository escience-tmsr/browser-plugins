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

function replaceProgressTable(html) {
  const element = document.getElementById(PROGRESS_ELEMENT_ID);
  if (!element) return;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  element.replaceChildren(...parsed.body.childNodes);
}

function appendLogLine(text) {
  const element = document.getElementById(LOG_ELEMENT_ID);
  if (!element) return;
  const line = document.createElement("div");
  line.textContent = text;
  element.appendChild(line);
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
  browser.runtime.onMessage.addListener(handleStatusViewMessage);
  return requestCurrentProgress();
}

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    STATUS_VIEW_PAGE,
    PROGRESS_ELEMENT_ID,
    LOG_ELEMENT_ID,
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
