const assert = require('node:assert/strict');
const { _RedisRateLimitStore } = require('./rateLimiter');

const run = async () => {
  const store = new _RedisRateLimitStore('test');
  store.init({ windowMs: 60_000 });
  store.localMap.set('client', { count: 500, resetTime: Date.now() - 1 });
  const result = await store.increment('client');
  assert.equal(result.totalHits, 1, 'Expired fallback windows must reset instead of throttling forever');
  assert.ok(result.resetTime.getTime() > Date.now());

  for (let index = 0; index < 100; index += 1) {
    store.localMap.set(`expired-${index}`, { count: 1, resetTime: Date.now() - 1 });
  }
  store.localOperations = 255;
  await store.increment('active-client');
  assert.equal(
    [...store.localMap.keys()].some((key) => key.startsWith('expired-')),
    false,
    'Expired fallback entries must be swept to prevent memory growth during Redis outages'
  );
  console.log('Rate limiter fallback-window contract passed');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
