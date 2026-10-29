// Runs in every page (see manifest.json), after src/content.functions.js, whose
// maybeRunJob and sendStatus it uses. It finds out which tab it is in and then lets
// maybeRunJob decide whether that tab has a job to run.

const JOB_START_DELAY_MS = 500;

async function requestOwnTabId() {
  const response = await browser.runtime.sendMessage({ type: "what-is-my-tabid" });
  return response?.tabId ?? null;
}

function scheduleMaybeRunJob(tabId) {
  window.setTimeout(() => maybeRunJob(tabId), JOB_START_DELAY_MS);
}

async function startContentScript() {
  console.log("[default-extension] content-script injected on", window.location.href);
  try {
    const tabId = await requestOwnTabId();
    if (tabId !== null) {
      scheduleMaybeRunJob(tabId);
    } else {
      sendStatus("[default-extension] no tabId available, doing nothing");
    }
  } catch (err) {
    sendStatus(`[default-extension] error getting tabId: ${err}`);
  }
}

if (typeof module !== "undefined") {
  module.exports = { JOB_START_DELAY_MS, requestOwnTabId, scheduleMaybeRunJob, startContentScript };
}

startContentScript();
