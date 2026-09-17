const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verifier = require('./appleSignedDataVerifier');
const ApplePurchaseIntent = require('../models/ApplePurchaseIntent');
const AppleNotificationReceipt = require('../models/AppleNotificationReceipt');
const PremiumMembership = require('../models/PremiumMembership');
const PaymentTransaction = require('../models/PaymentTransaction');
const { shouldIgnoreStaleSubscriptionEvent } = require('./appleIapService');

const root = path.resolve(__dirname, '../../..');
const serviceSource = fs.readFileSync(path.join(__dirname, 'appleIapService.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/modules/payments/payments.routes.ts'), 'utf8');

const intentTokenIndex = ApplePurchaseIntent.schema.indexes().find(
  ([keys, options]) => keys.appAccountToken === 1 && options.unique,
);
const intentTransactionIndex = ApplePurchaseIntent.schema.indexes().find(
  ([keys, options]) => keys.transactionId === 1 && options.unique,
);
const notificationIndex = AppleNotificationReceipt.schema.indexes().find(
  ([keys, options]) => keys.notificationUUID === 1 && options.unique,
);
const providerPaymentIndex = PaymentTransaction.schema.indexes().find(
  ([keys, options]) => keys.providerPaymentId === 1 && options.unique,
);

assert.ok(intentTokenIndex, 'appAccountToken ownership links must be unique');
assert.ok(intentTransactionIndex, 'an Apple transaction can only bind to one purchase intent');
assert.ok(notificationIndex, 'App Store notification UUIDs must be deduplicated');
assert.ok(providerPaymentIndex, 'provider transaction IDs must remain globally unique');
assert.ok(PremiumMembership.schema.path('source').enumValues.includes('apple_subscription'));
assert.ok(PaymentTransaction.schema.path('provider').enumValues.includes('apple'));

assert.match(serviceSource, /APPLE_PRODUCT_TYPE_MISMATCH/);
assert.match(serviceSource, /provider: 'apple', providerPaymentId: transactionId/);
assert.match(serviceSource, /status: 'processing',[\s\S]*processingAt/);
assert.match(serviceSource, /PROCESSING_LEASE_MS/);
assert.match(serviceSource, /prior\?\.status === 'failed'|prior\?\.status === 'completed'/);
assert.doesNotMatch(serviceSource, /signedPayload\s*:/, 'raw signed notifications must not be stored');
assert.match(serviceSource, /revokeBoostCampaign/, 'a refunded Boost must clear both campaign and post delivery state');
assert.match(serviceSource, /refundStatus: 'full', refundedAmount: amount/, 'revoked Apple transactions must update the payment ledger');

const currentMembership = {
  apple: { originalTransactionId: 'original-1', latestTransactionId: 'transaction-2' },
  providerLastEventAt: new Date('2026-09-16T12:00:00Z'),
  currentPeriodEnd: new Date('2026-11-16T12:00:00Z')
};
assert.equal(shouldIgnoreStaleSubscriptionEvent({
  membership: currentMembership,
  originalTransactionId: 'original-1',
  transactionId: 'transaction-1',
  expiresAt: new Date('2026-10-16T12:00:00Z'),
  eventAt: new Date('2026-09-16T11:00:00Z')
}), true, 'older Apple events must not roll back a newer membership');
assert.equal(shouldIgnoreStaleSubscriptionEvent({
  membership: currentMembership,
  originalTransactionId: 'original-1',
  transactionId: 'transaction-3',
  expiresAt: new Date('2026-12-16T12:00:00Z'),
  eventAt: new Date('2026-09-16T13:00:00Z')
}), false, 'a later renewal must advance the membership');

assert.match(routeSource, /router\.post\(\s*"\/apple\/notifications"/);
assert.match(routeSource, /router\.post\(\s*"\/apple\/transactions\/verify"[\s\S]*protect/);
assert.match(routeSource, /router\.post\(\s*"\/apple\/restore"[\s\S]*protect/);

const fakeSignedData = 'x'.repeat(120);
let receivedEnvironment = '';
verifier.setVerifierForTests({
  verifyTransaction: async (value, environment) => {
    assert.equal(value, fakeSignedData);
    receivedEnvironment = environment;
    return { transactionId: 'verified' };
  },
  verifyNotification: async () => ({ notificationUUID: 'notification' }),
  verifyRenewal: async () => ({ autoRenewStatus: 1 }),
});

(async () => {
  try {
    assert.deepEqual(await verifier.verifyTransaction(fakeSignedData, 'Sandbox'), { transactionId: 'verified' });
    assert.equal(receivedEnvironment, 'Sandbox');
    await assert.rejects(
      verifier.verifyTransaction('too-short', 'Sandbox'),
      (error) => error.code === 'INVALID_APPLE_SIGNED_DATA',
    );
    console.log('Apple IAP security tests passed');
  } finally {
    verifier.resetVerifierForTests();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
