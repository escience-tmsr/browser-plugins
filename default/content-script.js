console.log("[default-extension] content-script injected on", window.location.href);

browser.runtime.sendMessage({ type: "what-is-my-tabid" })
  .then(response => {
    const myTabId = response && response.tabId;
    if (myTabId != null) {
      window.setTimeout(() => maybeRunJob(myTabId), 500);
    } else {
      reportStatus("[default-extension] no tabId available, doing nothing");
    }
  })
  .catch(err => {
    reportStatus(`[default-extension] error getting tabId: ${err}`);
  });
