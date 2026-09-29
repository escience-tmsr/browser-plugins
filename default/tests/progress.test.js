const DOI = "10.1000/example";
const PAGE_URL = "http://example.com";
const PUBLISHER_URL = "http://publisher.example";
const PDF_URL = "http://example.com/a.pdf";
const FILENAME = "10.1000_example.pdf";
const UNSAFE_DOI = "<script>doi</script>";
const UNSAFE_URL = "http://a?x=1&y=2";

let progress;

beforeEach(() => {
  jest.resetModules();
  progress = require("../src/progress");
});

const {
  STATUS_SUCCESS: SUCCESS,
  STATUS_NOT_FOUND: NOT_FOUND,
  STATUS_ACCESS_ERROR: ACCESS_ERROR,
  STATUS_SKIPPED: SKIPPED,
  STATUS_PENDING: PENDING,
} = require("../src/progress");

describe("getRecorder", () => {
  test("returns a singleton", () => {
    const first = progress.getRecorder();
    const second = progress.getRecorder();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(progress.ProgressRecorder);
  });
});

describe("ProgressRecorder._row", () => {
  test("reuses the row for the same doi and page counter", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    recorder.recordPdfLinkFound(DOI, 1, SUCCESS, PDF_URL);
    expect(recorder._rows.size).toBe(1);
  });

  test("gives different pages of the same doi separate rows", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com/1");
    recorder.recordPublisherPageAccess(DOI, 2, SUCCESS, "http://example.com/2");
    expect(recorder._rows.size).toBe(2);
  });

  test("gives the same page counter of different dois separate rows", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess("10.1/a", 1, SUCCESS, "http://a");
    recorder.recordPublisherPageAccess("10.1/b", 1, SUCCESS, "http://b");
    expect(recorder._rows.size).toBe(2);
  });
});

describe("record* methods", () => {
  test("recordPublisherPageAccess sets page status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const row = recorder._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
    expect(row.pageResult).toBe(PAGE_URL);
  });

  test("recordPdfLinkFound sets link status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfLinkFound(DOI, 1, SUCCESS, PDF_URL);
    const row = recorder._row(DOI, 1);
    expect(row.linkStatus).toBe(SUCCESS);
    expect(row.linkResult).toBe(PDF_URL);
  });

  test("recordPdfCapture sets capture status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfCapture(DOI, 1, `${ACCESS_ERROR}: paywall`, PDF_URL);
    const row = recorder._row(DOI, 1);
    expect(row.captureStatus).toBe(`${ACCESS_ERROR}: paywall`);
    expect(row.captureResult).toBe(PDF_URL);
  });

  test("recordPdfDownload sets download status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfDownload(DOI, 1, SUCCESS, FILENAME);
    const row = recorder._row(DOI, 1);
    expect(row.downloadStatus).toBe(SUCCESS);
    expect(row.downloadResult).toBe(FILENAME);
  });

  test("a later call to the same record function overwrites the row's cells", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SKIPPED, "http://doi.org/" + DOI);
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PUBLISHER_URL);
    const row = recorder._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
    expect(row.pageResult).toBe(PUBLISHER_URL);
  });
});

describe("module-level record* free functions route to the singleton recorder", () => {
  test("recordPublisherPageAccess", () => {
    progress.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
  });

  test("recordPdfLinkFound", () => {
    progress.recordPdfLinkFound(DOI, 1, NOT_FOUND, "");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.linkStatus).toBe(NOT_FOUND);
  });

  test("recordPdfCapture", () => {
    progress.recordPdfCapture(DOI, 1, SUCCESS, PDF_URL);
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.captureStatus).toBe(SUCCESS);
  });

  test("recordPdfDownload", () => {
    progress.recordPdfDownload(DOI, 1, SUCCESS, "a.pdf");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.downloadStatus).toBe(SUCCESS);
  });

  test("toHtml renders the singleton recorder's table", () => {
    progress.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    expect(progress.toHtml()).toBe(progress.getRecorder().toHtml());
  });
});

describe("toHtml", () => {
  test("renders a table with a header row and no data rows when empty", () => {
    const recorder = new progress.ProgressRecorder();
    const html = recorder.toHtml();
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody></tbody>");
    expect(html).toContain("<th>DOI</th>");
    expect(html).toContain("<th>page #</th>");
  });

  test("renders one row per recorded (doi, page) pair", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com/1");
    recorder.recordPublisherPageAccess(DOI, 2, SUCCESS, "http://example.com/2");
    const html = recorder.toHtml();
    expect(html.match(/<tr[ >]/g)).toHaveLength(3); // header + 2 rows
  });

  test("includes the recorded doi, page number, and result values", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const html = recorder.toHtml();
    expect(html).toContain(DOI);
    expect(html).toContain(">1<");
    expect(html).toContain(PAGE_URL);
  });

  test("escapes doi, result, and status values", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(UNSAFE_DOI, 1, SUCCESS, UNSAFE_URL);
    const html = recorder.toHtml();
    expect(html).not.toContain(UNSAFE_DOI);
    expect(html).toContain("&lt;script&gt;doi&lt;/script&gt;");
    expect(html).toContain("http://a?x=1&amp;y=2");
  });

  test("leaves unset cells blank and uncolored", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const html = recorder.toHtml();
    // link/capture/download stages were never recorded for this row
    expect(html).not.toContain("status-failed");
    expect(html).not.toContain("status-skipped");
  });

  test("colors a SUCCESS status and its result cell status-success", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const html = recorder.toHtml();
    expect(html.match(/class="status-success"/g).length).toBe(2); // status cell + result cell
  });

  test("colors NOT_FOUND and ACCESS_ERROR (with a reason suffix) as status-failed", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfLinkFound(DOI, 1, NOT_FOUND, null);
    recorder.recordPdfCapture(DOI, 1, `${ACCESS_ERROR}: blocked by robots.txt`, PDF_URL);
    const html = recorder.toHtml();
    expect(html).toContain(NOT_FOUND);
    expect(html).toContain(`${ACCESS_ERROR}: blocked by robots.txt`);
    expect(html.match(/class="status-failed"/g).length).toBe(4); // link status + link result (blank, colored by status) + capture status + capture result
  });

  test("colors SKIPPED status-skipped", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SKIPPED, "http://doi.org/" + DOI);
    const html = recorder.toHtml();
    expect(html.match(/class="status-skipped"/g).length).toBe(2);
  });

  test("colors PENDING (with a reason suffix) status-pending", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, `${PENDING}: waiting for the page to load`, "http://doi.org/" + DOI);
    const html = recorder.toHtml();
    expect(html.match(/class="status-pending"/g).length).toBe(2);
    expect(html).not.toContain("status-skipped");
  });
});

describe("recordedRow", () => {
  test("returns a copy of a recorded row, or null for a row that was not recorded", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    const recordedCopy = recorder.recordedRow(DOI, 1);
    expect(recordedCopy).toMatchObject({ doi: DOI, pageCounter: 1, pageStatus: SUCCESS, pageResult: PAGE_URL });
    recordedCopy.pageStatus = NOT_FOUND;
    expect(recorder.recordedRow(DOI, 1).pageStatus).toBe(SUCCESS);
    expect(recorder.recordedRow(DOI, 2)).toBeNull();
  });

  test("the free function reads the singleton recorder", () => {
    progress.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    expect(progress.recordedRow(DOI, 1).pageResult).toBe(PAGE_URL);
  });
});

describe("row attributes", () => {
  test("each row carries its DOI and page number, escaped", () => {
    const manualPageLabel = "1 (by hand)";
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(UNSAFE_DOI, 2, SUCCESS, PAGE_URL);
    recorder.recordPublisherPageAccess(DOI, manualPageLabel, SUCCESS, PAGE_URL);
    const table = new DOMParser().parseFromString(recorder.toHtml(), "text/html");
    const rowData = [...table.querySelectorAll("tbody tr")].map((row) => ({ ...row.dataset }));
    expect(rowData).toEqual([
      { doi: UNSAFE_DOI, pageCounter: "2" },
      { doi: DOI, pageCounter: manualPageLabel },
    ]);
  });
});

describe("result links", () => {
  const SCRIPT_URL = "javascript:alert(1)";

  // The links in the rendered table, as { href, title, target, rel, text }.
  function renderedLinks(recorder) {
    const table = new DOMParser().parseFromString(recorder.toHtml(), "text/html");
    return [...table.querySelectorAll("a")].map((link) => ({
      href: link.getAttribute("href"),
      title: link.getAttribute("title"),
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
      text: link.textContent,
    }));
  }

  test("links the page, pdf link and capture addresses, opening in a new tab", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, PAGE_URL);
    recorder.recordPdfLinkFound(DOI, 1, SUCCESS, PDF_URL);
    recorder.recordPdfCapture(DOI, 1, `${ACCESS_ERROR}: blocked by robots.txt`, PUBLISHER_URL);
    const newTabLink = { target: "_blank", rel: "noopener noreferrer" };
    expect(renderedLinks(recorder)).toEqual([
      { href: PAGE_URL, title: PAGE_URL, text: PAGE_URL, ...newTabLink },
      { href: PDF_URL, title: PDF_URL, text: PDF_URL, ...newTabLink },
      { href: PUBLISHER_URL, title: PUBLISHER_URL, text: PUBLISHER_URL, ...newTabLink },
    ]);
  });

  test("keeps an address with special characters intact in the link and its tooltip", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, UNSAFE_URL);
    expect(renderedLinks(recorder)).toEqual([expect.objectContaining({ href: UNSAFE_URL, title: UNSAFE_URL })]);
  });

  test("shows an address without its query string, but links to the complete address", () => {
    const addressPath = "https://pdf.example.org/1/main.pdf";
    const signedAddress = `${addressPath}?X-Amz-Expires=300&X-Amz-Signature=${"0".repeat(64)}`;
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfCapture(DOI, 1, SUCCESS, signedAddress);
    expect(renderedLinks(recorder)).toEqual([
      expect.objectContaining({ href: signedAddress, title: signedAddress, text: `${addressPath}?…` }),
    ]);
  });

  test("does not link a file name, or an address that is not http or https", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfDownload(DOI, 1, SUCCESS, FILENAME);
    recorder.recordPdfCapture(DOI, 1, SUCCESS, SCRIPT_URL);
    expect(renderedLinks(recorder)).toEqual([]);
    expect(recorder.toHtml()).toContain(FILENAME);
    expect(recorder.toHtml()).toContain(SCRIPT_URL);
  });
});
