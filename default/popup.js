const START_BUTTON_ID = "startButtonId";
const START_JOB_MESSAGE_TYPE = "start-job";
const SAVE_LOG_BUTTON_ID = "saveLogId";
const SAVE_LOG_MESSAGE_TYPE = "save-log";
const OPEN_STATUS_TABLE_BUTTON_ID = "openStatusTableId";
const DOI_INPUT_ID = "doiInputId";
const ERROR_COLOR = "red";
const ERROR_MISSING_DOI = "Please enter a DOI.";
const LOG_PREFIX = "[default-extension]";
const STATUS_LINE_ID = "statusLineId";

// called when popup opens, from line 79
function initPopup() {
  document.getElementById(START_BUTTON_ID).addEventListener("click", startJobFromPopup);
  document.getElementById(SAVE_LOG_BUTTON_ID).addEventListener("click", saveLogFile);
  document.getElementById(OPEN_STATUS_TABLE_BUTTON_ID).addEventListener("click", openStatusTable);
}

async function startJobFromPopup() {
  const doi = readDoiInput();
  if (doi) {
    await requestJobStart(doi);
  } else {
    showError(ERROR_MISSING_DOI);
  }
}

function readDoiInput() {
  return document.getElementById(DOI_INPUT_ID).value.trim();
}

async function requestJobStart(doi) {
  try {
    await browser.runtime.sendMessage({ type: START_JOB_MESSAGE_TYPE, doi, caller: "requestJobStart" });
    closePopup();
  } catch (error) {
    showError(`Error starting job: ${error.message}`);
  }
}

function closePopup() {
  window.close();
}

function showError(errorText) {
  const statusLineElement = document.getElementById(STATUS_LINE_ID);
  statusLineElement.textContent = errorText;
  statusLineElement.style.color = ERROR_COLOR;
  console.error(`${LOG_PREFIX} ${errorText}`);
}

async function saveLogFile() {
  try {
    await browser.runtime.sendMessage({ type: SAVE_LOG_MESSAGE_TYPE });
  } catch (error) {
    showError(`Could not save logfile: ${error.message}`);
  }
}

async function openStatusTable() {
  try {
    await openOrFocusStatusTab(); // defined in src/status-view.js
    closePopup();
  } catch (error) {
    showError(`Error opening status table: ${error.message}`);
  }
}

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    initPopup, openStatusTable, saveLogFile, startJobFromPopup,
    START_BUTTON_ID, START_JOB_MESSAGE_TYPE, SAVE_LOG_BUTTON_ID, SAVE_LOG_MESSAGE_TYPE,
    OPEN_STATUS_TABLE_BUTTON_ID, DOI_INPUT_ID, ERROR_COLOR, ERROR_MISSING_DOI, LOG_PREFIX, STATUS_LINE_ID,
  };
}
/* istanbul ignore next */
if (typeof document !== "undefined" && document.getElementById(START_BUTTON_ID)) {
  initPopup();
}
