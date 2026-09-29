// Collects per-(doi, page) download progress and renders it as an HTML table.
//
// Row grain differs from the doi_downloader Python version: this extension has a
// single strategy (no competing plugins), but a job can visit several pages in
// sequence, so a row is one per page visited within a job, keyed by
// `${doi}#${pageCounter}`. Each record* call overwrites that row's own pair of
// cells, which also lets startJob's placeholder page-load row (see the plan,
// section 3) be overwritten in place once the real outcome is known.

const STATUS_SUCCESS = "SUCCESS";
const STATUS_NOT_FOUND = "NOT_FOUND";
const STATUS_ACCESS_ERROR = "ACCESS_ERROR";
const STATUS_SKIPPED = "SKIPPED";
// Not in the doi_downloader vocabulary: a stage that has started but has no outcome yet,
// such as startJob's placeholder row while the DOI page loads.
const STATUS_PENDING = "PENDING";

const COLUMNS = [
  "DOI", "page #",
  "publisher page status", "publisher page result (URL)",
  "pdf link status", "pdf link result (URL)",
  "pdf capture status", "pdf capture result (target)",
  "pdf download status", "pdf download result (file)",
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusClass(status) {
  if (!status) { return null; }
  if (status.startsWith(STATUS_SUCCESS)) { return "status-success"; }
  if (status.startsWith(STATUS_NOT_FOUND) || status.startsWith(STATUS_ACCESS_ERROR)) { return "status-failed"; }
  if (status.startsWith(STATUS_SKIPPED)) { return "status-skipped"; }
  if (status.startsWith(STATUS_PENDING)) { return "status-pending"; }
  return null;
}

function cell(value) {
  return `<td>${value ? escapeHtml(value) : ""}</td>`;
}

function statusCell(status) {
  const css = statusClass(status);
  const cssAttr = css ? ` class="${css}"` : "";
  return `<td${cssAttr}>${status ? escapeHtml(status) : ""}</td>`;
}

// Shown in place of a query string cut off from an address.
const SHORTENED_QUERY_MARK = "?…";

// An address as shown in the table: without its query string, which can make addresses
// thousands of characters long (such as the signed PDF addresses of ScienceDirect).
function shortenedAddress(address) {
  const queryStart = address.indexOf("?");
  return queryStart === -1 ? address : address.slice(0, queryStart) + SHORTENED_QUERY_MARK;
}

// Web addresses become links that open in a new tab, so the status tab stays in place;
// noopener keeps the opened page from reaching back into the status tab. The link and
// its tooltip keep the complete address. Only http and https addresses are linked, so
// no other kind of address (such as javascript:) can run.
function linkOrText(resultValue) {
  const escapedValue = escapeHtml(resultValue);
  if (!/^https?:\/\//i.test(resultValue)) return escapedValue;
  return `<a href="${escapedValue}" title="${escapedValue}" target="_blank" rel="noopener noreferrer">` +
    `${escapeHtml(shortenedAddress(resultValue))}</a>`;
}

function resultCell(value, status) {
  const css = statusClass(status);
  const cssAttr = css ? ` class="${css}"` : "";
  return `<td${cssAttr}>${value ? linkOrText(value) : ""}</td>`;
}

class ProgressRecorder {
  constructor() {
    this._rows = new Map();
  }

  _row(doi, pageCounter) {
    const key = `${doi}#${pageCounter}`;
    if (!this._rows.has(key)) {
      this._rows.set(key, {
        doi, pageCounter,
        pageStatus: null, pageResult: null,
        linkStatus: null, linkResult: null,
        captureStatus: null, captureResult: null,
        downloadStatus: null, downloadResult: null,
      });
    }
    return this._rows.get(key);
  }

  recordPublisherPageAccess(doi, pageCounter, status, url) {
    const row = this._row(doi, pageCounter);
    row.pageStatus = status;
    row.pageResult = url;
  }

  recordPdfLinkFound(doi, pageCounter, status, resultUrl) {
    const row = this._row(doi, pageCounter);
    row.linkStatus = status;
    row.linkResult = resultUrl;
  }

  recordPdfCapture(doi, pageCounter, status, targetUrl) {
    const row = this._row(doi, pageCounter);
    row.captureStatus = status;
    row.captureResult = targetUrl;
  }

  recordPdfDownload(doi, pageCounter, status, filename) {
    const row = this._row(doi, pageCounter);
    row.downloadStatus = status;
    row.downloadResult = filename;
  }

  // A copy of the row (doi, pageCounter) as recorded so far, or null if there is none.
  recordedRow(doi, pageCounter) {
    const row = this._rows.get(`${doi}#${pageCounter}`);
    return row ? { ...row } : null;
  }

  _rowHtml(row) {
    const cells = [
      cell(row.doi),
      cell(String(row.pageCounter)),
      statusCell(row.pageStatus), resultCell(row.pageResult, row.pageStatus),
      statusCell(row.linkStatus), resultCell(row.linkResult, row.linkStatus),
      statusCell(row.captureStatus), resultCell(row.captureResult, row.captureStatus),
      statusCell(row.downloadStatus), resultCell(row.downloadResult, row.downloadStatus),
    ].join("");
    // The status tab reads a clicked row's DOI and page number from these attributes.
    const rowAttributes = `data-doi="${escapeHtml(row.doi)}" data-page-counter="${escapeHtml(String(row.pageCounter))}"`;
    return `<tr ${rowAttributes}>${cells}</tr>`;
  }

  toHtml() {
    const header = COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const rows = [...this._rows.values()].map((row) => this._rowHtml(row)).join("");
    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }
}

let _recorder = null;

function getRecorder() {
  if (_recorder === null) {
    _recorder = new ProgressRecorder();
  }
  return _recorder;
}

function recordPublisherPageAccess(doi, pageCounter, status, url) {
  getRecorder().recordPublisherPageAccess(doi, pageCounter, status, url);
}

function recordPdfLinkFound(doi, pageCounter, status, resultUrl) {
  getRecorder().recordPdfLinkFound(doi, pageCounter, status, resultUrl);
}

function recordPdfCapture(doi, pageCounter, status, targetUrl) {
  getRecorder().recordPdfCapture(doi, pageCounter, status, targetUrl);
}

function recordPdfDownload(doi, pageCounter, status, filename) {
  getRecorder().recordPdfDownload(doi, pageCounter, status, filename);
}

function recordedRow(doi, pageCounter) {
  return getRecorder().recordedRow(doi, pageCounter);
}

function toHtml() {
  return getRecorder().toHtml();
}

const exported = {
  STATUS_SUCCESS,
  STATUS_NOT_FOUND,
  STATUS_ACCESS_ERROR,
  STATUS_SKIPPED,
  STATUS_PENDING,
  ProgressRecorder,
  getRecorder,
  recordPublisherPageAccess,
  recordPdfLinkFound,
  recordPdfCapture,
  recordPdfDownload,
  recordedRow,
  toHtml,
};

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = exported;
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
