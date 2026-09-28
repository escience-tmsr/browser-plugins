# Respect robots.txt in the TMSR browser extension: A Plan

The `default` browser extension visits web sites on the user's behalf: it opens the DOI
page, follows the publisher's redirect, follows a PDF link or clicks a download button,
and captures the PDF. It never checks the sites' `robots.txt` files. The `doi-downloader`
project does (`doi_downloader/lib.py`, `robot_access_allowed`), following the policy in
its `CLAUDE.md`: "Do not access contents from a website when its configuration file
robots.txt prohibits bot access". This plan adds the same policy to the extension.

This document is step 1: a plan only, without any code. Steps 2+ (section 9) are meant
to land as separate, independently reviewable PRs, one branch/PR per step.

## 1. Decisions

Taken by the maintainer before this plan was written:

1. **Follow RFC 9309** (the Robots Exclusion Protocol) where it differs from
   `doi-downloader`, in particular for a robots.txt that cannot be fetched (section 4).
2. **Check the `*` user-agent group**, as `doi-downloader` does
   (`can_fetch("*", url)`). The extension has no product token of its own.
3. **Write our own parser** (`src/robots.js`) instead of vendoring a library: the
   extension has no build step and no runtime dependencies, and the RFC's matching
   rules fit in about a hundred lines that can be tested completely.

## 2. How doi-downloader does it, and what changes

`robot_access_allowed(url)` fetches `<scheme>://<host>/robots.txt` with `requests`
(10 s timeout, cached for the whole run with `functools.cache`), parses it with Python's
`urllib.robotparser.RobotFileParser` and asks `can_fetch("*", url)`. It is called
before a publisher page is fetched (`plugins/googlescholar.py`), before a PDF is
downloaded (`pdf_download.py`), and for every redirect hop (`get_page_with_requests`).

| Aspect                         | doi-downloader                           | extension (this plan)                                  |
|--------------------------------|------------------------------------------|--------------------------------------------------------|
| where the check happens        | before each `requests.get` and each redirect hop | one `webRequest.onBeforeRequest` guard for every page request in the job's tab (section 3) |
| robots.txt 200                 | parse and check                          | parse and check                                        |
| robots.txt 4xx (e.g. 404)      | allowed                                  | allowed                                                |
| robots.txt 5xx, 429, network error, timeout | allowed                     | **disallowed** (RFC 9309, decision 1)                  |
| rule matching                  | first rule in file order that matches; no `*`/`$` wildcards | longest matching rule wins, `Allow` wins a tie, `*` and `$` supported (RFC 9309) |
| user-agent group               | `*`                                      | `*`                                                    |
| cache                          | whole run, no expiry                     | per origin, 24 hours, in memory (section 4)            |

Because of the matching rules the two projects can give different answers for the same
robots.txt. Example: with `Disallow: /` followed by `Allow: /pdf/`, Python's parser
disallows `/pdf/x.pdf` (the first rule matches), RFC 9309 allows it (the `Allow` rule is
longer). The parser tests will include such a case, with a comment pointing here.

## 3. Where to check: one guard for all page requests

The extension reaches a page in four ways, and a check has to cover all of them:

1. `startJob` opens `https://doi.org/<DOI>` in a new tab (`tabs.create`).
2. The server redirects: doi.org to the publisher, and often further inside the
   publisher's site.
3. `armCaptureAndNavigate` follows a PDF link (`tabs.update`).
4. `performAction` clicks a button; the page's own script or form decides where that
   goes, so the extension never sees the URL beforehand.

Checking before `tabs.create`/`tabs.update` would miss 2 and 4. Instead, `background.js`
gets a blocking `webRequest.onBeforeRequest` listener:

- It only acts on requests of type `main_frame` in the job's tab. A PDF opened in the tab
  is a `main_frame` request too, including one the server sends as a download.
- It reads the job's tab id from `browser.storage.local` (the `job` object `startJob`
  already stores there), so it keeps working after the non-persistent background page
  was unloaded and reloaded.
- It asks `robotsAccessAllowed(url)` (section 4) and returns `{ cancel: true }` if the
  answer is no. Firefox lets a blocking listener return a Promise, so the listener can
  wait for the robots.txt fetch.
- Everything else passes untouched: other tabs, and the images, scripts and style sheets
  a page loads. robots.txt governs which pages a bot requests, not what those pages
  load, and blocking sub-resources would break the pages.

Two details:

- **The first request.** `tabs.create({ url })` sends the doi.org request before the
  extension knows the new tab's id, so the guard would not recognise it. `startJob` will
  create the tab on `about:blank`, store the `job` with its tab id, and only then
  navigate the tab to the DOI URL with `tabs.update`. Content scripts are not injected
  into `about:blank`, so nothing else changes.
- **Redirects.** We expect Firefox to call `onBeforeRequest` again for each redirect
  target (MDN's diagram of the `webRequest` events loops from `onBeforeRedirect` back to
  `onBeforeRequest`). This has to be confirmed in Firefox in step 4 before we rely on
  it. The fallback is to inspect 3xx responses in the existing `onHeadersReceived`
  listener and cancel them when their `Location` is disallowed.

The extension's own robots.txt requests run in the background page, with tab id -1, so
the guard never sees them and cannot call itself.

## 4. Fetching and caching robots.txt (`src/robots.js`)

`robotsAccessAllowed(url)` returns a Promise of `{ allowed, reason }`:

1. Build `<scheme>://<host>[:port]/robots.txt` from the URL. The robots.txt URL itself
   is always allowed (RFC 9309).
2. Look up the origin in the cache; if there is no entry younger than 24 hours, fetch
   the file with `fetch()`. The manifest's `<all_urls>` permission lets the background
   page fetch from any site without CORS restrictions. Timeout 10 seconds (as in
   `doi-downloader`), using an `AbortController`. `fetch` follows redirects itself,
   which covers the RFC's "at least five redirects".
3. Interpret the result:
   - **2xx**: parse the body, at most the first 500 KiB (the RFC's minimum parsing
     limit), and check the URL against the `*` group.
   - **4xx other than 429**: the file is "unavailable": everything is allowed.
   - **5xx, 429, network error or timeout**: the file is "unreachable": everything is
     disallowed, with reason `robots.txt unreachable`. RFC 9309 names 5xx and network
     errors. It does not mention 429 ("Too Many Requests"); treating it as unreachable
     is our choice, because it tells us the server wants fewer requests, not that there
     are no rules. Google's crawler does the same.
4. Cache the parsed rules (or the "allow all"/"disallow all" outcome) per origin. The
   cache lives in memory: when Firefox unloads the background page the cache is lost
   and the next request fetches the file again, which is harmless. An unreachable
   robots.txt is cached for a shorter time (e.g. 10 minutes), so a temporary server
   problem does not block a site for a day. The RFC's 30-day fallback for a long
   unreachable file does not apply to a cache that lives this short.

The parser, `parseRobotsTxt(text)` and `isAllowed(rules, url)`, follows RFC 9309:

- Lines are `key: value`; keys are case-insensitive; `#` starts a comment; unknown keys
  (`Sitemap`, `Crawl-delay`, ...) are ignored.
- A group is one or more `User-agent` lines followed by `Allow`/`Disallow` rules. Only
  groups naming `*` apply to us; several such groups are combined. If there is no `*`
  group, everything is allowed.
- A rule matches when its pattern matches the start of the URL's path plus query string.
  `*` matches any sequence of characters, a final `$` anchors the end. Both the pattern
  and the path are compared in percent-encoded form, so `/ä` and `/%C3%A4` are equal.
- The longest matching pattern wins; if an `Allow` and a `Disallow` pattern of the same
  length both match, `Allow` wins; with no matching rule the URL is allowed. An empty
  `Disallow:` is not a rule and allows everything.

## 5. What happens when a request is blocked

- **The tab** shows Firefox's own page for a blocked request. (Open question: redirect
  to a small extension page that explains why instead, see section 11.)
- **The status log** gets a line like `🚫 robots.txt disallows https://example.org/x.pdf`.
- **The progress table** records the block on the stage that was going on:
  - no capture armed yet (the DOI page or the redirects after it): the page stage of
    row 1, `ACCESS_ERROR: blocked by robots.txt` with the blocked URL as result;
    `pageLoadTimeoutId` is cleared, otherwise the timeout would later overwrite the row
    with "page did not load";
  - a capture armed (a followed link or a clicked button): the capture stage of the
    capture's row, with the same status; the capture's timeout is cleared and the
    capture ends (`failCapture`, `captureSession = null`).
  For an unreachable robots.txt the reason is `robots.txt unreachable` instead.
  `ACCESS_ERROR: blocked by robots.txt` is the status the progress table plan
  (`docs/visualize_progress_plan.md`, section 3) already used as its example.
- **The job** ends: the content script never runs on a cancelled page, so no further
  link is searched.

## 6. Files to change (existing)

- `default/manifest.json`: add `src/robots.js` to `background.scripts` (before
  `src/background.functions.js`). The permissions it needs (`webRequest`,
  `webRequestBlocking`, `<all_urls>`) are already there.
- `default/background.js`: register the `onBeforeRequest` guard.
- `default/src/background.functions.js`: the guard's handler (find the job's tab, ask
  `robotsAccessAllowed`, record the block, section 5); `startJob` opens `about:blank`
  first (section 3).
- `default/tests/background.test.js`: tests for the handler and the new `startJob` order.
- `default/README.md`: document the robots.txt check, including that it makes the
  extension skip sites whose robots.txt server fails.
- `aidecl.yaml`: declare the new work.

## 7. New files

- `default/src/robots.js`: `parseRobotsTxt`, `isAllowed`, `robotsAccessAllowed` and the
  cache; exported to `self` and, behind `typeof module !== "undefined"`, to Jest.
- `default/tests/robots.test.js`: parser and matching tests (the RFC 9309 examples,
  wildcards, ties, percent-encoding, multiple `*` groups, no `*` group, the
  doi-downloader difference from section 2), and fetch/cache tests with a mocked
  `fetch` (200, 404, 429, 500, network error, timeout, cache expiry).

## 8. Sketch of new functions

`src/robots.js`:
```js
const ROBOTS_FETCH_TIMEOUT_MS = 10000;
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
const ROBOTS_UNREACHABLE_CACHE_MS = 10 * 60 * 1000;
const ROBOTS_MAX_BYTES = 500 * 1024;
const BLOCKED_BY_ROBOTS = "blocked by robots.txt";
const ROBOTS_UNREACHABLE = "robots.txt unreachable";

function parseRobotsTxt(text) {}          // -> rules of the "*" group(s): [{ allow, pattern }]
function isAllowed(rules, url) {}         // longest match, Allow wins a tie
async function robotsAccessAllowed(url) {} // -> { allowed, reason }, fetches and caches
```

`src/background.functions.js`:
```js
// onBeforeRequest handler: only main_frame requests in the job's tab
async function checkRobotsBeforeRequest(details) {} // -> {} or { cancel: true }
function recordRobotsBlock(url, reason) {}          // page or capture stage, section 5
```

## 9. Suggested breakup into reviewable steps

1. **This plan doc.** (current step)
2. `src/robots.js` parser and matcher (`parseRobotsTxt`, `isAllowed`) with their tests.
   Pure functions, not wired into anything.
3. Fetching, status-code handling and caching (`robotsAccessAllowed`) with tests
   against a mocked `fetch`. Still not wired in.
4. The `onBeforeRequest` guard and `startJob` opening `about:blank` first, with tests.
   Manual Firefox tests: a site whose robots.txt disallows the PDF, a redirect into a
   disallowed path, a button click to a disallowed URL, and confirming that
   `onBeforeRequest` sees redirect targets (section 3).
5. Recording blocks in the progress table and the status log (section 5), README and
   `aidecl.yaml`.

## 10. doi.org's own robots.txt

Every job starts at `https://doi.org/<DOI>`, so a robots.txt on doi.org disallowing `*`
would stop the extension altogether. Checked on 2026-09-28:
`https://doi.org/robots.txt` redirects (301) to `https://www.doi.org/robots.txt`, which
returns 404. By RFC 9309 the file is "unavailable" and everything on doi.org is allowed.
`fetch` follows the redirect itself, and RFC 9309 allows following robots.txt redirects
to another host. The manual tests of step 4 should confirm that a job still starts.

## 11. Open questions

- **Blocked page.** Keep Firefox's page for a cancelled request, or redirect the tab to
  an extension page that names the blocking robots.txt rule? The latter needs a
  `web_accessible_resources` entry.
- **Frames.** Some publishers show a PDF inside an `<iframe>` or `<embed>`. The
  extension does not follow those today; if it ever does, `sub_frame` and `object`
  requests need the same check.
- **A product token.** If the extension later gets its own user-agent name, the parser
  must prefer a group naming it over the `*` group (RFC 9309). Out of scope now
  (decision 2).
- **Politeness.** `Crawl-delay` and a waiting period between requests to the same site
  (the "be gentle" item in `doi-downloader`'s `CLAUDE.md`) are a separate follow-up.
