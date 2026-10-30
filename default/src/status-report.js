// Report status of a DOI search in 1. extension icon badge;
// 2. web browser console; and 3. extension pages

const LOG_PREFIX = "[default-extension]";
const STATUS_MESSAGE_TYPE = "status";
const BADGE_TEXT = "•";
const ERROR_COLOR = "red";
const NORMAL_COLOR = "green";

function reportStatus(statusText, isError = false) {
  showStatusOnBadge(BADGE_TEXT, isError);
  writeStatusToConsole(statusText, isError);
  return sendStatusToExtensionPages(statusText, isError);
}

function showStatusOnBadge(badgeText, isError) {
  try {
    browser.browserAction.setBadgeText({ text: badgeText });
    browser.browserAction.setBadgeBackgroundColor({ color: chooseColor(isError) });
  } catch (_) {}
}

function chooseColor(isError) {
  return isError ? ERROR_COLOR : NORMAL_COLOR;
}

function writeStatusToConsole(statusText, isError) {
  const logToConsole = chooseConsoleType(isError);
  logToConsole(`${LOG_PREFIX} ${statusText}`);
}

function chooseConsoleType(isError) {
  return isError ? console.error : console.log;
}

function sendStatusToExtensionPages(statusText, isError) {
  return browser.runtime.sendMessage({ type: STATUS_MESSAGE_TYPE, text: statusText, isError: isError }).catch(() => {});
}

/* exports for testing */
/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = { reportStatus, NORMAL_COLOR, BADGE_TEXT, ERROR_COLOR, LOG_PREFIX, STATUS_MESSAGE_TYPE };
}
