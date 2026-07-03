const assert = require('node:assert/strict');
const { _private } = require('./progressiveAuthLimiter');

const now = Date.now();
_private.localStore.clear();
for (let index = 0; index < 100; index += 1) {
  _private.localStore.set(`expired-${index}`, {
    fails: 1,
    blockedUntilMs: now - 1,
    lastFailAtMs: now - 3 * 60 * 60 * 1000,
    lastSeenAtMs: now - 3 * 60 * 60 * 1000
  });
}
_private.sweepLocalStore(now);
assert.equal(_private.localStore.size, 0);

for (let index = 0; index < _private.MAX_LOCAL_AUTH_ENTRIES + 25; index += 1) {
  _private.localStore.set(`active-${index}`, {
    fails: 1,
    blockedUntilMs: 0,
    lastFailAtMs: now,
    lastSeenAtMs: now
  });
}
_private.sweepLocalStore(now);
assert.equal(_private.localStore.size, _private.MAX_LOCAL_AUTH_ENTRIES);
_private.localStore.clear();

console.log('Progressive auth fallback memory-bound contracts passed');
