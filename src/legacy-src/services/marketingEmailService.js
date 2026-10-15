const { createHmac, createHash } = require('crypto');
const User = require('../models/User');
const { CANONICAL_PUBLIC_WEB_ORIGIN } = require('../utils/publicWebUrl');

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const tokenSecret = () => String(process.env.EMAIL_UNSUBSCRIBE_SECRET || '');
const usableSecret = () => tokenSecret().length >= 32 &&
  !/replace|example|placeholder/i.test(tokenSecret()) &&
  tokenSecret() !== process.env.JWT_SECRET &&
  tokenSecret() !== process.env.ADMIN_JWT_SECRET;
const marketingEnabled = () => process.env.PROMOTIONAL_EMAILS_ENABLED === 'true' && usableSecret();

const tokenForUser = (user) => {
  if (!usableSecret() || !user?._id || !user?.emailPreferences?.marketingConsentAt) return '';
  return createHmac('sha256', tokenSecret())
    .update(`${user._id}:${new Date(user.emailPreferences.marketingConsentAt).toISOString()}`)
    .digest('hex');
};
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const marketingEligibility = (user, now = new Date()) => Boolean(
  user &&
  user.isActive === true &&
  (user.moderationStatus === 'active' || user.moderationStatus == null) &&
  user.adminControls?.loginDisabled !== true &&
  user.userType !== 'system' &&
  user.isSystemAccount !== true &&
  user.email &&
  user.emailPreferences?.promotionalEnabled === true &&
  user.emailPreferences?.marketingConsentAt &&
  !user.emailPreferences?.withdrawnAt &&
  !user.emailPreferences?.suppressedAt &&
  user.lastSeen &&
  new Date(user.lastSeen).getTime() <= now.getTime() - FIVE_DAYS_MS
);

async function setPromotionalPreference(userId, enabled, source = 'web_preferences') {
  const now = new Date();
  if (enabled) {
    if (!usableSecret()) {
      const error = new Error('Promotional email enrollment is not available');
      error.statusCode = 503;
      throw error;
    }
    const user = await User.findById(userId).select('_id emailPreferences +emailPreferences.unsubscribeTokenHash');
    if (!user) return null;
    if (user.emailPreferences?.promotionalEnabled === true && user.emailPreferences?.marketingConsentAt && user.emailPreferences?.unsubscribeTokenHash) return user;
    const consentAt = now;
    const token = tokenForUser({ _id: user._id, emailPreferences: { marketingConsentAt: consentAt } });
    return User.findByIdAndUpdate(userId, { $set: {
      'emailPreferences.promotionalEnabled': true,
      'emailPreferences.marketingConsentAt': consentAt,
      'emailPreferences.consentSource': source,
      'emailPreferences.withdrawnAt': null,
      'emailPreferences.unsubscribeTokenHash': hashToken(token)
    } }, { new: true }).select('emailPreferences');
  }
  return User.findByIdAndUpdate(userId, { $set: {
    'emailPreferences.promotionalEnabled': false,
    'emailPreferences.withdrawnAt': now,
    'emailPreferences.unsubscribeTokenHash': null
  } }, { new: true }).select('emailPreferences');
}

async function unsubscribeByToken(rawToken) {
  const token = String(rawToken || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const update = await User.updateOne({ 'emailPreferences.unsubscribeTokenHash': hashToken(token) }, {
    $set: { 'emailPreferences.promotionalEnabled': false, 'emailPreferences.withdrawnAt': new Date() },
    $unset: { 'emailPreferences.unsubscribeTokenHash': 1 }
  });
  return update.matchedCount > 0;
}

const unsubscribeUrlForUser = (user) => {
  const token = tokenForUser(user);
  if (!token) return '';
  return `${CANONICAL_PUBLIC_WEB_ORIGIN}/api/email/unsubscribe/${token}`;
};

module.exports = { FIVE_DAYS_MS, marketingEnabled, marketingEligibility, tokenForUser, hashToken, setPromotionalPreference, unsubscribeByToken, unsubscribeUrlForUser };
