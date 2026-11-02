const DOI = "10.1000/example";
const PAGE_NBR_1 = 1;
const PAGE_NBR_2 = 2;
const PAGE_URL = "http://example.com";
const PUBLISHER_URL = "http://publisher.example";
const PDF_URL = "http://example.com/a.pdf";
const FILENAME = "10.1000_example.pdf";
const UNSAFE_DOI = "<script>doi</script>";
const UNSAFE_URL = "http://a?x=1&y=2";

let progress;

beforeEach(() => {
  jest.resetModules();
  progress = require("../src/progress-table");
});

const {
  STATUS_SUCCESS,
  STATUS_NOT_FOUND,
  STATUS_ACCESS_ERROR,
  STATUS_SKIPPED,
  STATUS_PENDING,
  STAGE_PUBLISHER_PAGE,
  STAGE_PDF_LINK,
  STAGE_PDF_CAPTURE,
  STAGE_PDF_DOWNLOAD,
} = require("../src/progress-table");

function countBodyRows() {
  return progress.renderProgressTableHtml().match(/<tr>/g).length - 1;
}

describe("recordStage", () => {
  test("reuses the row for the same doi and page counter", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_LINK, STATUS_SUCCESS, PDF_URL);
    expect(countBodyRows()).toBe(PAGE_NBR_1);
  });

  test("gives different pages of the same doi separate rows", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://example.com/1");
    progress.recordStage(DOI, PAGE_NBR_2, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://example.com/2");
    expect(countBodyRows()).toBe(PAGE_NBR_2);
  });

  test("gives the same page counter of different dois separate rows", () => {
    progress.recordStage("10.1/a", PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://a");
    progress.recordStage("10.1/b", PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://b");
    expect(countBodyRows()).toBe(2);
  });

  test("sets the status and result of the publisher page stage", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    const row = progress.findOrCreateRow(DOI, PAGE_NBR_1);
    expect(row.stageStatuses[STAGE_PUBLISHER_PAGE]).toBe(STATUS_SUCCESS);
    expect(row.stageResults[STAGE_PUBLISHER_PAGE]).toBe(PAGE_URL);
  });

  test("sets the status and result of the pdf link stage", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_LINK, STATUS_SUCCESS, PDF_URL);
    const row = progress.findOrCreateRow(DOI, PAGE_NBR_1);
    expect(row.stageStatuses[STAGE_PDF_LINK]).toBe(STATUS_SUCCESS);
    expect(row.stageResults[STAGE_PDF_LINK]).toBe(PDF_URL);
  });

  test("sets the status and result of the pdf capture stage", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_CAPTURE, `${STATUS_ACCESS_ERROR}: paywall`, PDF_URL);
    const row = progress.findOrCreateRow(DOI, PAGE_NBR_1);
    expect(row.stageStatuses[STAGE_PDF_CAPTURE]).toBe(`${STATUS_ACCESS_ERROR}: paywall`);
    expect(row.stageResults[STAGE_PDF_CAPTURE]).toBe(PDF_URL);
  });

  test("sets the status and result of the pdf download stage", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_DOWNLOAD, STATUS_SUCCESS, FILENAME);
    const row = progress.findOrCreateRow(DOI, PAGE_NBR_1);
    expect(row.stageStatuses[STAGE_PDF_DOWNLOAD]).toBe(STATUS_SUCCESS);
    expect(row.stageResults[STAGE_PDF_DOWNLOAD]).toBe(FILENAME);
  });

  test("a later call for the same stage overwrites the row's cells", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SKIPPED, "http://doi.org/" + DOI);
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PUBLISHER_URL);
    const row = progress.findOrCreateRow(DOI, PAGE_NBR_1);
    expect(row.stageStatuses[STAGE_PUBLISHER_PAGE]).toBe(STATUS_SUCCESS);
    expect(row.stageResults[STAGE_PUBLISHER_PAGE]).toBe(PUBLISHER_URL);
  });

  test("throws an error for an unknown stage", () => {
    expect(() => progress.recordStage(DOI, PAGE_NBR_1, "unknownStage", STATUS_SUCCESS, PAGE_URL)).toThrow("Unknown progress stage: unknownStage");
  });
});

describe("renderProgressTableHtml", () => {
  test("renders a table with a header row and no data rows when empty", () => {
    const html = progress.renderProgressTableHtml();
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody></tbody>");
    expect(html).toContain(
      "<thead><tr><th>DOI</th><th>page #</th><th>publisher page</th><th>pdf link</th>" +
      "<th>pdf capture</th><th>pdf download</th></tr></thead>");
  });

  test("renders one row per recorded (doi, page) pair", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://example.com/1");
    progress.recordStage(DOI, PAGE_NBR_2, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, "http://example.com/2");
    const html = progress.renderProgressTableHtml();
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });

  test("includes the recorded doi, page number, and result values", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(DOI);
    expect(html).toContain(`>${PAGE_NBR_1}<`);
    expect(html).toContain(PAGE_URL);
  });

  test("escapes doi, result, and status values", () => {
    progress.recordStage(UNSAFE_DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, UNSAFE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).not.toContain(UNSAFE_DOI);
    expect(html).toContain("&lt;script&gt;doi&lt;/script&gt;");
    expect(html).toContain("http://a?x=1&amp;y=2");
  });

  test("shows a stage's status before its result, separated by a colon", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(`<div class="stage-summary">${STATUS_SUCCESS}: ${PAGE_URL}</div>`);
  });

  test("puts a stage's whole text in a tooltip, for text cut off in the table", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, UNSAFE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(`<td class="status-success" title="${STATUS_SUCCESS}: http://a?x=1&amp;y=2">`);
  });

  test("shows a status's explanation between brackets", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, `${STATUS_ACCESS_ERROR}: page did not load`, PAGE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(`<div class="stage-summary">${STATUS_ACCESS_ERROR} (page did not load): ${PAGE_URL}</div>`);
  });

  test("shows only the status when a stage has no result", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_LINK, STATUS_NOT_FOUND, null);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(`<div class="stage-summary">${STATUS_NOT_FOUND}</div>`);
  });

  test("does not color a stage without a known status", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_DOWNLOAD, null, FILENAME);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(`<td title="${FILENAME}"><div class="stage-summary">${FILENAME}</div></td>`);
  });

  test("leaves unset cells (e.g. download) blank and uncolored", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).not.toContain("status-failed");
    expect(html).not.toContain("status-skipped");
    expect(html).toContain("<td></td><td></td><td></td></tr>");
  });

  test("colors a STATUS_SUCCESS status and its result cell status-success", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SUCCESS, PAGE_URL);
    const html = progress.renderProgressTableHtml();
    expect(html.match(/class="status-success"/g).length).toBe(1);
  });

  test("colors NOT_FOUND and ACCESS_ERROR (with a reason suffix) as status-failed", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_LINK, STATUS_NOT_FOUND, null);
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PDF_CAPTURE, `${STATUS_ACCESS_ERROR}: blocked by robots.txt`, PDF_URL);
    const html = progress.renderProgressTableHtml();
    expect(html).toContain(STATUS_NOT_FOUND);
    expect(html).toContain(`${STATUS_ACCESS_ERROR} (blocked by robots.txt): ${PDF_URL}`);
    expect(html.match(/class="status-failed"/g).length).toBe(2);
  });

  test("colors SKIPPED status-skipped", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, STATUS_SKIPPED, "http://doi.org/" + DOI);
    const html = progress.renderProgressTableHtml();
    expect(html.match(/class="status-skipped"/g).length).toBe(1);
  });

  test("colors PENDING (with a reason suffix) status-pending", () => {
    progress.recordStage(DOI, PAGE_NBR_1, STAGE_PUBLISHER_PAGE, `${STATUS_PENDING}: waiting for the page to load`, "http://doi.org/" + DOI);
    const html = progress.renderProgressTableHtml();
    expect(html.match(/class="status-pending"/g).length).toBe(1);
    expect(html).not.toContain("status-skipped");
  });
});
