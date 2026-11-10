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

const LINK_FOUND = "link found";
const BUTTON_FOUND = "button found";
const NO_LINK_OR_BUTTON_FOUND = "no link or button found";
const LINK_CAPTURE_ERROR = "link capture error";
const PAGE_SEARCH_SCHEDULED = "page search scheduled";
const PAGE_ALREADY_PROCESSED = "page already processed";
const NO_JOB_FOR_THIS_TAB = "no job for this tab";

async function runStoredJob(myTabId) {
  const job = await readStoredJob();
  if (isJobForThisTab(job, myTabId)) {
    return runJob(job, myTabId);
  } else {
    return NO_JOB_FOR_THIS_TAB;
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
  self.reportStatus("Entered readStoredJob");
  try {
    const storedValues = await browser.storage.local.get("job");
    return storedValues.job;
  } catch (error) {
    self.reportStatus(`Error reading job from storage: ${error}`);
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
    return PAGE_ALREADY_PROCESSED;
  } else {
    await processNewPage(job, myTabId, publisherPageUrl);
    return PAGE_SEARCH_SCHEDULED;
  }
}

async function processNewPage(job, myTabId, publisherPageUrl) {
  self.reportStatus(`Entered processNewPage, tabId is ${myTabId}, publisher page url is ${publisherPageUrl}`);
  job.usedUrls.push(publisherPageUrl);
  await browser.storage.local.set({ job });
  await self.recordProgress(PROGRESS_STAGE_PAGE, job.doi, { url: publisherPageUrl });
  window.setTimeout(() => searchPage(job, myTabId), SEARCH_DELAY_MS);
}

async function searchPage(job, myTabId) {
  self.reportStatus(`Entered searchPage, tabId is ${myTabId}`);
  try {
    await self.followPdfLinkOrButton(job, myTabId);
  } catch (error) {
    self.reportStatus(`Error while searching link: ${error.message}`);
  }
}

async function followPdfLinkOrButton(job, myTabId) {
  self.reportStatus("Entered followPdfLinkOrButton");
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
  self.reportStatus(`Entered handleFoundElement, tabId is ${myTabId}`);
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
  self.reportStatus(`Entered requestLinkCapture: Found candidate link for "${job.phrase}", processing`);
  try {
    await browser.runtime.sendMessage({ type: CAPTURE_LINK_MESSAGE_TYPE, pdfUrl, doi: job.doi, tabId: myTabId });
    return LINK_FOUND;
  } catch (error) {
    self.reportStatus(`Error asking add-on to capture PDF: ${error}`);
    return LINK_CAPTURE_ERROR;
  }
}

// misses the capture if the button opens the PDF in a new tab
async function clickButton(button, job, myTabId) {
  self.reportStatus("Entered clickButton: arming capture");
  await browser.runtime.sendMessage({ type: ARM_CAPTURE_MESSAGE_TYPE, doi: job.doi, tabId: myTabId });
  self.reportStatus(`Clicking "${job.phrase}" button…`);
  try {
    button.click();
  } catch (error) {
    self.reportStatus(`Failed clicking element: ${error.message}`);
  }
  return BUTTON_FOUND;
}

async function reportMissingElement(job) {
  self.reportStatus(`Entered reportMissingElement: No link or button found containing "${job.phrase}"`);
  await self.recordProgress(PROGRESS_STAGE_LINK, job.doi, { found: false, url: null });
  return NO_LINK_OR_BUTTON_FOUND;
}

const exported = { findElementByPhrase, followPdfLinkOrButton, runStoredJob, recordProgress, reportStatus };

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    ...exported,
    PROGRESS_STAGE_PAGE, PROGRESS_STAGE_LINK,
    LINK_FOUND, BUTTON_FOUND, NO_LINK_OR_BUTTON_FOUND, LINK_CAPTURE_ERROR,
    PAGE_SEARCH_SCHEDULED, PAGE_ALREADY_PROCESSED, NO_JOB_FOR_THIS_TAB,
    RECORD_PROGRESS_MESSAGE_TYPE, CAPTURE_LINK_MESSAGE_TYPE, ARM_CAPTURE_MESSAGE_TYPE,
  };
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
