/**
 * Hashtag extraction and normalization — the single source of truth the
 * backend uses to index posts for hashtag discovery.
 *
 * Storage/search key rules (mirror the Web and Mobile parsers):
 *   - a hashtag is `#` followed by one or more of [A-Za-z0-9_]
 *   - the stored key drops the leading `#`, is lowercased, and never
 *     includes trailing punctuation
 *   - a standalone `#` is not a hashtag
 *   - emails/URLs are never turned into hashtags (they have no leading `#`)
 */

// Global matcher for hashtags embedded in caption text.
const HASHTAG_RE = /#([A-Za-z0-9_]+)/g;

/**
 * Normalize a single raw tag token (which may carry a leading `#` and/or
 * trailing punctuation) into its canonical storage/search key.
 * Returns '' when there is no valid tag body.
 */
function normalizeTag(raw) {
  if (raw == null) return '';
  const match = String(raw).match(/[A-Za-z0-9_]+/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Extract every unique normalized hashtag from caption text, in first-seen
 * order. Duplicate hashtags (any casing) collapse to a single key.
 */
function extractHashtags(text) {
  if (typeof text !== 'string' || !text) return [];
  const seen = new Set();
  const out = [];
  let match;
  HASHTAG_RE.lastIndex = 0;
  while ((match = HASHTAG_RE.exec(text)) !== null) {
    const key = match[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Compute the final, deduped, normalized tag set for a post from any explicit
 * tags (the legacy comma/array "tags" field) unioned with the hashtags found
 * in the caption. Caption hashtags are the source of truth, so re-running this
 * on edit naturally drops hashtags removed from the caption.
 */
function mergeTags(explicitTags, text) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const key = normalizeTag(value);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };
  if (Array.isArray(explicitTags)) {
    explicitTags.forEach(add);
  } else if (typeof explicitTags === 'string') {
    explicitTags.split(',').forEach(add);
  }
  extractHashtags(text).forEach((key) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  });
  return out;
}

module.exports = { normalizeTag, extractHashtags, mergeTags, HASHTAG_RE };
