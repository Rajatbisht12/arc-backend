const { getJson, setJson, del } = require('../utils/redisCache');

function toSafeLower(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function getClientIp(req) {
  // express req.ip already respects "trust proxy" if enabled; keep simple.
  return (req.ip || '').toString();
}

function getIdentifier(req, kind) {
  if (kind === 'otp') return toSafeLower(req.body?.email);
  // kind === 'password'
  return toSafeLower(req.body?.email || req.body?.username);
}

function computeCooldownSeconds(fails) {
  if (fails <= 5) return 0;          // 5 free attempts before any lock
  if (fails <= 8) return 30;         // 6-8  failures → 30 sec
  if (fails <= 12) return 2 * 60;    // 9-12 failures → 2 min
  if (fails <= 16) return 10 * 60;   // 13-16 failures → 10 min
  if (fails <= 20) return 30 * 60;   // 17-20 failures → 30 min
  return 60 * 60;                    // 21+  failures → 60 min
}

// In-memory fallback when Redis is unavailable
const localStore = new Map();

/**
 * Get entry from Redis (or local fallback).
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
async function getEntry(key) {
  const redisEntry = await getJson(`pal:${key}`);
  if (redisEntry) return redisEntry;
  return localStore.get(key) || null;
}

/**
 * Set entry in Redis (and local fallback).
 * @param {string} key
 * @param {Object} entry
 */
async function setEntry(key, entry) {
  localStore.set(key, entry);
  // TTL = remaining block time + 1 hour buffer so entries auto-expire after block lifts.
  // Minimum 1 hour so short-block state doesn't persist for a full day.
  const blockRemainingMs = Math.max(0, (entry.blockedUntilMs || 0) - Date.now());
  const ttlSec = Math.ceil(blockRemainingMs / 1000) + 60 * 60;
  await setJson(`pal:${key}`, entry, ttlSec);
}

/**
 * Delete entry from Redis and local.
 * @param {string} key
 */
async function delEntry(key) {
  localStore.delete(key);
  await del(`pal:${key}`);
}

function createProgressiveAuthLimiter(options) {
  const kind = options?.kind || 'password'; // 'password' | 'otp'
  const name = options?.name || 'auth';

  return async function progressiveAuthLimiter(req, res, next) {
    const nowMs = Date.now();

    const ip = getClientIp(req);
    const identifier = getIdentifier(req, kind);
    const key = `${name}|${ip}|${identifier || 'no_identifier'}`;

    let entry = await getEntry(key);

    // If a previous block has now expired, decay the fail count so the user
    // gets a partial reset rather than immediately hitting the next threshold.
    if (entry?.blockedUntilMs && entry.blockedUntilMs <= nowMs && entry.blockedUntilMs > 0) {
      entry.fails = Math.max(0, entry.fails - 3);
      entry.blockedUntilMs = 0;
      await setEntry(key, entry);
    }

    if (entry?.blockedUntilMs && entry.blockedUntilMs > nowMs) {
      // Important UX/security behavior:
      // Even during cooldown, allow a "correct password" login to go through (genuine user),
      // but keep blocking wrong-password attempts.
      if (kind === 'password' && identifier && req.body?.password) {
        try {
          const User = require('../models/User');
          const looksLikeEmail = identifier.includes('@');
          const query = looksLikeEmail ? { email: identifier } : { username: identifier };
          const user = await User.findOne(query).select('+password');
          const ok = user && (await user.comparePassword(req.body.password));
          if (ok) {
            // Clear counters and let the request proceed.
            await delEntry(key);
            return next();
          }
        } catch (_) {
          // If credential precheck fails (db transient), don't hard-lock a genuine user.
          // Let controller decide.
          return next();
        }
      }

      const retryAfterSec = Math.max(1, Math.ceil((entry.blockedUntilMs - nowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please try again after ${retryAfterSec} seconds.`,
        retryAfter: retryAfterSec
      });
    }

    // Track outcome after controller runs.
    res.on('finish', async () => {
      try {
        const status = res.statusCode;
        const current = (await getEntry(key)) || {
          fails: 0,
          blockedUntilMs: 0,
          lastFailAtMs: 0,
          lastSeenAtMs: 0
        };
        current.lastSeenAtMs = Date.now();

        const isSuccess = status >= 200 && status < 300;
        const isFailure =
          (kind === 'password' && status === 401) || // invalid credentials
          (kind === 'otp' && (status === 400 || status === 401)); // invalid/expired OTP or deactivated

        if (isSuccess) {
          // Successful auth should reset counters (no punishment for genuine users).
          await delEntry(key);
          return;
        }

        if (!isFailure) {
          // Don't count validation errors or other failures by default.
          await setEntry(key, current);
          return;
        }

        current.fails += 1;
        current.lastFailAtMs = Date.now();
        const cooldownSec = computeCooldownSeconds(current.fails);
        if (cooldownSec > 0) {
          current.blockedUntilMs = Date.now() + cooldownSec * 1000;
        }
        await setEntry(key, current);
      } catch (err) {
        // Best-effort tracking; don't crash the response
        console.error('Progressive auth limiter tracking error:', err.message);
      }
    });

    return next();
  };
}

module.exports = {
  progressiveLoginLimiter: createProgressiveAuthLimiter({ kind: 'password', name: 'login' }),
  progressiveOtpLoginLimiter: createProgressiveAuthLimiter({ kind: 'otp', name: 'otp_login' })
};
