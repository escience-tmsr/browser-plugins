require("jest-webextension-mock");

const { setBadge, sendStatus }  = require("../src/status");

describe("sendStatus", () => {
  const text = "text";
  const dot = "•";

  beforeEach(() => {
    jest.clearAllMocks();
    global.self = {"setBadge": jest.fn()};
    global.browser = {
      "runtime": {"sendMessage": jest.fn().mockResolvedValue(null)},
    };
    global.console = {
      "error": jest.fn(),
      "log": jest.fn(),
    };
  });

  test("report status, no web status element available", () => {
    document.getElementById = jest.fn().mockReturnValue(null);
    const result = sendStatus(text);
    expect(self.setBadge).toHaveBeenCalledWith(dot, false);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "status", text: text });
    expect(result).toBe(null);
  });

  test("report error, web status element available", () => {
    let element = {"textContent": "", "style": {"color": ""},}
    document.getElementById = jest.fn().mockReturnValue(element);
    const result = sendStatus(text, true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(null);
    expect(element.textContent).toBe(text);
    expect(element.style.color).toBe("red");
  });

  test("report status, web status element available", () => {  
    let element = {"textContent": "", "style": {"color": ""},}
    document.getElementById = jest.fn().mockReturnValue(element);
    const result = sendStatus(text, false);
    expect(element.style.color).toBe("");
  });
});

describe("setBadge", () => {
  const dot = "•";

  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {"browserAction": {
      "setBadgeBackgroundColor": jest.fn(),
      "setBadgeText": jest.fn(),
    }}
  });

  test("set badge color for status", () => {
    const isError = false;
    const result = setBadge(dot, isError);
    expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({ text: dot });
    expect(browser.browserAction.setBadgeBackgroundColor).toHaveBeenCalledTimes(1);
    expect(result).toBe(isError);
  });

  test("set badge color for error", () => {
    const isError = true;
    const result = setBadge(dot, isError);
    expect(result).toBe(isError);
  });
});
