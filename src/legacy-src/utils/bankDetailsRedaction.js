const maskEmail = (value) => {
  const [local = '', domain = ''] = String(value || '').split('@');
  return local && domain
    ? `${local.slice(0, 1)}${'*'.repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`
    : '';
};

const maskPaymentAddress = (value) => {
  const [local = '', handle = ''] = String(value || '').split('@');
  return local && handle ? `${local.slice(0, 1)}***@${handle}` : '';
};

const maskIdentifier = (value) => value ? `•••• ${String(value).slice(-4)}` : '';

const MASKED_FIELDS = new Map([
  ['accountnumber', maskIdentifier],
  ['bankaccountnumber', maskIdentifier],
  ['beneficiaryaccountnumber', maskIdentifier],
  ['accountno', maskIdentifier],
  ['accountnumberconfirm', maskIdentifier],
  ['confirmaccountnumber', maskIdentifier],
  ['iban', maskIdentifier],
  ['routingnumber', maskIdentifier],
  ['upiid', maskPaymentAddress],
  ['paypalemail', maskEmail],
  ['gstnumber', maskIdentifier],
  ['taxid', maskIdentifier],
  ['taxidentificationnumber', maskIdentifier],
  ['pan', maskIdentifier],
  ['pannumber', maskIdentifier]
]);

const REDACTED_FIELDS = new Set([
  'accountnumberencrypted',
  'accountnumberhash',
  'taxidencrypted',
  'taxidhash',
  'upiidencrypted',
  'paypalemailencrypted',
  'gstnumberencrypted',
  'internalnotes'
]);

const isAtomicObject = (value) => (
  value instanceof Date ||
  Buffer.isBuffer(value) ||
  value?._bsontype === 'ObjectId' ||
  value?._bsontype === 'Decimal128'
);

const redactBankHistorySnapshot = (value) => {
  if (Array.isArray(value)) return value.map(redactBankHistorySnapshot);
  if (!value || typeof value !== 'object' || isAtomicObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => {
    const normalizedField = field.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (REDACTED_FIELDS.has(normalizedField)) return [field, '[redacted]'];
    const masker = MASKED_FIELDS.get(normalizedField);
    if (masker) return [field, fieldValue ? masker(fieldValue) : ''];
    return [field, redactBankHistorySnapshot(fieldValue)];
  }));
};

const stableSnapshot = (value) => JSON.stringify(value ?? null);
const historySnapshotNeedsRedaction = (record) => (
  stableSnapshot(record?.previous) !== stableSnapshot(redactBankHistorySnapshot(record?.previous)) ||
  stableSnapshot(record?.next) !== stableSnapshot(redactBankHistorySnapshot(record?.next))
);

module.exports = {
  redactBankHistorySnapshot,
  historySnapshotNeedsRedaction
};
