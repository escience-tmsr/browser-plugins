// Show the DOI download progress as an HTML table on one row per DOI and page visited

const STATUS_SUCCESS = "SUCCESS";
const STATUS_NOT_FOUND = "NOT_FOUND";
const STATUS_ACCESS_ERROR = "ACCESS_ERROR";
const STATUS_SKIPPED = "SKIPPED";
const STATUS_PENDING = "PENDING";

const STATUS_CSS_CLASSES = {
  [STATUS_SUCCESS]: "status-success",
  [STATUS_NOT_FOUND]: "status-failed",
  [STATUS_ACCESS_ERROR]: "status-failed",
  [STATUS_SKIPPED]: "status-skipped",
  [STATUS_PENDING]: "status-pending",
};
const STATUS_WORD_PATTERN = /^[A-Z_]+/;

const STAGE_PUBLISHER_PAGE = "publisherPage";
const STAGE_PDF_LINK = "pdfLink";
const STAGE_PDF_CAPTURE = "pdfCapture";
const STAGE_PDF_DOWNLOAD = "pdfDownload";

const STAGE_COLUMN_NAMES = {
  [STAGE_PUBLISHER_PAGE]: "publisher page",
  [STAGE_PDF_LINK]: "pdf link",
  [STAGE_PDF_CAPTURE]: "pdf capture",
  [STAGE_PDF_DOWNLOAD]: "pdf download",
};
const STAGE_NAMES = Object.keys(STAGE_COLUMN_NAMES);

const COLUMN_NAMES = ["DOI", "page #", ...Object.values(STAGE_COLUMN_NAMES)];
const STATUS_RESULT_SEPARATOR = ": ";
const STATUS_WITH_EXPLANATION_PATTERN = /^([A-Z_]+): (.+)$/s;
const STAGE_SUMMARY_CLASS = "stage-summary";

const progressTableRows = new Map();

function recordStage(doi, pageCounter, stageName, stageStatus, stageResult) {
  if (STAGE_NAMES.includes(stageName)) {
    const row = findOrCreateRow(doi, pageCounter);
    row.stageStatuses[stageName] = stageStatus;
    row.stageResults[stageName] = stageResult;
  } else {
    throw new Error(`Unknown progress stage: ${stageName}`);
  }
}

function renderProgressTableHtml() {
  const headerCells = COLUMN_NAMES.map((columnName) => `<th>${escapeHtml(columnName)}</th>`).join("");
  const bodyRows = [...progressTableRows.values()].map((row) => renderRowHtml(row)).join("");
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function findOrCreateRow(doi, pageCounter) {
  const rowKey = createRowKey(doi, pageCounter);
  if (!progressTableRows.has(rowKey)) {
    progressTableRows.set(rowKey, createEmptyRow(doi, pageCounter));
  }
  return progressTableRows.get(rowKey);
}

function createRowKey(doi, pageCounter) {
  return `${doi}#${pageCounter}`;
}

function createEmptyRow(doi, pageCounter) {
  return { doi, pageCounter, stageStatuses: createEmptyStageValues(), stageResults: createEmptyStageValues() };
}

function createEmptyStageValues() {
  return Object.fromEntries(STAGE_NAMES.map((stageName) => [stageName, null]));
}

function renderRowHtml(row) {
  const stageCells = STAGE_NAMES.map((stageName) => renderStageCell(row.stageStatuses[stageName], row.stageResults[stageName]));
  const rowCells = [renderCell(row.doi), renderCell(String(row.pageCounter)), ...stageCells].join("");
  return `<tr>${rowCells}</tr>`;
}

function renderCell(cellText) {
  return `<td>${escapeHtml(cellText)}</td>`;
}

function renderStageCell(stageStatus, stageResult) {
  const stageText = combineStatusAndResult(stageStatus, stageResult);
  if (stageText) {
    return renderFilledStageCell(stageText, stageStatus);
  } else {
    return "<td></td>";
  }
}

function combineStatusAndResult(stageStatus, stageResult) {
  const statusText = putExplanationInBrackets(stageStatus) ?? "";
  const separator = chooseSeparator(statusText, stageResult);
  return `${statusText}${separator}${stageResult ?? ""}`;
}

function chooseSeparator(statusText, stageResult) {
  return statusText && stageResult ? STATUS_RESULT_SEPARATOR : "";
}

function putExplanationInBrackets(stageStatus) {
  return stageStatus?.replace(STATUS_WITH_EXPLANATION_PATTERN, "$1 ($2)");
}

function renderFilledStageCell(stageText, stageStatus) {
  const classAttribute = renderClassAttribute(chooseStatusClass(stageStatus));
  const escapedText = escapeHtml(stageText);
  return `<td${classAttribute} title="${escapedText}"><div class="${STAGE_SUMMARY_CLASS}">${escapedText}</div></td>`;
}

function chooseStatusClass(stageStatus) {
  const statusWord = stageStatus?.match(STATUS_WORD_PATTERN)?.[0];
  return STATUS_CSS_CLASSES[statusWord] ?? null;
}

function renderClassAttribute(cssClass) {
  return cssClass ? ` class="${cssClass}"` : "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const exported = {
  STATUS_SUCCESS,
  STATUS_NOT_FOUND,
  STATUS_ACCESS_ERROR,
  STATUS_SKIPPED,
  STATUS_PENDING,
  STAGE_PUBLISHER_PAGE,
  STAGE_PDF_LINK,
  STAGE_PDF_CAPTURE,
  STAGE_PDF_DOWNLOAD,
  recordStage,
  renderProgressTableHtml,
};

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = { ...exported, findOrCreateRow };
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
