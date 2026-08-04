const assert = require('node:assert/strict');
const test = require('node:test');

const { extractHashtags, normalizeTag, mergeTags } = require('./hashtags');

test('#Gaming and #gaming resolve to the same stored key (case-insensitive)', () => {
  assert.deepEqual(extractHashtags('#Gaming #gaming #GAMING'), ['gaming']);
  assert.equal(normalizeTag('#Gaming'), 'gaming');
  assert.equal(normalizeTag('gaming'), 'gaming');
});

test('trailing punctuation is stripped — #gaming!!! stores only "gaming"', () => {
  assert.deepEqual(extractHashtags('#gaming!!!'), ['gaming']);
  assert.deepEqual(extractHashtags('great match! #valorant.'), ['valorant']);
});

test('adjacent/comma-joined hashtags all extract — #gaming,#fps', () => {
  assert.deepEqual(extractHashtags('#gaming,#fps'), ['gaming', 'fps']);
  assert.deepEqual(extractHashtags('#a#b#c'), ['a', 'b', 'c']);
});

test('numbers and underscores are valid tag bodies', () => {
  assert.deepEqual(extractHashtags('#gaming2026 #a_b #123'), ['gaming2026', 'a_b', '123']);
});

test('a lone # and emails/URLs are never hashtags', () => {
  assert.deepEqual(extractHashtags('a # b user@example.com http://x/#frag'), ['frag']);
  // (only the URL fragment "#frag" qualifies; the bare # and the email do not)
});

test('duplicates collapse and first-seen order is preserved (multiple spaces too)', () => {
  assert.deepEqual(extractHashtags('#fps   #gaming\n#fps\t#gaming'), ['fps', 'gaming']);
});

test('very long captions extract all unique tags without error', () => {
  const caption = Array.from({ length: 500 }, (_, i) => `#tag${i % 10}`).join(' ');
  assert.deepEqual(extractHashtags(caption), Array.from({ length: 10 }, (_, i) => `tag${i}`));
});

test('mergeTags unions explicit tags with caption hashtags, normalized + deduped', () => {
  assert.deepEqual(mergeTags(['News', 'gaming'], 'playing #Gaming #fps'), ['news', 'gaming', 'fps']);
  assert.deepEqual(mergeTags('a,b,#a', 'text #B'), ['a', 'b']);
});

test('DOCUMENTED LIMIT: tag bodies are ASCII [A-Za-z0-9_] on all three clients', () => {
  // The Web/Mobile/Backend tokenizers are intentionally identical ASCII so they
  // never disagree. Unicode/mixed-language hashtags are truncated at the first
  // non-ASCII char (kept consistent, not silently divergent). Broadening to
  // \p{L}\p{N} must be done in lockstep across all five tokenizer sites AND
  // verified on Hermes (mobile) before enabling — see HashtagPipeline notes.
  assert.deepEqual(extractHashtags('#español'), ['espa']);
  assert.deepEqual(extractHashtags('#日本語 #gaming'), ['gaming']);
});
