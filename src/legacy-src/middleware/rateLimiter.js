const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.default || rateLimitModule.rateLimit || rateLimitModule;
const { ipKeyGenerator } = rateLimitModule;
const { getRedisClient } = require('../utils/redisCache');

/**
 * Redis-backed rate limit store.
 * Falls back to in-memory when Redis is unavailable (dev / cold start).
 */
class RedisRateLimitStore {
  constructor(prefix = 'rl') {
    this.prefix = prefix;
    this.localMap = new Map(); // fallback
  }

  _key(k) { return `${this.prefix}:${k}`; }

  async increment(key) {
    const client = getRedisClient();
    if (!client) {
      // Fallback to in-memory
      const now = Date.now();
      const entry = this.localMap.get(key) || { count: 0, resetTime: now + this.windowMs };
      entry.count += 1;
      this.localMap.set(key, entry);
      return { totalHits: entry.count, resetTime: new Date(entry.resetTime) };
    }

    const redisKey = this._key(key);
    const multi = client.multi();
    multi.incr(redisKey);
    multi.pTTL(redisKey);
    const results = await multi.exec();
    const totalHits = results[0];
    const pttl = results[1];

    if (pttl === -1 || pttl === -2) {
      await client.pExpire(redisKey, this.windowMs);
    }

    const resetTime = new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs));
    return { totalHits, resetTime };
  }

  async decrement(key) {
    const client = getRedisClient();
    if (!client) {
      const entry = this.localMap.get(key);
      if (entry) entry.count = Math.max(0, entry.count - 1);
      return;
    }
    await client.decr(this._key(key));
  }

  async resetKey(key) {
    const client = getRedisClient();
    if (!client) {
      this.localMap.delete(key);
      return;
    }
    await client.del(this._key(key));
  }

  // Called by express-rate-limit to pass config
  init(options) {
    this.windowMs = options.windowMs;
  }
}

/**
 * AI Coach specific rate limiter
 * Prevents spam and abuse of AI API
 */
const aiCoachLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Max 10 requests per minute per user
  store: new RedisRateLimitStore('rl:ai'),
  message: {
    success: false,
    message: 'Too many requests. Please wait before sending more messages.',
    retryAfter: '1 minute'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers

  // Custom key generator (by user ID if available, otherwise by IP)
  keyGenerator: (req) => {
    return req.user?.id || ipKeyGenerator(req);
  },

  // Skip successful requests from the count (optional)
  skipSuccessfulRequests: false,

  // Skip failed requests from the count
  skipFailedRequests: false,

  // Handler for when limit is exceeded
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for user: ${req.user?.id || req.ip}`);

    // Get user's language for localized message
    const language = req.body?.language || 'english';

    const messages = {
      english: 'Too many requests. Please wait 1 minute before sending more messages. 🙏',
      roman_hindi: 'Bahut zyada messages bhej diye. Please 1 minute wait karo. 🙏',
      roman_marathi: 'Khup messages pathavle. Kripaya 1 minute thamba. 🙏',
      mixed: 'Too many requests. Please wait 1 minute. 🙏'
    };

    res.status(429).json({
      success: false,
      message: messages[language] || messages.english,
      retryAfter: 60, // seconds
      error: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

/**
 * Stricter rate limiter for analytics and heavy operations
 */
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Max 5 requests per minute
  store: new RedisRateLimitStore('rl:analytics'),
  message: {
    success: false,
    message: 'Too many analytics requests. Please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req)
});

/**
 * General API rate limiter (for all routes)
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per 15 minutes
  store: new RedisRateLimitStore('rl:general'),
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Auth rate limiter (for login/signup)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 auth attempts per 15 minutes
  store: new RedisRateLimitStore('rl:auth'),
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

module.exports = {
  aiCoachLimiter,
  analyticsLimiter,
  generalLimiter,
  authLimiter
};
