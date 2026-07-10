const assert = require('assert');
const mongoose = require('mongoose');
const { setRedisClient } = require('../utils/redisCache');
const { getCachedUser } = require('./auth');

// A cached user is JSON round-tripped through Redis, which turns `_id` into a
// plain string. Mongoose casts query filters but never aggregation pipelines,
// so a string `_id` reaching a `$match` stage matches zero documents instead of
// raising — silently emptying every owner-scoped listing (e.g. the recruitment
// page's "My Recruitments" tab) for the five minutes the cache entry lives.
const userId = new mongoose.Types.ObjectId();

const store = new Map();
setRedisClient({
  async get(key) { return store.get(key) ?? null; },
  async setEx(key, _ttl, value) { store.set(key, value); },
  async del() {}
});

(async () => {
  store.set(
    `auth:user:${userId}`,
    JSON.stringify({ _id: userId, username: 'squad', userType: 'team', isActive: true, password: 'secret' })
  );

  const cached = await getCachedUser(String(userId));

  assert(cached, 'a cache hit must resolve a user');
  assert(
    cached._id instanceof mongoose.Types.ObjectId,
    'a cache hit must rehydrate _id so aggregation $match stages still match'
  );
  assert.strictEqual(String(cached._id), String(userId));
  assert.strictEqual(cached.password, undefined, 'cached credentials must never leave the cache layer');

  console.log('Auth user-cache contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
