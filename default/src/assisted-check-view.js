// THROW-AWAY feasibility check for docs/assisted_download_plan.md, section 2, point 4.
// Logs every click on a link in the progress table, without changing what the click
// does. Not meant to be merged: remove this file and its script tag after the check.

function logViewCheck(checkMessage) {
  console.log(`[assisted check] ${checkMessage}`);
  appendLogLine(`🔎 ${checkMessage}`);
}

function logLinkClick(clickEvent) {
  const clickedLink = clickEvent.target.closest("a");
  if (!clickedLink) return;
  const heldKeys = ["ctrlKey", "shiftKey", "metaKey", "altKey"].filter((keyName) => clickEvent[keyName]);
  logViewCheck(`${clickEvent.type} with mouse button ${clickEvent.button}` +
    `${heldKeys.length ? ` and ${heldKeys.join(", ")}` : ""} on ${clickedLink.href}`);
}

const progressElementForCheck = document.getElementById(PROGRESS_ELEMENT_ID);
if (progressElementForCheck) {
  progressElementForCheck.addEventListener("click", logLinkClick);
  progressElementForCheck.addEventListener("auxclick", logLinkClick);
  browser.tabs.getCurrent().then((statusTab) => logViewCheck(`the status tab is tab ${statusTab.id}`));
}
