const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  EMAIL_INTENTS,
  ALLOWED_EMAIL_EVENTS,
  evaluateEmailPolicy,
  evaluateNotificationEmailPolicy
} = require('./notificationChannelPolicy');

const approvedEmailEvents = [
  [EMAIL_INTENTS.ACCOUNT_LIFECYCLE, 'monetization_approved'],
  [EMAIL_INTENTS.PAYMENT_TRANSACTIONAL, 'payout_generated'],
  [EMAIL_INTENTS.PAYMENT_TRANSACTIONAL, 'payout_paid'],
  [EMAIL_INTENTS.PAYMENT_TRANSACTIONAL, 'payout_failed']
];

for (const [intent, eventType] of approvedEmailEvents) {
  const decision = evaluateEmailPolicy({ intent, eventType });
  assert.equal(decision.allowed, true, `${eventType} must be explicitly email-enabled`);
  assert.equal(decision.reason, 'explicit_transactional_event');
}

const routineMonetizationEvents = [
  'monetization_rejected',
  'monetization_suspended',
  'monetization_reactivated',
  'payout_approved',
  'payout_processing',
  'payout_held',
  'payout_hold_released',
  'payout_rejected',
  'payout_cancelled',
  'withdrawal_approved',
  'withdrawal_rejected',
  'withdrawal_paid',
  'withdrawal_failed',
  'creator_analytics_updated'
];

for (const eventType of routineMonetizationEvents) {
  const decision = evaluateEmailPolicy({
    intent: EMAIL_INTENTS.PAYMENT_TRANSACTIONAL,
    eventType
  });
  assert.equal(decision.allowed, false, `${eventType} must remain in-app/push only`);
}

assert.deepEqual(
  ALLOWED_EMAIL_EVENTS[EMAIL_INTENTS.PAYMENT_TRANSACTIONAL].filter((event) => event.startsWith('payout_')),
  ['payout_generated', 'payout_paid', 'payout_failed'],
  'creator payout email allow-list must contain exactly generated, paid, and failed'
);

const notificationDecision = evaluateNotificationEmailPolicy({
  type: 'system',
  data: { type: 'payout_paid' },
  email: {
    intent: EMAIL_INTENTS.PAYMENT_TRANSACTIONAL,
    eventType: 'payout_paid'
  }
});
assert.equal(notificationDecision.allowed, true);

const spoofedIntent = evaluateEmailPolicy({
  intent: EMAIL_INTENTS.PLATFORM_CRITICAL,
  eventType: 'payout_paid'
});
assert.equal(spoofedIntent.allowed, false, 'a valid event cannot be paired with a broader incorrect intent');

const backendRoot = path.resolve(__dirname, '../../..');
const payoutService = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/services/CreatorPayoutAdminService.js'), 'utf8');
const cycleService = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/services/CreatorEarningsCalculationService.js'), 'utf8');
const adminController = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/controllers/adminController.js'), 'utf8');
assert.ok(payoutService.includes("const emailActions = new Set(['generated', 'paid', 'failed'])"));
assert.ok(payoutService.includes('paymentEmail(`payout_${action}`)'));
assert.ok(cycleService.includes("payoutEmail('payout_generated')"));
const monetizationApprovalBlock = adminController.slice(
  adminController.indexOf('const approveMonetizationApplication'),
  adminController.indexOf('const rejectMonetizationApplication')
);
assert.ok(
  monetizationApprovalBlock.includes("notificationEmail(EMAIL_INTENTS.ACCOUNT_LIFECYCLE, 'monetization_approved')"),
  'monetization approval must explicitly opt into its allowed transactional email'
);

console.log('Creator monetization email channel policy tests passed');
