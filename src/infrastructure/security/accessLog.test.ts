import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAccessLog, safeAccessLogValue } from './accessLog';

test('access logs retain useful paths but never query/fragment grants or referrers', () => {
  const url = '/api/posts/video-playback/a/master.m3u8?token=private-grant&Signature=secret';
  const referrer = 'https://staging.invalid/?code=oauth-secret#fragment';
  const tokens = Object.fromEntries(Object.entries({ url, referrer, method: 'GET', status: '200',
    'http-version': '1.1', 'user-agent': 'browser\r\nforged-log', 'remote-addr': '127.0.0.1' })
    .map(([key, value]) => [key, () => value]));
  const output = safeAccessLog(tokens as any, {} as any, {} as any);
  assert.match(output!, /GET \/api\/posts\/video-playback\/a\/master\.m3u8\?\[redacted\]/);
  assert.match(output!, /https:\/\/staging\.invalid\/\?\[redacted\]/);
  assert.doesNotMatch(output!, /private-grant|Signature|oauth-secret|fragment|\r|\n/);
  assert.equal(tokens.url(), url, 'Logging must not change signed request bytes');
  assert.equal(tokens.referrer(), referrer);
});

test('ordinary legacy requests remain identifiable and control characters are removed', () => {
  assert.equal(safeAccessLogValue('/api/posts/123', true), '/api/posts/123');
  assert.equal(safeAccessLogValue(undefined), '-');
  assert.equal(safeAccessLogValue('x\u0000y\u0085z'), 'xyz');
});
