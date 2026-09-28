// Firefox runs the scripts the manifest lists for the background page, and those for a
// content script, in one shared global scope. The other tests load each file as a
// separate module, so they cannot notice two files declaring the same top-level name,
// which makes the second file fail to load in Firefox.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXTENSION_DIRECTORY = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIRECTORY, "manifest.json"), "utf8"));

// Stands in for the browser API: every property is itself, and so is every call result.
const ANY_BROWSER_API = new Proxy(function () {}, {
  get: (target, propertyName) => (propertyName === Symbol.toPrimitive ? undefined : ANY_BROWSER_API),
  apply: () => ANY_BROWSER_API,
});

// A page address for content scripts, which read window.location when they load.
const PAGE_URL = "https://www.example.com/article";

// Run scriptPaths one after the other in one fresh global scope; returns that scope.
function loadTogether(scriptPaths) {
  const sharedScope = vm.createContext({ browser: ANY_BROWSER_API, console, location: { href: PAGE_URL } });
  sharedScope.self = sharedScope;
  sharedScope.window = sharedScope;
  for (const scriptPath of scriptPaths) {
    const scriptCode = fs.readFileSync(path.join(EXTENSION_DIRECTORY, scriptPath), "utf8");
    vm.runInContext(scriptCode, sharedScope, { filename: scriptPath });
  }
  return sharedScope;
}

describe("manifest scripts", () => {
  test("the background scripts load together", () => {
    const backgroundScope = loadTogether(manifest.background.scripts);
    expect(typeof backgroundScope.robotsAccessAllowed).toBe("function");
    expect(typeof backgroundScope.checkRobotsBeforeRequest).toBe("function");
  });

  test.each(manifest.content_scripts.map((contentScript) => [contentScript.js.join(", "), contentScript.js]))(
    "the content scripts %s load together", (scriptNames, scriptPaths) => {
      expect(() => loadTogether(scriptPaths)).not.toThrow();
    });
});
