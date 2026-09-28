// THROW-AWAY feasibility check for docs/assisted_download_plan.md, section 2 (step 2).
// Logs what Firefox reports about PDF responses, downloads and new tabs, in every tab,
// so a manual download on a publisher's site shows whether the planned design works.
// Not meant to be merged: remove this file and its manifest entry after the check.

const ASSISTED_CHECK_PDF_TYPE = "application/pdf";
// Tabs created during this check, whose later address changes are logged too.
const assistedCheckCreatedTabs = new Set();

function logAssistedCheck(checkMessage) {
  console.log(`[assisted check] ${checkMessage}`);
  self.sendStatus(`🔎 ${checkMessage}`);
}

function headerValue(responseHeaders, headerName) {
  const matchingHeader = (responseHeaders || []).find((header) => header.name.toLowerCase() === headerName);
  return matchingHeader ? matchingHeader.value : "";
}

// Point 1 and 3: the PDF responses, with their tab and address.
browser.webRequest.onHeadersReceived.addListener(
  (responseDetails) => {
    const contentType = headerValue(responseDetails.responseHeaders, "content-type").toLowerCase();
    const contentDisposition = headerValue(responseDetails.responseHeaders, "content-disposition");
    if (!contentType.includes(ASSISTED_CHECK_PDF_TYPE) && !contentDisposition.toLowerCase().includes("attachment")) return;
    logAssistedCheck(`PDF response in tab ${responseDetails.tabId} (${responseDetails.type}, ` +
      `status ${responseDetails.statusCode}, ${contentType || "no content type"}` +
      `${contentDisposition ? `, disposition "${contentDisposition}"` : ""}): ${responseDetails.url}`);
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "object", "other"] },
  ["responseHeaders"]
);

// Point 1 and 3: the downloads, with their address and referrer.
browser.downloads.onCreated.addListener((downloadItem) => {
  logAssistedCheck(`download ${downloadItem.id} started: url ${downloadItem.url}, ` +
    `referrer ${downloadItem.referrer || "none"}, mime ${downloadItem.mime || "none"}`);
});

browser.downloads.onChanged.addListener(async (downloadDelta) => {
  const downloadState = downloadDelta.state?.current;
  if (downloadState !== "complete" && downloadState !== "interrupted") return;
  const [downloadItem] = await browser.downloads.search({ id: downloadDelta.id });
  if (!downloadItem) return;
  logAssistedCheck(`download ${downloadItem.id} ${downloadState}: file ${downloadItem.filename}, ` +
    `url ${downloadItem.url}, referrer ${downloadItem.referrer || "none"}`);
});

// Point 2: new tabs, with the tab they were opened from.
browser.tabs.onCreated.addListener((createdTab) => {
  assistedCheckCreatedTabs.add(createdTab.id);
  logAssistedCheck(`tab ${createdTab.id} opened from tab ${createdTab.openerTabId ?? "none"}: ${createdTab.url}`);
});

browser.tabs.onUpdated.addListener((updatedTabId, tabChanges) => {
  if (!tabChanges.url || !assistedCheckCreatedTabs.has(updatedTabId)) return;
  logAssistedCheck(`tab ${updatedTabId} now shows ${tabChanges.url}`);
});
