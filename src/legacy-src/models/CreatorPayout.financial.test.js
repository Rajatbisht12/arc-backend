const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const CreatorPayout = require('./CreatorPayout');
const CreatorPayoutHistory = require('./CreatorPayoutHistory');
const EarningsSnapshot = require('./EarningsSnapshot');

const userId = new mongoose.Types.ObjectId();
const cycleId = new mongoose.Types.ObjectId();

const payout = new CreatorPayout({
  user: userId,
  payoutCycle: cycleId,
  amount: 1250.75,
  amountMinor: 125075,
  currency: 'INR',
  status: 'paid',
  transactionId: 'txn_manual_001',
  bankReference: 'UTR000000001',
  paymentMethod: 'bank_transfer',
  paymentNotes: 'July creator payout',
  paymentDate: new Date('2026-07-07T10:00:00.000Z')
});
assert.equal(payout.validateSync(), undefined);
assert.equal(payout.transactionId, 'txn_manual_001');
assert.equal(payout.bankReference, 'UTR000000001');
assert.equal(payout.paymentMethod, 'bank_transfer');
assert.equal(payout.paymentNotes, 'July creator payout');
assert.equal(payout.paymentDate.toISOString(), '2026-07-07T10:00:00.000Z');
assert.equal(payout.amountMinor, 125075);
assert.equal(payout.currency, 'INR');
assert.equal(payout.version, 0);

const invalidMethod = new CreatorPayout({
  user: userId,
  payoutCycle: cycleId,
  amount: 100,
  paymentMethod: 'untrusted-provider'
});
assert.match(
  invalidMethod.validateSync()?.errors?.paymentMethod?.message || '',
  /not a valid enum value/i,
  'payment methods must be allow-listed by the server model'
);

const payoutIndexes = CreatorPayout.schema.indexes();
assert.ok(
  payoutIndexes.some(([keys, options]) => keys.user === 1 && keys.payoutCycle === 1 && options.unique),
  'one creator payout per creator/cycle must be enforced by a unique index'
);

for (const field of [
  'amountMinor',
  'currency',
  'breakdown.organicRevenue',
  'breakdown.bonusRevenue',
  'breakdown.referralRevenue',
  'breakdown.platformAdjustments',
  'breakdown.taxes',
  'breakdown.grossAmount',
  'breakdown.finalPayoutAmount'
]) {
  assert.ok(EarningsSnapshot.schema.path(field), `earnings snapshots must persist ${field}`);
}
assert.ok(
  payoutIndexes.some(([keys]) => keys.status === 1 && keys.paymentDate === -1),
  'financial reports need a status/payment-date index'
);

const history = new CreatorPayoutHistory({
  payout: payout._id,
  user: userId,
  payoutCycle: cycleId,
  action: 'paid',
  previousStatus: 'processing',
  newStatus: 'paid',
  amount: payout.amount,
  amountMinor: payout.amountMinor,
  currency: payout.currency,
  idempotencyKey: 'mark-paid:financial-test-001',
  payment: {
    transactionId: payout.transactionId,
    referenceNumber: payout.bankReference,
    method: payout.paymentMethod,
    notes: payout.paymentNotes,
    paymentDate: payout.paymentDate
  },
  actor: {
    actorKey: 'user:507f1f77bcf86cd799439011',
    user: new mongoose.Types.ObjectId(),
    username: 'finance-admin',
    role: 'super_admin'
  },
  reason: 'Manual transfer reconciled',
  ip: '203.0.113.10',
  userAgent: 'financial-regression-test'
});
assert.equal(history.validateSync(), undefined);
assert.equal(history.payment.referenceNumber, 'UTR000000001');
assert.equal(history.action, 'paid');
assert.equal(history.amountMinor, 125075);
assert.equal(history.currency, 'INR');

const immutableHooks = CreatorPayoutHistory.schema.s.hooks._pres;
for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'bulkWrite'
]) {
  assert.ok(immutableHooks.get(operation)?.length, `${operation} must be blocked for payout history`);
}
assert.ok(
  immutableHooks.get('deleteOne').some((hook) => hook.document === true && hook.query === false),
  'document.deleteOne must be blocked for immutable payout history'
);

const historyIndexes = CreatorPayoutHistory.schema.indexes();
assert.ok(
  historyIndexes.some(([keys]) => keys.payout === 1 && keys.createdAt === -1),
  'payout history must be efficiently queryable by payout'
);
assert.ok(
  historyIndexes.some(([keys]) => keys.user === 1 && keys.createdAt === -1),
  'payout history must be efficiently queryable by creator'
);
assert.ok(
  historyIndexes.some(([keys, options]) => keys.payout === 1 && keys.idempotencyKey === 1 && options.unique),
  'payout transition idempotency must be enforced by a unique index'
);

console.log('Creator payout financial model contracts passed');
