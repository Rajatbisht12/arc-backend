/**
 * Creator Earnings Calculation Service.
 * CPM-based earnings: (totalClipViews / 1000) × CPM per creator per cycle.
 * Stores final payable amount in EarningsSnapshot per payout cycle.
 */

const Post = require('../models/Post');
const User = require('../models/User');
const EarningsSnapshot = require('../models/EarningsSnapshot');
const PayoutCycle = require('../models/PayoutCycle');
const CreatorPayout = require('../models/CreatorPayout');
const CreatorPayoutHistory = require('../models/CreatorPayoutHistory');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const CreatorDisbursementReservation = require('../models/CreatorDisbursementReservation');
const PostEngagement = require('../models/PostEngagement');
const { randomUUID } = require('crypto');
const { buildUniquePostViewPipeline } = require('./postEngagementAnalytics');
const { FINANCIAL_TRANSACTION_OPTIONS, startFinancialSession } = require('../utils/financialTransactions');
const { createSystemNotification } = require('../utils/notificationService');
const { EMAIL_INTENTS } = require('../utils/notificationChannelPolicy');
const log = require('../utils/logger');

// Platform keeps a share; kept for audit purposes
const PLATFORM_REVENUE_SHARE_PERCENT = 30;

/** Platform-wide default CPM (INR per 1,000 views) — overridden per creator by admin */
const PLATFORM_DEFAULT_CPM = Number(process.env.PLATFORM_DEFAULT_CPM) || 50;

/** Max payout per creator per cycle (INR) */
const MAX_PAYOUT_PER_CREATOR = Number(process.env.MAX_PAYOUT_PER_CREATOR) || 10000;

const configuredCloseLeaseMs = Number(process.env.MONETIZATION_CLOSE_LEASE_MS);
const PAYOUT_CLOSE_LEASE_MS = Number.isFinite(configuredCloseLeaseMs) && configuredCloseLeaseMs >= 60_000
  ? Math.min(configuredCloseLeaseMs, 24 * 60 * 60 * 1000)
  : 30 * 60 * 1000;
const PAYOUT_CLOSE_HEARTBEAT_MS = Math.max(15_000, Math.min(60_000, Math.floor(PAYOUT_CLOSE_LEASE_MS / 4)));
const toMinorUnits = (amount) => Math.max(0, Math.round((Number(amount) || 0) * 100));
const snapshotFinancialFields = (grossAmount, finalAmount) => ({
  amount: finalAmount,
  amountMinor: toMinorUnits(finalAmount),
  currency: 'INR',
  breakdown: {
    organicRevenue: grossAmount,
    bonusRevenue: 0,
    referralRevenue: 0,
    platformAdjustments: Math.round((finalAmount - grossAmount) * 100) / 100,
    taxes: 0,
    grossAmount,
    finalPayoutAmount: finalAmount
  }
});

const payoutEmail = (eventType) => ({
  email: {
    intent: EMAIL_INTENTS.PAYMENT_TRANSACTIONAL,
    eventType,
    templateKey: `creator_${eventType}`,
    triggerSource: 'creator.earnings.cycle_close'
  }
});

async function notifyPayoutGenerated(payout, cycle) {
  if (!payout?._id || !payout?.user) return;
  await createSystemNotification(
    payout.user,
    'Creator payout generated',
    `Your creator payout of ₹${Number(payout.amount || 0).toFixed(2)} for ${cycle.cycleLabel} has been generated.`,
    {
      type: 'payout_generated',
      payoutId: payout._id,
      cycleLabel: cycle.cycleLabel,
      customData: {
        notificationDedupeKey: `creator-payout-generated:${String(payout._id)}`
      }
    },
    payoutEmail('payout_generated')
  );
}

async function ensureAutomaticPayoutHistory({ payout, snapshots = [], cycle, session }) {
  const exists = await CreatorPayoutHistory.exists({ payout: payout._id, action: 'generated' }).session(session);
  if (exists) return;
  const amountMinor = Number.isSafeInteger(payout.amountMinor)
    ? payout.amountMinor
    : toMinorUnits(payout.amount);
  const sourceSnapshotIds = (snapshots.length > 0 ? snapshots.map((snapshot) => snapshot?._id) : (payout.sourceSnapshots || []))
    .filter(Boolean)
    .map(String);
  await CreatorPayoutHistory.create([{
    payout: payout._id,
    user: payout.user,
    payoutCycle: payout.payoutCycle,
    action: 'generated',
    previousStatus: '',
    newStatus: payout.status || 'pending',
    amount: payout.amount,
    amountMinor,
    currency: payout.currency || 'INR',
    idempotencyKey: `cycle-close:${String(cycle._id)}:payout:${String(payout._id)}`,
    actor: {
      actorKey: 'system:payout-cron',
      user: null,
      username: 'payout-cron',
      role: 'system'
    },
    reason: 'Generated during leased payout-cycle close',
    metadata: {
      sourceSnapshotIds,
      sourceSnapshotCount: sourceSnapshotIds.length,
      cycleLabel: cycle.cycleLabel
    }
  }], { session });
}

async function acquireCycleCloseLease(cycleLabel) {
  const now = new Date();
  const leaseKey = randomUUID();
  const closeLeaseExpiresAt = new Date(now.getTime() + PAYOUT_CLOSE_LEASE_MS);
  const cycle = await PayoutCycle.findOneAndUpdate(
    {
      cycleLabel,
      payoutExecutedAt: null,
      status: { $in: ['open', 'closing', 'closed'] },
      $or: [
        { closeLeaseExpiresAt: null },
        { closeLeaseExpiresAt: { $exists: false } },
        { closeLeaseExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: 'closing',
        closeLeaseKey: leaseKey,
        closeLeaseExpiresAt,
        closeLastAttemptAt: now,
        closeLastError: ''
      },
      $inc: { closeAttemptCount: 1 }
    },
    { new: true, runValidators: true }
  );
  if (!cycle) return null;

  // Keep the first start timestamp with a separate guarded update: payout
  // cycles already exist before the close worker acquires them.
  if (!cycle.closeStartedAt) {
    await PayoutCycle.updateOne(
      { _id: cycle._id, closeLeaseKey: leaseKey, closeStartedAt: null },
      { $set: { closeStartedAt: now } }
    );
    cycle.closeStartedAt = now;
  }
  return { cycle, leaseKey };
}

async function renewCycleCloseLease(cycleId, leaseKey) {
  const result = await PayoutCycle.updateOne(
    { _id: cycleId, status: 'closing', closeLeaseKey: leaseKey, payoutExecutedAt: null },
    { $set: { closeLeaseExpiresAt: new Date(Date.now() + PAYOUT_CLOSE_LEASE_MS) } }
  );
  if (result.matchedCount !== 1) {
    const error = new Error('Payout-cycle close lease was lost.');
    error.code = 'PAYOUT_CLOSE_LEASE_LOST';
    throw error;
  }
}

/**
 * Get current open payout cycle (monthly). Creates one if none exists.
 */
async function getOrCreateCurrentCycle() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const cycleLabel = `${year}-${String(month + 1).padStart(2, '0')}`;

  try {
    return await PayoutCycle.findOneAndUpdate(
      { cycleLabel },
      { $setOnInsert: {
        cycleLabel,
        periodType: 'monthly',
        startDate,
        endDate,
        status: 'open',
        minimumPayoutThreshold: 500
      } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await PayoutCycle.findOne({ cycleLabel });
    if (!winner) throw error;
    return winner;
  }
}

/**
 * Calculate CPM-based earnings for one creator in a cycle.
 * Returns { amount, inputs } where amount is in INR (rounded to 2 decimal places).
 */
async function calculateCreatorEarnings(userId, cycle) {
  const user = await User.findById(userId).select('creatorCpm').lean();
  const cpm = (user?.creatorCpm != null && user.creatorCpm > 0)
    ? user.creatorCpm
    : PLATFORM_DEFAULT_CPM;

  const posts = await Post.find({
    author: userId,
    isActive: true,
    hiddenByAdmin: { $ne: true },
    'content.media': { $elemMatch: { type: 'video' } }
  }).select('_id').lean();

  let totalClipViews = 0;
  if (posts.length > 0) {
    const rows = await PostEngagement.aggregate(buildUniquePostViewPipeline({
      postIds: posts.map((post) => post._id),
      source: 'organic',
      sinceDate: cycle.startDate,
      untilDate: cycle.endDate,
      groupBy: 'total'
    }));
    totalClipViews = rows[0]?.views || 0;
  }

  const amount = Math.round((totalClipViews / 1000) * cpm * 100) / 100;
  return {
    amount,
    inputs: {
      totalClipViews,
      totalOrganicClipViews: totalClipViews,
      cpm,
      platformSharePercent: PLATFORM_REVENUE_SHARE_PERCENT
    }
  };
}

/**
 * Run full CPM earnings calculation for a cycle: compute per-creator earnings,
 * cap at MAX_PAYOUT_PER_CREATOR, save EarningsSnapshot for each.
 */
async function runEarningsForCycle(cycleId, { leaseKey = '', heartbeat = null } = {}) {
  const cycle = await PayoutCycle.findById(cycleId).select('+closeLeaseKey');
  const leaseOwned = Boolean(leaseKey) && cycle?.status === 'closing' && cycle?.closeLeaseKey === leaseKey;
  if (!cycle || (!leaseOwned && cycle.status !== 'open')) {
    throw new Error('Cycle not found, not open, or close lease is not owned');
  }

  const approvedCreators = await User.find({
    userType: 'player',
    isCreator: true,
    creatorMonetizationStatus: 'approved',
    isActive: true
  }).select('_id').lean();

  let creatorsUpdated = 0;
  let reservedSnapshotsSkipped = 0;
  for (const u of approvedCreators) {
    if (heartbeat) await heartbeat();
    const { amount, inputs } = await calculateCreatorEarnings(u._id, cycle);
    const cappedAmount = Math.min(amount, MAX_PAYOUT_PER_CREATOR);
    const financialFields = snapshotFinancialFields(amount, cappedAmount);

    const existing = await EarningsSnapshot.findOne({ user: u._id, payoutCycle: cycleId })
      .select('_id disbursementReservedAt disbursementId')
      .lean();
    if (existing?.disbursementReservedAt || existing?.disbursementId) {
      reservedSnapshotsSkipped += 1;
      continue;
    }

    if (existing) {
      const result = await EarningsSnapshot.updateOne(
        { _id: existing._id, disbursementReservedAt: null, disbursementId: null },
        { $set: { ...financialFields, inputs, calculatedAt: new Date() } },
        { runValidators: true }
      );
      if (result.matchedCount !== 1) {
        reservedSnapshotsSkipped += 1;
        continue;
      }
      creatorsUpdated += 1;
      continue;
    }

    try {
      await EarningsSnapshot.create({
        user: u._id,
        payoutCycle: cycleId,
        ...financialFields,
        inputs,
        held: false,
        holdReason: '',
        calculatedAt: new Date()
      });
      creatorsUpdated += 1;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Another legitimate calculation may have inserted the snapshot. Never
      // overwrite it here: it may already have been reserved for disbursement.
      reservedSnapshotsSkipped += 1;
    }
  }

  return {
    creatorsProcessed: approvedCreators.length,
    creatorsUpdated,
    reservedSnapshotsSkipped,
    cycleId
  };
}

/**
 * Get estimated earnings for current cycle for one creator (from snapshot or live CPM calc).
 */
async function getEstimatedEarningsForCreator(userId) {
  const cycle = await getOrCreateCurrentCycle();
  let snapshot = await EarningsSnapshot.findOne({ user: userId, payoutCycle: cycle._id }).lean();
  if (!snapshot) {
    const { amount, inputs } = await calculateCreatorEarnings(userId, cycle);
    const cappedAmount = Math.min(amount, MAX_PAYOUT_PER_CREATOR);
    const financialFields = snapshotFinancialFields(amount, cappedAmount);
    return {
      amount: cappedAmount,
      amountMinor: financialFields.amountMinor,
      currency: financialFields.currency,
      breakdown: financialFields.breakdown,
      cycleId: cycle._id,
      cycleLabel: cycle.cycleLabel,
      cycleEndDate: cycle.endDate,
      inputs,
      isEstimate: true
    };
  }
  return {
    amount: snapshot.amount,
    amountMinor: Number.isSafeInteger(snapshot.amountMinor) ? snapshot.amountMinor : toMinorUnits(snapshot.amount),
    currency: snapshot.currency || 'INR',
    breakdown: snapshot.breakdown || snapshotFinancialFields(snapshot.amount, snapshot.amount).breakdown,
    cycleId: cycle._id,
    cycleLabel: cycle.cycleLabel,
    cycleEndDate: cycle.endDate,
    inputs: snapshot.inputs,
    isEstimate: false,
    held: snapshot.held
  };
}

/**
 * Close the previous month's cycle: run earnings, then create CreatorPayout (pending) for each above threshold.
 * Call on 1st of each month (cron).
 */
async function closePreviousCycleAndCreatePayouts() {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const cycleLabel = `${year}-${String(prevMonth + 1).padStart(2, '0')}`;
  const lease = await acquireCycleCloseLease(cycleLabel);
  if (!lease) {
    const current = await PayoutCycle.findOne({ cycleLabel }).select('status payoutExecutedAt closeLeaseExpiresAt').lean();
    if (!current) return { done: false, reason: 'Cycle not found' };
    if (current.payoutExecutedAt || current.status === 'paid') {
      return { done: false, reason: 'Cycle already closed' };
    }
    return { done: false, reason: 'Cycle close is already running', retryAfter: current.closeLeaseExpiresAt || null };
  }

  let cycle = lease.cycle;
  const leaseKey = lease.leaseKey;
  let lastLeaseRenewedAt = Date.now();
  const heartbeat = async (force = false) => {
    if (!force && Date.now() - lastLeaseRenewedAt < PAYOUT_CLOSE_HEARTBEAT_MS) return;
    await renewCycleCloseLease(cycle._id, leaseKey);
    lastLeaseRenewedAt = Date.now();
  };

  try {
    if (!cycle.earningsFinalizedAt) {
      await runEarningsForCycle(cycle._id, { leaseKey, heartbeat });
      await heartbeat(true);
      cycle = await PayoutCycle.findOneAndUpdate(
        { _id: cycle._id, status: 'closing', closeLeaseKey: leaseKey, payoutExecutedAt: null },
        { $set: { earningsFinalizedAt: new Date() } },
        { new: true, runValidators: true }
      );
      if (!cycle) {
        const error = new Error('Payout-cycle close lease was lost before earnings were finalized.');
        error.code = 'PAYOUT_CLOSE_LEASE_LOST';
        throw error;
      }
    }

    const threshold = cycle.minimumPayoutThreshold ?? 500;
    const thresholdMinor = toMinorUnits(threshold);
    const approvedCreatorIds = await User.distinct('_id', {
      userType: 'player',
      isCreator: true,
      creatorMonetizationStatus: 'approved',
      isActive: true
    });
    const carryForwardCycleIds = await PayoutCycle.distinct('_id', {
      endDate: { $lte: cycle.endDate },
      $or: [
        { status: { $in: ['closed', 'paid'] } },
        { _id: cycle._id, earningsFinalizedAt: { $ne: null } }
      ]
    });
    const unreservedSnapshotFilter = {
      payoutCycle: { $in: carryForwardCycleIds },
      held: { $ne: true },
      disbursementReservedAt: null,
      disbursementId: null,
      amount: { $gt: 0 },
      $or: [
        { currency: 'INR' },
        { currency: null },
        { currency: { $exists: false } }
      ]
    };
    const [candidateCreatorIds, reservationCreatorIds, payoutCreatorIds, withdrawalCreatorIds] = await Promise.all([
      EarningsSnapshot.distinct('user', {
        ...unreservedSnapshotFilter,
        user: { $in: approvedCreatorIds }
      }),
      CreatorDisbursementReservation.distinct('user', { payoutCycle: cycle._id }),
      CreatorPayout.distinct('user', { payoutCycle: cycle._id }),
      WithdrawalRequest.distinct('user', { payoutCycle: cycle._id })
    ]);
    const creatorIds = [...new Map([
      ...candidateCreatorIds,
      ...reservationCreatorIds,
      ...payoutCreatorIds,
      ...withdrawalCreatorIds
    ].map((id) => [String(id), id])).values()];
    let payoutsCreated = 0;
    let withdrawalsSkipped = 0;
    let sourceSnapshotsClaimed = 0;

    for (const creatorId of creatorIds) {
      await heartbeat();
      let session;
      let payoutToNotify = null;
      try {
        session = await startFinancialSession();
        const outcome = await session.withTransaction(async () => {
          payoutToNotify = null;
          const existingReservation = await CreatorDisbursementReservation.findOne({
            user: creatorId,
            payoutCycle: cycle._id
          }).session(session).lean();

          const reconcilePayoutSnapshotLinks = async (payout) => {
            let claimedSnapshots = await EarningsSnapshot.find({
              user: creatorId,
              disbursementSource: 'creator_payout',
              disbursementId: payout._id
            }).session(session).lean();

            // Legacy payouts predate snapshot claims. Link either their
            // explicit immutable source list or one exact-cycle snapshot when
            // its liability equals the payout. Never enlarge or rewrite an
            // existing payout during reconciliation.
            if (claimedSnapshots.length === 0) {
              const payoutMinor = Number.isSafeInteger(payout.amountMinor)
                ? payout.amountMinor
                : toMinorUnits(payout.amount);
              const explicitSnapshotIds = Array.isArray(payout.sourceSnapshots)
                ? payout.sourceSnapshots.filter(Boolean)
                : [];
              let linkCandidates = explicitSnapshotIds.length > 0
                ? await EarningsSnapshot.find({
                    _id: { $in: explicitSnapshotIds },
                    user: creatorId,
                    held: { $ne: true },
                    disbursementReservedAt: null,
                    disbursementId: null
                  }).session(session).lean()
                : [];
              if (linkCandidates.length !== explicitSnapshotIds.length || linkCandidates.length === 0) {
                const currentSnapshot = await EarningsSnapshot.findOne({
                  user: creatorId,
                  payoutCycle: payout.payoutCycle,
                  held: { $ne: true },
                  disbursementReservedAt: null,
                  disbursementId: null
                }).session(session).lean();
                linkCandidates = currentSnapshot ? [currentSnapshot] : [];
              }
              const candidateMinor = linkCandidates.reduce((sum, item) => (
                sum + (Number.isSafeInteger(item.amountMinor) ? item.amountMinor : toMinorUnits(item.amount))
              ), 0);
              if (linkCandidates.length > 0 && payoutMinor === candidateMinor) {
                const claimTime = new Date();
                const linked = await EarningsSnapshot.updateMany(
                  {
                    _id: { $in: linkCandidates.map((item) => item._id) },
                    held: { $ne: true },
                    disbursementReservedAt: null,
                    disbursementId: null
                  },
                  { $set: {
                    disbursementReservedAt: claimTime,
                    disbursementSource: 'creator_payout',
                    disbursementId: payout._id
                  } },
                  { session }
                );
                if (linked.matchedCount === linkCandidates.length) {
                  claimedSnapshots = linkCandidates.map((item) => ({ ...item, disbursementReservedAt: claimTime }));
                }
              }
            }
            return claimedSnapshots;
          };

          if (existingReservation) {
            if (existingReservation.source === 'creator_payout') {
              payoutToNotify = await CreatorPayout.findById(existingReservation.sourceId).session(session).lean();
              if (!payoutToNotify) {
                const error = new Error('Creator payout reservation target is missing.');
                error.code = 'PAYOUT_RESERVATION_TARGET_MISSING';
                throw error;
              }
              const claimedSnapshots = await reconcilePayoutSnapshotLinks(payoutToNotify);
              await ensureAutomaticPayoutHistory({ payout: payoutToNotify, snapshots: claimedSnapshots, cycle, session });
              return {
                type: 'existing_payout',
                snapshotCount: claimedSnapshots.length,
                shouldNotifyGenerated: ['pending', 'approved', 'processing', 'held'].includes(payoutToNotify.status)
              };
            }
            const withdrawal = await WithdrawalRequest.exists({ _id: existingReservation.sourceId }).session(session);
            if (!withdrawal) {
              const error = new Error('Withdrawal reservation target is missing.');
              error.code = 'WITHDRAWAL_RESERVATION_TARGET_MISSING';
              throw error;
            }
            return { type: 'withdrawal', snapshotCount: 0 };
          }

          // MongoDB sessions do not support parallel operations inside one
          // transaction; keep these reads ordered on the same session.
          const existingPayout = await CreatorPayout.findOne({ user: creatorId, payoutCycle: cycle._id }).session(session);
          const existingWithdrawal = await WithdrawalRequest.findOne({ user: creatorId, payoutCycle: cycle._id }).session(session);
          if (existingPayout && existingWithdrawal) {
            const error = new Error('Multiple disbursement paths exist for the same creator and cycle.');
            error.code = 'DUPLICATE_DISBURSEMENT_PATHS';
            throw error;
          }
          if (existingPayout) {
            if (['failed', 'rejected', 'cancelled'].includes(existingPayout.status)) {
              // An administrator intentionally terminated this attempt. Do
              // not silently resurrect it during close; released snapshots
              // remain available for a later explicit/new-cycle attempt.
              return { type: 'terminal_payout', snapshotCount: 0 };
            }
            await CreatorDisbursementReservation.create([{
              user: creatorId,
              payoutCycle: cycle._id,
              source: 'creator_payout',
              sourceId: existingPayout._id
            }], { session });
            payoutToNotify = existingPayout.toObject();
            const claimedSnapshots = await reconcilePayoutSnapshotLinks(payoutToNotify);
            await ensureAutomaticPayoutHistory({ payout: payoutToNotify, snapshots: claimedSnapshots, cycle, session });
            return {
              type: 'existing_payout',
              snapshotCount: claimedSnapshots.length,
              shouldNotifyGenerated: ['pending', 'approved', 'processing', 'held'].includes(payoutToNotify.status)
            };
          }
          if (existingWithdrawal) {
            if (['failed', 'rejected', 'cancelled'].includes(existingWithdrawal.status)) {
              return { type: 'terminal_withdrawal', snapshotCount: 0 };
            }
            await CreatorDisbursementReservation.create([{
              user: creatorId,
              payoutCycle: cycle._id,
              source: 'withdrawal',
              sourceId: existingWithdrawal._id
            }], { session });
            return { type: 'withdrawal', snapshotCount: 0 };
          }

          const eligibleCreator = await User.exists({
            _id: creatorId,
            userType: 'player',
            isCreator: true,
            creatorMonetizationStatus: 'approved',
            isActive: true
          }).session(session);
          if (!eligibleCreator) return { type: 'ineligible', snapshotCount: 0 };

          // Legacy payouts/withdrawals did not always stamp the snapshot. A
          // missing modern claim must not make already-paid earnings payable
          // again. Failed/rejected/cancelled attempts are retryable only after
          // their snapshot claim has been released.
          const blockingPayouts = await CreatorPayout.find({
            user: creatorId,
            payoutCycle: { $in: carryForwardCycleIds },
            status: { $nin: ['failed', 'rejected', 'cancelled'] }
          }).select('payoutCycle').session(session).lean();
          const blockingWithdrawals = await WithdrawalRequest.find({
            user: creatorId,
            payoutCycle: { $in: carryForwardCycleIds },
            status: { $nin: ['failed', 'rejected', 'cancelled'] }
          }).select('payoutCycle').session(session).lean();
          const blockedLegacyCycleIds = new Set([
            ...blockingPayouts.map((item) => String(item.payoutCycle)),
            ...blockingWithdrawals.map((item) => String(item.payoutCycle))
          ]);
          const carryForwardSnapshots = (await EarningsSnapshot.find({
            ...unreservedSnapshotFilter,
            user: creatorId
          }).sort({ calculatedAt: 1, _id: 1 }).session(session).lean())
            .filter((item) => !blockedLegacyCycleIds.has(String(item.payoutCycle)));
          const totalAmountMinor = carryForwardSnapshots.reduce((sum, item) => (
            sum + (Number.isSafeInteger(item.amountMinor) ? item.amountMinor : toMinorUnits(item.amount))
          ), 0);
          if (carryForwardSnapshots.length === 0 || totalAmountMinor < thresholdMinor) {
            return { type: 'below_threshold', snapshotCount: 0 };
          }

          const payout = new CreatorPayout({
            user: creatorId,
            payoutCycle: cycle._id,
            amount: Math.round(totalAmountMinor) / 100,
            amountMinor: totalAmountMinor,
            currency: 'INR',
            sourceSnapshots: carryForwardSnapshots.map((item) => item._id),
            status: 'pending'
          });
          const claimTime = new Date();
          const snapshotClaim = await EarningsSnapshot.updateMany(
            {
              _id: { $in: carryForwardSnapshots.map((item) => item._id) },
              held: { $ne: true },
              disbursementReservedAt: null,
              disbursementId: null
            },
            { $set: { disbursementReservedAt: claimTime, disbursementSource: 'creator_payout', disbursementId: payout._id } },
            { session }
          );
          if (snapshotClaim.matchedCount !== carryForwardSnapshots.length) {
            const error = new Error('One or more carry-forward earnings snapshots changed while being reserved.');
            error.code = 'EARNINGS_CARRY_FORWARD_CONFLICT';
            throw error;
          }
          await CreatorDisbursementReservation.create([{
            user: creatorId,
            payoutCycle: cycle._id,
            source: 'creator_payout',
            sourceId: payout._id
          }], { session });
          await payout.save({ session });
          payoutToNotify = payout.toObject();
          await ensureAutomaticPayoutHistory({ payout: payoutToNotify, snapshots: carryForwardSnapshots, cycle, session });
          return { type: 'created', snapshotCount: carryForwardSnapshots.length };
        }, FINANCIAL_TRANSACTION_OPTIONS);
        if (outcome?.type === 'created') payoutsCreated += 1;
        if (outcome?.type === 'withdrawal') withdrawalsSkipped += 1;
        if (outcome?.type === 'created') sourceSnapshotsClaimed += Number(outcome.snapshotCount || 0);
        if (
          payoutToNotify &&
          (outcome?.type === 'created' || outcome?.type === 'existing_payout') &&
          outcome?.shouldNotifyGenerated !== false
        ) {
          await notifyPayoutGenerated(payoutToNotify, cycle);
        }
      } catch (error) {
        // A concurrent withdrawal may win the unique reservation. Abort this
        // close attempt so the next leased pass reconciles the winner before
        // the cycle can be marked fully executed.
        throw error;
      } finally {
        if (session) await session.endSession().catch(() => null);
      }
    }

    await heartbeat(true);
    const completedAt = new Date();
    const completed = await PayoutCycle.findOneAndUpdate(
      { _id: cycle._id, status: 'closing', closeLeaseKey: leaseKey, payoutExecutedAt: null },
      {
        $set: {
          status: 'closed',
          payoutExecutedAt: completedAt,
          closeCompletedAt: completedAt,
          closeLastError: ''
        },
        $unset: { closeLeaseKey: 1, closeLeaseExpiresAt: 1 }
      },
      { new: true, runValidators: true }
    );
    if (!completed) {
      const error = new Error('Payout-cycle close lease was lost before completion.');
      error.code = 'PAYOUT_CLOSE_LEASE_LOST';
      throw error;
    }
    return { done: true, cycleLabel, payoutsCreated, withdrawalsSkipped, sourceSnapshotsClaimed };
  } catch (error) {
    await PayoutCycle.updateOne(
      { _id: cycle._id, closeLeaseKey: leaseKey },
      {
        $set: {
          closeLeaseExpiresAt: new Date(),
          closeLastError: String(error?.message || error).slice(0, 1000)
        },
        $unset: { closeLeaseKey: 1 }
      }
    ).catch((leaseError) => {
      log.error('Failed to release payout close lease after error', {
        cycleLabel,
        error: String(leaseError)
      });
    });
    throw error;
  }
}

module.exports = {
  getOrCreateCurrentCycle,
  calculateCreatorEarnings,
  runEarningsForCycle,
  getEstimatedEarningsForCreator,
  closePreviousCycleAndCreatePayouts,
  PLATFORM_DEFAULT_CPM,
  MAX_PAYOUT_PER_CREATOR,
  PLATFORM_REVENUE_SHARE_PERCENT
};
