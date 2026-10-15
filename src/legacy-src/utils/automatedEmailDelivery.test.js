const assert = require('node:assert/strict');
const { test } = require('node:test');
const User = require('../models/User');
const marketing = require('../services/marketingEmailService');

const sent = [];
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath, filename: nodemailerPath, loaded: true,
  exports: { createTransport: () => ({ sendMail: async (message) => { sent.push(message); return { messageId: 'test-message' }; } }) },
  children: [], paths: []
};
const environment = Object.fromEntries(['SMTP_USER', 'SMTP_PASS', 'PROMOTIONAL_EMAILS_ENABLED', 'EMAIL_UNSUBSCRIBE_SECRET'].map((key) => [key, process.env[key]]));
process.env.SMTP_USER = 'noreply@example.test';
process.env.SMTP_PASS = 'test-only-password';
process.env.PROMOTIONAL_EMAILS_ENABLED = 'true';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-secret-of-more-than-32-characters';

const user = {
  _id: '507f1f77bcf86cd799439011', email: 'member@example.test', isActive: true,
  moderationStatus: 'active', userType: 'player', lastSeen: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
  emailPreferences: { promotionalEnabled: true, marketingConsentAt: new Date('2026-10-01T00:00:00.000Z'), withdrawnAt: null, suppressedAt: null }
};
user.emailPreferences.unsubscribeTokenHash = marketing.hashToken(marketing.tokenForUser(user));
const originalFindById = User.findById;
User.findById = () => ({ select: async () => user });
const { sendAutomatedEmail } = require('./email');

test('marketing email rechecks consent and uses one-click headers', async () => {
  const result = await sendAutomatedEmail(user.email, 'inactive_user_reengagement', { userId: user._id, firstName: 'Ava' });
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(sent[0].list.unsubscribe, /^https:\/\/www\.squadhunt\.com\/api\/email\/unsubscribe\/[a-f0-9]{64}$/);
  assert.match(sent[0].html, /Manage Email Preferences/);
  assert.match(sent[0].text, /Flat No\. 5, Madhuvanti Housing Society/);
  user.emailPreferences.promotionalEnabled = false;
  const blocked = await sendAutomatedEmail(user.email, 'inactive_user_reengagement', { userId: user._id });
  assert.equal(blocked.blocked, true);
  assert.equal(sent.length, 1);
});

test('transactional mail has no promotional headers', async () => {
  const result = await sendAutomatedEmail(user.email, 'password_reset_confirmation', { firstName: 'Ava' });
  assert.equal(result.sent, true);
  assert.equal(sent.at(-1).headers, undefined);
  assert.equal(sent.at(-1).list, undefined);
});

process.on('exit', () => {
  User.findById = originalFindById;
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
