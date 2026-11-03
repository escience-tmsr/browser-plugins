// Search a publisher's page for the PDF link or button of a DOI job

const LOG_PREFIX = "[default-extension]";
const STATUS_MESSAGE_TYPE = "status";
const RECORD_PROGRESS_MESSAGE_TYPE = "record-progress";
const CAPTURE_LINK_MESSAGE_TYPE = "download_pdf_via_tab_capture";
const ARM_CAPTURE_MESSAGE_TYPE = "arm_capture_for_tab";
const PROGRESS_STAGE_PAGE = "page";
const PROGRESS_STAGE_LINK = "link";
const SEARCHED_ELEMENTS_SELECTOR = "a, button";
const SEARCH_DELAY_MS = 1000;

const ACTION_RESULT_LINK_FOUND = "link found";
const ACTION_RESULT_BUTTON_FOUND = "button found";
const ACTION_RESULT_NOT_FOUND = "not found";
const ACTION_RESULT_ERROR = "error";
const JOB_RESULT_FINISHED = "finished job";
const JOB_RESULT_PROCESSED = "processed job";
const JOB_RESULT_INVALID = "invalid job";

async function maybeRunJob(myTabId) {
  const job = await readStoredJob();
  if (isJobForThisTab(job, myTabId)) {
    return runJob(job, myTabId);
  } else {
    return JOB_RESULT_INVALID;
  }
}

function reportStatus(statusText) {
  try {
    browser.runtime.sendMessage({ type: STATUS_MESSAGE_TYPE, text: statusText });
  } catch (_) {}
  console.log(`${LOG_PREFIX} ${statusText}`);
}

function recordProgress(progressStage, doi, stageDetails) {
  try {
    return browser.runtime.sendMessage({ type: RECORD_PROGRESS_MESSAGE_TYPE, stage: progressStage, doi, ...stageDetails }).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

async function readStoredJob() {
  try {
    const storedValues = await browser.storage.local.get("job");
    return storedValues.job;
  } catch (error) {
    self.reportStatus(`error reading job from storage: ${error}`);
    return null;
  }
}

function isJobForThisTab(job, myTabId) {
  return Boolean(job) && job.tabId === myTabId;
}

async function runJob(job, myTabId) {
  self.reportStatus(`Entered runJob, tabId is ${myTabId}, url is ${job.url}`);
  const publisherPageUrl = location.href;
  if (job.usedUrls.includes(publisherPageUrl)) {
    self.reportStatus("Skipping: already processed this page.");
    return JOB_RESULT_PROCESSED;
  } else {
    await processNewPage(job, myTabId, publisherPageUrl);
    return JOB_RESULT_FINISHED;
  }
}

async function processNewPage(job, myTabId, publisherPageUrl) {
  job.usedUrls.push(publisherPageUrl);
  await browser.storage.local.set({ job });
  await self.recordProgress(PROGRESS_STAGE_PAGE, job.doi, { url: publisherPageUrl });
  self.reportStatus("tabId matches job, running job");
  window.setTimeout(() => searchPage(job, myTabId), SEARCH_DELAY_MS);
}

async function searchPage(job, myTabId) {
  try {
    await self.followPdfLinkOrButton(job, myTabId);
  } catch (error) {
    self.reportStatus(`Error while searching link: ${error.message}`);
  }
}

async function followPdfLinkOrButton(job, myTabId) {
  self.reportStatus("Entering followPdfLinkOrButton...");
  const foundElement = self.findElementByPhrase(job.phrase);
  if (foundElement) {
    return handleFoundElement(foundElement, job, myTabId);
  } else {
    return reportMissingElement(job);
  }
}

function findElementByPhrase(searchPhrases) {
  const candidateElementsFromPage = Array.from(document.querySelectorAll(SEARCHED_ELEMENTS_SELECTOR));
  for (const searchPhrase of searchPhrases) {
    const matchingElement = findElementContaining(candidateElementsFromPage, searchPhrase);
    if (matchingElement) {
      return matchingElement;
    }
  }
  return null;
}

function findElementContaining(candidateElementsFromPage, searchPhrase) {
  const searchText = searchPhrase.toLowerCase();
  self.reportStatus(`searching for phrase: ${searchText}`);
  const matchingElement = candidateElementsFromPage.find((candidateElement) => readElementText(candidateElement).includes(searchText)); // this only considers the first match
  if (matchingElement) {
    self.reportStatus(`found key "${searchText}", tag: ${matchingElement.tagName}, target: ${matchingElement.href}`);
  } else {
    self.reportStatus(`no element found for phrase: ${searchPhrase}`);
  }
  return matchingElement ?? null;
}

function readElementText(candidateElement) {
  const visibleText = (candidateElement.innerText || candidateElement.textContent || "").trim();
  const ariaLabel = candidateElement.getAttribute("aria-label") || "";
  const titleText = candidateElement.getAttribute("title") || "";
  return `${visibleText} ${ariaLabel} ${titleText}`.toLowerCase();
}

async function handleFoundElement(foundElement, job, myTabId) {
  await self.recordProgress(PROGRESS_STAGE_LINK, job.doi, { found: true, url: readLinkUrl(foundElement) });
  if (isLink(foundElement)) {
    return requestLinkCapture(foundElement.href, job, myTabId);
  } else {
    return clickButton(foundElement, job, myTabId);
  }
}

function readLinkUrl(foundElement) {
  return isLink(foundElement) ? foundElement.href : null;
}

function isLink(foundElement) {
  return foundElement.tagName.toLowerCase() === "a" && Boolean(foundElement.href);
}

async function requestLinkCapture(pdfUrl, job, myTabId) {
  self.reportStatus(`Found candidate link for "${job.phrase}", processing…`);
  try {
    await browser.runtime.sendMessage({ type: CAPTURE_LINK_MESSAGE_TYPE, pdfUrl, doi: job.doi || null, tabId: myTabId });
    return ACTION_RESULT_LINK_FOUND;
  } catch (error) {
    self.reportStatus(`Error asking add-on to capture PDF: ${error}`);
    return ACTION_RESULT_ERROR;
  }
}

// The capture only watches this tab. If the button opens the PDF in a new tab
// (window.open, or a form with target="_blank"), the PDF is not captured and the
// capture is recorded as failed when it times out.
async function clickButton(button, job, myTabId) {
  self.reportStatus("Arming capture…");
  await browser.runtime.sendMessage({ type: ARM_CAPTURE_MESSAGE_TYPE, doi: job.doi, tabId: myTabId });
  self.reportStatus(`Clicking "${job.phrase}" button…`);
  try {
    button.click();
  } catch (error) {
    self.reportStatus(`Failed clicking element: ${error.message}`);
  }
  return ACTION_RESULT_BUTTON_FOUND;
}

async function reportMissingElement(job) {
  self.reportStatus(`❌ No link or button found containing "${job.phrase}"`);
  await self.recordProgress(PROGRESS_STAGE_LINK, job.doi, { found: false, url: null });
  return ACTION_RESULT_NOT_FOUND;
}

const exported = { findElementByPhrase, followPdfLinkOrButton, maybeRunJob, recordProgress, reportStatus };

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    ...exported,
    PROGRESS_STAGE_PAGE, PROGRESS_STAGE_LINK,
    ACTION_RESULT_LINK_FOUND, ACTION_RESULT_BUTTON_FOUND, ACTION_RESULT_NOT_FOUND, ACTION_RESULT_ERROR,
    JOB_RESULT_FINISHED, JOB_RESULT_PROCESSED, JOB_RESULT_INVALID,
  };
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
