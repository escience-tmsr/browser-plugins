# Record PDFs the user downloads by hand from the status table: A Plan

When the extension cannot get a PDF by itself, the progress table often shows where to
find it. For example, for DOI 10.1016/j.artint.2021.103535 the extension reaches
linkinghub.elsevier.com, which forwards to ScienceDirect; ScienceDirect's robots.txt
disallows robots, so the extension stops there (`docs/robots_txt_plan.md`). Clicking the
blocked ScienceDirect address in the table opens the article page, where the user can
click the PDF button.

This plan lets the extension notice that download and record it in the table, in a
row of its own next to the extension's own attempt, so the table shows which DOIs have
a PDF however it was obtained.
The extension only watches: every request in the tab is the user's own, so robots.txt
does not apply, and the extension does not search, click or navigate anything there.
This is option B from the discussion of 2026-09-28; option A, in which the extension
would continue the job in the new tab and would need an exception to robots.txt, was
not chosen.

This document is step 1: a plan only, without any code. It builds on the progress
table (`docs/visualize_progress_plan.md`) and on the clickable addresses of the
robots.txt step 5 PR (#18), so steps 2+ start after those are merged.

## 1. What the user sees

1. The user clicks an address in the progress table. It opens in a new tab, as now.
2. The user downloads the PDF in that tab, or in a tab opened from it (many publishers
   open "View PDF" in a new tab).
3. As soon as a PDF shows up in the watched tab, the manual take-over gets a new row,
   decided by the maintainer on 2026-09-28, so the extension's own attempt in the row
   the address came from (such as the robots.txt block of the example above) stays as
   it is:
   - *DOI*: the DOI of the row the address came from;
   - *page #*: that row's page number followed by `(by hand)`, e.g. `1 (by hand)`. It
     shows where the take-over started, and cannot clash with the numbers of a job
     that is still running, which are plain numbers;
   - *publisher page*: when the clicked row's publisher page was accessible (status
     `SUCCESS`), its publisher page cells are copied, and the manual part starts with
     the capture: opening the article page by hand is part of reaching the PDF. When
     it was not accessible (blocked, or it did not load), the manual part starts with
     the page itself: `SUCCESS: opened by hand` with the address the user clicked;
   - *pdf link*: empty, as the user found the PDF, which the extension does not
     observe.

   For the example above, where linkinghub.elsevier.com loaded and ScienceDirect was
   blocked, the two rows read:

   | page # | publisher page | pdf link | pdf capture | pdf download |
   |---|---|---|---|---|
   | 1 | `SUCCESS` linkinghub… | `NOT_FOUND` | `ACCESS_ERROR: blocked by robots.txt` sciencedirect… | |
   | 1 (by hand) | `SUCCESS` linkinghub… (copied) | | `SUCCESS: viewed by hand` PDF address | `SUCCESS: downloaded by hand` file name |
4. When the PDF is shown in the tab (in Firefox's PDF viewer) before it is saved, the
   new row shows, decided by the maintainer on 2026-09-28:
   - in its *pdf capture* cells `SUCCESS: viewed by hand` with the PDF's address: the
     PDF was reached;
   - in its *pdf download* cells `PENDING: viewed, not downloaded yet`, until the PDF
     is saved.
5. When the PDF is saved, the new row shows in its *pdf download* cells
   `SUCCESS: downloaded by hand` with the file name, and the log shows
   `📥 PDF downloaded by hand for <DOI>: <file name>`. A download the user cancels is
   shown as `ACCESS_ERROR: Download interrupted (<reason>)`, as for the extension's
   own downloads.

Clicking an address in the same row again continues in the same `(by hand)` row. A
click that leads to no PDF adds no row. The new row is added at the bottom of the table,
like every new row; its page number names the row it belongs to.

The file keeps the name the website gives it: Firefox does not let extensions choose the
name of a download they did not start. The status text makes the difference with the
extension's own downloads visible; `SUCCESS: …` is colored green like `SUCCESS`, and
`PENDING: …` light blue like `PENDING`, since the colors go by the start of the status.

## 2. Is it feasible? Parts to confirm first

The parts below use documented WebExtension APIs, but four behaviours depend on Firefox
and on the publisher, and decide the design. They are checked in step 2, before any
code is built on them:

1. **Knowing which tab a download came from.** Firefox's `downloads.DownloadItem` has no
   tab id. The plan matches a download to a tab by its address instead: the
   `webRequest.onHeadersReceived` listener that already exists sees the PDF response,
   with its tab id and URL, and a download with the same `url` belongs to that tab.
   This is how `isCaptureDownload` already matches the extension's own downloads.
   To confirm: does the download's `url` equal the response URL for ScienceDirect's PDF
   button? Backup: `DownloadItem.referrer`, the page the download was started from,
   compared with the pages loaded in the watched tabs.
2. **Tabs opened from the watched tab.** `tabs.onCreated` gives a new tab's
   `openerTabId`. To confirm: is it set for the tab ScienceDirect opens for its PDF
   (a link with `target="_blank"` or `window.open`)?
3. **PDFs shown in Firefox's own viewer.** When Firefox displays a PDF instead of
   downloading it (the default for PDFs), nothing is downloaded until the user clicks
   the viewer's download button. The PDF response itself is recorded as viewed
   (section 1). To confirm: does the later download carry the PDF's URL, so point 1
   matches it? If it carries a `blob:` address instead, match by `referrer`.
4. **The click in the status tab.** The status tab has to open the tab itself
   (`browser.tabs.create`) to know its id; a plain link does not report the new tab.
   To confirm: middle-clicks and Ctrl-clicks, which users use to open links in a new
   tab, reach the click handler (`auxclick` for the middle button).

If 1 and 3 both fail, the feature cannot be built reliably and the plan stops after
step 2.

## 3. Design

### Remembering which tab belongs to which row

- Each table row carries its DOI and page number: `<tr data-doi="…" data-page-counter="…">`
  (`progress.js`, `_rowHtml`). The links stay as they are, so they still work as plain
  links if the click handler is missing.
- `status-view.js` listens for `click` and `auxclick` on the progress element, not on
  each link, because the table is replaced on every update. For a click on an
  `http(s)` link it prevents the default, opens the address with
  `browser.tabs.create({ url, active: true })` (`active: false` for a middle click, as
  the browser would), and sends
  `{ type: "watch-assisted-tab", tabId, doi, pageCounter, clickedUrl }` to the
  background, `pageCounter` being the clicked row's page number.
- The background keeps the watched tabs in `browser.storage.local` under
  `assistedTabs`, as `{ [tabId]: { doi, manualPageLabel, clickedUrl, pdfUrls: [] } }`,
  with `manualPageLabel` the new row's page number, `` `${pageCounter} (by hand)` ``.
  They survive
  the background page being unloaded, like `job`. A tab opened from a watched tab
  (`tabs.onCreated` with a watched `openerTabId`) is watched for the same row.
  `tabs.onRemoved` removes a closed tab.

### Noticing the PDF

- In the existing `onHeadersReceived` listener: for a response in a watched tab whose
  content type is `application/pdf` (`retrievingPdfFile`), add its URL to that tab's
  `pdfUrls`. Only `main_frame` and `sub_frame` responses, as a PDF viewer page may show
  the PDF in a frame. Unless the response is a download (`retrievingAttachment`),
  Firefox shows it, so record it as viewed in the manual row: `recordPdfCapture(doi,
  manualPageLabel, "SUCCESS: viewed by hand", pdfUrl)` and `recordPdfDownload(doi,
  manualPageLabel, "PENDING: viewed, not downloaded yet", null)`, unless that row's
  download cells already show a download by hand.
- The first time a watched tab records anything, the manual row is created with its
  publisher page cells (section 1): a copy of the clicked row's publisher page cells
  when their status is `SUCCESS`, and otherwise `recordPublisherPageAccess(doi,
  manualPageLabel, "SUCCESS: opened by hand", clickedUrl)`. The copy needs a way to
  read a row's cells from the recorder, such as `publisherPageCells(doi,
  pageCounter)`, returning `{ pageStatus, pageResult }`. The progress recorder keys rows by `` `${doi}#${pageCounter}` `` and
  prints the page number as text, so a label such as `1 (by hand)` works without
  changes to the recorder.
- In `processDownloadChange`, which already sees every download ending: when no capture
  is armed, or the download is not the capture's, look for a watched tab whose
  `pdfUrls` contain the download's `url`. If one does, record the download in the
  manual row with `recordPdfDownload(doi, manualPageLabel, status, fileName)` and log
  it.
- A downloaded PDF also counts when no PDF response was seen but the download itself is
  a PDF (`mime` `application/pdf`) and its `referrer` is a page of a watched tab, if
  step 2 shows that is needed.

### What stays the same

- The job's tab and the robots.txt check are not involved: a watched tab is never the
  job's tab, and requests in other tabs pass the check unchecked.
- The content script does nothing in watched tabs: `maybeRunJob` only works in the
  job's tab.
- The row the address came from is not changed.
- A watched tab stays watched until it is closed. A later download in it replaces the
  manual row's download cells; that is the user's own choice of file.

## 4. Privacy

The extension only looks at the tabs the user opened from the table, and at those
tabs' PDF responses and downloads. It does not read page contents there, and keeps
nothing after a tab is closed. The README says so.

## 5. Files to change (existing)

- `default/src/progress.js`: `data-doi` and `data-page-counter` on each row; a status
  suffix for downloads by hand (`SUCCESS: downloaded by hand`).
- `default/src/status-view.js`: the click and auxclick handler.
- `default/background.js`: `tabs.onCreated` and `tabs.onRemoved` listeners; the
  `onHeadersReceived` listener also runs for watched tabs; a `watch-assisted-tab`
  message handler.
- `default/src/background.functions.js`: the functions of section 6, and
  `processDownloadChange` checking watched tabs.
- `default/manifest.json`: probably nothing; `tabs`, `downloads`, `webRequest` and
  `<all_urls>` are already there.
- `default/README.md`: a "Downloading by hand" section in the status table part.
- Tests: `progress.test.js`, `status-view.test.js`, `background.test.js`.
- `aidecl.yaml`.

## 6. Sketch of new functions

Names follow the naming preference from the PR #16 review: descriptive names of two
or more words for variables, parameters and object properties.

`src/status-view.js`:
```js
// click/auxclick on the progress element: open the link's address in a watched tab
async function openAssistedTab(clickEvent) {}
```

`src/background.functions.js`:
```js
async function watchAssistedTab(tabId, doi, pageCounter, clickedUrl) {} // store in assistedTabs
async function watchTabOpenedFromAssistedTab(createdTab) {}      // tabs.onCreated
async function forgetAssistedTab(closedTabId) {}                 // tabs.onRemoved
async function rememberAssistedPdfResponse(responseDetails) {}   // onHeadersReceived; records "viewed"
async function recordAssistedDownload(downloadItem, downloadState) {} // -> true if recorded
```

## 7. Open questions

- **Renaming.** Should the extension offer to save a copy under the DOI name, with
  `browser.downloads.download` of the same URL? That is a second request by the
  extension, to a site whose robots.txt may disallow robots, so it goes against the
  reason for option B; left out unless the user asks for it.
- **Clickable file names.** Opening a saved PDF from the table
  (`browser.downloads.open`, future work from PR #18) needs the download's id in the
  row too; the two features could share that.

## 8. Suggested breakup into reviewable steps

1. **This plan doc.** (current step)
2. **Feasibility check in Firefox** (section 2): a small throw-away branch that logs the
   download items, the PDF responses with their tab ids, and the `openerTabId` of new
   tabs, tried on ScienceDirect (10.1016/j.artint.2021.103535) and one or two other
   publishers. The results decide between URL and referrer matching, and are added to
   this plan.
3. Rows with `data-doi`/`data-page-counter`, and the status tab opening links in a
   watched tab (`openAssistedTab`, the `watch-assisted-tab` message, storing
   `assistedTabs`, `tabs.onCreated`/`tabs.onRemoved`), with tests. Nothing is recorded
   yet.
4. Noticing PDF responses and downloads in watched tabs and recording them, with tests
   and manual Firefox tests; README and `aidecl.yaml`.
