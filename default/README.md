# Default browser extension

This browser extension reads a DOI and tries to download the PDF of the paper associated with the DOI. The advantage of using the extension is that paper PDFs can be retrieved semi-automatically when the browser user has gained access rights to the papers via another tab in the browser. The word *default* in the title refers to the extension not being developed with a specific target website in mind. PDFs of papers will be stored in the user's `Downloads` directory. 

## Usage

The browser extension was developed for and tested in the [Firefox](https://www.firefox.com) browser. Before being able to process a DOI, the extension needs to be installed in the browser:

1. Download or clone this repository: `git clone https://github.com/escience-tmsr/browser-plugins.git`
2. Open [about:debugging](about:debugging) in the address bar of Firefox
3. Click on `This Firefox` in the left menu
4. Click on the button `Load Temporary Add-on`
5. Open the extension's file `manifest.json`, it should be available from your computer disk together with the other files from this directory, file path: browser-plugins/default/manifest.json

The properties of the extension should be shown now, including the status message "Running". If the status message is "Stopped", additional steps might be necessary:

6. Open [about:addons](about:addons) in the address bar of Firefox
7. Click on the extension name (Default extension)
8. Next click on "Allow" next to "Run in Private Windows".

After these steps, the extension can be used for accessing paper PDFs via their DOIs:

1. Access the extension by clicking on the jigsaw puzzle piece logo in the top right of the browser window: ![](../images/puzzle_piece.png "")
2. A popup window appears, open the extension by clicking on its name: `Default extension`
3. Fill in a DOI under `DOI` and click the `Process DOI` button, or press Enter. Here is an example DOI from the open access journal [JAIR](https://jair.org): 10.1613/jair.49
4. A list of the processed DOIs and the full paths of their saved PDFs can be saved as a CSV file with the `Download CSV` button in the status tab (see "Status table" below).

The extension will open the main web page associated with DOI, look for a button labeled PDF or Download on the page and try to download the PDF linked from the page. If successful, the PDF will be stored in the `Downloads` directory of the browser user with the DOI as name (slashes replaced by underscores). When downloading fails, an error message will be displayed. 

### Status table

The popup closes as soon as another tab gets the focus, so the extension shows its progress in a separate status tab, named "DOI progress" and marked with the extension's icon. Clicking `Process DOI` opens this tab (or brings it to the front if it is already open), opens the DOI's web page in a background tab, so the status tab stays in view, and closes the popup. The status tab can also be opened without processing a DOI, with the `Open status table` button in the popup.

The status tab contains:

* **A progress table** with one row per web page visited for a DOI. A DOI can take more than one row, for example when its PDF link leads to a viewer page that has its own download link. For each page, the table shows the result of four stages, each with a status and a result:
  * *publisher page*: did the page load (result: its URL)?
  * *pdf link*: was a link or button containing "PDF" or "download" found on the page (result: the link's URL; empty for a button, which has no URL of its own)?
  * *pdf capture*: did following the link or clicking the button give a PDF (result: the URL it came from)?
  * *pdf download*: was the PDF saved (result: the file name)? A download that is cancelled or breaks off is shown as `ACCESS_ERROR` with the reason.

  The status is `SUCCESS` (green), `NOT_FOUND` or `ACCESS_ERROR` (red, followed by the reason), `SKIPPED` (gray, for a link that led to another web page instead of a PDF) or `PENDING` (light blue, still waiting). A new row first appears as `PENDING: waiting for the page to load` while the DOI's page is loading; if the page has not loaded after 30 seconds, it is marked `ACCESS_ERROR: page did not load`. The web addresses in the table are links, which open in a new tab. Addresses are shown without their query string (the part after `?`, shown as `?…`), which can make them thousands of characters long; the link, and its tooltip, keep the complete address.
  The `Download CSV` button next to the heading saves the DOIs of the table and the full paths of their saved PDFs as a CSV file, `doi-progress-<date>.csv`, in the browser's download directory. It has one line per DOI, with an empty path when no PDF was saved; a DOI with more than one different saved PDF (for example one saved by the extension and one by hand) gets a line for each.
* **A log** with the status messages the popup shows, one per line, for as long as the status tab is open.

The table and the log each take up half of the status tab and scroll separately. Each keeps its newest entries at the bottom in view; after scrolling up to read older entries, the view stays put until it is scrolled back to the bottom. The headings show the number of table rows and log lines, a shadow under a heading shows that there are entries above the visible part, and a button such as "▼ 3 new lines" shows that entries arrived below it while scrolled up; clicking it jumps back to the bottom.

The table is kept by the extension's background script, so closing and reopening the status tab shows the table again. It is emptied when the extension is reloaded or Firefox is restarted. (Before, it was also emptied when Firefox unloaded the idle background script after about 30 seconds; the background script now stays loaded.)

### robots.txt

Websites state in their [robots.txt](https://www.rfc-editor.org/rfc/rfc9309) file which of their pages robots may visit. Before the extension loads a web page in the tab it opened for a DOI, it checks the website's robots.txt and follows the rules for all robots (`User-agent: *`). When robots.txt disallows the page, the page is not visited:

* the log shows `🚫 Not visiting <address>: blocked by robots.txt`;
* the progress table shows `ACCESS_ERROR: blocked by robots.txt` with the address. It is shown in the *pdf capture* cells when a link or button led to the page, or when a page went on to it by itself (for example a publisher's page forwarding to another website): the row of that page shows how far the extension got before the block. Otherwise, for example when the DOI's page itself is blocked, it is shown in the *publisher page* cells;
* when the extension itself opened the page (the DOI's page, or a followed link), the processing of the DOI ends there. When a page went on to the blocked page by itself, Firefox stays on that page, and the extension searches it for a PDF link as usual.

When a website's robots.txt cannot be fetched because of a server error (HTTP status 500-599 or 429), a network error or a timeout of 10 seconds, the extension does not visit the website either, with the reason `robots.txt unreachable`. When the website has no robots.txt (HTTP status 400-499 other than 429), all its pages may be visited. The extension remembers each website's robots.txt for 24 hours, or for 10 minutes after a failed attempt. Only the pages the tab loads are checked, not the images and scripts that pages use, and pages in other tabs are not checked.

### Downloading by hand

When the extension cannot get a PDF itself, the table often shows where it can be found, for example a publisher's page that robots.txt kept the extension from visiting. Clicking an address in the table opens it in a new tab, which the extension watches for the rest of the process, together with the tabs opened from it (such as a publisher's "View PDF" tab). The extension does not search, click or load anything in those tabs: every step there is the user's own, so robots.txt does not apply.

As soon as a PDF appears in a watched tab, the table gets a new row for the DOI, numbered after the clicked row, for example `1 (by hand)`, so the extension's own attempt stays visible above it:

* *publisher page*: copied from the clicked row when that page was accessible; otherwise `SUCCESS: opened by hand` with the clicked address;
* *pdf capture*: `SUCCESS: viewed by hand` with the PDF's address, when Firefox shows the PDF;
* *pdf download*: `PENDING: viewed, not downloaded yet` while the PDF is only shown, and `SUCCESS: downloaded by hand` with the file name once it is saved, also logged as `📥 PDF downloaded by hand for <DOI>: <file name>`. A cancelled download is shown as `ACCESS_ERROR` with the reason.

The file keeps the name the website gives it, as Firefox does not let extensions rename downloads they did not start. A PDF saved from Firefox's PDF viewer is recognised by the tab that is in front when saving starts, and only recorded when its name is that of a PDF shown in the watched tab. The extension keeps only the addresses and names of the PDFs in the watched tabs, and forgets a tab when it is closed and all of them when Firefox starts.

### Known limitations

* One DOI is processed at a time. Starting a new DOI while another is still being processed stops the first one.
* When a button (not a link) opens the PDF in a new tab, the extension does not capture it; the capture is reported as failed after 15 seconds.
* When the same DOI is processed twice, the second run overwrites the first run's table cells only where it records something new.
* Firefox may open a saved PDF in a new tab (setting: Settings, Applications, Portable Document Format), which moves the status tab out of view.
* After a DOI has been processed, pages opened in its tab are still checked against robots.txt, until the next DOI is processed.
* Downloading by hand was tested with ScienceDirect only; publishers that show a PDF in their own viewer, or save it themselves, may not be recognised. A PDF saved from Firefox's viewer under another name (in a "Save as" dialog) is not recorded.

## Evaluation

The extension was compared to [Zotero](https://www.zotero.org/) (version 8.0.4) and [UnpaywallPDFDownloader](https://github.com/lixuliu/UnpaywallPDFDownloader) with respect to retrieving a PDF provided a DOI for fourteen DOIs representing papers from different publishers (test date 20260323). Zotero found six PDFs (43%) via the "Find Full Text" menu option while the extension was able to retrieve seven PDFs (50%). The only difference between the two methods involved Zotero being identified as a robot by the target website and successively being refused access to the PDF file. The combination of five plugins of the doi-downloader outperformed the two approaches with nine successful downloads (64%). UnpaywallPDFDownloader only retrieved four PDFs (29%).

The extension was tested again on the same fourteen DOIs on 20260929, now with its [robots.txt check](#robotstxt), with the option to finish a download by hand from the status tab (see [Downloading by hand](#downloading-by-hand)), and with institutional access turned on in the browser. It retrieved ten PDFs (71%): the seven of the first test and three more (the DOIs from Springer, Wiley and ScienceDirect in rows 9 to 11), so it now outperforms the other three approaches. Most downloads that the robots.txt check blocked could be finished by hand, and having institutional access turned on in the browser helped too. The other columns are from the first test: Zotero has not been tested yet with institutional access, which may improve its results too.

| DOI                               | Publisher/Journal       | Zotero | This extension | doi-downloader | Unpaywall |
|-----------------------------------|-------------------------|:------:|:--------------:|:--------------:|:---------:|
| 10.1613/jair.49                   | jair.org                |   +    |       +        |       +        |     +     |
| 10.1038/s41586-025-10047-5        | nature.com              |   +    |       +        |       +        |     -     |
| 10.3390/electronics15040795       | mdpi.com                |   +    |       +        |       -        |     +     |
| 10.3389/fpsyt.2025.1739639        | frontiersin.com         |   +    |       +        |       +        |     +     |
| 10.4236/jhrss.2026.141006         | scirp.com               |   +    |       +        |       +        |     -     |
| 10.3897/aiep.51.63489             | pensoft.com             |   +    |       +        |       +        |     -     |
| 10.1016/j.nlp.2026.100202         | sciencedirectassets.com |   -    |       +        |       -        |     -     |
| 10.1177/0022002714560349          | sagepub.com             |   -    |       -        |       +        |     -     |
| 10.1007/s10198-013-0496-x         | springer.com            |   -    |       +        |       -        |     -     |
| 10.1111/j.1465-7295.2010.00309.x  | wiley.com               |   -    |       +        |       +        |     -     |
| 10.1016/j.econlet.2009.08.024     | sciencedirect.com       |   -    |       +        |       +        |     +     |
| 10.1093/ei/cb1001                 | wiley.com               |   -    |       -        |       +        |     -     |
| 10.2174/2213476X07666200423081738 | bethamscience.com       |   -    |       -        |       -        |     -     |
| 10.1504/EJIM.2025.150039          | inderscience.com        |   -    |       -        |       -        |     -     |
| **Total**                         |                         | **6**  |     **10**     |     **9**      |   **4**   |

## Running the tests

The extension's unit tests use [Jest](https://jestjs.io) and require [Node.js](https://nodejs.org). Run them from this directory (default):

```bash
npm install   # first time only
npm test
```

## Code sequence diagram

| Source                       |     | Target                            | Task              |
|------------------------------|-----|-----------------------------------|-------------------|
| popup                        | ->> | background:  startJob             | Download doi page |
| every page request in the job's tab | ->> | background: checkRobotsBeforeRequest | Check robots.txt |
| doi page                     | ->> | content-script: maybeRunJob       |                   |
| maybeRunJob                  | ->> | content-script: performAction     | Find PDF button   |
| performAction                | ->> | send download_pdf_via_tab_capture |                   |
| download_pdf_via_tab_capture | ->> | background: armCaptureAndNavigate | Load web page     |
| web page                     | ->> | background: onHeadersReceived     | Checks for PDF    |
| web page                     | ->> | content-script: maybeRunJob       |                   |

The progress table is updated along the way:

| Source                       |     | Target                            | Task                          |
|------------------------------|-----|-----------------------------------|-------------------------------|
| background: startJob         | ->> | status tab                        | Open status tab, seed row     |
| content-script: maybeRunJob  | ->> | background: recordContentProgress | Record "Page loaded"            |
| content-script: performAction| ->> | background: recordContentProgress | Record "Link found/not found"   |
| background: onHeadersReceived, armCaptureBase | ->> | background: recordCapture | Record "Captured result" |
| background: downloads.onChanged | ->> | background: recordDownload     | Record "Saved file"             |
| background: checkRobotsBeforeRequest | ->> | background: recordRobotsBlock | Record "Blocked by robots.txt" |
| background: record functions | ->> | status tab                        | Send updated table            |

## Links

* Icon source: [Google icons](https://fonts.google.com/icons)
