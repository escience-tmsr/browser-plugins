const { parseRobotsTxt, isAllowed } = require("../src/robots");

const SITE = "https://www.example.com";

// Whether the "*" user agent may visit path on SITE under robotsTxt.
function allowed(robotsTxt, path) {
  return isAllowed(parseRobotsTxt(robotsTxt), SITE + path);
}

// The first example of RFC 9309, section 5.1.
const RFC_SIMPLE_EXAMPLE = [
  "User-Agent: *",
  "Disallow: *.gif$",
  "Disallow: /example/",
  "Allow: /publications/",
  "",
  "User-Agent: foobot",
  "Disallow:/",
  "Allow:/example/page.html",
  "Allow:/example/allowed.gif",
  "",
  "User-Agent: barbot",
  "User-Agent: bazbot",
  "Disallow: /example/page.html",
  "",
  "User-Agent: quxbot",
  "",
].join("\n");

describe("parseRobotsTxt", () => {
  test("keeps only the rules of the * group, in file order", () => {
    expect(parseRobotsTxt(RFC_SIMPLE_EXAMPLE)).toEqual([
      { allow: false, pattern: "*.gif$" },
      { allow: false, pattern: "/example/" },
      { allow: true, pattern: "/publications/" },
    ]);
  });

  test("combines all groups for *", () => {
    const robotsTxt = "User-agent: *\nDisallow: /foo\n\nUser-agent: foobot\nDisallow: /bar\n\nUser-agent: *\nDisallow: /baz\n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/foo", "/baz"]);
  });

  test("applies a group that names * among other user agents", () => {
    const robotsTxt = "User-agent: foobot\nUser-agent: *\nDisallow: /private/\n";
    expect(parseRobotsTxt(robotsTxt)).toEqual([{ allow: false, pattern: "/private/" }]);
  });

  test("a User-agent line after rules starts a new group", () => {
    const robotsTxt = "User-agent: *\nDisallow: /foo\nUser-agent: foobot\nDisallow: /bar\n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/foo"]);
  });

  test("ignores rules before the first User-agent line", () => {
    const robotsTxt = "Disallow: /early\nUser-agent: *\nDisallow: /late\n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/late"]);
  });

  test("other lines such as Sitemap do not end a group", () => {
    const robotsTxt = "User-agent: *\nSitemap: https://www.example.com/sitemap.xml\nDisallow: /a\nCrawl-delay: 10\nDisallow: /b\n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/a", "/b"]);
  });

  test("reads keys case-insensitively, with or without spaces around the colon", () => {
    const robotsTxt = "USER-AGENT:*\nDISALLOW:/a\n  disallow  :  /b  \n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/a", "/b"]);
  });

  test("skips comments, blank lines and lines without a colon", () => {
    const robotsTxt = "# robots.txt\n\nUser-agent: * # everyone\nDisallow: /a # not /b\nnonsense\n";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/a"]);
  });

  test("accepts CRLF and CR line ends and a byte order mark", () => {
    const robotsTxt = "﻿User-agent: *\r\nDisallow: /a\rDisallow: /b";
    expect(parseRobotsTxt(robotsTxt).map((rule) => rule.pattern)).toEqual(["/a", "/b"]);
  });

  test("an empty Disallow value is not a rule", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow:\n")).toEqual([]);
  });

  test("returns no rules for an empty file", () => {
    expect(parseRobotsTxt("")).toEqual([]);
  });
});

describe("isAllowed", () => {
  test("follows the * group of the RFC 9309 example (section 5.1)", () => {
    expect(allowed(RFC_SIMPLE_EXAMPLE, "/publications/paper.pdf")).toBe(true);
    expect(allowed(RFC_SIMPLE_EXAMPLE, "/example/page.html")).toBe(false);
    expect(allowed(RFC_SIMPLE_EXAMPLE, "/images/logo.gif")).toBe(false);
    expect(allowed(RFC_SIMPLE_EXAMPLE, "/images/logo.gif?size=2")).toBe(true);
    expect(allowed(RFC_SIMPLE_EXAMPLE, "/about.html")).toBe(true);
  });

  test("allows everything without a * group, or without any rules", () => {
    expect(allowed("User-agent: foobot\nDisallow: /\n", "/page")).toBe(true);
    expect(allowed("", "/page")).toBe(true);
  });

  test("matches rules as prefixes of the path", () => {
    const robotsTxt = "User-agent: *\nDisallow: /private\n";
    expect(allowed(robotsTxt, "/private")).toBe(false);
    expect(allowed(robotsTxt, "/private-notes/a.html")).toBe(false);
    expect(allowed(robotsTxt, "/public/private")).toBe(true);
  });

  test("matches case-sensitively", () => {
    expect(allowed("User-agent: *\nDisallow: /Private\n", "/private")).toBe(true);
  });

  test("includes the query string but not the fragment", () => {
    const robotsTxt = "User-agent: *\nDisallow: /search?q=\nDisallow: /page$\n";
    expect(allowed(robotsTxt, "/search?q=robots")).toBe(false);
    expect(allowed(robotsTxt, "/search")).toBe(true);
    expect(allowed(robotsTxt, "/page#top")).toBe(false);
  });

  test("the longest matching rule decides (RFC 9309, section 5.2)", () => {
    const robotsTxt = "User-agent: *\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n";
    expect(allowed(robotsTxt, "/example/page/disallowed.gif")).toBe(false);
    expect(allowed(robotsTxt, "/example/page/allowed.gif")).toBe(true);
  });

  test("the longest matching rule decides whatever the order of the rules", () => {
    // Python's urllib.robotparser, used by doi_downloader, takes the first matching rule
    // instead and disallows /pdf/paper.pdf here.
    const robotsTxt = "User-agent: *\nDisallow: /\nAllow: /pdf/\n";
    expect(allowed(robotsTxt, "/pdf/paper.pdf")).toBe(true);
    expect(allowed(robotsTxt, "/html/paper.html")).toBe(false);
  });

  test("an Allow rule wins a tie with an equally long Disallow rule", () => {
    expect(allowed("User-agent: *\nDisallow: /page\nAllow: /page\n", "/page")).toBe(true);
    expect(allowed("User-agent: *\nAllow: /page\nDisallow: /page\n", "/page")).toBe(true);
  });

  test("* matches any sequence of characters, including slashes", () => {
    const robotsTxt = "User-agent: *\nDisallow: /*/private/\n";
    expect(allowed(robotsTxt, "/a/private/x")).toBe(false);
    expect(allowed(robotsTxt, "/a/b/private/x")).toBe(false);
    expect(allowed(robotsTxt, "/private/x")).toBe(true);
  });

  test("a final $ anchors the pattern at the end of the path", () => {
    const robotsTxt = "User-agent: *\nDisallow: /exactly$\n";
    expect(allowed(robotsTxt, "/exactly")).toBe(false);
    expect(allowed(robotsTxt, "/exactly/more")).toBe(true);
  });

  test("a $ before the end of the pattern is a literal $", () => {
    const robotsTxt = "User-agent: *\nDisallow: /price$list\n";
    expect(allowed(robotsTxt, "/price$list")).toBe(false);
    expect(allowed(robotsTxt, "/price")).toBe(true);
  });

  test("%2A and %24 in a pattern match a literal * and $ (RFC 9309, figure 6)", () => {
    const robotsTxt = "User-agent: *\nDisallow: /path/file-with-a-%2A.html\nDisallow: /path/foo-%24\n";
    expect(allowed(robotsTxt, "/path/file-with-a-*.html")).toBe(false);
    expect(allowed(robotsTxt, "/path/file-with-a-b.html")).toBe(true);
    expect(allowed(robotsTxt, "/path/foo-$")).toBe(false);
  });

  test("compares non-ASCII characters in percent-encoded form (RFC 9309, figure 4)", () => {
    const robotsTxt = "User-agent: *\nDisallow: /foo/bar/ツ\n";
    expect(allowed(robotsTxt, "/foo/bar/%E3%83%84")).toBe(false);
    expect(allowed(robotsTxt, "/foo/bar/%e3%83%84")).toBe(false);
    expect(allowed(robotsTxt, "/foo/bar/ツ")).toBe(false);
  });

  test("decodes percent-encoded unreserved characters (RFC 9309, figure 4)", () => {
    expect(allowed("User-agent: *\nDisallow: /foo/bar/baz\n", "/foo/bar/%62%61%7A")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /foo/bar/%62%61%7A\n", "/foo/bar/baz")).toBe(false);
  });

  test("keeps percent-encoded reserved characters encoded", () => {
    const robotsTxt = "User-agent: *\nDisallow: /a%2Fb\n";
    expect(allowed(robotsTxt, "/a%2fb")).toBe(false);
    expect(allowed(robotsTxt, "/a/b")).toBe(true);
  });

  test("always allows /robots.txt itself", () => {
    expect(allowed("User-agent: *\nDisallow: /\n", "/robots.txt")).toBe(true);
  });
});

describe("robotsAccessAllowed", () => {
  const ROBOTS_TXT_URL = SITE + "/robots.txt";
  const OTHER_SITE = "https://publisher.example.org";
  const DISALLOW_PRIVATE = "User-agent: *\nDisallow: /private/\n";
  const ALLOWED_URL = SITE + "/public/paper.pdf";
  const DISALLOWED_URL = SITE + "/private/paper.pdf";
  const ALLOWED = { allowed: true, reason: null };

  let robots;
  let blocked;
  let unreachable;

  function respondWith(status, body = "") {
    global.fetch.mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => body });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    robots = require("../src/robots");
    blocked = { allowed: false, reason: robots.BLOCKED_BY_ROBOTS };
    unreachable = { allowed: false, reason: robots.ROBOTS_UNREACHABLE };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test("fetches the site's robots.txt without cookies and follows its rules", async () => {
    respondWith(200, DISALLOW_PRIVATE);
    await expect(robots.robotsAccessAllowed(DISALLOWED_URL)).resolves.toEqual(blocked);
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(ALLOWED);
    expect(global.fetch).toHaveBeenCalledWith(ROBOTS_TXT_URL, expect.objectContaining({ credentials: "omit" }));
  });

  test("fetches robots.txt from the URL's own scheme, host and port", async () => {
    respondWith(200, "");
    await robots.robotsAccessAllowed("http://www.example.com:8080/page?x=1");
    expect(global.fetch.mock.calls[0][0]).toBe("http://www.example.com:8080/robots.txt");
  });

  test.each([400, 401, 403, 404, 410])("allows everything when robots.txt answers %i", async (status) => {
    respondWith(status);
    await expect(robots.robotsAccessAllowed(DISALLOWED_URL)).resolves.toEqual(ALLOWED);
  });

  test.each([429, 500, 502, 503])("disallows everything when robots.txt answers %i", async (status) => {
    respondWith(status);
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(unreachable);
  });

  test("disallows everything when robots.txt cannot be fetched", async () => {
    global.fetch.mockRejectedValue(new TypeError("NetworkError when attempting to fetch resource."));
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(unreachable);
  });

  test("disallows everything when fetching robots.txt times out", async () => {
    global.fetch.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    }));
    const access = robots.robotsAccessAllowed(ALLOWED_URL);
    jest.advanceTimersByTime(robots.ROBOTS_FETCH_TIMEOUT_MS);
    await expect(access).resolves.toEqual(unreachable);
  });

  test("allows other schemes and robots.txt itself without fetching", async () => {
    await expect(robots.robotsAccessAllowed("about:blank")).resolves.toEqual(ALLOWED);
    await expect(robots.robotsAccessAllowed(ROBOTS_TXT_URL)).resolves.toEqual(ALLOWED);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("fetches robots.txt once per site while the cache lasts", async () => {
    respondWith(200, DISALLOW_PRIVATE);
    await robots.robotsAccessAllowed(ALLOWED_URL);
    await robots.robotsAccessAllowed(DISALLOWED_URL);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await robots.robotsAccessAllowed(OTHER_SITE + "/paper.pdf");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("requests arriving during a fetch share it", async () => {
    respondWith(200, DISALLOW_PRIVATE);
    const results = await Promise.all([robots.robotsAccessAllowed(ALLOWED_URL), robots.robotsAccessAllowed(DISALLOWED_URL)]);
    expect(results).toEqual([ALLOWED, blocked]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("fetches robots.txt again once the cache has expired", async () => {
    respondWith(200, DISALLOW_PRIVATE);
    await robots.robotsAccessAllowed(ALLOWED_URL);
    jest.advanceTimersByTime(robots.ROBOTS_CACHE_MS - 1);
    await robots.robotsAccessAllowed(ALLOWED_URL);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    respondWith(200, "");
    await expect(robots.robotsAccessAllowed(DISALLOWED_URL)).resolves.toEqual(ALLOWED);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("remembers an unreachable robots.txt for a shorter time", async () => {
    respondWith(503);
    await robots.robotsAccessAllowed(ALLOWED_URL);
    jest.advanceTimersByTime(robots.ROBOTS_UNREACHABLE_CACHE_MS - 1);
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(unreachable);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    respondWith(200, DISALLOW_PRIVATE);
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(ALLOWED);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("parses only the complete lines within the parse limit", async () => {
    // The limit falls just after "Disallow: /" in the last line. Read up to the limit,
    // that line would disallow the whole site, so it has to be left out.
    const head = "User-agent: *\nDisallow: /early/\n";
    const lastRule = "Disallow: /private/\n";
    const lastRuleWithinLimit = "Disallow: /";
    const filler = "#".repeat(robots.ROBOTS_PARSE_LIMIT - head.length - 1 - lastRuleWithinLimit.length) + "\n";
    respondWith(200, head + filler + lastRule);
    await expect(robots.robotsAccessAllowed(SITE + "/early/paper.pdf")).resolves.toEqual(blocked);
    await expect(robots.robotsAccessAllowed(DISALLOWED_URL)).resolves.toEqual(ALLOWED);
    await expect(robots.robotsAccessAllowed(ALLOWED_URL)).resolves.toEqual(ALLOWED);
  });
});
