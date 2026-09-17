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

const COLUMNS = [
  "DOI", "page #",
  "page status", "page result (URL)",
  "link status", "link result",
  "capture status", "capture result (target)",
  "download status", "download result (file)",
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

function resultCell(value, status) {
  const css = statusClass(status);
  const cssAttr = css ? ` class="${css}"` : "";
  return `<td${cssAttr}>${value ? escapeHtml(value) : ""}</td>`;
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

  recordPdfLinkFound(doi, pageCounter, status, result) {
    const row = this._row(doi, pageCounter);
    row.linkStatus = status;
    row.linkResult = result;
  }

  recordPdfAccess(doi, pageCounter, status, targetUrl) {
    const row = this._row(doi, pageCounter);
    row.captureStatus = status;
    row.captureResult = targetUrl;
  }

  recordPdfDownload(doi, pageCounter, status, filename) {
    const row = this._row(doi, pageCounter);
    row.downloadStatus = status;
    row.downloadResult = filename;
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
    return `<tr>${cells}</tr>`;
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

function recordPdfLinkFound(doi, pageCounter, status, result) {
  getRecorder().recordPdfLinkFound(doi, pageCounter, status, result);
}

function recordPdfAccess(doi, pageCounter, status, targetUrl) {
  getRecorder().recordPdfAccess(doi, pageCounter, status, targetUrl);
}

function recordPdfDownload(doi, pageCounter, status, filename) {
  getRecorder().recordPdfDownload(doi, pageCounter, status, filename);
}

function toHtml() {
  return getRecorder().toHtml();
}

const exported = {
  STATUS_SUCCESS,
  STATUS_NOT_FOUND,
  STATUS_ACCESS_ERROR,
  STATUS_SKIPPED,
  ProgressRecorder,
  getRecorder,
  recordPublisherPageAccess,
  recordPdfLinkFound,
  recordPdfAccess,
  recordPdfDownload,
  toHtml,
};

/* istanbul ignore next */
if (typeof self === "undefined") {
  module.exports = exported;
} else {
  module.exports = exported;
  Object.assign(self, exported);
}
