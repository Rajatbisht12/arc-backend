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
if (apply && verify) {
  console.error('Use only one of --apply or --verify');
  process.exit(1);
}

const modelPath = (name) => path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', `${name}.js`);
const CreatorPayout = require(modelPath('CreatorPayout'));
const CreatorPayoutHistory = require(modelPath('CreatorPayoutHistory'));
const CreatorDisbursementReservation = require(modelPath('CreatorDisbursementReservation'));
const EarningsSnapshot = require(modelPath('EarningsSnapshot'));
const PayoutCycle = require(modelPath('PayoutCycle'));
const WithdrawalRequest = require(modelPath('WithdrawalRequest'));
const PostEngagement = require(modelPath('PostEngagement'));
const BoostDeliveryAttribution = require(modelPath('BoostDeliveryAttribution'));
const ProfileVisitDaily = require(modelPath('ProfileVisitDaily'));
const User = require(modelPath('User'));

const connectOptions = {
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  readPreference: 'primary',
  serverSelectionTimeoutMS: 15_000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {})
  } : {})
};

const toMinor = (amount) => Math.max(0, Math.round((Number(amount) || 0) * 100));
const missingNamespace = (error) => error?.code === 26 || /namespace.*not found/i.test(error?.message || '');

async function collectionIndexes(Model) {
  try {
    return await Model.collection.indexes();
  } catch (error) {
    if (missingNamespace(error)) return [];
    throw error;
  }
}

const hasIndex = (indexes, key, unique = false) => indexes.some((index) => {
  const left = Object.entries(index.key || {});
  const right = Object.entries(key);
  return left.length === right.length && left.every(([name, direction], position) => right[position]?.[0] === name && right[position]?.[1] === direction) && (!unique || index.unique === true);
});

async function scan() {
  const [
    payouts,
    snapshots,
    withdrawals,
    histories,
    reservations,
    payoutIndexes,
    historyIndexes,
    snapshotIndexes,
    cycleIndexes,
    reservationIndexes,
    engagementIndexes,
    attributionIndexes,
    profileVisitIndexes
  ] = await Promise.all([
    CreatorPayout.find({}).select('_id user payoutCycle sourceSnapshots amount amountMinor currency version attemptNumber status paidAt paymentDate').lean(),
    EarningsSnapshot.find({}).select('_id user payoutCycle amount amountMinor currency breakdown disbursementReservedAt disbursementId').lean(),
    WithdrawalRequest.find({}).select('_id user payoutCycle amount amountMinor currency status paidAt paymentDate').lean(),
    CreatorPayoutHistory.find({ action: 'generated' }).select('payout').lean(),
    CreatorDisbursementReservation.find({}).select('_id user payoutCycle source sourceId').lean(),
    collectionIndexes(CreatorPayout),
    collectionIndexes(CreatorPayoutHistory),
    collectionIndexes(EarningsSnapshot),
    collectionIndexes(PayoutCycle),
    collectionIndexes(CreatorDisbursementReservation),
    collectionIndexes(PostEngagement),
    collectionIndexes(BoostDeliveryAttribution),
    collectionIndexes(ProfileVisitDaily)
  ]);
  const historyIds = new Set(histories.map((row) => String(row.payout)));
  const ownerIds = [...new Set([...payouts, ...snapshots, ...withdrawals, ...reservations].map((row) => String(row.user)).filter(Boolean))];
  const existingOwners = ownerIds.length ? await User.distinct('_id', { _id: { $in: ownerIds } }) : [];
  const existingOwnerIds = new Set(existingOwners.map(String));
  const payoutIds = new Set(payouts.map((row) => String(row._id)));
  const withdrawalIds = new Set(withdrawals.map((row) => String(row._id)));
  const snapshotIds = new Set(snapshots.map((row) => String(row._id)));
  const targetExists = (source, sourceId) => source === 'creator_payout'
    ? payoutIds.has(String(sourceId))
    : source === 'withdrawal' && withdrawalIds.has(String(sourceId));
  const reservationTargetIds = new Set(reservations.map((row) => String(row.sourceId)));
  const disbursementClaimIds = new Set(snapshots.filter((row) => row.disbursementId).map((row) => String(row.disbursementId)));
  const report = {
    payouts: {
      total: payouts.length,
      missingMinorUnits: payouts.filter((row) => !Number.isSafeInteger(row.amountMinor) || row.amountMinor !== toMinor(row.amount)).length,
      missingCurrency: payouts.filter((row) => !row.currency).length,
      missingVersion: payouts.filter((row) => !Number.isInteger(row.version)).length,
      missingAttemptNumber: payouts.filter((row) => !Number.isInteger(row.attemptNumber) || row.attemptNumber < 1).length,
      paidWithoutPaymentDate: payouts.filter((row) => ['paid', 'completed'].includes(row.status) && !row.paymentDate).length,
      paidWithoutProvableDate: payouts.filter((row) => ['paid', 'completed'].includes(row.status) && !row.paymentDate && !row.paidAt).length,
      missingGeneratedHistory: payouts.filter((row) => !historyIds.has(String(row._id))).length,
      missingSourceSnapshots: payouts.filter((row) => !Array.isArray(row.sourceSnapshots) || row.sourceSnapshots.length === 0).length,
      unrecoverableSourceSnapshots: payouts.filter((row) => (!Array.isArray(row.sourceSnapshots) || row.sourceSnapshots.length === 0) && !disbursementClaimIds.has(String(row._id))).length,
      invalidSourceSnapshots: payouts.filter((row) => (row.sourceSnapshots || []).some((snapshotId) => !snapshotIds.has(String(snapshotId)))).length,
      orphanedOwners: payouts.filter((row) => !existingOwnerIds.has(String(row.user))).length
    },
    earningsSnapshots: {
      total: snapshots.length,
      missingMinorUnits: snapshots.filter((row) => !Number.isSafeInteger(row.amountMinor) || row.amountMinor !== toMinor(row.amount)).length,
      missingCurrency: snapshots.filter((row) => !row.currency).length,
      missingBreakdown: snapshots.filter((row) => row.breakdown?.finalPayoutAmount == null).length,
      inconsistentReservations: snapshots.filter((row) => Boolean(row.disbursementReservedAt) !== Boolean(row.disbursementId)).length,
      orphanedDisbursementTargets: snapshots.filter((row) => row.disbursementId && !payoutIds.has(String(row.disbursementId)) && !withdrawalIds.has(String(row.disbursementId))).length,
      reservationWithoutIdentity: snapshots.filter((row) => row.disbursementId && !reservationTargetIds.has(String(row.disbursementId))).length,
      orphanedOwners: snapshots.filter((row) => !existingOwnerIds.has(String(row.user))).length
    },
    withdrawals: {
      total: withdrawals.length,
      missingMinorUnits: withdrawals.filter((row) => !Number.isSafeInteger(row.amountMinor) || row.amountMinor !== toMinor(row.amount)).length,
      missingCurrency: withdrawals.filter((row) => !row.currency).length,
      paidWithoutPaymentDate: withdrawals.filter((row) => ['paid', 'completed'].includes(row.status) && !row.paymentDate).length,
      paidWithoutProvableDate: withdrawals.filter((row) => ['paid', 'completed'].includes(row.status) && !row.paymentDate && !row.paidAt).length,
      orphanedOwners: withdrawals.filter((row) => !existingOwnerIds.has(String(row.user))).length
    },
    reservations: {
      total: reservations.length,
      orphanedOwners: reservations.filter((row) => !existingOwnerIds.has(String(row.user))).length,
      orphanedTargets: reservations.filter((row) => !targetExists(row.source, row.sourceId)).length,
      withoutSnapshotClaim: reservations.filter((row) => !disbursementClaimIds.has(String(row.sourceId))).length
    },
    indexes: {
      payoutUserCycle: hasIndex(payoutIndexes, { user: 1, payoutCycle: 1 }, true),
      payoutStatusDate: hasIndex(payoutIndexes, { status: 1, paymentDate: -1, createdAt: -1 }),
      historyPayoutDate: hasIndex(historyIndexes, { payout: 1, createdAt: -1 }),
      historyIdempotency: hasIndex(historyIndexes, { payout: 1, idempotencyKey: 1 }, true),
      snapshotUserCycle: hasIndex(snapshotIndexes, { user: 1, payoutCycle: 1 }, true),
      cycleLabel: hasIndex(cycleIndexes, { cycleLabel: 1 }, true),
      reservationUserCycle: hasIndex(reservationIndexes, { user: 1, payoutCycle: 1 }, true),
      reservationSource: hasIndex(reservationIndexes, { source: 1, sourceId: 1 }, true),
      engagementAnalytics: hasIndex(engagementIndexes, { eventType: 1, source: 1, createdAt: -1, author: 1 }),
      boostAttributionIdentity: hasIndex(attributionIndexes, { user: 1, post: 1, campaign: 1, context: 1 }, true),
      boostAttributionTtl: hasIndex(attributionIndexes, { expiresAt: 1 }),
      profileVisitDailyIdentity: hasIndex(profileVisitIndexes, { profileOwner: 1, viewer: 1, day: 1 }, true),
      profileVisitAnalytics: hasIndex(profileVisitIndexes, { profileOwner: 1, day: -1 }),
      profileVisitRetentionTtl: hasIndex(profileVisitIndexes, { expiresAt: 1 })
    }
  };
  return report;
}

async function backfillPayouts() {
  let updated = 0;
  let histories = 0;
  const cursor = CreatorPayout.find({}).lean().cursor();
  for await (const payout of cursor) {
    const set = {};
    const amountMinor = toMinor(payout.amount);
    if (payout.amountMinor !== amountMinor) set.amountMinor = amountMinor;
    if (!payout.currency) set.currency = 'INR';
    if (!Number.isInteger(payout.version)) set.version = 0;
    if (!Number.isInteger(payout.attemptNumber) || payout.attemptNumber < 1) set.attemptNumber = 1;
    const sourceSnapshotIds = await EarningsSnapshot.distinct('_id', { disbursementId: payout._id });
    if (sourceSnapshotIds.length && sourceSnapshotIds.map(String).sort().join(',') !== (payout.sourceSnapshots || []).map(String).sort().join(',')) {
      set.sourceSnapshots = sourceSnapshotIds;
    }
    if (['paid', 'completed'].includes(payout.status) && !payout.paymentDate && payout.paidAt) set.paymentDate = payout.paidAt;
    if (Object.keys(set).length) {
      await CreatorPayout.collection.updateOne({ _id: payout._id }, { $set: set });
      updated += 1;
    }
    const existingHistory = await CreatorPayoutHistory.exists({ payout: payout._id, action: 'generated' });
    if (!existingHistory) {
      try {
        await CreatorPayoutHistory.create({
          payout: payout._id,
          user: payout.user,
          payoutCycle: payout.payoutCycle,
          action: 'generated',
          previousStatus: '',
          newStatus: payout.status || 'pending',
          amount: Number(payout.amount || 0),
          amountMinor,
          currency: payout.currency || 'INR',
          idempotencyKey: `migration:generated:${String(payout._id)}`,
          actor: { actorKey: 'system:monetization-migration', username: 'monetization-migration', role: 'system' },
          reason: 'Backfilled initial payout history for a legacy payout.',
          metadata: { migrated: true, originalCreatedAt: payout.createdAt || null }
        });
        histories += 1;
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
  }
  return { updated, histories };
}

async function backfillSnapshots() {
  let updated = 0;
  const cursor = EarningsSnapshot.find({}).lean().cursor();
  for await (const snapshot of cursor) {
    const gross = Number(snapshot.breakdown?.grossAmount ?? snapshot.amount ?? 0);
    const final = Number(snapshot.amount || 0);
    const set = {};
    if (snapshot.amountMinor !== toMinor(final)) set.amountMinor = toMinor(final);
    if (!snapshot.currency) set.currency = 'INR';
    if (snapshot.breakdown?.finalPayoutAmount == null) {
      set.breakdown = {
        organicRevenue: Number(snapshot.breakdown?.organicRevenue ?? gross),
        bonusRevenue: Number(snapshot.breakdown?.bonusRevenue || 0),
        referralRevenue: Number(snapshot.breakdown?.referralRevenue || 0),
        platformAdjustments: Number(snapshot.breakdown?.platformAdjustments ?? (final - gross)),
        taxes: Number(snapshot.breakdown?.taxes || 0),
        grossAmount: gross,
        finalPayoutAmount: final
      };
    }
    if (Object.keys(set).length) {
      await EarningsSnapshot.collection.updateOne({ _id: snapshot._id }, { $set: set });
      updated += 1;
    }
  }
  return updated;
}

async function backfillWithdrawals() {
  let updated = 0;
  const cursor = WithdrawalRequest.find({}).lean().cursor();
  for await (const withdrawal of cursor) {
    const set = {};
    const amountMinor = toMinor(withdrawal.amount);
    if (withdrawal.amountMinor !== amountMinor) set.amountMinor = amountMinor;
    if (!withdrawal.currency) set.currency = 'INR';
    if (['paid', 'completed'].includes(withdrawal.status) && !withdrawal.paymentDate && withdrawal.paidAt) set.paymentDate = withdrawal.paidAt;
    if (Object.keys(set).length) {
      await WithdrawalRequest.collection.updateOne({ _id: withdrawal._id }, { $set: set });
      updated += 1;
    }
  }
  return updated;
}

async function createRequiredIndexes() {
  for (const Model of [CreatorPayout, CreatorPayoutHistory, CreatorDisbursementReservation, EarningsSnapshot, PayoutCycle, PostEngagement, BoostDeliveryAttribution, ProfileVisitDaily]) {
    await Model.createIndexes();
  }
}

const verificationFailures = (report) => {
  const failures = [];
  if (report.payouts.missingMinorUnits) failures.push('payout amountMinor backfill incomplete');
  if (report.payouts.missingCurrency) failures.push('payout currency backfill incomplete');
  if (report.payouts.missingVersion) failures.push('payout version backfill incomplete');
  if (report.payouts.missingAttemptNumber) failures.push('payout attemptNumber backfill incomplete');
  if (report.payouts.paidWithoutPaymentDate) failures.push('paid payouts without a provable payment date require manual reconciliation');
  if (report.payouts.missingGeneratedHistory) failures.push('payout history backfill incomplete');
  if (report.payouts.missingSourceSnapshots) failures.push('payouts without immutable source snapshots require manual reconciliation');
  if (report.payouts.invalidSourceSnapshots) failures.push('payouts reference missing earnings snapshots');
  if (report.payouts.orphanedOwners) failures.push('payouts reference missing users');
  if (report.earningsSnapshots.missingMinorUnits) failures.push('earnings amountMinor backfill incomplete');
  if (report.earningsSnapshots.missingCurrency) failures.push('earnings currency backfill incomplete');
  if (report.earningsSnapshots.missingBreakdown) failures.push('earnings breakdown backfill incomplete');
  if (report.earningsSnapshots.inconsistentReservations) failures.push('inconsistent disbursement reservations require manual reconciliation');
  if (report.earningsSnapshots.orphanedDisbursementTargets) failures.push('earnings snapshots reference missing payout or withdrawal targets');
  if (report.earningsSnapshots.reservationWithoutIdentity) failures.push('earnings snapshots are missing cross-collection reservation identities');
  if (report.earningsSnapshots.orphanedOwners) failures.push('earnings snapshots reference missing users');
  if (report.withdrawals.missingMinorUnits) failures.push('withdrawal amountMinor backfill incomplete');
  if (report.withdrawals.missingCurrency) failures.push('withdrawal currency backfill incomplete');
  if (report.withdrawals.paidWithoutPaymentDate) failures.push('paid withdrawals without a provable payment date require manual reconciliation');
  if (report.withdrawals.orphanedOwners) failures.push('withdrawals reference missing users');
  if (report.reservations.orphanedOwners) failures.push('disbursement reservations reference missing users');
  if (report.reservations.orphanedTargets) failures.push('disbursement reservations reference missing payout or withdrawal targets');
  if (report.reservations.withoutSnapshotClaim) failures.push('disbursement reservations have no claimed earnings snapshot');
  for (const [name, present] of Object.entries(report.indexes)) if (!present) failures.push(`missing index: ${name}`);
  return failures;
};

const auditBlockingFailures = (report) => {
  const failures = [];
  if (report.payouts.paidWithoutProvableDate) failures.push('paid payouts have no provable payment date');
  if (report.payouts.unrecoverableSourceSnapshots) failures.push('payouts have no recoverable earnings source');
  if (report.payouts.invalidSourceSnapshots) failures.push('payouts reference missing earnings snapshots');
  if (report.payouts.orphanedOwners) failures.push('payouts reference missing users');
  if (report.earningsSnapshots.inconsistentReservations) failures.push('earnings reservations have incomplete identity fields');
  if (report.earningsSnapshots.orphanedDisbursementTargets) failures.push('earnings snapshots reference missing disbursement targets');
  if (report.earningsSnapshots.reservationWithoutIdentity) failures.push('earnings snapshots are missing reservation records');
  if (report.earningsSnapshots.orphanedOwners) failures.push('earnings snapshots reference missing users');
  if (report.withdrawals.paidWithoutProvableDate) failures.push('paid withdrawals have no provable payment date');
  if (report.withdrawals.orphanedOwners) failures.push('withdrawals reference missing users');
  if (report.reservations.orphanedOwners) failures.push('disbursement reservations reference missing users');
  if (report.reservations.orphanedTargets) failures.push('disbursement reservations reference missing targets');
  if (report.reservations.withoutSnapshotClaim) failures.push('disbursement reservations have no claimed earnings snapshot');
  return failures;
};

async function main() {
  await mongoose.connect(uri, connectOptions);
  try {
    const before = await scan();
    const blockers = auditBlockingFailures(before);
    console.log(JSON.stringify({ mode: apply ? 'apply' : verify ? 'verify' : 'audit', before, blockers }, null, 2));
    if (!apply && !verify && blockers.length) {
      process.exitCode = 2;
      return;
    }
    if (apply) {
      const changes = {
        payouts: await backfillPayouts(),
        earningsSnapshots: await backfillSnapshots(),
        withdrawals: await backfillWithdrawals()
      };
      await createRequiredIndexes();
      const after = await scan();
      const failures = verificationFailures(after);
      console.log(JSON.stringify({ changes, after, failures }, null, 2));
      if (failures.length) process.exitCode = 2;
      return;
    }
    if (verify) {
      const failures = verificationFailures(before);
      console.log(JSON.stringify({ failures }, null, 2));
      if (failures.length) process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
