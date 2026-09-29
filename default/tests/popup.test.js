// The popup's elements, as in popup.html.
const POPUP_HTML = `
  <input type="text" id="doiInput">
  <button id="startButton"></button>
  <button id="openStatusTable"></button>
  <p id="status"></p>`;
const DOI = "10.1613/jair.1.20161";

function pressKey(keyName, keyOptions = {}) {
  const keyEvent = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...keyOptions });
  document.getElementById("doiInput").dispatchEvent(keyEvent);
  return keyEvent;
}

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = POPUP_HTML;
  global.browser = {
    runtime: {
      onMessage: { addListener: jest.fn() },
      sendMessage: jest.fn().mockResolvedValue(undefined),
    },
  };
  window.close = jest.fn();
  require("../popup");
  document.getElementById("doiInput").value = DOI;
});

describe("pressing Enter in the DOI field", () => {
  test("processes the DOI, like the Process DOI button", () => {
    const keyEvent = pressKey("Enter");
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "start-job", doi: DOI });
    expect(keyEvent.defaultPrevented).toBe(true);
  });

  test("does nothing while an input method is composing text", () => {
    pressKey("Enter", { isComposing: true });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("other keys are typed as usual", () => {
    const keyEvent = pressKey("a");
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(keyEvent.defaultPrevented).toBe(false);
  });

  test("asks for a DOI when the field is empty, as the button does", () => {
    document.getElementById("doiInput").value = "  ";
    pressKey("Enter");
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById("status").textContent).toBe("Please enter a DOI.");
  });
});
