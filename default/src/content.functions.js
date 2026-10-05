function sendStatus(text) {
  try { browser.runtime.sendMessage({ type: "status", text }); } catch (_) {}
  console.log("[default-extension]", text);
}

self.sendStatus = sendStatus;

// Report a page load or a link search to the background, which adds the page number
// and records it in the progress table. Resolves once the background has recorded it.
function recordProgress(stage, doi, details) {
  try {
    return browser.runtime.sendMessage({ type: "record-progress", stage, doi, ...details }).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

self.recordProgress = recordProgress;
function findElementByPhrase(phrases) {
  for (const phrase of phrases) {
    const needle = phrase.toLowerCase();
    self.sendStatus(`[default-extension] searching for phrase: ${needle}`);
  
    const elements = Array.from(document.querySelectorAll("a, button"));
    for (const el of elements) {
      const text  = (el.innerText || el.textContent || "").trim();
      const aria  = el.getAttribute("aria-label") || "";
      const title = el.getAttribute("title") || "";
  
      const combined = (text + " " + aria + " " + title).toLowerCase();
      if (combined.includes(needle)) {
        self.sendStatus(`[default-extension] found key "${needle}", tag: ${el.tagName}, target: ${el.href}`);
        return el;
      }
    }
  
    self.sendStatus(`[default-extension] no element found for phrase: ${phrase}`);
  }
  return null;
}

self.findElementByPhrase = findElementByPhrase;
async function performAction(job, myTabId) {
  self.sendStatus("Entering performAction...")
  const phrase = job.phrase;
  const el = self.findElementByPhrase(phrase);

  if (!el) {
    self.sendStatus(`❌ No link or button found containing "${phrase}"`);
    await self.recordProgress("link", job.doi, { found: false, url: null });
    return "not found";
  }
  const tag = el.tagName.toLowerCase();
  // Recorded before the capture is armed, which moves the background on to the next page.
  // A button has no URL of its own: that only becomes known in the capture stage.
  await self.recordProgress("link", job.doi, { found: true, url: (tag === "a" && el.href) || null });

  if (tag === "a" && el.href) {
    const pdfUrl = el.href;
    self.sendStatus(`Found candidate link for "${phrase}", processing…`);

    try {
      await browser.runtime.sendMessage({
        type: "download_pdf_via_tab_capture",
        pdfUrl,
        doi: job.doi || null,
        tabId: myTabId
      });
      return "link found";
    } catch(err) {
      self.sendStatus(`Error asking add-on to capture PDF: ${err}`);
      return "error";
    };

  }

  self.sendStatus("Arming capture…");

  // The capture only watches this tab. If the button opens the PDF in a new tab
  // (window.open, or a form with target="_blank"), the PDF is not captured and the
  // capture is recorded as failed when it times out.
  await browser.runtime.sendMessage({
    type: "arm_capture_for_tab",
    doi: job.doi,
    tabId: myTabId
  });

  self.sendStatus(`Clicking "${phrase}" button…`);
  try {
    el.click();
  } catch (e) {
    self.sendStatus(`Failed clicking element: ${e.message}`);
  }
  return "button found";
}

self.performAction = performAction;
async function maybeRunJob(myTabId) {
  let result = null;
  try {
    result = await browser.storage.local.get("job")
  } catch(err) {
    self.sendStatus(`[default-extension] error reading job from storage: ${err}`);
    return;
  };
  const job = result.job;
  if (!job || job.tabId !== myTabId) return "invalid job";
  self.sendStatus(`Entered maybeRunJob, tabId is ${myTabId}, url is ${job.url}`);

  const here = location.href;
  if (job.usedUrls.includes(here)) {
    self.sendStatus(`Skipping: already processed this page.`);
    return "processed job";
  }

  job.usedUrls.push(here);
  await browser.storage.local.set({ job });
  await self.recordProgress("page", job.doi, { url: here });

  self.sendStatus("[default-extension] tabId matches job, running job");

  window.setTimeout(() => {
    try {
      self.performAction(job, myTabId);
    } catch (e) {
      self.sendStatus(`Error while searching link: ${e.message}`);
    }
  }, 1000);
  return "finished job"
}

module.exports = { findElementByPhrase, maybeRunJob, performAction, recordProgress, sendStatus, };
if (typeof self !== "undefined") {
  self.findElementByPhrase = findElementByPhrase;
  self.maybeRunJob = maybeRunJob;
  self.performAction = performAction;
  self.recordProgress = recordProgress;
  self.sendStatus = sendStatus;
}
