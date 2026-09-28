// Parses robots.txt files and decides whether a URL may be visited, following RFC 9309
// (the Robots Exclusion Protocol), for the "*" user-agent group only: the extension has
// no product token of its own (see docs/robots_txt_plan.md, sections 1 and 4).
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

const exported = {
  parseRobotsTxt,
  isAllowed,
};

/* istanbul ignore next */
if (typeof module !== "undefined") {
  module.exports = exported;
}
/* istanbul ignore next */
if (typeof self !== "undefined") {
  Object.assign(self, exported);
}
