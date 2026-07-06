'use strict';

/**
 * WebRTC ICE / TURN routes.
 *
 *   GET    /api/rtc/ice                  → ICE config for a WebRTC client (auth)
 *   GET    /api/rtc/usage/:username      → total relayed GB for a credential (admin)
 *   GET    /api/rtc/usage                → daily usage per user, paginated (admin)
 *   GET    /api/rtc/credentials          → list credentials (admin)
 *   DELETE /api/rtc/credentials/:username→ revoke a credential (admin)
 *
 * Credentials are minted via Metered with a 24h auto-expiry and rotated before
 * they lapse. The Metered secret key stays server-side; clients only receive the
 * ephemeral iceServers array.
 */

const express = require('express');
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const log = require('../utils/logger');
const { TurnService, FALLBACK_ICE } = require('../services/turnCredentialService');

// Initialise the Metered-backed service once. If env is absent, /ice still works
// by serving STUN + OpenRelay fallback so calling never hard-fails.
let turnService = null;
try {
  if (process.env.METERED_APP_NAME && process.env.METERED_SECRET_KEY) {
    turnService = new TurnService({
      appName: process.env.METERED_APP_NAME,
      secretKey: process.env.METERED_SECRET_KEY,
      rotateMarginSeconds: Number(process.env.TURN_ROTATE_MARGIN_SECONDS || 3600),
      logger: log,
    });
    turnService.startUsageMonitor({
      intervalMinutes: Number(process.env.TURN_USAGE_MONITOR_MINUTES || 15),
    });
    log.info?.('[rtc] Metered TURN service initialised');
  } else {
    log.warn?.('[rtc] METERED_APP_NAME/METERED_SECRET_KEY not set; /api/rtc/ice serves STUN + OpenRelay fallback only');
  }
} catch (err) {
  log.error?.('[rtc] Failed to initialise Metered TURN service', { error: String(err) });
  turnService = null;
}

const iceLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || 'authenticated'),
  message: { success: false, message: 'Too many ICE requests. Try again shortly.' },
});

const ensureConfigured = (req, res, next) => {
  if (!turnService) {
    return res.status(503).json({ success: false, message: 'TURN service is not configured' });
  }
  next();
};

const handleAdminError = (res, err, code) =>
  res.status(err?.status || 502).json({
    success: false,
    message: code,
    detail: err?.body || err?.message,
  });

// ── ICE config for WebRTC clients ──
router.get('/ice', protect, iceLimiter, async (req, res) => {
  // Let clients refetch every few minutes so a rotation is picked up promptly.
  res.set('Cache-Control', 'private, max-age=300');
  if (!turnService) {
    return res.json({ iceServers: FALLBACK_ICE, source: 'fallback' });
  }
  const result = await turnService.getIceServers(); // never throws — falls back internally
  return res.json(result);
});

// ── Usage / credential management (admin) ──
router.get('/usage/:username', protect, requireAdmin, ensureConfigured, async (req, res) => {
  try {
    res.json(await turnService.usageForUser(req.params.username));
  } catch (err) {
    handleAdminError(res, err, 'usage_lookup_failed');
  }
});

router.get('/usage', protect, requireAdmin, ensureConfigured, async (req, res) => {
  try {
    const { startDate, endDate, page } = req.query;
    res.json(await turnService.dailyUsage({ startDate, endDate, page }));
  } catch (err) {
    handleAdminError(res, err, 'usage_lookup_failed');
  }
});

router.get('/credentials', protect, requireAdmin, ensureConfigured, async (req, res) => {
  try {
    const { all, page, label } = req.query;
    res.json(await turnService.listCredentials({ all, page, label }));
  } catch (err) {
    handleAdminError(res, err, 'list_failed');
  }
});

router.delete('/credentials/:username', protect, requireAdmin, ensureConfigured, async (req, res) => {
  try {
    res.json(await turnService.deleteCredential(req.params.username));
  } catch (err) {
    handleAdminError(res, err, 'delete_failed');
  }
});

module.exports = router;
