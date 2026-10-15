import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from '../auth/auth.legacy-adapters';
import { backendRootPath } from '../legacy/legacy.paths';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const marketing = require(path.join(backendRootPath, 'services', 'marketingEmailService.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const User = require(path.join(backendRootPath, 'models', 'User.js'));
const router = Router();
const unsubscribeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/preferences', protect, async (req, res) => {
  const userId = (req as typeof req & { user?: { _id?: unknown } }).user?._id;
  const user = await User.findById(userId).select('emailPreferences.promotionalEnabled emailPreferences.marketingConsentAt').lean();
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ success: true, data: { promotionalEnabled: user?.emailPreferences?.promotionalEnabled === true, marketingConsentAt: user?.emailPreferences?.marketingConsentAt || null } });
});

router.put('/preferences', protect, async (req, res) => {
  if (typeof req.body?.promotionalEnabled !== 'boolean') return res.status(400).json({ success: false, message: 'promotionalEnabled must be a boolean' });
  try {
    const userId = (req as typeof req & { user?: { _id?: unknown } }).user?._id;
    const user = await marketing.setPromotionalPreference(userId, req.body.promotionalEnabled, 'web_preferences');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: { promotionalEnabled: user.emailPreferences?.promotionalEnabled === true } });
  } catch (error: unknown) {
    const status = (error as { statusCode?: number }).statusCode || 500;
    return res.status(status).json({ success: false, message: status === 503 ? 'Promotional email preferences are temporarily unavailable.' : 'Could not update email preferences.' });
  }
});

const unsubscribe = async (token: string) => {
  try { return await marketing.unsubscribeByToken(token); } catch { return false; }
};
router.get('/unsubscribe/:token', unsubscribeLimiter, async (req, res) => {
  await unsubscribe(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | SquadHunt</title></head><body style="font-family:Arial,sans-serif;max-width:500px;margin:60px auto;padding:20px"><h1>Promotional emails are turned off</h1><p>You will no longer receive promotional emails from SquadHunt. Essential account and security emails are unaffected.</p><p><a href="https://www.squadhunt.com/settings/notifications">Manage Email Preferences</a></p></body></html>');
});
router.post('/unsubscribe/:token', unsubscribeLimiter, async (req, res) => {
  await unsubscribe(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).end();
});

export default router;
