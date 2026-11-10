const START_JOB_MESSAGE_TYPE = "start-job";
const SAVE_LOG_MESSAGE_TYPE = "save-log";
const DOI_INPUT_ID = "doiInputId";
const START_BUTTON_ID = "startButtonId";
const OPEN_STATUS_TABLE_BUTTON_ID = "openStatusTableId";
const SAVE_LOG_BUTTON_ID = "saveLogId";
const STATUS_LINE_ID = "statusLineId";
const ERROR_COLOR = "red";
const LOG_PREFIX = "[default-extension]";

function initPopup() {
  document.getElementById(START_BUTTON_ID).addEventListener("click", startJobFromPopup);
  document.getElementById(OPEN_STATUS_TABLE_BUTTON_ID).addEventListener("click", openStatusTable);
  document.getElementById(SAVE_LOG_BUTTON_ID).addEventListener("click", saveLogFile);
}

async function startJobFromPopup() {
  const doi = readDoiInput();
  if (doi) {
    await requestJobStart(doi);
  } else {
    showError("Please enter a DOI.");
  }
}

async function openStatusTable() {
  try {
    await openOrFocusStatusTab();
    closePopup();
  } catch (error) {
    showError(`Error opening status table: ${error.message}`);
  }
}

async function saveLogFile() {
  try {
    await browser.runtime.sendMessage({ type: SAVE_LOG_MESSAGE_TYPE });
  } catch (error) {
    showError(`Could not save log: ${error.message}`);
  }
}

function readDoiInput() {
  return document.getElementById(DOI_INPUT_ID).value.trim();
}

async function requestJobStart(doi) {
  try {
    await browser.runtime.sendMessage({ type: START_JOB_MESSAGE_TYPE, doi });
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

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = {
    initPopup, startJobFromPopup, openStatusTable, saveLogFile,
    START_JOB_MESSAGE_TYPE, SAVE_LOG_MESSAGE_TYPE, ERROR_COLOR, LOG_PREFIX,
    DOI_INPUT_ID, START_BUTTON_ID, OPEN_STATUS_TABLE_BUTTON_ID, SAVE_LOG_BUTTON_ID, STATUS_LINE_ID,
  };
}
/* istanbul ignore next */
if (typeof document !== "undefined" && document.getElementById(START_BUTTON_ID)) {
  initPopup();
}
