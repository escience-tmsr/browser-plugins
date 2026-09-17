const DOI = "10.1000/example";

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
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    recorder.recordPdfLinkFound(DOI, 1, SUCCESS, "<a>pdf</a>");
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
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    const row = recorder._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
    expect(row.pageResult).toBe("http://example.com");
  });

  test("recordPdfLinkFound sets link status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfLinkFound(DOI, 1, SUCCESS, '<a href="a.pdf">');
    const row = recorder._row(DOI, 1);
    expect(row.linkStatus).toBe(SUCCESS);
    expect(row.linkResult).toBe('<a href="a.pdf">');
  });

  test("recordPdfAccess sets capture status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfAccess(DOI, 1, `${ACCESS_ERROR}: paywall`, "http://example.com/a.pdf");
    const row = recorder._row(DOI, 1);
    expect(row.captureStatus).toBe(`${ACCESS_ERROR}: paywall`);
    expect(row.captureResult).toBe("http://example.com/a.pdf");
  });

  test("recordPdfDownload sets download status and result", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfDownload(DOI, 1, SUCCESS, "10.1000_example.pdf");
    const row = recorder._row(DOI, 1);
    expect(row.downloadStatus).toBe(SUCCESS);
    expect(row.downloadResult).toBe("10.1000_example.pdf");
  });

  test("a later call to the same record function overwrites the row's cells", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SKIPPED, "http://doi.org/" + DOI);
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://publisher.example");
    const row = recorder._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
    expect(row.pageResult).toBe("http://publisher.example");
  });
});

describe("module-level record* free functions route to the singleton recorder", () => {
  test("recordPublisherPageAccess", () => {
    progress.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.pageStatus).toBe(SUCCESS);
  });

  test("recordPdfLinkFound", () => {
    progress.recordPdfLinkFound(DOI, 1, NOT_FOUND, "");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.linkStatus).toBe(NOT_FOUND);
  });

  test("recordPdfAccess", () => {
    progress.recordPdfAccess(DOI, 1, SUCCESS, "http://example.com/a.pdf");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.captureStatus).toBe(SUCCESS);
  });

  test("recordPdfDownload", () => {
    progress.recordPdfDownload(DOI, 1, SUCCESS, "a.pdf");
    const row = progress.getRecorder()._row(DOI, 1);
    expect(row.downloadStatus).toBe(SUCCESS);
  });

  test("toHtml renders the singleton recorder's table", () => {
    progress.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
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
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
  });

  test("includes the recorded doi, page number, and result values", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    const html = recorder.toHtml();
    expect(html).toContain(DOI);
    expect(html).toContain(">1<");
    expect(html).toContain("http://example.com");
  });

  test("escapes doi, result, and status values", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess("<script>doi</script>", 1, SUCCESS, "http://a?x=1&y=2");
    const html = recorder.toHtml();
    expect(html).not.toContain("<script>doi</script>");
    expect(html).toContain("&lt;script&gt;doi&lt;/script&gt;");
    expect(html).toContain("http://a?x=1&amp;y=2");
  });

  test("leaves unset cells blank and uncolored", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    const html = recorder.toHtml();
    // link/capture/download stages were never recorded for this row
    expect(html).not.toContain("status-failed");
    expect(html).not.toContain("status-skipped");
  });

  test("colors a SUCCESS status and its result cell status-success", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPublisherPageAccess(DOI, 1, SUCCESS, "http://example.com");
    const html = recorder.toHtml();
    expect(html.match(/class="status-success"/g).length).toBe(2); // status cell + result cell
  });

  test("colors NOT_FOUND and ACCESS_ERROR (with a reason suffix) as status-failed", () => {
    const recorder = new progress.ProgressRecorder();
    recorder.recordPdfLinkFound(DOI, 1, NOT_FOUND, null);
    recorder.recordPdfAccess(DOI, 1, `${ACCESS_ERROR}: blocked by robots.txt`, "http://example.com/a.pdf");
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
});
