/**
 * canonicalize — normalise a raw bank merchant string to a stable lowercase key.
 *
 * Processing order:
 *   1. Strip common merchant prefixes (AMZN*, SQ*, PAYPAL*, TST*, POS, SP*).
 *   2. Strip trailing 10-digit phone numbers.
 *   3. Strip trailing toll-free vanity numbers (e.g. 877-NEWPRIME).
 *   4. Strip ".com" anywhere in the string.
 *   5. Strip trailing " - <whatever>" noise clauses.
 *   6. Strip trailing city + state tokens (e.g. "NEW YORK NY").
 *   7. Strip trailing bare 2-letter state tokens (e.g. "CA").
 *   8. Remove standalone noise words (plus, premium, membership, subscription, inc, llc, com).
 *   9. Collapse whitespace and lowercase.
 *
 * Phone stripping intentionally precedes noise-word stripping so that vanity
 * numbers containing letter sequences (e.g. "USA" in "1-800-USA-XXXX") are
 * removed as part of the phone token rather than surviving as noise words.
 */

/** Merchant-prefix patterns that precede the real merchant name. */
const PREFIX_RE = /^(amzn\s*\*|sq\s*\*|paypal\s*\*|tst\s*\*|pos\s+|sp\s*\*)/i;

/** Standard 10-digit phone numbers with optional separators, preceded by whitespace. */
const PHONE_RE = /\s+\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/g;

/**
 * Toll-free vanity numbers: 3-digit area code, optional separator, then letters
 * (e.g. 877-NEWPRIME, 800-FLOWERS).  Must be preceded by whitespace.
 */
const TOLLFREE_RE = /\s+\d{3}[-\s]?[A-Z]+(\b|$)/g;

/** ".com" domain suffix appearing anywhere. */
const DOTCOM_RE = /\.com\b/gi;

/** " - <trailing clause>" patterns used to append plan tiers or categories. */
const DASH_AFTER_NAME = /\s+-\s+.*$/;

/**
 * City + state tokens at the end of a string, e.g. "NEW YORK NY" or "SAN JOSE CA".
 * Matches one or two ALL-CAPS word(s) (the city name) immediately followed by a
 * 2-letter state abbreviation at the very end.  The city group is deliberately
 * limited to one or two words so it does not consume earlier meaningful tokens
 * like "SPOTIFY USA".  Applied before the simpler state-only strip.
 */
const CITY_STATE_RE = /\s+[A-Z]+(?:\s+[A-Z]+)?\s+[A-Z]{2}\s*$/;

/** Bare 2-letter state abbreviation at the end, as a fallback for city-less strings. */
const STATE_SUFFIX_RE = /\s+[A-Z]{2}\s*$/;

/**
 * Generic noise words that add no merchant identity signal.
 * Note: "usa" is intentionally excluded here — some merchants (e.g. "Spotify USA")
 * carry it as a meaningful differentiator.  It is removed only when it appears as
 * part of a phone-vanity token (handled by TOLLFREE_RE above).
 */
const SUFFIX_NOISE = /\b(plus|premium|membership|subscription|inc|llc|com)\b/gi;

/**
 * Canonicalize a raw bank merchant string to a stable, lowercase comparison key.
 *
 * @param raw - The merchant string exactly as it appears on a bank statement.
 * @returns A normalised, lowercase string suitable for fuzzy subscription matching.
 */
export function canonicalize(raw: string): string {
  let s = raw ?? "";
  s = s.replace(PREFIX_RE, "");
  s = s.replace(PHONE_RE, " ");
  s = s.replace(TOLLFREE_RE, " ");
  s = s.replace(DOTCOM_RE, " ");
  s = s.replace(DASH_AFTER_NAME, "");
  s = s.replace(CITY_STATE_RE, "");
  s = s.replace(STATE_SUFFIX_RE, "");
  s = s.replace(SUFFIX_NOISE, " ");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}
