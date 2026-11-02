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

test('v2 preserves explicit text sizing and the separate link destination', () => {
  const text = overlay({ version: 2, coordinateSpace: 'media', fontSize: 37.5, scale: 1.25, textAlign: 'center' });
  const link = { ...text, id: 'link_1', type: 'link', text: 'Watch', label: 'Watch', url: 'https://example.com/watch?q=1' };
  assert.deepEqual(parseStoryOverlays(JSON.stringify([text, link])), [text, link]);
});

test('v2 rejects unsafe destinations and inconsistent coordinate or size metadata', () => {
  const link = overlay({ type: 'link', version: 2, coordinateSpace: 'media', fontSize: 30, textAlign: 'center', url: 'https://example.com/', label: 'Watch' });
  for (const patch of [{ url: 'javascript:alert(1)' }, { url: 'data:text/html,test' }, { url: 'https://user:pass@example.com/' },
    { url: 'https://example.com/\n' }, { label: 'x'.repeat(81) }, { fontSize: 90 }, { coordinateSpace: 'viewport' }, { version: 3 }]) {
    assert.throws(() => parseStoryOverlays([{ ...link, ...patch }]), { statusCode: 400 });
  }
});
