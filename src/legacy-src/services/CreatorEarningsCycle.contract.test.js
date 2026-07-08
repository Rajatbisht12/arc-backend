const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PayoutCycle = require('../models/PayoutCycle');

const serviceSource = fs.readFileSync(path.join(__dirname, 'CreatorEarningsCalculationService.js'), 'utf8');
const cronSource = fs.readFileSync(path.join(__dirname, '../jobs/payoutCron.js'), 'utf8');

assert.deepEqual(
  PayoutCycle.schema.path('status').options.enum,
  ['open', 'closing', 'closed', 'paid'],
  'payout cycles need an explicit crash-recoverable closing state'
);
assert.equal(PayoutCycle.schema.path('closeLeaseKey').options.select, false, 'lease keys must not leak in normal API projections');
for (const field of [
  'closeLeaseExpiresAt',
  'closeStartedAt',
  'closeLastAttemptAt',
  'closeAttemptCount',
  'earningsFinalizedAt',
  'closeCompletedAt',
  'closeLastError'
]) {
  assert.ok(PayoutCycle.schema.path(field), `payout cycle must persist ${field}`);
}

assert.ok(serviceSource.includes('acquireCycleCloseLease'));
assert.ok(serviceSource.includes('renewCycleCloseLease'));
assert.ok(serviceSource.includes("status: 'closing'"));
assert.ok(serviceSource.includes('closeLeaseKey: leaseKey'));
assert.ok(serviceSource.includes('closeLeaseExpiresAt: { $lte: now }'), 'expired close leases must be reclaimable');
assert.ok(serviceSource.includes('payoutExecutedAt: null'), 'completed cycles must not be claimed again');
assert.ok(serviceSource.includes(".select('+closeLeaseKey')"), 'earnings calculation must verify lease ownership');

assert.ok(serviceSource.includes('const snapshotFinancialFields'));
assert.ok(serviceSource.includes('amountMinor: toMinorUnits(finalAmount)'));
assert.ok(serviceSource.includes("currency: 'INR'"));
for (const field of ['organicRevenue', 'bonusRevenue', 'referralRevenue', 'platformAdjustments', 'taxes', 'grossAmount', 'finalPayoutAmount']) {
  assert.ok(serviceSource.includes(field), `earnings snapshots must disclose ${field}`);
}
assert.ok(
  serviceSource.includes('platformAdjustments: Math.round((finalAmount - grossAmount) * 100) / 100'),
  'a payout cap must remain visible as an auditable negative adjustment'
);

assert.ok(serviceSource.includes(".select('_id disbursementReservedAt disbursementId')"));
assert.ok(
  serviceSource.includes('if (existing?.disbursementReservedAt || existing?.disbursementId)'),
  'a recalculation must not overwrite an already-reserved snapshot'
);
assert.ok(
  serviceSource.includes('{ _id: existing._id, disbursementReservedAt: null, disbursementId: null }'),
  'snapshot updates need a reservation compare-and-swap filter'
);

assert.ok(serviceSource.includes("type: 'payout_generated'"));
assert.ok(serviceSource.includes("payoutEmail('payout_generated')"));
assert.ok(
  serviceSource.includes('notificationDedupeKey: `creator-payout-generated:${String(payout._id)}`'),
  'payout-generated notifications need a stable per-payout dedupe key'
);

assert.ok(
  cronSource.includes("cron.schedule('0 3 * * *'"),
  'cycle close must retry daily so a failed first-of-month run is recoverable'
);
assert.ok(!cronSource.includes("cron.schedule('0 3 1 * *'"));

console.log('Creator earnings cycle lease, reservation, and notification contracts passed');
