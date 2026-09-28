// Fetches and parses robots.txt files and decides whether a URL may be visited, following
// RFC 9309 (the Robots Exclusion Protocol), for the "*" user-agent group only: the
// extension has no product token of its own (see docs/robots_txt_plan.md, sections 1 and 4).
//
// This differs from doi_downloader, which uses Python's urllib.robotparser: there the
// first matching rule in file order decides and "*"/"$" are not special. Here the longest
// matching rule decides, an Allow rule wins a tie, and "*" and "$" are wildcards.

const ALL_USER_AGENTS = "*";
const ROBOTS_TXT_PATH = "/robots.txt";
// Characters that RFC 3986 lets a URI carry either as they are or percent-encoded.
const UNRESERVED_CHARACTER = /^[A-Za-z0-9\-._~]$/;
const PERCENT_ENCODED_OCTET = /^%[0-9A-Fa-f]{2}/;

// Bring a path or a rule pattern into one form, so equal paths compare equal whichever
// way they were written: percent-encoded unreserved characters are decoded, other
// percent-encodings get uppercase hex digits, and characters outside printable ASCII
// are percent-encoded as UTF-8. A "*" that is not a wildcard is encoded as %2A and a
// "$" as %24, so a rule can match these characters with %2A and %24 (RFC 9309, 2.2.3).
function normalizePath(pathText, keepWildcards) {
  let normalizedPath = "";
  let i = 0;
  while (i < pathText.length) {
    const encodedOctet = pathText.slice(i).match(PERCENT_ENCODED_OCTET);
    if (encodedOctet) {
      const decodedCharacter = String.fromCharCode(parseInt(encodedOctet[0].slice(1), 16));
      normalizedPath += UNRESERVED_CHARACTER.test(decodedCharacter) ? decodedCharacter : encodedOctet[0].toUpperCase();
      i += encodedOctet[0].length;
      continue;
    }
    const currentCharacter = String.fromCodePoint(pathText.codePointAt(i));
    if (currentCharacter === "*") {
      normalizedPath += keepWildcards ? "*" : "%2A";
    } else if (currentCharacter === "$") {
      normalizedPath += "%24";
    } else if (currentCharacter < "!" || currentCharacter > "~") {
      normalizedPath += encodeURIComponent(currentCharacter);
    } else {
      normalizedPath += currentCharacter;
    }
    i += currentCharacter.length;
  }
  return normalizedPath;
}

// A final "$" anchors the pattern at the end of the path; elsewhere it is a literal "$".
function normalizePattern(patternText) {
  const isAnchored = patternText.endsWith("$");
  const patternBody = isAnchored ? patternText.slice(0, -1) : patternText;
  return normalizePath(patternBody, true) + (isAnchored ? "$" : "");
}

// The Allow and Disallow rules of all groups for the "*" user agent, combined, as
// [{ allow, pattern }] with normalized patterns. Groups for other user agents, rules
// before the first User-agent line and unknown lines (Sitemap, Crawl-delay, ...) are
// skipped. An empty Disallow value is not a rule.
function parseRobotsTxt(robotsTxt) {
  const starGroupRules = [];
  let inGroup = false;
  let groupHasRules = false;
  let groupApplies = false;
  for (const rawLine of robotsTxt.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const contentLine = rawLine.replace(/#.*/, "").trim();
    const colonIndex = contentLine.indexOf(":");
    if (colonIndex === -1) continue;
    const fieldName = contentLine.slice(0, colonIndex).trim().toLowerCase();
    const fieldValue = contentLine.slice(colonIndex + 1).trim();
    if (fieldName === "user-agent") {
      // A User-agent line after rules starts a new group; consecutive ones share a group.
      if (!inGroup || groupHasRules) {
        inGroup = true;
        groupHasRules = false;
        groupApplies = false;
      }
      if (fieldValue === ALL_USER_AGENTS) groupApplies = true;
    } else if ((fieldName === "allow" || fieldName === "disallow") && inGroup) {
      groupHasRules = true;
      if (groupApplies && fieldValue !== "") {
        starGroupRules.push({ allow: fieldName === "allow", pattern: normalizePattern(fieldValue) });
      }
    }
  }
  return starGroupRules;
}

function patternToRegExp(normalizedPattern) {
  const isAnchored = normalizedPattern.endsWith("$");
  const patternBody = isAnchored ? normalizedPattern.slice(0, -1) : normalizedPattern;
  const escapedParts = patternBody.split("*").map((literalPart) => literalPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + escapedParts.join(".*") + (isAnchored ? "$" : ""));
}

// May the "*" user agent visit url under these rules (from parseRobotsTxt)? The rule
// with the longest pattern that matches the start of the URL's path plus query decides;
// of an Allow and a Disallow rule of equal length, the Allow rule; without a matching
// rule the URL is allowed. Matching is case-sensitive. /robots.txt is always allowed.
function isAllowed(robotsRules, url) {
  const { pathname, search } = new URL(url);
  if (pathname === ROBOTS_TXT_PATH) return true;
  const pathToMatch = normalizePath(pathname + search, false);
  let decidingRule = null;
  for (const rule of robotsRules) {
    if (!patternToRegExp(rule.pattern).test(pathToMatch)) continue;
    if (decidingRule === null
        || rule.pattern.length > decidingRule.pattern.length
        || (rule.pattern.length === decidingRule.pattern.length && rule.allow)) {
      decidingRule = rule;
    }
  }
  return decidingRule === null ? true : decidingRule.allow;
}

const ROBOTS_FETCH_TIMEOUT_MS = 10000;
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
// Shorter, so a temporary server problem does not keep a site blocked for a day.
const ROBOTS_UNREACHABLE_CACHE_MS = 10 * 60 * 1000;
// RFC 9309 asks crawlers to parse at least 500 KiB. This limit counts characters, and a
// UTF-8 file has at least as many bytes as characters, so at least 500 KiB is parsed.
const ROBOTS_PARSE_LIMIT = 500 * 1024;
const HTTP_TOO_MANY_REQUESTS = 429;
const BLOCKED_BY_ROBOTS = "blocked by robots.txt";
const ROBOTS_UNREACHABLE = "robots.txt unreachable";

// Per origin: { expiresAt, verdict }, verdict being a Promise of { rules } or
// { unreachable: true }. expiresAt stays null while the fetch is under way, so requests
// arriving meanwhile share it.
const robotsCache = new Map();

// Cut a long file after its last complete line within the parse limit, so a rule cut in
// half cannot block more than the whole rule would.
function truncateRobotsTxt(robotsTxt) {
  if (robotsTxt.length <= ROBOTS_PARSE_LIMIT) return robotsTxt;
  const textWithinLimit = robotsTxt.slice(0, ROBOTS_PARSE_LIMIT);
  return textWithinLimit.slice(0, Math.max(textWithinLimit.lastIndexOf("\n"), textWithinLimit.lastIndexOf("\r")) + 1);
}

// Fetch and parse the origin's robots.txt, following RFC 9309 (see the plan, section 4):
// a 4xx status means there is no file and everything is allowed; a 5xx status, a network
// error or a timeout means the file is unreachable and everything is disallowed. 429 (Too
// Many Requests) counts as unreachable too: the RFC does not name it, but it asks for
// fewer requests rather than saying there are no rules. Never rejects.
async function fetchRobotsVerdict(siteOrigin) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), ROBOTS_FETCH_TIMEOUT_MS);
  try {
    const robotsResponse = await fetch(siteOrigin + ROBOTS_TXT_PATH, { credentials: "omit", signal: abortController.signal });
    if (robotsResponse.ok) {
      return { rules: parseRobotsTxt(truncateRobotsTxt(await robotsResponse.text())) };
    }
    const httpStatus = robotsResponse.status;
    if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== HTTP_TOO_MANY_REQUESTS) {
      return { rules: [] };
    }
    return { unreachable: true };
  } catch (_) {
    return { unreachable: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

function cachedRobotsVerdict(siteOrigin) {
  const cachedEntry = robotsCache.get(siteOrigin);
  if (cachedEntry && (cachedEntry.expiresAt === null || cachedEntry.expiresAt > Date.now())) {
    return cachedEntry.verdict;
  }
  const newEntry = { expiresAt: null, verdict: fetchRobotsVerdict(siteOrigin) };
  robotsCache.set(siteOrigin, newEntry);
  newEntry.verdict.then((robotsVerdict) => {
    newEntry.expiresAt = Date.now() + (robotsVerdict.unreachable ? ROBOTS_UNREACHABLE_CACHE_MS : ROBOTS_CACHE_MS);
  });
  return newEntry.verdict;
}

// May the extension visit url? Resolves to { allowed, reason }, reason being
// BLOCKED_BY_ROBOTS or ROBOTS_UNREACHABLE when it may not, and null when it may.
// Only http and https URLs have a robots.txt; other URLs are allowed.
async function robotsAccessAllowed(url) {
  const { protocol, origin: siteOrigin, pathname } = new URL(url);
  if ((protocol !== "http:" && protocol !== "https:") || pathname === ROBOTS_TXT_PATH) {
    return { allowed: true, reason: null };
  }
  const robotsVerdict = await cachedRobotsVerdict(siteOrigin);
  if (robotsVerdict.unreachable) {
    return { allowed: false, reason: ROBOTS_UNREACHABLE };
  }
  if (!isAllowed(robotsVerdict.rules, url)) {
    return { allowed: false, reason: BLOCKED_BY_ROBOTS };
  }
  return { allowed: true, reason: null };
}

const exported = {
  ROBOTS_FETCH_TIMEOUT_MS,
  ROBOTS_CACHE_MS,
  ROBOTS_UNREACHABLE_CACHE_MS,
  ROBOTS_PARSE_LIMIT,
  BLOCKED_BY_ROBOTS,
  ROBOTS_UNREACHABLE,
  parseRobotsTxt,
  isAllowed,
  robotsAccessAllowed,
};

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = exported;
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
