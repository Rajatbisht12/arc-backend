#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const prepare = process.argv.includes('--prepare');
if ([apply, verify, prepare].filter(Boolean).length > 1) {
  console.error('Use only one of --prepare, --apply, or --verify');
  process.exit(1);
}

const modelPath = (name) => path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', `${name}.js`);
const CreatorBankDetails = require(modelPath('CreatorBankDetails'));
const CreatorBankDetailsHistory = require(modelPath('CreatorBankDetailsHistory'));
const CreatorPayout = require(modelPath('CreatorPayout'));
const WithdrawalRequest = require(modelPath('WithdrawalRequest'));
const CreatorDisbursementReservation = require(modelPath('CreatorDisbursementReservation'));
const PayoutCycle = require(modelPath('PayoutCycle'));
const EarningsSnapshot = require(modelPath('EarningsSnapshot'));
const User = require(modelPath('User'));
const {
  FINANCIAL_TRANSACTION_OPTIONS,
  startFinancialSession,
  maskedBankSnapshot
} = require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'utils', 'financialTransactions.js'));
const {
  redactBankHistorySnapshot,
  historySnapshotNeedsRedaction
} = require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'utils', 'bankDetailsRedaction.js'));

const ACTIVE_PAYOUT_STATUSES = ['approved', 'processing', 'held'];
const DISBURSEMENT_PAYOUT_STATUSES = ['pending', ...ACTIVE_PAYOUT_STATUSES];
const ACTIVE_WITHDRAWAL_STATUSES = ['pending', 'approved', 'processing'];
const NON_APPROVED_CREATOR_STATUSES = ['not_eligible', 'eligible', 'pending', 'rejected', 'suspended', 'disabled', 'withdrawn'];
const CREATOR_STATUSES = ['approved', ...NON_APPROVED_CREATOR_STATUSES];
const ACTIVE_BOUND_PAYOUT_MATCH = {
  $or: [
    { status: { $in: ['approved', 'processing'] } },
    { status: 'held', bankDetails: { $ne: null } }
  ]
};
const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example|demo|your[-_ ]?key|at_least_32)/i;
const key = process.env.BANK_DETAILS_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
const accountNumberValid = (value, country) => (
  String(country || 'IN').toUpperCase() === 'IN'
    ? /^\d{6,20}$/.test(String(value || ''))
    : /^[A-Z0-9]{6,34}$/.test(String(value || '').toUpperCase())
);
const maskEmail = (value) => {
  const [local = '', domain = ''] = String(value || '').split('@');
  return local && domain ? `${local.slice(0, 1)}${'*'.repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}` : '';
};
const maskPaymentAddress = (value) => {
  const [local = '', handle = ''] = String(value || '').split('@');
  return local && handle ? `${local.slice(0, 1)}***@${handle}` : '';
};
const maskIdentifier = (value) => value ? `•••• ${String(value).slice(-4)}` : '';
const optionalValue = (record, name) => record[`${name}Encrypted`]
  ? CreatorBankDetails.decryptAccountNumber(record[`${name}Encrypted`])
  : String(record[name] || '');
const isAuthenticatedCiphertext = (value) => typeof value === 'string' && value.startsWith('v2:');

const connectOptions = {
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  readPreference: 'primary',
  serverSelectionTimeoutMS: 15000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {})
  } : {})
};

const idSet = (values = []) => new Set(values.map(String));
const sameIndexKey = (actual, expected) => {
  const actualEntries = Object.entries(actual || {});
  const expectedEntries = Object.entries(expected || {});
  return actualEntries.length === expectedEntries.length && actualEntries.every(([keyName, direction], index) => (
    expectedEntries[index]?.[0] === keyName && expectedEntries[index]?.[1] === direction
  ));
};

const requiredIndexes = {
  creatorBankDetails: [
    { key: { user: 1 }, unique: true },
    { key: { accountNumberHash: 1 } },
    { key: { verificationStatus: 1, updatedAt: -1 } },
    { key: { country: 1, verificationStatus: 1, updatedAt: -1 } }
  ],
  history: [
    { key: { user: 1, createdAt: -1 } },
    { key: { bankDetails: 1, createdAt: -1 } }
  ],
  payouts: [
    { key: { user: 1, payoutCycle: 1 }, unique: true },
    { key: { payoutCycle: 1, status: 1 } }
  ],
  withdrawals: [
    { key: { user: 1, payoutCycle: 1 }, unique: true }
  ],
  reservations: [
    { key: { user: 1, payoutCycle: 1 }, unique: true },
    { key: { source: 1, sourceId: 1 }, unique: true }
  ],
  payoutCycles: [
    { key: { cycleLabel: 1 }, unique: true },
    { key: { startDate: 1, endDate: 1 } }
  ],
  earningsSnapshots: [
    { key: { user: 1, payoutCycle: 1 }, unique: true },
    { key: { payoutCycle: 1 } }
  ]
};

const missingIndexes = (actual, expected) => expected.filter((required) => !actual.some((index) => (
  sameIndexKey(index.key, required.key) && (!required.unique || index.unique === true)
))).map((required) => ({ key: required.key, unique: Boolean(required.unique) }));

const scanRequiredUniqueKeyConflicts = async () => {
  const specs = [
    ['creatorBankDetails.user', CreatorBankDetails, '$user'],
    ['creatorPayout.userCycle', CreatorPayout, { user: '$user', payoutCycle: '$payoutCycle' }],
    ['withdrawal.userCycle', WithdrawalRequest, { user: '$user', payoutCycle: '$payoutCycle' }],
    ['reservation.userCycle', CreatorDisbursementReservation, { user: '$user', payoutCycle: '$payoutCycle' }],
    ['reservation.source', CreatorDisbursementReservation, { source: '$source', sourceId: '$sourceId' }],
    ['payoutCycle.label', PayoutCycle, '$cycleLabel'],
    ['earningsSnapshot.userCycle', EarningsSnapshot, { user: '$user', payoutCycle: '$payoutCycle' }]
  ];
  const conflicts = {};
  for (const [name, Model, groupId] of specs) {
    try {
      const rows = await Model.aggregate([
        { $group: { _id: groupId, firstId: { $first: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 }
      ]);
      if (rows.length) conflicts[name] = rows.map((row) => ({ key: row._id, firstId: String(row.firstId), count: row.count }));
    } catch (error) {
      if (error?.code === 26 || error?.codeName === 'NamespaceNotFound' || /namespace.*not found/i.test(error?.message || '')) continue;
      throw error;
    }
  }
  return conflicts;
};

const transactionProbe = async () => {
  let session;
  try {
    session = await startFinancialSession();
    session.startTransaction(FINANCIAL_TRANSACTION_OPTIONS);
    // Use an existing collection and a guaranteed-unmatched ID. This issues a
    // transactional write without changing production data.
    await CreatorBankDetails.collection.updateOne(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { version: 1 } },
      { session }
    );
    await session.abortTransaction();
    return true;
  } catch (error) {
    if (session?.inTransaction()) await session.abortTransaction().catch(() => null);
    throw new Error(`Financial transaction probe failed: ${error?.message || String(error)}`);
  } finally {
    if (session) await session.endSession().catch(() => null);
  }
};

const scanBanks = async () => {
  const report = {
    totalRecords: 0,
    decryptFailures: 0,
    orphanRecords: 0,
    orphanSamples: [],
    accountHashMismatches: 0,
    taxHashMismatches: 0,
    invalidAccountNumbers: 0,
    lastFourMismatches: 0,
    optionalDecryptFailures: 0,
    optionalEncryptionPending: 0,
    optionalMaskMismatches: 0,
    plaintextSensitiveFields: 0,
    legacyCiphertexts: 0,
    invalidVersions: 0,
    invalidInternalNotesVersions: 0,
    missingSubmittedAt: 0,
    legacyStatuses: 0
  };
  const cursor = CreatorBankDetails.find({})
    .select('+accountNumberEncrypted +accountNumberHash +taxIdEncrypted +taxIdHash +upiId +upiIdEncrypted +paypalEmail +paypalEmailEncrypted +gstNumber +gstNumberEncrypted')
    .lean()
    .cursor();
  let ownerBatch = [];
  const flushOwnerBatch = async () => {
    if (!ownerBatch.length) return;
    const ownerIds = ownerBatch.map((entry) => entry.user).filter(Boolean);
    const existingOwners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds } }).select('_id').lean()
      : [];
    const existingOwnerIds = idSet(existingOwners.map((entry) => entry._id));
    ownerBatch.forEach((entry) => {
      if (entry.user && existingOwnerIds.has(String(entry.user))) return;
      report.orphanRecords += 1;
      if (report.orphanSamples.length < 20) report.orphanSamples.push(String(entry.bankId));
    });
    ownerBatch = [];
  };
  for await (const record of cursor) {
    report.totalRecords += 1;
    ownerBatch.push({ bankId: record._id, user: record.user });
    if (ownerBatch.length >= 500) await flushOwnerBatch();
    try {
      for (const field of ['accountNumberEncrypted', 'taxIdEncrypted', 'upiIdEncrypted', 'paypalEmailEncrypted', 'gstNumberEncrypted']) {
        if (record[field] && !isAuthenticatedCiphertext(record[field])) report.legacyCiphertexts += 1;
      }
      const accountNumber = CreatorBankDetails.decryptAccountNumber(record.accountNumberEncrypted);
      if (!accountNumberValid(accountNumber, record.country)) report.invalidAccountNumbers += 1;
      if (String(record.lastFourDigits || '') !== accountNumber.slice(-4)) report.lastFourMismatches += 1;
      const expectedAccountHash = CreatorBankDetails.hashSensitiveValue(accountNumber, 'account-number');
      if (record.accountNumberHash !== expectedAccountHash) report.accountHashMismatches += 1;
      if (record.taxIdEncrypted) {
        const taxId = CreatorBankDetails.decryptAccountNumber(record.taxIdEncrypted);
        const expectedTaxHash = CreatorBankDetails.hashSensitiveValue(taxId, 'tax-id');
        if (record.taxIdHash !== expectedTaxHash) report.taxHashMismatches += 1;
      } else if (record.taxIdHash) {
        report.taxHashMismatches += 1;
      }
      for (const [field, masker] of [['upiId', maskPaymentAddress], ['paypalEmail', maskEmail], ['gstNumber', maskIdentifier]]) {
        try {
          const value = optionalValue(record, field);
          if (record[field]) report.plaintextSensitiveFields += 1;
          if (value && !record[`${field}Encrypted`]) report.optionalEncryptionPending += 1;
          if ((record[`${field}Masked`] || '') !== masker(value)) report.optionalMaskMismatches += 1;
        } catch {
          report.optionalDecryptFailures += 1;
        }
      }
    } catch {
      report.decryptFailures += 1;
    }
    if (!Number.isInteger(record.version) || record.version < 1) report.invalidVersions += 1;
    if (!Number.isInteger(record.internalNotesVersion) || record.internalNotesVersion < 1) report.invalidInternalNotesVersions += 1;
    if (!record.lastSubmittedAt) report.missingSubmittedAt += 1;
    if (record.verificationStatus === 'failed') report.legacyStatuses += 1;
  }
  await flushOwnerBatch();
  return report;
};

const applyBankRowMigration = async () => {
  let migrated = 0;
  const cursor = CreatorBankDetails.find({})
    .select('+accountNumberEncrypted +accountNumberHash +taxIdEncrypted +taxIdHash +upiId +upiIdEncrypted +paypalEmail +paypalEmailEncrypted +gstNumber +gstNumberEncrypted')
    .lean()
    .cursor();
  for await (const record of cursor) {
    const accountNumber = CreatorBankDetails.decryptAccountNumber(record.accountNumberEncrypted);
    const taxId = record.taxIdEncrypted ? CreatorBankDetails.decryptAccountNumber(record.taxIdEncrypted) : '';
    const upiId = optionalValue(record, 'upiId');
    const paypalEmail = optionalValue(record, 'paypalEmail');
    const gstNumber = optionalValue(record, 'gstNumber');
    const $set = {
      accountNumberEncrypted: isAuthenticatedCiphertext(record.accountNumberEncrypted)
        ? record.accountNumberEncrypted
        : CreatorBankDetails.encryptSensitiveValue(accountNumber),
      accountNumberHash: CreatorBankDetails.hashSensitiveValue(accountNumber, 'account-number'),
      version: Math.max(1, Number(record.version || 1)),
      internalNotesVersion: Math.max(1, Number(record.internalNotesVersion || 1)),
      lastSubmittedAt: record.lastSubmittedAt || record.updatedAt || record.createdAt || new Date()
    };
    $set.lastFourDigits = accountNumber.slice(-4);
    for (const [field, value, masker] of [
      ['upiId', upiId, maskPaymentAddress],
      ['paypalEmail', paypalEmail, maskEmail],
      ['gstNumber', gstNumber, maskIdentifier]
    ]) {
      if (value) {
        $set[`${field}Encrypted`] = isAuthenticatedCiphertext(record[`${field}Encrypted`])
          ? record[`${field}Encrypted`]
          : CreatorBankDetails.encryptSensitiveValue(value);
        $set[`${field}Masked`] = masker(value);
      }
    }
    if (taxId) {
      $set.taxIdEncrypted = isAuthenticatedCiphertext(record.taxIdEncrypted)
        ? record.taxIdEncrypted
        : CreatorBankDetails.encryptSensitiveValue(taxId);
      $set.taxIdHash = CreatorBankDetails.hashSensitiveValue(taxId, 'tax-id');
    }
    if (record.verificationStatus === 'failed') $set.verificationStatus = 'rejected';
    const update = { $set, $unset: { upiId: 1, paypalEmail: 1, gstNumber: 1 } };
    if (!taxId) {
      update.$unset.taxIdEncrypted = 1;
      update.$unset.taxIdHash = 1;
    }
    for (const [field, value] of [['upiId', upiId], ['paypalEmail', paypalEmail], ['gstNumber', gstNumber]]) {
      if (!value) {
        update.$unset[`${field}Encrypted`] = 1;
        update.$unset[`${field}Masked`] = 1;
      }
    }
    const result = await CreatorBankDetails.updateOne(
      { _id: record._id, updatedAt: record.updatedAt, accountNumberEncrypted: record.accountNumberEncrypted },
      update,
      { runValidators: true }
    );
    if (result.matchedCount !== 1) throw new Error(`Concurrent bank mutation detected for ${String(record._id)}; retry the preflight.`);
    migrated += 1;
  }
  return migrated;
};

const scanBankHistory = async () => {
  const report = {
    totalRecords: 0,
    plaintextSensitiveSnapshots: 0,
    samples: []
  };
  const cursor = CreatorBankDetailsHistory.collection.find(
    {},
    { projection: { _id: 1, previous: 1, next: 1, action: 1 } }
  );
  for await (const record of cursor) {
    report.totalRecords += 1;
    if (!historySnapshotNeedsRedaction(record)) continue;
    report.plaintextSensitiveSnapshots += 1;
    if (report.samples.length < 20) report.samples.push(String(record._id));
  }
  return report;
};

// History is immutable to the application. This one-time migration deliberately
// bypasses model mutation hooks, but performs each legacy redaction together
// with a new immutable system audit row in a financial transaction.
const applyBankHistoryRedaction = async () => {
  let redactedRecords = 0;
  const cursor = CreatorBankDetailsHistory.collection.find(
    {},
    { projection: { _id: 1, bankDetails: 1, user: 1, previous: 1, next: 1, action: 1 } }
  );
  for await (const candidate of cursor) {
    if (!historySnapshotNeedsRedaction(candidate)) continue;
    let session;
    let rowRedacted = false;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        const current = await CreatorBankDetailsHistory.collection.findOne(
          { _id: candidate._id },
          { session, projection: { _id: 1, bankDetails: 1, user: 1, previous: 1, next: 1, action: 1 } }
        );
        if (!current || !historySnapshotNeedsRedaction(current)) return;
        const previous = redactBankHistorySnapshot(current.previous);
        const next = redactBankHistorySnapshot(current.next);
        const result = await CreatorBankDetailsHistory.collection.updateOne(
          { _id: current._id },
          { $set: { previous, next } },
          { session }
        );
        if (result.matchedCount !== 1) throw new Error(`History redaction lost race for ${String(current._id)}`);
        await CreatorBankDetailsHistory.create([{
          bankDetails: current.bankDetails || null,
          user: current.user,
          action: 'legacy_sensitive_data_redacted',
          actor: {
            actorKey: 'system:bank-details-migration',
            username: 'bank-details-migration',
            role: 'system',
            type: 'system'
          },
          previous: { historyRecordId: String(current._id), sourceAction: current.action || '' },
          next: { sensitiveSnapshotFieldsRedacted: true },
          reason: 'Removed legacy plaintext bank identifiers from immutable history snapshots.'
        }], { session });
        rowRedacted = true;
      }, FINANCIAL_TRANSACTION_OPTIONS);
      if (rowRedacted) redactedRecords += 1;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }
  return redactedRecords;
};

const scanFinancialBindings = async () => {
  const report = {
    activePayouts: 0,
    payoutConflicts: [],
    missingPayoutLocks: [],
    pendingWithdrawals: 0,
    withdrawalConflicts: [],
    withdrawalBackfills: [],
    missingWithdrawalLocks: [],
    stalePayoutLocks: [],
    staleWithdrawalLocks: [],
    historicalPayoutSnapshotsUnavailable: 0,
    historicalWithdrawalSnapshotsUnavailable: 0
  };

  const payoutCursor = CreatorPayout.find(ACTIVE_BOUND_PAYOUT_MATCH).lean().cursor();
  for await (const payout of payoutCursor) {
    report.activePayouts += 1;
    if (!payout.bankDetails || !payout.bankDetailsVersion || !payout.bankDetailsSnapshot?.capturedAt) {
      report.payoutConflicts.push(String(payout._id));
      continue;
    }
    const bank = await CreatorBankDetails.findOne({
      _id: payout.bankDetails,
      user: payout.user,
      version: payout.bankDetailsVersion,
      verificationStatus: 'verified'
    }).select('activePayoutLocks').lean();
    if (!bank) {
      report.payoutConflicts.push(String(payout._id));
      continue;
    }
    if (!idSet(bank.activePayoutLocks).has(String(payout._id))) {
      report.missingPayoutLocks.push({ payoutId: String(payout._id), bankId: String(payout.bankDetails) });
    }
  }

  report.historicalPayoutSnapshotsUnavailable = await CreatorPayout.countDocuments({
    status: { $nin: ACTIVE_PAYOUT_STATUSES },
    'bankDetailsSnapshot.capturedAt': { $exists: false }
  });

  const withdrawalCursor = WithdrawalRequest.find({ status: { $in: ACTIVE_WITHDRAWAL_STATUSES } }).lean().cursor();
  for await (const withdrawal of withdrawalCursor) {
    report.pendingWithdrawals += 1;
    if (withdrawal.bankDetails && withdrawal.bankDetailsVersion && withdrawal.bankDetailsSnapshot?.capturedAt) {
      const bank = await CreatorBankDetails.findOne({
        _id: withdrawal.bankDetails,
        user: withdrawal.user,
        version: withdrawal.bankDetailsVersion,
        verificationStatus: 'verified'
      }).select('activeWithdrawalLocks').lean();
      if (!bank) {
        report.withdrawalConflicts.push(String(withdrawal._id));
      } else if (!idSet(bank.activeWithdrawalLocks).has(String(withdrawal._id))) {
        report.missingWithdrawalLocks.push({ withdrawalId: String(withdrawal._id), bankId: String(withdrawal.bankDetails) });
      }
      continue;
    }
    if (withdrawal.status !== 'pending') {
      // Never infer a destination for a processing transfer.
      report.withdrawalConflicts.push(String(withdrawal._id));
      continue;
    }
    // Pending requests have not been paid, so binding the creator's current
    // verified bank at deployment is deterministic and safe.
    const currentBank = await CreatorBankDetails.findOne({
      ...(withdrawal.bankDetails ? { _id: withdrawal.bankDetails } : {}),
      user: withdrawal.user,
      verificationStatus: 'verified'
    })
      .select('accountHolderName bankName lastFourDigits ifsc swiftCode branch country version')
      .lean();
    if (!currentBank) {
      report.withdrawalConflicts.push(String(withdrawal._id));
    } else {
      report.withdrawalBackfills.push({ withdrawalId: String(withdrawal._id), bankId: String(currentBank._id) });
    }
  }

  report.historicalWithdrawalSnapshotsUnavailable = await WithdrawalRequest.countDocuments({
    status: { $nin: ACTIVE_WITHDRAWAL_STATUSES },
    'bankDetailsSnapshot.capturedAt': { $exists: false }
  });

  const bankCursor = CreatorBankDetails.find({
    $or: [
      { 'activePayoutLocks.0': { $exists: true } },
      { 'activeWithdrawalLocks.0': { $exists: true } }
    ]
  }).select('activePayoutLocks activeWithdrawalLocks').lean().cursor();
  for await (const bank of bankCursor) {
    const payoutLocks = bank.activePayoutLocks || [];
    if (payoutLocks.length) {
      const valid = await CreatorPayout.find({
        _id: { $in: payoutLocks },
        bankDetails: bank._id,
        status: { $in: ACTIVE_PAYOUT_STATUSES }
      }).distinct('_id');
      const validIds = idSet(valid);
      const stale = payoutLocks.filter((id) => !validIds.has(String(id))).map(String);
      if (stale.length) report.stalePayoutLocks.push({ bankId: String(bank._id), lockIds: stale });
    }
    const withdrawalLocks = bank.activeWithdrawalLocks || [];
    if (withdrawalLocks.length) {
      const valid = await WithdrawalRequest.find({
        _id: { $in: withdrawalLocks },
        bankDetails: bank._id,
        status: { $in: ACTIVE_WITHDRAWAL_STATUSES }
      }).distinct('_id');
      const validIds = idSet(valid);
      const stale = withdrawalLocks.filter((id) => !validIds.has(String(id))).map(String);
      if (stale.length) report.staleWithdrawalLocks.push({ bankId: String(bank._id), lockIds: stale });
    }
  }
  return report;
};

const scanDisbursementReservations = async () => {
  const report = { conflicts: [], missing: [], invalid: [], missingSnapshotClaims: [], orphanSnapshotClaims: [], missingActiveEarningsSnapshots: [] };
  const conflictKeys = new Set();
  const invalidReservationIds = new Set();
  const missingSnapshotClaimIds = new Set();
  const orphanSnapshotClaimIds = new Set();
  const reservationCollectionExists = await mongoose.connection.db
    .listCollections({ name: CreatorDisbursementReservation.collection.name }, { nameOnly: true })
    .hasNext();
  const keyFor = (record) => `${String(record.user)}:${String(record.payoutCycle)}`;
  const snapshotClaimNeedsBackfill = (snapshot, reservation) => (
    !(snapshot.disbursementReservedAt instanceof Date) ||
    Number.isNaN(snapshot.disbursementReservedAt.getTime()) ||
    snapshot.disbursementSource !== reservation.source ||
    String(snapshot.disbursementId || '') !== String(reservation.sourceId)
  );
  const addMissingSnapshotClaim = (snapshot, reservation) => {
    const snapshotId = String(snapshot._id);
    if (missingSnapshotClaimIds.has(snapshotId)) return;
    missingSnapshotClaimIds.add(snapshotId);
    report.missingSnapshotClaims.push({
      reservationId: String(reservation._id),
      snapshotId,
      source: reservation.source,
      sourceId: String(reservation.sourceId),
      user: String(reservation.user),
      payoutCycle: String(reservation.payoutCycle)
    });
  };
  const consumeInBatches = async (cursor, handler, size = 500) => {
    let batch = [];
    for await (const record of cursor) {
      batch.push(record);
      if (batch.length >= size) {
        await handler(batch);
        batch = [];
      }
    }
    if (batch.length) await handler(batch);
  };
  const inspectSourceBatch = async (batch, source, OtherModel) => {
    const keyQueries = batch.map((record) => ({ user: record.user, payoutCycle: record.payoutCycle }));
    const otherRecords = await OtherModel.find({ $or: keyQueries }).select('user payoutCycle').lean();
    const otherKeys = new Set(otherRecords.map(keyFor));
    const reservations = reservationCollectionExists
      ? await CreatorDisbursementReservation.find({ $or: keyQueries }).lean()
      : [];
    const reservationsByKey = new Map(reservations.map((reservation) => [keyFor(reservation), reservation]));
    batch.forEach((record) => {
      const keyName = keyFor(record);
      if (otherKeys.has(keyName)) {
        if (!conflictKeys.has(keyName)) {
          report.conflicts.push({ user: String(record.user), payoutCycle: String(record.payoutCycle) });
          conflictKeys.add(keyName);
        }
        return;
      }
      const reservation = reservationsByKey.get(keyName);
      if (!reservation) {
        report.missing.push({ source, sourceId: String(record._id), user: String(record.user), payoutCycle: String(record.payoutCycle) });
        return;
      }
      if (reservation.source !== source || String(reservation.sourceId) !== String(record._id)) {
        const reservationId = String(reservation._id);
        if (!invalidReservationIds.has(reservationId)) {
          report.invalid.push({ reservationId, user: String(record.user), payoutCycle: String(record.payoutCycle) });
          invalidReservationIds.add(reservationId);
        }
      }
    });
    const activeStatuses = source === 'creator_payout' ? DISBURSEMENT_PAYOUT_STATUSES : ACTIVE_WITHDRAWAL_STATUSES;
    const activeBatch = batch.filter((record) => activeStatuses.includes(record.status));
    if (activeBatch.length) {
      const snapshots = await EarningsSnapshot.find({
        $or: activeBatch.map((record) => ({ user: record.user, payoutCycle: record.payoutCycle }))
      }).select('user payoutCycle').lean();
      const snapshotKeys = new Set(snapshots.map(keyFor));
      activeBatch.forEach((record) => {
        if (!snapshotKeys.has(keyFor(record))) {
          report.missingActiveEarningsSnapshots.push({ source, sourceId: String(record._id), user: String(record.user), payoutCycle: String(record.payoutCycle) });
        }
      });
    }
  };
  await consumeInBatches(
    CreatorPayout.find({}).select('user payoutCycle status').lean().cursor(),
    (batch) => inspectSourceBatch(batch, 'creator_payout', WithdrawalRequest)
  );
  await consumeInBatches(
    WithdrawalRequest.find({}).select('user payoutCycle status').lean().cursor(),
    (batch) => inspectSourceBatch(batch, 'withdrawal', CreatorPayout)
  );

  if (reservationCollectionExists) {
    await consumeInBatches(CreatorDisbursementReservation.find({}).lean().cursor(), async (batch) => {
      const payoutReservations = batch.filter((entry) => entry.source === 'creator_payout');
      const withdrawalReservations = batch.filter((entry) => entry.source === 'withdrawal');
      const [payouts, withdrawals] = await Promise.all([
        payoutReservations.length
          ? CreatorPayout.find({ _id: { $in: payoutReservations.map((entry) => entry.sourceId) } }).select('user payoutCycle').lean()
          : [],
        withdrawalReservations.length
          ? WithdrawalRequest.find({ _id: { $in: withdrawalReservations.map((entry) => entry.sourceId) } }).select('user payoutCycle').lean()
          : []
      ]);
      const payoutById = new Map(payouts.map((entry) => [String(entry._id), entry]));
      const withdrawalById = new Map(withdrawals.map((entry) => [String(entry._id), entry]));
      const snapshots = await EarningsSnapshot.find({
        $or: batch.map((entry) => ({ user: entry.user, payoutCycle: entry.payoutCycle }))
      }).select('user payoutCycle disbursementReservedAt disbursementSource disbursementId').lean();
      const snapshotsByKey = new Map(snapshots.map((entry) => [keyFor(entry), entry]));
      batch.forEach((reservation) => {
        const sourceRecord = reservation.source === 'creator_payout'
          ? payoutById.get(String(reservation.sourceId))
          : reservation.source === 'withdrawal'
            ? withdrawalById.get(String(reservation.sourceId))
            : null;
        const valid = sourceRecord && String(sourceRecord.user) === String(reservation.user) && String(sourceRecord.payoutCycle) === String(reservation.payoutCycle);
        const reservationId = String(reservation._id);
        if (!valid && !invalidReservationIds.has(reservationId)) {
          report.invalid.push({ reservationId, user: String(reservation.user), payoutCycle: String(reservation.payoutCycle) });
          invalidReservationIds.add(reservationId);
        }
        const snapshot = snapshotsByKey.get(keyFor(reservation));
        if (valid && snapshot && snapshotClaimNeedsBackfill(snapshot, reservation)) {
          addMissingSnapshotClaim(snapshot, reservation);
        }
      });
    });
  }

  // A partial/orphan claim can block the conditional runtime reservation even
  // when no reservation or disbursement exists. Reconcile valid reservations,
  // and explicitly clear only claims for keys with no payout/withdrawal source.
  await consumeInBatches(
    EarningsSnapshot.find({
      $or: [
        { disbursementReservedAt: { $ne: null } },
        { disbursementSource: { $ne: null } },
        { disbursementId: { $ne: null } }
      ]
    }).select('user payoutCycle disbursementReservedAt disbursementSource disbursementId').lean().cursor(),
    async (batch) => {
      const keyQueries = batch.map((entry) => ({ user: entry.user, payoutCycle: entry.payoutCycle }));
      const [reservations, payouts, withdrawals] = await Promise.all([
        reservationCollectionExists ? CreatorDisbursementReservation.find({ $or: keyQueries }).lean() : [],
        CreatorPayout.find({ $or: keyQueries }).select('user payoutCycle').lean(),
        WithdrawalRequest.find({ $or: keyQueries }).select('user payoutCycle').lean()
      ]);
      const reservationsByKey = new Map(reservations.map((entry) => [keyFor(entry), entry]));
      const sourceKeys = new Set([...payouts, ...withdrawals].map(keyFor));
      batch.forEach((snapshot) => {
        const keyName = keyFor(snapshot);
        const reservation = reservationsByKey.get(keyName);
        if (reservation) {
          if (snapshotClaimNeedsBackfill(snapshot, reservation)) {
            addMissingSnapshotClaim(snapshot, reservation);
          }
          return;
        }
        if (sourceKeys.has(keyName)) return;
        const snapshotId = String(snapshot._id);
        if (orphanSnapshotClaimIds.has(snapshotId)) return;
        orphanSnapshotClaimIds.add(snapshotId);
        report.orphanSnapshotClaims.push({ snapshotId, user: String(snapshot.user), payoutCycle: String(snapshot.payoutCycle) });
      });
    }
  );
  return report;
};

const applyDisbursementReservations = async (reservationReport) => {
  let created = 0;
  let snapshotClaimsBackfilled = 0;
  for (const missing of reservationReport.missing) {
    let session;
    let snapshotClaimed = false;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        const SourceModel = missing.source === 'creator_payout' ? CreatorPayout : WithdrawalRequest;
        const OtherModel = missing.source === 'creator_payout' ? WithdrawalRequest : CreatorPayout;
        const source = await SourceModel.findOne({
          _id: missing.sourceId,
          user: missing.user,
          payoutCycle: missing.payoutCycle
        }).session(session).lean();
        if (!source) throw new Error(`Disbursement source ${missing.sourceId} changed during migration`);
        const other = await OtherModel.exists({ user: missing.user, payoutCycle: missing.payoutCycle }).session(session);
        if (other) throw new Error(`Conflicting disbursement appeared for ${missing.user}/${missing.payoutCycle}`);
        await CreatorDisbursementReservation.create([{
          user: missing.user,
          payoutCycle: missing.payoutCycle,
          source: missing.source,
          sourceId: missing.sourceId
        }], { session });
        const claim = await EarningsSnapshot.updateOne(
          { user: missing.user, payoutCycle: missing.payoutCycle },
          { $set: {
            disbursementReservedAt: new Date(),
            disbursementSource: missing.source,
            disbursementId: missing.sourceId
          } },
          { session }
        );
        snapshotClaimed = claim.matchedCount === 1;
      }, FINANCIAL_TRANSACTION_OPTIONS);
      created += 1;
      if (snapshotClaimed) snapshotClaimsBackfilled += 1;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }
  for (const claim of reservationReport.missingSnapshotClaims) {
    const result = await EarningsSnapshot.updateOne(
      { _id: claim.snapshotId, user: claim.user, payoutCycle: claim.payoutCycle },
      { $set: {
        disbursementReservedAt: new Date(),
        disbursementSource: claim.source,
        disbursementId: claim.sourceId
      } }
    );
    if (result.matchedCount !== 1) throw new Error(`Earnings snapshot ${claim.snapshotId} changed during migration`);
    snapshotClaimsBackfilled += 1;
  }
  let orphanSnapshotClaimsCleared = 0;
  for (const claim of reservationReport.orphanSnapshotClaims) {
    const result = await EarningsSnapshot.updateOne(
      { _id: claim.snapshotId, user: claim.user, payoutCycle: claim.payoutCycle },
      { $set: {
        disbursementReservedAt: null,
        disbursementSource: null,
        disbursementId: null,
        disbursementReviewedAt: null
      } }
    );
    if (result.matchedCount !== 1) throw new Error(`Orphan earnings snapshot claim ${claim.snapshotId} changed during migration`);
    orphanSnapshotClaimsCleared += 1;
  }
  return { created, snapshotClaimsBackfilled, orphanSnapshotClaimsCleared };
};

const applyFinancialBindings = async (financial) => {
  let payoutLocksAdded = 0;
  let withdrawalLocksAdded = 0;
  let withdrawalsBackfilled = 0;
  let staleLocksRemoved = 0;

  for (const binding of financial.missingPayoutLocks) {
    let session;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        const payout = await CreatorPayout.findById(binding.payoutId).session(session).lean();
        const isBoundActive = payout && (
          ['approved', 'processing'].includes(payout.status) || (payout.status === 'held' && payout.bankDetails)
        );
        if (!isBoundActive || String(payout.bankDetails) !== binding.bankId || !payout.bankDetailsVersion || !payout.bankDetailsSnapshot?.capturedAt) {
          throw new Error(`Payout ${binding.payoutId} changed during migration`);
        }
        const result = await CreatorBankDetails.updateOne(
          { _id: binding.bankId, user: payout.user, verificationStatus: 'verified', version: payout.bankDetailsVersion },
          { $addToSet: { activePayoutLocks: payout._id } },
          { session }
        );
        if (result.matchedCount !== 1) throw new Error(`Could not restore payout lock ${binding.payoutId}`);
      }, FINANCIAL_TRANSACTION_OPTIONS);
      payoutLocksAdded += 1;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }

  for (const binding of financial.missingWithdrawalLocks) {
    let session;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        const withdrawal = await WithdrawalRequest.findById(binding.withdrawalId).session(session).lean();
        if (!withdrawal || !ACTIVE_WITHDRAWAL_STATUSES.includes(withdrawal.status) || String(withdrawal.bankDetails) !== binding.bankId || !withdrawal.bankDetailsVersion || !withdrawal.bankDetailsSnapshot?.capturedAt) {
          throw new Error(`Withdrawal ${binding.withdrawalId} changed during migration`);
        }
        const result = await CreatorBankDetails.updateOne(
          { _id: binding.bankId, user: withdrawal.user, verificationStatus: 'verified', version: withdrawal.bankDetailsVersion },
          { $addToSet: { activeWithdrawalLocks: withdrawal._id } },
          { session }
        );
        if (result.matchedCount !== 1) throw new Error(`Could not restore withdrawal lock ${binding.withdrawalId}`);
      }, FINANCIAL_TRANSACTION_OPTIONS);
      withdrawalLocksAdded += 1;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }

  for (const binding of financial.withdrawalBackfills) {
    let session;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        const withdrawal = await WithdrawalRequest.findOne({ _id: binding.withdrawalId, status: 'pending' }).session(session);
        const bank = await CreatorBankDetails.findOne({ _id: binding.bankId, user: withdrawal?.user, verificationStatus: 'verified' })
          .select('accountHolderName bankName lastFourDigits ifsc swiftCode branch country version')
          .session(session);
        if (!withdrawal || !bank) throw new Error(`Withdrawal ${binding.withdrawalId} changed during migration`);
        const updated = await WithdrawalRequest.updateOne(
          { _id: withdrawal._id, status: 'pending', bankDetails: { $in: [null, bank._id] } },
          { $set: {
            bankDetails: bank._id,
            bankDetailsVersion: Math.max(1, Number(bank.version || 1)),
            bankDetailsSnapshot: maskedBankSnapshot(bank)
          } },
          { session, runValidators: true }
        );
        if (updated.matchedCount !== 1) throw new Error(`Withdrawal ${binding.withdrawalId} could not be bound`);
        const locked = await CreatorBankDetails.updateOne(
          { _id: bank._id, verificationStatus: 'verified', version: bank.version },
          { $addToSet: { activeWithdrawalLocks: withdrawal._id } },
          { session }
        );
        if (locked.matchedCount !== 1) throw new Error(`Withdrawal ${binding.withdrawalId} bank lock could not be created`);
      }, FINANCIAL_TRANSACTION_OPTIONS);
      withdrawalsBackfilled += 1;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }

  for (const stale of financial.stalePayoutLocks) {
    let session;
    let removedForRecord = 0;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        removedForRecord = 0;
        const stillStale = [];
        for (const lockId of stale.lockIds) {
          const active = await CreatorPayout.exists({
            _id: lockId,
            bankDetails: stale.bankId,
            status: { $in: ACTIVE_PAYOUT_STATUSES }
          }).session(session);
          if (!active) stillStale.push(lockId);
        }
        if (stillStale.length) {
          await CreatorBankDetails.updateOne(
            { _id: stale.bankId },
            { $pull: { activePayoutLocks: { $in: stillStale } } },
            { session }
          );
          removedForRecord = stillStale.length;
        }
      }, FINANCIAL_TRANSACTION_OPTIONS);
      staleLocksRemoved += removedForRecord;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }
  for (const stale of financial.staleWithdrawalLocks) {
    let session;
    let removedForRecord = 0;
    try {
      session = await startFinancialSession();
      await session.withTransaction(async () => {
        removedForRecord = 0;
        const stillStale = [];
        for (const lockId of stale.lockIds) {
          const active = await WithdrawalRequest.exists({
            _id: lockId,
            bankDetails: stale.bankId,
            status: { $in: ACTIVE_WITHDRAWAL_STATUSES }
          }).session(session);
          if (!active) stillStale.push(lockId);
        }
        if (stillStale.length) {
          await CreatorBankDetails.updateOne(
            { _id: stale.bankId },
            { $pull: { activeWithdrawalLocks: { $in: stillStale } } },
            { session }
          );
          removedForRecord = stillStale.length;
        }
      }, FINANCIAL_TRANSACTION_OPTIONS);
      staleLocksRemoved += removedForRecord;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  }
  return { payoutLocksAdded, withdrawalLocksAdded, withdrawalsBackfilled, staleLocksRemoved };
};

const readIndexReport = async () => {
  const readIndexes = async (Model) => {
    try {
      return await Model.collection.indexes();
    } catch (error) {
      if (error?.code === 26 || error?.codeName === 'NamespaceNotFound' || /namespace.*not found/i.test(error?.message || '')) return [];
      throw error;
    }
  };
  const actual = {
    creatorBankDetails: await readIndexes(CreatorBankDetails),
    history: await readIndexes(CreatorBankDetailsHistory),
    payouts: await readIndexes(CreatorPayout),
    withdrawals: await readIndexes(WithdrawalRequest),
    reservations: await readIndexes(CreatorDisbursementReservation),
    payoutCycles: await readIndexes(PayoutCycle),
    earningsSnapshots: await readIndexes(EarningsSnapshot)
  };
  return Object.fromEntries(Object.entries(actual).map(([name, indexes]) => [name, {
    names: indexes.map((index) => index.name),
    missing: missingIndexes(indexes, requiredIndexes[name])
  }]));
};

const createRequiredIndexes = async () => {
  await CreatorBankDetails.createIndexes();
  await CreatorBankDetailsHistory.createIndexes();
  await CreatorPayout.createIndexes();
  await WithdrawalRequest.createIndexes();
  await CreatorDisbursementReservation.createIndexes();
  await PayoutCycle.createIndexes();
  await EarningsSnapshot.createIndexes();
};

const scanCreatorStatusConsistency = async () => {
  const base = { userType: 'player' };
  const [approvedFlagMismatch, nonApprovedFlagMismatch, invalidOrMissingStatus] = await Promise.all([
    User.countDocuments({ ...base, creatorMonetizationStatus: 'approved', isCreator: { $ne: true } }),
    User.countDocuments({ ...base, creatorMonetizationStatus: { $in: NON_APPROVED_CREATOR_STATUSES }, isCreator: true }),
    User.countDocuments({ ...base, creatorMonetizationStatus: { $nin: CREATOR_STATUSES } })
  ]);
  return {
    approvedFlagMismatch,
    nonApprovedFlagMismatch,
    invalidOrMissingStatus,
    total: approvedFlagMismatch + nonApprovedFlagMismatch + invalidOrMissingStatus
  };
};

const applyCreatorStatusConsistency = async () => {
  const legacyApproved = await User.updateMany(
    { userType: 'player', creatorMonetizationStatus: { $nin: CREATOR_STATUSES }, isCreator: true },
    { $set: { creatorMonetizationStatus: 'approved' } }
  );
  const legacyNotEligible = await User.updateMany(
    { userType: 'player', creatorMonetizationStatus: { $nin: CREATOR_STATUSES }, isCreator: { $ne: true } },
    { $set: { creatorMonetizationStatus: 'not_eligible', isCreator: false } }
  );
  const approved = await User.updateMany(
    { userType: 'player', creatorMonetizationStatus: 'approved', isCreator: { $ne: true } },
    { $set: { isCreator: true } }
  );
  const nonApproved = await User.updateMany(
    { userType: 'player', creatorMonetizationStatus: { $in: NON_APPROVED_CREATOR_STATUSES }, isCreator: true },
    { $set: { isCreator: false } }
  );
  return {
    legacyApproved: legacyApproved.modifiedCount || 0,
    legacyNotEligible: legacyNotEligible.modifiedCount || 0,
    approved: approved.modifiedCount || 0,
    nonApproved: nonApproved.modifiedCount || 0
  };
};

const main = async () => {
  if (!/^[\x20-\x7E]{32,}$/.test(key) || PLACEHOLDER_PATTERN.test(key)) {
    throw new Error('A stable, non-placeholder ASCII BANK_DETAILS_ENCRYPTION_KEY with at least 32 characters is required');
  }
  await mongoose.connect(uri, connectOptions);
  if (prepare) {
    const uniqueKeyConflicts = await scanRequiredUniqueKeyConflicts();
    if (Object.keys(uniqueKeyConflicts).length) {
      console.log(JSON.stringify({
        mode: 'prepare-blocked',
        uniqueKeyConflicts,
        message: 'Resolve duplicate financial identity keys before creating unique indexes. Do not merge or delete payout records without Finance approval.'
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    await createRequiredIndexes();
    await transactionProbe();
    const indexes = await readIndexReport();
    console.log(JSON.stringify({ mode: 'prepare', transactionProbe: 'passed', indexes }, null, 2));
    return;
  }
  await transactionProbe();

  const before = await scanBanks();
  const historyBefore = await scanBankHistory();
  const financialBefore = await scanFinancialBindings();
  const reservationsBefore = await scanDisbursementReservations();
  const creatorStatusBefore = await scanCreatorStatusConsistency();
  const unrecoverableBefore = before.decryptFailures > 0 || before.optionalDecryptFailures > 0 || before.invalidAccountNumbers > 0 || before.orphanRecords > 0 ||
    financialBefore.payoutConflicts.length > 0 || financialBefore.withdrawalConflicts.length > 0 ||
    reservationsBefore.conflicts.length > 0 || reservationsBefore.invalid.length > 0 || reservationsBefore.missingActiveEarningsSnapshots.length > 0;
  if (unrecoverableBefore) {
    const blocked = {
      mode: apply ? 'apply-blocked' : verify ? 'verify-failed' : 'audit-failed',
      ...before,
      history: historyBefore,
      financial: financialBefore,
      disbursementReservations: reservationsBefore,
      message: 'No records were changed. Resolve decrypt/orphan/ambiguous financial bindings before retrying.'
    };
    console.log(JSON.stringify(blocked, null, 2));
    process.exitCode = 1;
    return;
  }

  let migratedRecords = 0;
  let redactedHistoryRecords = 0;
  let financialChanges = null;
  let reservationChanges = { created: 0, snapshotClaimsBackfilled: 0, orphanSnapshotClaimsCleared: 0 };
  let creatorStatusChanges = null;
  if (apply) {
    migratedRecords = await applyBankRowMigration();
    redactedHistoryRecords = await applyBankHistoryRedaction();
    financialChanges = await applyFinancialBindings(financialBefore);
    reservationChanges = await applyDisbursementReservations(reservationsBefore);
    creatorStatusChanges = await applyCreatorStatusConsistency();
    await createRequiredIndexes();
  }

  const after = apply ? await scanBanks() : before;
  const historyAfter = apply ? await scanBankHistory() : historyBefore;
  const financialAfter = apply ? await scanFinancialBindings() : financialBefore;
  const reservationsAfter = apply ? await scanDisbursementReservations() : reservationsBefore;
  const creatorStatusAfter = apply ? await scanCreatorStatusConsistency() : creatorStatusBefore;
  const indexes = await readIndexReport();
  const missingIndexCount = Object.values(indexes).reduce((sum, group) => sum + group.missing.length, 0);
  const strictFailures = after.decryptFailures + after.optionalDecryptFailures + after.invalidAccountNumbers + after.orphanRecords + after.accountHashMismatches +
    after.taxHashMismatches + after.lastFourMismatches + after.optionalEncryptionPending + after.optionalMaskMismatches + after.plaintextSensitiveFields + after.legacyCiphertexts + after.invalidVersions + after.invalidInternalNotesVersions + after.missingSubmittedAt + after.legacyStatuses +
    historyAfter.plaintextSensitiveSnapshots +
    financialAfter.payoutConflicts.length + financialAfter.withdrawalConflicts.length +
    financialAfter.missingPayoutLocks.length + financialAfter.missingWithdrawalLocks.length +
    financialAfter.stalePayoutLocks.length + financialAfter.staleWithdrawalLocks.length +
    reservationsAfter.conflicts.length + reservationsAfter.invalid.length + reservationsAfter.missing.length + reservationsAfter.missingSnapshotClaims.length + reservationsAfter.orphanSnapshotClaims.length + reservationsAfter.missingActiveEarningsSnapshots.length + creatorStatusAfter.total + missingIndexCount;

  const report = {
    mode: apply ? 'apply' : verify ? 'verify' : 'audit',
    ...after,
    migratedRecords,
    history: historyAfter,
    redactedHistoryRecords,
    financial: financialAfter,
    financialChanges,
    disbursementReservations: reservationsAfter,
    reservationChanges,
    creatorStatus: creatorStatusAfter,
    creatorStatusChanges,
    indexes,
    warnings: {
      historicalPayoutSnapshotsUnavailable: financialAfter.historicalPayoutSnapshotsUnavailable,
      historicalWithdrawalSnapshotsUnavailable: financialAfter.historicalWithdrawalSnapshotsUnavailable
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if ((verify || apply) && strictFailures > 0) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => null);
  });
