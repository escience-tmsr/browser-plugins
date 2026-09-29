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
3. Fill in a DOI under `DOI` and click the `Process DOI` button. Here is an example DOI from the open access journal [JAIR](https://jair.org): 10.1613/jair.49
4. There is an option to save a list of successful downloads of a session by clicking the `Save log` button in the extension, left of the `Process DOI` button. The list will be saved in the file `my_table.csv` in the user's Downloads directory.

The extension will open the main web page associated with DOI, look for a button labeled PDF or Download on the page and try to download the PDF linked from the page. If successful, the PDF will be stored in the `Downloads` directory of the browser user with the DOI as name (slashes replaced by underscores). When downloading fails, an error message will be displayed. 

### Status table

The popup closes as soon as another tab gets the focus, so the extension shows its progress in a separate status tab. Clicking `Process DOI` opens this tab (or brings it to the front if it is already open), opens the DOI's web page in a background tab, so the status tab stays in view, and closes the popup. The status tab can also be opened without processing a DOI, with the `Open status table` button in the popup.

The status tab contains:

* **A progress table** with one row per web page visited for a DOI. A DOI can take more than one row, for example when its PDF link leads to a viewer page that has its own download link. For each page, the table shows the result of four stages, each with a status and a result:
  * *publisher page*: did the page load (result: its URL)?
  * *pdf link*: was a link or button containing "PDF" or "download" found on the page (result: the link's URL; empty for a button, which has no URL of its own)?
  * *pdf capture*: did following the link or clicking the button give a PDF (result: the URL it came from)?
  * *pdf download*: was the PDF saved (result: the file name)? A download that is cancelled or breaks off is shown as `ACCESS_ERROR` with the reason.

  The status is `SUCCESS` (green), `NOT_FOUND` or `ACCESS_ERROR` (red, followed by the reason), `SKIPPED` (gray, for a link that led to another web page instead of a PDF) or `PENDING` (light blue, still waiting). A new row first appears as `PENDING: waiting for the page to load` while the DOI's page is loading; if the page has not loaded after 30 seconds, it is marked `ACCESS_ERROR: page did not load`.
* **A log** with the status messages the popup shows, one per line, for as long as the status tab is open.

The table and the log each take up half of the status tab and scroll separately. Each keeps its newest entries at the bottom in view; after scrolling up to read older entries, the view stays put until it is scrolled back to the bottom. The headings show the number of table rows and log lines, a shadow under a heading shows that there are entries above the visible part, and a button such as "▼ 3 new lines" shows that entries arrived below it while scrolled up; clicking it jumps back to the bottom.

The table is kept by the extension's background script, so closing and reopening the status tab shows the table again. It is emptied when the extension is reloaded, or when Firefox unloads the idle background script.

### Known limitations

* One DOI is processed at a time. Starting a new DOI while another is still being processed stops the first one.
* When a button (not a link) opens the PDF in a new tab, the extension does not capture it; the capture is reported as failed after 15 seconds.
* When the same DOI is processed twice, the second run overwrites the first run's table cells only where it records something new.
* Firefox may open a saved PDF in a new tab (setting: Settings, Applications, Portable Document Format), which moves the status tab out of view.

## Evaluation

The extension was compared to [Zotero](https://www.zotero.org/) (version 8.0.4) and [UnpaywallPDFDownloader](https://github.com/lixuliu/UnpaywallPDFDownloader) with respect to retrieving a PDF provided a DOI for fourteen DOIs representing papers from different publishers (test date 20260323). Zotero found six PDFs (43%) via the "Find Full Text" menu option while the extension was able to retrieve seven PDFs (50%). The only difference between the two methods involved Zotero being identified as a robot by the target website and successively being refused access to the PDF file. The test did not involve logging in to websites so PDFs behind paywalls were inaccessible to both approaches. The combination of five plugins of the doi-downloader outperformed the two approaches with nine successful downloads (64%). UnpaywallPDFDownloader only retrieved four PDFs (29%).

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
| 10.1007/s10198-013-0496-x         | springer.com            |   -    |       -        |       -        |     -     |
| 10.1111/j.1465-7295.2010.00309.x  | wiley.com               |   -    |       -        |       +        |     -     |
| 10.1016/j.econlet.2009.08.024     | sciencedirect.com       |   -    |       -        |       +        |     +     |
| 10.1093/ei/cb1001                 | wiley.com               |   -    |       -        |       +        |     -     |
| 10.2174/2213476X07666200423081738 | bethamscience.com       |   -    |       -        |       -        |     -     |
| 10.1504/EJIM.2025.150039          | inderscience.com        |   -    |       -        |       -        |     -     |

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
| background: record functions | ->> | status tab                        | Send updated table            |

## Links

* Icon source: [Google icons](https://fonts.google.com/icons)
