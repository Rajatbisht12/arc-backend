const assert = require('node:assert/strict');

const controller = require('./adminMonetizationController');
const payoutService = require('../services/CreatorPayoutAdminService');

const { appendCreatorSearch, buildCreatorBaseQuery, parseRange, spreadsheetSafe, makePdf } = controller.__testables;
const { normalizeManualPaymentInput, toMinor, fromMinor } = payoutService.__testables;

assert.equal(toMinor(12.345), 1235);
assert.equal(toMinor(-50), 0);
assert.equal(toMinor('19.99'), 1999);
assert.equal(fromMinor(1235), 12.35);
assert.equal(fromMinor(-1), 0);

const payout = { createdAt: new Date('2026-07-01T00:00:00.000Z') };
const payment = normalizeManualPaymentInput({
  transactionId: '  txn_001  ',
  referenceNumber: '  UTR-001  ',
  paymentMethod: 'BANK_TRANSFER',
  notes: '  Reconciled against statement  ',
  paymentDate: '2026-07-07T10:00:00.000Z'
}, payout);
assert.equal(payment.transactionId, 'txn_001');
assert.equal(payment.referenceNumber, 'UTR-001');
assert.equal(payment.paymentMethod, 'bank_transfer');
assert.equal(payment.notes, 'Reconciled against statement');
assert.equal(payment.paymentDate.toISOString(), '2026-07-07T10:00:00.000Z');

assert.throws(
  () => normalizeManualPaymentInput({ paymentMethod: 'bank_transfer', paymentDate: '2026-07-07' }, payout),
  (error) => error.statusCode === 422 && error.code === 'REFERENCE_NUMBER_REQUIRED'
);
assert.throws(
  () => normalizeManualPaymentInput({ referenceNumber: 'UTR-2', paymentMethod: 'crypto', paymentDate: '2026-07-07' }, payout),
  (error) => error.statusCode === 422 && error.code === 'PAYMENT_METHOD_REQUIRED'
);
assert.throws(
  () => normalizeManualPaymentInput({ referenceNumber: 'UTR-3', paymentMethod: 'bank_transfer', paymentDate: 'not-a-date' }, payout),
  (error) => error.statusCode === 422 && error.code === 'INVALID_PAYMENT_DATE'
);
assert.throws(
  () => normalizeManualPaymentInput({ referenceNumber: 'UTR-4', paymentMethod: 'bank_transfer', paymentDate: '2026-06-30T23:59:59.999Z' }, payout),
  (error) => error.statusCode === 422 && error.code === 'INVALID_PAYMENT_DATE'
);

for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
  const unsafe = `${prefix}SUM(1,1)`;
  assert.equal(spreadsheetSafe(unsafe), `'${unsafe}`, `spreadsheet prefix ${JSON.stringify(prefix)} must be neutralized`);
}
assert.equal(spreadsheetSafe('creator@example.com'), 'creator@example.com');
assert.equal(spreadsheetSafe(null), '');

const sevenDays = parseRange({ range: '7d', to: '2026-07-07' });
assert.equal(sevenDays.range, '7d');
assert.equal(sevenDays.end.toISOString(), '2026-07-07T23:59:59.999Z');
assert.equal((sevenDays.end.getTime() - sevenDays.start.getTime()) / 86_400_000, 6);

const reversedCustom = parseRange({
  range: 'custom',
  from: '2026-07-07T00:00:00.000Z',
  to: '2026-07-01T00:00:00.000Z'
});
assert.equal(reversedCustom.range, 'custom');
assert.ok(reversedCustom.start <= reversedCustom.end, 'reversed custom dates must be normalized');

const bounded = parseRange({ range: 'custom', from: '2020-01-01', to: '2026-07-07' });
assert.ok(
  bounded.end.getTime() - bounded.start.getTime() <= 366 * 86_400_000,
  'custom financial reports must have a bounded time range'
);

const pdf = makePdf(['Creator Payout Statement', '(escaped) \\ value', '₹123.45']);
assert.ok(Buffer.isBuffer(pdf));
assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
assert.ok(pdf.toString().endsWith('%%EOF'));
assert.ok(pdf.length > 300);

const allCreatorStates = buildCreatorBaseQuery({});
assert.equal(allCreatorStates.isCreator, undefined);
assert.deepEqual(allCreatorStates.$or, [
  { isCreator: true },
  { creatorMonetizationStatus: { $in: ['eligible', 'pending', 'approved', 'rejected', 'suspended', 'disabled', 'withdrawn'] } }
]);
const suspendedCreators = buildCreatorBaseQuery({ status: 'suspended' });
assert.equal(suspendedCreators.creatorMonetizationStatus, 'suspended');
assert.equal(suspendedCreators.$or, undefined, 'status filters must include creators whose active isCreator flag was cleared');
assert.throws(
  () => buildCreatorBaseQuery({ status: '$ne' }),
  (error) => error.statusCode === 400 && error.code === 'INVALID_CREATOR_STATUS'
);
appendCreatorSearch(allCreatorStates, [{ username: /creator/i }]);
assert.equal(allCreatorStates.$or, undefined);
assert.equal(allCreatorStates.$and.length, 2, 'search must intersect with creator scope instead of replacing it');

console.log('Admin monetization input, date-range, export, and money helper tests passed');
