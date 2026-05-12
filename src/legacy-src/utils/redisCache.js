/**
 * Redis Cache Bridge
 * ------------------
 * Provides a shared Redis client to all legacy JS code.
 * The client is injected from the TypeScript server bootstrap via setRedisClient().
 *
 * Why a bridge?  Legacy JS cannot `require()` TypeScript modules directly.
 * The modular-backend's server.ts calls setRedisClient() once at startup.
 */

let _client = null;

/**
 * Inject the connected Redis client from TypeScript land.
 * @param {import('redis').RedisClientType} client
 */
const setRedisClient = (client) => {
  _client = client;
};

/** @returns {import('redis').RedisClientType | null} */
const getRedisClient = () => _client;

/**
 * GET a JSON-serialised value.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
const getJson = async (key) => {
  if (!_client) return null;
  try {
    const raw = await _client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * SET a JSON value with TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - default 300 (5 min)
 */
const setJson = async (key, value, ttlSeconds = 300) => {
  if (!_client) return;
  try {
    await _client.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Swallow – caching is best-effort
  }
};

/**
 * DEL one or more keys.
 * @param  {...string} keys
 */
const del = async (...keys) => {
  if (!_client || keys.length === 0) return;
  try {
    await _client.del(keys);
  } catch {
    // Swallow
  }
};

/**
 * INCREMENT a key and set expiry atomically (for rate limiting).
 * @param {string} key
 * @param {number} windowSeconds
 * @returns {Promise<{count: number, ttl: number}>}
 */
const increment = async (key, windowSeconds) => {
  if (!_client) return { count: 0, ttl: 0 };
  try {
    const multi = _client.multi();
    multi.incr(key);
    multi.ttl(key);
    const results = await multi.exec();
    const count = results[0];
    const ttl = results[1];

    // If the key was just created (ttl === -1), set expiry
    if (ttl === -1) {
      await _client.expire(key, windowSeconds);
    }

    return { count, ttl: ttl === -1 ? windowSeconds : ttl };
  } catch {
    return { count: 0, ttl: 0 };
  }
};

module.exports = {
  setRedisClient,
  getRedisClient,
  getJson,
  setJson,
  del,
  increment
};
