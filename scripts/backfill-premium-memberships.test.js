const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const backfill = require('./backfill-premium-memberships');

const objectId = () => new mongoose.Types.ObjectId();
const user = (overrides = {}) => ({
  _id: objectId(),
  userType: 'player',
  isPremium: true,
  membership: { tier: 'player_pro', validUntil: null },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

assert.deepEqual(backfill.parseOptions([]), {
  apply: false,
  after: '',
  limit: 500,
  help: false,
});
assert.equal(backfill.parseOptions(['--apply', '--limit=25']).apply, true);
assert.throws(() => backfill.parseOptions(['--limit=0']), /between 1 and/);
assert.throws(() => backfill.parseOptions(['--limit=5001']), /between 1 and/);
assert.throws(() => backfill.parseOptions(['--after=not-an-object-id']), /ObjectId/);

const transactions = [
  { _id: objectId(), type: 'subscription', status: 'completed', paidAt: new Date('2026-04-01T00:00:00.000Z') },
  { _id: objectId(), type: 'subscription', status: 'failed', paidAt: new Date('2026-06-01T00:00:00.000Z') },
  { _id: objectId(), type: 'subscription', status: 'pending', paidAt: new Date('2026-07-01T00:00:00.000Z') },
];
assert.equal(backfill.selectLatestSuccessful(transactions), transactions[0], 'failed and pending payments cannot become purchaser evidence');
assert.equal(backfill.selectLatestSuccessful(transactions.slice(1)), null, 'failed/pending-only history must not select entitlement evidence');
assert.equal(backfill.isSuccessfulPayment({ status: 'completed' }), true);
assert.equal(backfill.isSuccessfulPayment({ status: 'refunded' }), true);
assert.equal(backfill.isSuccessfulPayment({ status: 'pending' }), false);

const ambiguous = backfill.buildMembershipValues({
  user: user(),
  existing: null,
  latestSuccessful: null,
  now: new Date('2026-07-01T00:00:00.000Z'),
});
assert.equal(ambiguous.billingPeriod, 'monthly', 'ambiguous legacy flags must not infer lifetime access');
assert.equal(ambiguous.membershipStatus, 'expired');
assert.equal(ambiguous.expiresAt.toISOString(), '2026-02-01T00:00:00.000Z');

const refunded = backfill.buildMembershipValues({
  user: user(),
  existing: null,
  latestSuccessful: {
    _id: objectId(),
    status: 'refunded',
    amount: 499,
    currency: 'INR',
    paidAt: new Date('2026-06-01T00:00:00.000Z'),
    metadata: { planKey: 'player_pro', billingPeriod: 'monthly' },
  },
  now: new Date('2026-06-15T00:00:00.000Z'),
});
assert.equal(refunded.membershipStatus, 'refunded');
assert.ok(refunded.expiresAt, 'inactive/refunded records must retain a finite audit period');

const membershipId = objectId();
const legacyTransaction = {
  _id: objectId(),
  status: 'completed',
  amount: 499,
  capturedAmount: 0,
  provider: 'razorpay',
  paymentId: 'pay_legacy123',
  orderId: 'order_legacy123',
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};
const normalized = backfill.transactionNormalization(legacyTransaction, membershipId).$set;
assert.equal(normalized.provider, 'razorpay');
assert.equal(normalized.providerPaymentId, 'pay_legacy123');
assert.equal(normalized.providerOrderId, 'order_legacy123');
assert.equal(normalized.capturedAmount, 499);
assert.equal(String(normalized.membership), String(membershipId));
assert.equal(normalized.paidAt.toISOString(), '2026-05-01T00:00:00.000Z');

const unproven = backfill.transactionNormalization({
  _id: objectId(),
  status: 'completed',
  amount: 100,
  provider: 'razorpay',
  paymentId: 'legacy-random-id',
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
}, null).$set;
assert.equal(unproven.provider, 'unknown', 'Razorpay provider attribution requires a proven provider ID prefix');
assert.equal(unproven.providerPaymentId, undefined);

const source = fs.readFileSync(path.join(__dirname, 'backfill-premium-memberships.js'), 'utf8');
assert.equal(source.includes('.distinct('), false, 'backfill must not materialize global distinct user ID arrays');
assert.equal(source.includes('paymentUserIds'), false, 'backfill must advance through bounded user cursors');
assert.ok(source.includes('autoIndex: false') && source.includes('autoCreate: false'), 'dry-run connections must not implicitly create indexes or collections');
assert.ok(source.includes('if (!options.apply) continue'), 'transaction writes must remain behind the apply gate');
assert.ok(source.includes('nextCursor') && source.includes('--after='), 'backfill must report and accept a resume cursor');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const variable of [
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_PREMIUM_PLAN_IDS',
  'RAZORPAY_PLAN_PLAYER_PRO_MONTHLY',
  'RAZORPAY_PLAN_TEAM_ORG_YEARLY',
  'PREMIUM_LIFECYCLE_JOB_ENABLED',
  'PREMIUM_LIFECYCLE_CRON',
  'PREMIUM_LIFECYCLE_BATCH_SIZE',
  'PREMIUM_PROVIDER_RECONCILIATION_ENABLED',
]) assert.ok(env.includes(`${variable}=`), `.env.example must document ${variable}`);

const operations = fs.readFileSync(path.join(root, 'src', 'modules', 'admin', 'PREMIUM_MEMBERSHIPS.md'), 'utf8');
for (const event of ['payment.captured', 'payment.failed', 'subscription.charged', 'refund.processed', 'refund.failed']) {
  assert.ok(operations.includes(event), `premium operations docs must list ${event}`);
}
assert.ok(operations.includes('--after=<ObjectId>') && operations.includes('nextCursor'));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const testFile of [
  'premiumMembershipService.test.js',
  'premiumMembership.security.test.js',
  'premiumMembership.models.security.test.js',
  'premiumMembershipService.security.test.js',
  'backfill-premium-memberships.test.js',
]) assert.ok(packageJson.scripts['test:premium'].includes(testFile), `test:premium must run ${testFile}`);
assert.ok(packageJson.scripts['test:premium'].includes('node --check scripts/migrate-premium-indexes.js'));
assert.ok(packageJson.scripts['test:premium'].includes('node --check scripts/backfill-premium-memberships.js'));

console.log('Premium membership backfill safety tests passed');
