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
function normalizePath(text, keepWildcards) {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const encoded = text.slice(i).match(PERCENT_ENCODED_OCTET);
    if (encoded) {
      const character = String.fromCharCode(parseInt(encoded[0].slice(1), 16));
      result += UNRESERVED_CHARACTER.test(character) ? character : encoded[0].toUpperCase();
      i += encoded[0].length;
      continue;
    }
    const character = String.fromCodePoint(text.codePointAt(i));
    if (character === "*") {
      result += keepWildcards ? "*" : "%2A";
    } else if (character === "$") {
      result += "%24";
    } else if (character < "!" || character > "~") {
      result += encodeURIComponent(character);
    } else {
      result += character;
    }
    i += character.length;
  }
  return result;
}

// A final "$" anchors the pattern at the end of the path; elsewhere it is a literal "$".
function normalizePattern(value) {
  const anchored = value.endsWith("$");
  const body = anchored ? value.slice(0, -1) : value;
  return normalizePath(body, true) + (anchored ? "$" : "");
}

// The Allow and Disallow rules of all groups for the "*" user agent, combined, as
// [{ allow, pattern }] with normalized patterns. Groups for other user agents, rules
// before the first User-agent line and unknown lines (Sitemap, Crawl-delay, ...) are
// skipped. An empty Disallow value is not a rule.
function parseRobotsTxt(text) {
  const rules = [];
  let inGroup = false;
  let groupHasRules = false;
  let groupApplies = false;
  for (const rawLine of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      // A User-agent line after rules starts a new group; consecutive ones share a group.
      if (!inGroup || groupHasRules) {
        inGroup = true;
        groupHasRules = false;
        groupApplies = false;
      }
      if (value === ALL_USER_AGENTS) groupApplies = true;
    } else if ((key === "allow" || key === "disallow") && inGroup) {
      groupHasRules = true;
      if (groupApplies && value !== "") {
        rules.push({ allow: key === "allow", pattern: normalizePattern(value) });
      }
    }
  }
  return rules;
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + parts.join(".*") + (anchored ? "$" : ""));
}

// May the "*" user agent visit url under these rules (from parseRobotsTxt)? The rule
// with the longest pattern that matches the start of the URL's path plus query decides;
// of an Allow and a Disallow rule of equal length, the Allow rule; without a matching
// rule the URL is allowed. Matching is case-sensitive. /robots.txt is always allowed.
function isAllowed(rules, url) {
  const { pathname, search } = new URL(url);
  if (pathname === ROBOTS_TXT_PATH) return true;
  const path = normalizePath(pathname + search, false);
  let decidingRule = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
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
function truncateRobotsTxt(text) {
  if (text.length <= ROBOTS_PARSE_LIMIT) return text;
  const head = text.slice(0, ROBOTS_PARSE_LIMIT);
  return head.slice(0, Math.max(head.lastIndexOf("\n"), head.lastIndexOf("\r")) + 1);
}

// Fetch and parse the origin's robots.txt, following RFC 9309 (see the plan, section 4):
// a 4xx status means there is no file and everything is allowed; a 5xx status, a network
// error or a timeout means the file is unreachable and everything is disallowed. 429 (Too
// Many Requests) counts as unreachable too: the RFC does not name it, but it asks for
// fewer requests rather than saying there are no rules. Never rejects.
async function fetchRobotsVerdict(origin) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROBOTS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(origin + ROBOTS_TXT_PATH, { credentials: "omit", signal: controller.signal });
    if (response.ok) {
      return { rules: parseRobotsTxt(truncateRobotsTxt(await response.text())) };
    }
    if (response.status >= 400 && response.status < 500 && response.status !== HTTP_TOO_MANY_REQUESTS) {
      return { rules: [] };
    }
    return { unreachable: true };
  } catch (_) {
    return { unreachable: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

function cachedRobotsVerdict(origin) {
  const cached = robotsCache.get(origin);
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
    return cached.verdict;
  }
  const entry = { expiresAt: null, verdict: fetchRobotsVerdict(origin) };
  robotsCache.set(origin, entry);
  entry.verdict.then((verdict) => {
    entry.expiresAt = Date.now() + (verdict.unreachable ? ROBOTS_UNREACHABLE_CACHE_MS : ROBOTS_CACHE_MS);
  });
  return entry.verdict;
}

// May the extension visit url? Resolves to { allowed, reason }, reason being
// BLOCKED_BY_ROBOTS or ROBOTS_UNREACHABLE when it may not, and null when it may.
// Only http and https URLs have a robots.txt; other URLs are allowed.
async function robotsAccessAllowed(url) {
  const { protocol, origin, pathname } = new URL(url);
  if ((protocol !== "http:" && protocol !== "https:") || pathname === ROBOTS_TXT_PATH) {
    return { allowed: true, reason: null };
  }
  const verdict = await cachedRobotsVerdict(origin);
  if (verdict.unreachable) {
    return { allowed: false, reason: ROBOTS_UNREACHABLE };
  }
  if (!isAllowed(verdict.rules, url)) {
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
