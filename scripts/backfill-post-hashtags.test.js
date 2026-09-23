const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzePostHashtags } = require('../src/legacy-src/utils/postHashtagBackfill');

test('repairs every missing hashtag relationship, not only the first one', () => {
  const result = analyzePostHashtags({
    tags: ['viral'],
    content: { text: '#viral #sukoon #meme' },
  });
  assert.deepEqual(result.expectedTags, ['viral', 'sukoon', 'meme']);
  assert.deepEqual(result.missingCaptionTags, ['sukoon', 'meme']);
  assert.equal(result.changed, true);
});

test('preserves explicit tags while normalizing and deduplicating legacy data', () => {
  const result = analyzePostHashtags({
    tags: ['Featured', '#VIRAL', 'featured'],
    content: { text: 'hello #Sukoon.' },
  });
  assert.deepEqual(result.expectedTags, ['featured', 'viral', 'sukoon']);
  assert.deepEqual(result.missingCaptionTags, ['sukoon']);
});

test('does not rewrite an already canonical multi-hashtag post', () => {
  const result = analyzePostHashtags({
    tags: ['viral', 'sukoon', 'meme'],
    content: { text: '#Viral,#Sukoon,#Meme' },
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.missingCaptionTags, []);
});
