// Status reporting for the background page and the popup (see manifest.json and
// popup.html). A status is logged in the browser console, sent to the status tab and
// the popup, shown in the popup's status line when the popup itself reports it, and
// signalled with a dot on the extension's toolbar button: green, or red for an error.

const LOG_PREFIX = "[default-extension] ";
const STATUS_ELEMENT_ID = "status";
const BADGE_TEXT = "•";
const BADGE_NORMAL_COLOR = "green";
const POPUP_NORMAL_COLOR = "";
const ERROR_COLOR = "red";

function reportStatus(statusText, isError = false) {
  showStatusOnBadge(BADGE_TEXT, isError);
  writeStatusToConsole(statusText, isError);
  sendStatusToExtensionPages(statusText, isError);
  showStatusInPopup(statusText, isError);
}

function showStatusOnBadge(badgeText, isError) {
  try {
    browser.browserAction.setBadgeText({ text: badgeText });
    browser.browserAction.setBadgeBackgroundColor({ color: chooseColor(isError, BADGE_NORMAL_COLOR, ERROR_COLOR) });
  } catch (_) {}
}

function chooseColor(isError, normalColor, errorColor) {
  return isError ? errorColor : normalColor;
}

function writeStatusToConsole(statusText, isError) {
  const logToConsole = chooseConsoleType(isError);
  logToConsole(LOG_PREFIX + statusText);
}

function chooseConsoleType(isError) {
  return isError ? console.error : console.log;
}

function sendStatusToExtensionPages(statusText, isError) {
  browser.runtime.sendMessage({ type: "status", text: statusText, isError: isError }).catch(() => {});
}

function showStatusInPopup(statusText, isError) {
  const statusElement = document.getElementById(STATUS_ELEMENT_ID);
  if (statusElement) {
    statusElement.textContent = statusText;
    statusElement.style.color = chooseColor(isError, POPUP_NORMAL_COLOR, ERROR_COLOR);
  }
}

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = { reportStatus, showStatusOnBadge, BADGE_TEXT, BADGE_NORMAL_COLOR, LOG_PREFIX, STATUS_ELEMENT_ID, POPUP_NORMAL_COLOR, ERROR_COLOR };
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  self.reportStatus = reportStatus;
  self.showStatusOnBadge = showStatusOnBadge;
}
