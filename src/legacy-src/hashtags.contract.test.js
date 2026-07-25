const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeTag, extractHashtags, mergeTags } = require('./utils/hashtags');
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

test('normalizeTag strips #, lowercases, and drops trailing punctuation', () => {
  assert.equal(normalizeTag('#Valorant'), 'valorant');
  assert.equal(normalizeTag('#esports,'), 'esports');
  assert.equal(normalizeTag('#game_night'), 'game_night');
  assert.equal(normalizeTag('#gaming2026'), 'gaming2026');
  assert.equal(normalizeTag('BGMI'), 'bgmi');
  assert.equal(normalizeTag('#'), '');
  assert.equal(normalizeTag('   '), '');
  assert.equal(normalizeTag(null), '');
});

test('extractHashtags pulls unique normalized tags from a caption', () => {
  assert.deepEqual(
    extractHashtags('Won the finals today! #valorant #esports'),
    ['valorant', 'esports'],
  );
  // Case-insensitive de-duplication.
  assert.deepEqual(extractHashtags('#Valorant #valorant #VALORANT'), ['valorant']);
  // Punctuation, start/middle/end, underscores and digits.
  assert.deepEqual(
    extractHashtags('#game_night was fun, #gaming2026! ok#BGMI'),
    ['game_night', 'gaming2026', 'bgmi'],
  );
  // A standalone # is not a hashtag; emails/urls are never hashtags.
  assert.deepEqual(extractHashtags('just # alone and a@b.com and http://x/y'), []);
  assert.deepEqual(extractHashtags(''), []);
  assert.deepEqual(extractHashtags(null), []);
});

test('mergeTags unions explicit field tags with caption hashtags, deduped', () => {
  assert.deepEqual(mergeTags(['Esports', 'lft'], 'gg #valorant #Esports'), ['esports', 'lft', 'valorant']);
  assert.deepEqual(mergeTags('Valorant, BGMI', 'no tags here'), ['valorant', 'bgmi']);
  assert.deepEqual(mergeTags([], ''), []);
});

test('createPost and editPost index hashtags from the caption (source of truth)', () => {
  const controller = read('controllers/postController.js');
  assert.match(controller, /require\('\.\.\/utils\/hashtags'\)/);
  // Create indexes caption hashtags + explicit tags.
  assert.match(controller, /tags: mergeTags\(parsedTags, typeof text === 'string' \? text : ''\)/);
  // Edit re-derives from the caption and preserves manual field tags.
  assert.match(controller, /oldCaptionTags = new Set\(extractHashtags\(oldText\)\)/);
  assert.match(controller, /preservedFieldTags/);
  assert.match(controller, /nextTags = mergeTags\(explicit, typeof effectiveText === 'string'/);
});

test('hashtag search query is normalized to the stored lowercase keys', () => {
  const service = read('services/recommendationService.js');
  assert.match(service, /require\('\.\.\/utils\/hashtags'\)/);
  assert.match(service, /String\(query\.tags\)\.split\(','\)\.map\(normalizeTag\)\.filter\(Boolean\)/);
});
