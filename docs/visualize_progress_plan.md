# Add live progress table for the TMSR browser extension: A Plan

We want to add a live progress table to the TMSR browser extension. It will mirror
the existing `doi_downloader/progress.py` + `progress_browser.py` from the `doi-downloader`
`visualize_progress` branch, adapted to the `default` browser extension. This document is
step 1 of that process: a plan only, without any code. Steps 2+ below are meant to land as 
separate, independently reviewable PRs (one branch/PR per step, smallest-diff-first — see 
the breakup below).

## 1. Key difference from the Python version in doi-downloader

The Python version owns a persistent Playwright tab it fully controls. A WebExtension
popup closes the instant the user's real browsing tab gets focus or navigates — which
happens constantly here, since the whole job *is* "navigate the tracked tab → click a
PDF link → navigate again". So the progress status table can't live in `popup.html`.

The new function will use **a dedicated extension tab** (`status-view.html`), opened 
once and reused, analogous to the Playwright tab `progress_browser.py` launches lazily 
on first use.

## 2. Popup/status-tab parity: a log panel

Today, closing the popup loses everything except the toolbar badge (the green/red dot
`setBadge` sets) — the popup's `#status` line is fed by one-line `sendStatus()` narration
calls scattered through `background.functions.js`/`content.functions.js`, and that
listener only exists while the popup's DOM is alive.

Decision: `status-view.js` subscribes to **both** message types, not just the new
structured one, so the status tab becomes a strict superset of what the popup ever
showed rather than a second, narrower view:

- `{type: "progress-update", html}` (new) — replaces the table content, as designed below.
- `{type: "status", text}` (existing — the same channel `popup.js` already listens to) —
  appended to a small running log panel alongside the table.

This needs no new recording calls added to `background.js`/`content.functions.js`: those
`sendStatus()` calls already broadcast `{type: "status", ...}`; only the new tab needs a
second listener for it. `status-view.html` gets a log container element in addition to
the table.

## 3. Row grain and stage mapping

In the Python version, rows are one per `(doi, plugin, fetch event)` — there are several 
competing plugins, each doing its own metadata-cache lookup, page fetch, and PDF-url extraction.
The extension has a single strategy (no plugins) but a job can visit **several pages**
in sequence (`captureSession.pageCounter`, `job.usedUrls`), so the natural row grain is
one row per **page visited within a job**.

| Python stage                     | Extension equivalent                                                                  | Source                                                        |
|----------------------------------|---------------------------------------------------------------------------------------|---------------------------------------------------------------|
| disk (pre-check)                 | — (no disk check in plugin code)                                                      | —                                                             |
| cache (metadata cache)           | — (no cache or cache check plugin code)                                               | —                                                             |
| fetch (page load, candidate URL) | page load: the content script noticing it has landed on a new page — the initial doi.org redirect target, or a later page reached by following a link | `content.functions.js` `maybeRunJob` (confirms), `background.functions.js` `startJob` (seeds + times out) |
| — (no direct analog)             | link search: did `findElementByPhrase` find a PDF/download link or button on the page | `content.functions.js` `performAction`/`findElementByPhrase`  |
| pdf access (candidate PDF url)   | capture: was a real PDF response detected, or did it fail (paywall/401/403/timeout)   | `background.functions.js` `armCaptureBase`/`failCapture`      |
| pdf file (saved path)            | download: file saved via `browser.downloads`                                          | `background.js` `downloads.onChanged`                         |

Note: `background.js`'s `onHeadersReceived`/`storeDetailsInSessionData` do **not** get their
own recording call. They only run once a capture session already exists (i.e. after a link
has already been found and `armCaptureBase` has armed one) — never for the very first
doi.org→publisher-page navigation, since no capture session exists yet at that point. What
they collect (`lastMainStatus`/`lastMainContentType`) stays internal plumbing that
`failCapture`'s existing reasoning already uses to decide *why* a capture failed
(paywall/401/403/HTML-instead-of-PDF); that reasoning is what feeds the capture stage's
`recordPdfAccess` call, not a separate page-load recording of its own.

**Registering a page-load failure.** A genuine failure of the very first page — a bad DOI,
a 404, a network/DNS error — normally shows the browser's own internal error page, where
content scripts don't get injected at all, so `maybeRunJob` would simply never fire and no
row would ever appear. To make that failure visible instead of silent: `startJob` seeds a
placeholder row as soon as the job starts, `recordPublisherPageAccess(doi, 1, STATUS_SKIPPED, doiUrl)` —
`doiUrl` being the `https://doi.org/<DOI>` URL, the only URL known before any redirect has
happened — and starts a timeout (mirroring `armCaptureBase`'s existing `CAPTURE_TIMEOUT_MS`
pattern). If `maybeRunJob` reports in before the timeout, its message both overwrites the
row with `recordPublisherPageAccess(doi, 1, STATUS_SUCCESS, actualLandedUrl)` and cancels the timeout. If
it never reports in, the timeout fires and overwrites the row with
`recordPublisherPageAccess(doi, 1, STATUS_ACCESS_ERROR: "page did not load", doiUrl)` instead — an explicit,
visible failure rather than a missing row. Either way, both the **page status** cell (the
colored status word) and the **page result** cell (the URL) always show, in their own
adjacent columns, exactly as laid out in the mockup below.

The status vocabulary from the Python version will be reused verbatim from `progress.py` 
for consistency across the two codebases: `SUCCESS`, `NOT_FOUND`, `ACCESS_ERROR` (with a 
free-text reason suffix, e.g. `ACCESS_ERROR: blocked by robots.txt`) and `SKIPPED`. Same 
color classes: success=green, not-found/access-error=red, skipped=gray, unset=blank.

## 4. Status progress table mockup

The progress table will contain one row per page visited for a DOI, with the most 
recent job's rows accumulating over a session, the same way the Python table grows 
across a batch of `download()` calls:

```
| DOI            | page # | page status | page result (URL)         | link status | link result       | capture status | capture result (target)  | download status | download result (file) |
|----------------|--------|-------------|---------------------------|-------------|--------------------|-----------------|---------------------------|------------------|--------------------------|
| 10.1613/jair.49| 1      | SUCCESS     | https://doi.org/... →jair | SUCCESS     | <a href="...pdf">  | SUCCESS         | https://jair.org/....pdf | SUCCESS          | 10.1613_jair.49.pdf      |
| 10.3390/...    | 1      | SUCCESS     | https://mdpi.com/...      | NOT_FOUND   |                    |                 |                           |                  |                          |
| 10.1177/...    | 1      | SUCCESS     | https://sagepub.com/...   | SUCCESS     | <button "Download">| ACCESS_ERROR: paywall/login | https://sagepub.com/...pdf |     |                          |
```

Below the table, the status tab also carries the running narration log described in
section 2 — the same one-line messages the popup shows today, just no longer lost when
the popup closes.

## 5. Files to change (existing)

- `default/manifest.json` — add `src/progress.js` to `background.scripts`; register
  `status-view.html`/`src/status-view.js` (background page, not a content script).
- `default/background.js` — hold the progress recorder singleton, call `record*` at the points
  listed in the stage table above, push an updated render to the status tab after each
  event, open/focus the status tab on `startJob`.
- `default/src/background.functions.js` — add recording calls to `armCaptureBase` and
  `failCapture` (capture stage, `recordPdfAccess`/`recordPdfDownload`), and to `startJob`:
  seed a placeholder page-load row and a timeout that marks it a failure if `maybeRunJob`
  never confirms (see section 3).
- `default/src/content.functions.js` — add recording calls to `maybeRunJob` (page-load
  stage, `recordPublisherPageAccess` — also cancels `startJob`'s pending timeout) and
  `performAction`/`findElementByPhrase` (link-search stage, `recordPdfLinkFound`); needs a new
  message type since these run in the content-script context, not the background, where
  the progress recorder singleton actually lives.
- `default/popup.html` / `default/popup.js` — add an "Open status table" affordance
  (button or auto-open on first `Process DOI` click), analogous to `show_progress=True`.
- `default/tests/background.test.js`, `default/tests/content.test.js` — extend for the
  new recording-call sites.
- `default/README.md` — document the status tab in Usage (mirrors the
  `docs/writing_a_plugin.md` diff on the Python side).

## 6. New files

- `default/src/progress.js` — progress recorder + HTML renderer, direct analog of `progress.py`:
  status constants, a row store keyed by `` `${doi}#${pageCounter}` ``, `record*`
  functions, `toHtml()`.
- `default/status-view.html` — the dedicated tab's HTML shell: the progress table plus
  the narration log panel from section 2 (analog of the page Playwright drives — here
  it's a real extension page instead).
- `default/src/status-view.js` — listens for both `runtime.onMessage` message types
  (`progress-update` replaces the table content, `status` appends to the log panel);
  analog of `progress_browser.py`'s `BrowserView.update()`, minus the browser-launching
  part since it's already running inside a real tab, plus the log-panel subscription
  from section 2.
- `default/tests/progress.test.js` — unit tests for the progress recorder/renderer (analog of
  `test_progress.py`).
- `default/tests/status-view.test.js` — tests for the view's message listeners, both
  the table-replacing and the log-appending one (analog of `test_progress_browser.py`).

## 7. Sketch of new functions/data structures (provisional — can be its own follow-up doc)

`src/progress.js`:
```js
const STATUS_SUCCESS = "SUCCESS";
const STATUS_NOT_FOUND = "NOT_FOUND";
const STATUS_ACCESS_ERROR = "ACCESS_ERROR";
const STATUS_SKIPPED = "SKIPPED";

// row shape (column names), keyed by `${doi}#${pageCounter}`
// { doi, pageCounter, pageStatus, pageResult,
//   linkStatus, linkResult, captureStatus, captureResult,
//   downloadStatus, downloadResult }

function recordPublisherPageAccess(doi, pageCounter, status, url) {}
function recordPdfLinkFound(doi, pageCounter, status, result) {}
function recordPdfAccess(doi, pageCounter, status, targetUrl) {}
function recordPdfDownload(doi, pageCounter, status, filename) {}
function toHtml() {}          // renders the colored table, same styling as progress.py
function getRecorder() {}     // module-level singleton, lives in background.js's context
```

`src/status-view.js`:
```js
function openOrFocusStatusTab() {}   // reuse an already-open tab id, else browser.tabs.create()
// pull-on-open: as soon as the tab is (re)opened, send it the progress recorder's
// current toHtml() and current log lines immediately, rather than waiting for the
// next push — otherwise a freshly opened/reopened tab shows empty until the next
// recording call, even though the recorder already holds this session's history.
// onMessage listener 1: { type: "progress-update", html } -> replace table content
// onMessage listener 2: { type: "status", text } -> append a line to the log panel
//   (same channel popup.js already listens to; see section 2)
```

## 8. Suggested breakup into reviewable steps

Confirmed against version-control-review practice: one branch/PR per step, smallest and
most self-contained diffs first, data/render logic reviewed before it's wired into live
event handlers.

1. **This plan doc.** (current step)
2. Add `src/progress.js` (recorder + renderer) with `tests/progress.test.js`. Pure
   addition, not wired into anything — reviewable purely as data-structure + rendering
   logic, same as reviewing `progress.py` standalone.
3. Add `status-view.html` + `src/status-view.js` + `tests/status-view.test.js` (table and
   log panel, both message listeners), manifest entry, and a manual "Open status table"
   button in the popup. Not wired to real events yet — testable by sending hand-crafted
   messages of both types.
4. Add recording calls to `background.js`/`background.functions.js` (capture/download
   stages) — the data-producing side, background context only.
5. Add recording calls to `content.functions.js` (page-load and link-search stages) —
   smallest, isolated diff, needs the new content-script → background message type.
6. Polish: auto-open behavior on `Process DOI`, README updates.

## 9. Open questions for step 2+ review

- Reuse exact `progress.py` status strings/HTML/CSS, or adapt the table shape once the
  extension's actual data shows what's worth keeping (e.g. is "link result" worth a
  separate column from "capture result" once real captures show it's usually the same
  URL)?
- Should `record*` calls be no-ops until a status tab has ever been opened (mirroring
  `active_row`'s "no-op unless active" contract), so tests and normal usage without the
  table open pay no cost?
- Should the log panel cap its length (e.g. keep the last N lines) so a long session
  doesn't grow the tab unboundedly, the way the table's row count already can?
- `manifest.json`'s background script is a non-persistent event page
  (`"persistent": false`), which Firefox can unload after a period of inactivity between
  jobs. The progress recorder is an in-memory singleton, not `browser.storage`, so an
  unload silently resets it to empty — a long gap between DOI lookups could drop earlier
  session history without the user knowing why. Accept this as a known limitation for
  step 1, or persist the recorder's rows to `browser.storage.local` (mirroring how
  `job`/`usedUrls` are already persisted there today) so they survive a reload?
- `recordPublisherPageAccess` needs a `pageCounter` value, but `content.functions.js`'s `maybeRunJob` (where
  it's sourced from, per section 3) has no access to `captureSession.pageCounter` — that
  variable is `background.js`-only. Page 1 is now covered: `startJob` seeds `job.pageCounter
  = 1` in the `job` object it already creates (in `browser.storage.local`, which the content
  script already reads/writes), and both its placeholder `recordPublisherPageAccess` call and
  `maybeRunJob`'s confirming one use that same value. Still open: who increments
  `job.pageCounter` for page 2 onward (reached by following a link), and how does
  `armCaptureBase` — which runs in `background.js`, not the content script — pick up that
  same number so `recordPdfAccess`/`recordPdfDownload` land on the matching row rather than a
  separately-numbered one?
