# Default browser extension

This browser extension reads a DOI and tries to download the PDF of the paper associated with the DOI. The advantage of using the extension is that paper PDFs can be retrieved semi-automatically when the browser user has gained access rights to the papers via another tab in the browser. The word *default* in the title refers to the extension not being developed with a specific target website in mind. PDFs of papers will be stored in the user's `Downloads` directory. 

## Usage

The browser extension was developed for and tested in the [Firefox](https://www.firefox.com) browser. Before being able to process a DOI, the extension needs to be installed in the browser:

1. Download or clone this repository: `git clone https://github.com/escience-tmsr/doi-downloader.git`
2. Open [about:debugging](about:debugging) in the address bar of Firefox
3. Click on `This Firefox` in the left menu
4. Click on the button `Load Temporary Add-on`
5. Open the extension's file `manifest.json`, it should be available from your computer disk together with the other files from this directory, file path: doi-downloader/browser_plugins/default/manifest.json

The properties of the extension should be shown now, including the status message "Running". If the status message is "Stopped", additional steps might be necessary:

6. Open [about:addons](about.addons) in the address bar of Firefox
7. Click on the extension name (Default extension)
8. Next click on "Allow" next to "Run in Private Windows".

After these steps, the extension can be used for accessing paper PDFs via their DOIs:

1. Access the extension by clicking on the jigsaw puzzle piece logo in the top right of the browser window: ![](../images/puzzle_piece.png "")
2. A popup window appears, open the extension by clicking on its name: `Default extension`
3. Fill in a DOI under `DOI` and click the `Process DOI` button. Here is an example DOI from the open access journal [JAIR](https://jair.org): 10.1613/jair.49
4. There is an option to save a list of successful downloads of a session by clicking the `Save log` button in the extension, left of the `Process DOI` button. The list will be saved in the file `my_table.csv` in the user's Downloads directory.

The extension will open the main web page associated with DOI, look for a button labeled PDF or Download on the page and try to download the PDF linked from the page. If successful, the PDF will be stored in the `Downloads` directory of the browser user with the DOI as name (slashes replaced by underscores). The extension displays its progress at the bottom of its popup window. However, if the browser has already downloaded the PDF, this version will be used with whatever name it has. When downloading fails, an error message will be displayed. 

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

## Links

* Icon source: [Google icons](https://fonts.google.com/icons)
