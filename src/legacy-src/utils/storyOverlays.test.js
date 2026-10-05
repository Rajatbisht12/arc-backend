const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStoryOverlays } = require('./storyOverlays');

const overlay = (patch = {}) => ({ id: 'text_1', type: 'text', text: 'Visit https://squadhunt.com',
  font: 'Montserrat', color: '#FFFFFF', x: 0.5, y: 0.5, scale: 1, ...patch });

test('Story overlay metadata is preserved and unsupported client fields are discarded', () => {
  assert.deepEqual(parseStoryOverlays(JSON.stringify([{ ...overlay(), links: ['javascript:alert(1)'], arbitraryStyle: {} }])), [overlay()]);
  assert.deepEqual(parseStoryOverlays(undefined), []);
});

test('Story overlays reject unsupported styles, invalid coordinates, duplicate ids and overflow', () => {
  for (const value of [
    [overlay({ font: 'Unknown' })], [overlay({ color: '#123456' })],
    [overlay({ x: -0.1 })], [overlay({ scale: 4 })],
    [overlay(), overlay()], Array.from({ length: 21 }, (_, i) => overlay({ id: `text_${i}` })),
    [overlay({ text: 'x'.repeat(501) })], [overlay({ text: 'hello\u0000' })],
  ]) assert.throws(() => parseStoryOverlays(value), { statusCode: 400 });
});
