const {
  initPopup, startJobFromPopup, openStatusTable, saveLogFile,
  START_JOB_MESSAGE_TYPE, SAVE_LOG_MESSAGE_TYPE, ERROR_COLOR, LOG_PREFIX,
  DOI_INPUT_ID, START_BUTTON_ID, OPEN_STATUS_TABLE_BUTTON_ID, SAVE_LOG_BUTTON_ID, STATUS_LINE_ID,
} = require("../popup");

const JOB_DOI = "10.1234/doi";
const POPUP_HTML = `
  <input type="text" id="${DOI_INPUT_ID}">
  <button id="${SAVE_LOG_BUTTON_ID}">Save Log</button>
  <button id="${START_BUTTON_ID}">Process DOI</button>
  <button id="${OPEN_STATUS_TABLE_BUTTON_ID}">Open status table</button>
  <p id="${STATUS_LINE_ID}"></p>`;

function mockPopupEnvironment() {
  document.body.innerHTML = POPUP_HTML;
  global.browser = { runtime: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
  global.openOrFocusStatusTab = jest.fn().mockResolvedValue(undefined);
  jest.spyOn(window, "close").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

function enterDoi(doiText) {
  document.getElementById(DOI_INPUT_ID).value = doiText;
}

function readStatusLine() {
  return document.getElementById(STATUS_LINE_ID);
}

function waitForClickHandlers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockPopupEnvironment();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("startJobFromPopup", () => {
  test("starts a job for the entered doi and closes the popup", async () => {
    enterDoi(`  ${JOB_DOI}  `);
    await startJobFromPopup();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: START_JOB_MESSAGE_TYPE, doi: JOB_DOI });
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  test("shows an error when no doi was entered", async () => {
    enterDoi("   ");
    await startJobFromPopup();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(readStatusLine().textContent).toBe("Please enter a DOI.");
    expect(readStatusLine().style.color).toBe(ERROR_COLOR);
    expect(console.error).toHaveBeenCalledWith(`${LOG_PREFIX} Please enter a DOI.`);
  });

  test("shows an error and stays open when the job cannot be started", async () => {
    enterDoi(JOB_DOI);
    browser.runtime.sendMessage.mockRejectedValue(new Error("no background"));
    await startJobFromPopup();
    expect(readStatusLine().textContent).toBe("Error starting job: no background");
    expect(readStatusLine().style.color).toBe(ERROR_COLOR);
    expect(window.close).not.toHaveBeenCalled();
  });
});

describe("openStatusTable", () => {
  test("opens the status table and closes the popup", async () => {
    await openStatusTable();
    expect(openOrFocusStatusTab).toHaveBeenCalledTimes(1);
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  test("shows an error and stays open when the status table cannot be opened", async () => {
    openOrFocusStatusTab.mockRejectedValue(new Error("no tabs"));
    await openStatusTable();
    expect(readStatusLine().textContent).toBe("Error opening status table: no tabs");
    expect(window.close).not.toHaveBeenCalled();
  });
});

describe("saveLogFile", () => {
  test("asks the background to save the log", async () => {
    await saveLogFile();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: SAVE_LOG_MESSAGE_TYPE });
    expect(readStatusLine().textContent).toBe("");
  });

  test("shows an error when the log cannot be saved", async () => {
    browser.runtime.sendMessage.mockRejectedValue(new Error("no downloads"));
    await saveLogFile();
    expect(readStatusLine().textContent).toBe("Could not save log: no downloads");
    expect(readStatusLine().style.color).toBe(ERROR_COLOR);
  });
});

describe("initPopup", () => {
  test("connects each button to its action", async () => {
    initPopup();
    enterDoi(JOB_DOI);
    document.getElementById(START_BUTTON_ID).click();
    document.getElementById(OPEN_STATUS_TABLE_BUTTON_ID).click();
    document.getElementById(SAVE_LOG_BUTTON_ID).click();
    await waitForClickHandlers();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: START_JOB_MESSAGE_TYPE, doi: JOB_DOI });
    expect(openOrFocusStatusTab).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: SAVE_LOG_MESSAGE_TYPE });
  });
});
