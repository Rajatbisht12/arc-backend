const mongoose = require('mongoose');
const CreatorPayout = require('../models/CreatorPayout');
const CreatorPayoutHistory = require('../models/CreatorPayoutHistory');
const CreatorBankDetails = require('../models/CreatorBankDetails');
const CreatorDisbursementReservation = require('../models/CreatorDisbursementReservation');
const EarningsSnapshot = require('../models/EarningsSnapshot');
const PayoutCycle = require('../models/PayoutCycle');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const User = require('../models/User');
const { createSystemNotification } = require('../utils/notificationService');
const { EMAIL_INTENTS } = require('../utils/notificationChannelPolicy');
const {
  FINANCIAL_TRANSACTION_OPTIONS,
  startFinancialSession,
  maskedBankSnapshot
} = require('../utils/financialTransactions');
const log = require('../utils/logger');

const PAYMENT_METHODS = new Set(['bank_transfer', 'neft', 'rtgs', 'imps', 'upi', 'razorpay', 'cash', 'other']);
const ACTIVE_STATUSES = new Set(['pending', 'approved', 'processing', 'held']);
const TERMINAL_RETRYABLE_STATUSES = new Set(['failed', 'rejected', 'cancelled']);

const toMinor = (amount) => Math.max(0, Math.round((Number(amount) || 0) * 100));
const fromMinor = (amountMinor) => Math.round((Math.max(0, Number(amountMinor) || 0) / 100) * 100) / 100;

const errorWithStatus = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });

const actorFromRequest = (req) => ({
  actorKey: req.user?._id ? `user:${String(req.user._id)}` : `hardcoded:${String(req.user?.username || 'admin').toLowerCase()}`,
  user: req.user?._id || null,
  username: req.user?.username || 'admin',
  role: req.user?.adminRole || (req.user?.isSuperUser ? 'super_admin' : 'admin')
});

const requestMetadata = (req) => ({
  ip: String(req.ip || req.headers?.['x-forwarded-for'] || ''),
  userAgent: req.get ? (req.get('user-agent') || '') : ''
});

const paymentEmail = (eventType) => ({
  email: {
    intent: EMAIL_INTENTS.PAYMENT_TRANSACTIONAL,
    eventType,
    templateKey: `admin_${eventType}`,
    triggerSource: 'admin.creator_payout'
  }
});

const notifyPayout = async (payout, action) => {
  const labels = {
    generated: ['Payout Generated', `A creator payout of ${payout.currency || 'INR'} ${Number(payout.amount || 0).toFixed(2)} has been generated.`],
    approved: ['Payout Approved', 'Your creator payout has been approved.'],
    processing: ['Payout Processing', 'Your creator payout is being processed.'],
    held: ['Payout Held', 'Your creator payout has been placed on hold.'],
    resumed: ['Payout Resumed', 'Your creator payout has been resumed.'],
    paid: ['Payout Paid', `Your creator payout was paid successfully${payout.bankReference ? ` (Reference: ${payout.bankReference})` : ''}.`],
    failed: ['Payout Failed', `Your creator payout failed${payout.failureReason ? `: ${payout.failureReason}` : '.'}`],
    rejected: ['Payout Rejected', `Your creator payout was rejected${payout.failureReason ? `: ${payout.failureReason}` : '.'}`],
    cancelled: ['Payout Cancelled', `Your creator payout was cancelled${payout.cancellationReason ? `: ${payout.cancellationReason}` : '.'}`]
  };
  const [title, message] = labels[action] || ['Payout Updated', `Your payout status is now ${payout.status}.`];
  const emailActions = new Set(['generated', 'paid', 'failed']);
  await createSystemNotification(
    payout.user,
    title,
    message,
    {
      type: `creator_payout_${action}`,
      payoutId: payout._id,
      status: payout.status,
      notificationDedupeKey: `creator-payout-${action}:${String(payout._id)}`
    },
    ...(emailActions.has(action) ? [paymentEmail(`payout_${action}`)] : [])
  );
};

const createHistory = async ({ payout, action, previousStatus = '', newStatus = '', actor, req, reason = '', payment = {}, idempotencyKey = '', metadata = {}, session }) => {
  const request = requestMetadata(req);
  const amountMinor = Number.isSafeInteger(payout.amountMinor) ? payout.amountMinor : toMinor(payout.amount);
  return CreatorPayoutHistory.create([{
    payout: payout._id,
    user: payout.user,
    payoutCycle: payout.payoutCycle,
    action,
    previousStatus,
    newStatus,
    amount: fromMinor(amountMinor),
    amountMinor,
    currency: payout.currency || 'INR',
    idempotencyKey,
    payment: {
      transactionId: payment.transactionId || '',
      referenceNumber: payment.referenceNumber || '',
      method: payment.paymentMethod || payment.method || '',
      notes: payment.notes || '',
      paymentDate: payment.paymentDate || null
    },
    actor,
    reason,
    ip: request.ip,
    userAgent: request.userAgent,
    metadata
  }], { session });
};

const normalizePaymentPayload = (payload, payout) => {
  const referenceNumber = String(payload.referenceNumber || payload.bankReference || '').trim().slice(0, 120);
  const transactionId = String(payload.transactionId || '').trim().slice(0, 120);
  const paymentMethod = String(payload.paymentMethod || '').trim().toLowerCase();
  const notes = String(payload.notes || '').trim().slice(0, 1000);
  const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
  if (referenceNumber.length < 3) throw errorWithStatus('A reference number or UTR is required.', 422, 'REFERENCE_NUMBER_REQUIRED');
  if (!PAYMENT_METHODS.has(paymentMethod)) throw errorWithStatus('A valid payment method is required.', 422, 'PAYMENT_METHOD_REQUIRED');
  if (Number.isNaN(paymentDate.getTime()) || paymentDate > new Date(Date.now() + 5 * 60 * 1000)) {
    throw errorWithStatus('A valid payment date is required.', 422, 'INVALID_PAYMENT_DATE');
  }
  if (payout?.createdAt && paymentDate < new Date(payout.createdAt)) {
    throw errorWithStatus('Payment date cannot precede payout creation.', 422, 'INVALID_PAYMENT_DATE');
  }
  return { referenceNumber, transactionId, paymentMethod, notes, paymentDate };
};

const assertSnapshotClaim = (claim, payout, message) => {
  const expected = Array.isArray(payout.sourceSnapshots) && payout.sourceSnapshots.length
    ? payout.sourceSnapshots.length
    : null;
  if ((expected != null && claim.matchedCount !== expected) || (expected == null && claim.matchedCount < 1)) {
    throw errorWithStatus(message, 409, 'PAYOUT_EARNINGS_UNAVAILABLE');
  }
};

async function ensureBankReservation(payout, session) {
  const bank = await CreatorBankDetails.findOneAndUpdate(
    {
      ...(payout.bankDetails ? { _id: payout.bankDetails } : { user: payout.user }),
      user: payout.user,
      verificationStatus: 'verified',
      ...(payout.bankDetailsVersion ? { version: payout.bankDetailsVersion } : {})
    },
    { $addToSet: { activePayoutLocks: payout._id } },
    { new: true, session }
  ).select('_id version accountHolderName bankName lastFourDigits ifsc swiftCode branch country');
  if (!bank) throw errorWithStatus('A verified bank account is required before this payout can proceed.', 409, 'VERIFIED_BANK_DETAILS_REQUIRED');
  return bank;
}

async function transitionPayout({ payoutId, action, payload = {}, req }) {
  if (!mongoose.isValidObjectId(payoutId)) throw errorWithStatus('Valid payout ID is required.', 400, 'INVALID_PAYOUT_ID');
  const idempotencyKey = String(payload.idempotencyKey || req.get?.('idempotency-key') || '').trim().slice(0, 160);
  if (idempotencyKey) {
    const previous = await CreatorPayoutHistory.findOne({ payout: payoutId, idempotencyKey }).lean();
    if (previous) {
      const payout = await CreatorPayout.findById(payoutId).lean();
      return { payout, history: previous, idempotentReplay: true };
    }
  }

  const actor = actorFromRequest(req);
  const reason = String(payload.reason || '').trim().slice(0, 1000);
  let session;
  let updated;
  let history;
  let previousStatus;
  try {
    session = await startFinancialSession();
    await session.withTransaction(async () => {
      const payout = await CreatorPayout.findById(payoutId).session(session);
      if (!payout) throw errorWithStatus('Creator payout not found.', 404, 'PAYOUT_NOT_FOUND');
      if (payload.expectedVersion != null && Number(payload.expectedVersion) !== Number(payout.version || 0)) {
        throw errorWithStatus('Payout changed while this page was open. Refresh and retry.', 409, 'PAYOUT_VERSION_CONFLICT');
      }
      previousStatus = payout.status;
      let nextStatus;
      if (action === 'approve' && ['pending', 'held'].includes(previousStatus)) nextStatus = 'approved';
      if (action === 'processing' && previousStatus === 'approved') nextStatus = 'processing';
      if (action === 'paid' && previousStatus === 'processing') nextStatus = 'paid';
      if (action === 'failed' && previousStatus === 'processing') nextStatus = 'failed';
      if (action === 'reject' && ['pending', 'held'].includes(previousStatus)) nextStatus = 'rejected';
      if (action === 'cancel' && ['pending', 'approved', 'processing', 'held'].includes(previousStatus)) nextStatus = 'cancelled';
      if (action === 'hold' && ['pending', 'approved', 'processing'].includes(previousStatus)) nextStatus = 'held';
      if (action === 'resume' && previousStatus === 'held') nextStatus = payout.preHoldStatus || 'pending';
      if (!nextStatus) throw errorWithStatus(`Payout cannot apply ${action} from ${previousStatus}.`, 409, 'INVALID_PAYOUT_TRANSITION');
      if (['failed', 'reject', 'cancel', 'hold'].includes(action) && reason.length < 3) {
        throw errorWithStatus('A reason is required for this payout action.', 422, 'PAYOUT_REASON_REQUIRED');
      }

      if (['approve', 'processing', 'paid', 'resume'].includes(action)) {
        const creator = await User.exists({
          _id: payout.user,
          userType: 'player',
          isCreator: true,
          creatorMonetizationStatus: 'approved',
          isActive: true
        }).session(session);
        if (!creator) throw errorWithStatus('Creator monetization is not active.', 409, 'CREATOR_MONETIZATION_NOT_ACTIVE');
      }

      let bank = null;
      if (['approve', 'processing', 'paid'].includes(action) || (action === 'resume' && ['approved', 'processing'].includes(nextStatus))) {
        bank = await ensureBankReservation(payout, session);
      }

      const update = { status: nextStatus, $versionIncrement: true };
      delete update.$versionIncrement;
      if (bank) {
        update.bankDetails = bank._id;
        update.bankDetailsVersion = Math.max(1, Number(bank.version || 1));
        if (!payout.bankDetailsSnapshot?.capturedAt) update.bankDetailsSnapshot = maskedBankSnapshot(bank);
      }
      if (action === 'approve') Object.assign(update, { approvedAt: new Date(), approvedBy: req.user?._id || null });
      if (action === 'processing') Object.assign(update, { processedAt: new Date(), processedBy: req.user?._id || null });
      if (action === 'hold') Object.assign(update, { preHoldStatus: previousStatus, heldReason: reason });
      if (action === 'resume') Object.assign(update, { preHoldStatus: '', heldReason: '' });
      if (action === 'failed' || action === 'reject') update.failureReason = reason;
      if (action === 'cancel') Object.assign(update, { cancelledAt: new Date(), cancelledBy: req.user?._id || null, cancellationReason: reason });

      let payment = {};
      if (action === 'paid') {
        payment = normalizePaymentPayload(payload, payout);
        Object.assign(update, {
          bankReference: payment.referenceNumber,
          transactionId: payment.transactionId,
          paymentMethod: payment.paymentMethod,
          paymentNotes: payment.notes,
          paymentDate: payment.paymentDate,
          paidAt: payment.paymentDate,
          paidBy: req.user?._id || null
        });
      }

      if (action === 'hold') {
        const claim = await EarningsSnapshot.updateMany(
          { user: payout.user, disbursementId: payout._id },
          { $set: { held: true, holdReason: reason } },
          { session }
        );
        assertSnapshotClaim(claim, payout, 'Payout earnings reservation is unavailable.');
      } else if (action === 'resume') {
        const claim = await EarningsSnapshot.updateMany(
          { user: payout.user, disbursementId: payout._id, held: true },
          { $set: { held: false, holdReason: '', disbursementReviewedAt: new Date() } },
          { session }
        );
        assertSnapshotClaim(claim, payout, 'Held payout earnings are unavailable.');
      } else if (['approve', 'processing', 'paid'].includes(action)) {
        const claim = await EarningsSnapshot.updateMany(
          { user: payout.user, disbursementId: payout._id, held: { $ne: true } },
          { $set: { disbursementReviewedAt: new Date() } },
          { session }
        );
        assertSnapshotClaim(claim, payout, 'Payout earnings are held or no longer reserved.');
      }

      updated = await CreatorPayout.findOneAndUpdate(
        {
          _id: payout._id,
          status: previousStatus,
          version: Number(payout.version || 0) === 0 ? { $in: [0, null] } : payout.version
        },
        { $set: update, $inc: { version: 1 } },
        { new: true, runValidators: true, session }
      );
      if (!updated) throw errorWithStatus('Payout changed while processing this action.', 409, 'PAYOUT_VERSION_CONFLICT');

      if (['failed', 'reject', 'cancel'].includes(action)) {
        await CreatorBankDetails.updateOne({ activePayoutLocks: updated._id }, { $pull: { activePayoutLocks: updated._id } }, { session });
        await CreatorDisbursementReservation.deleteOne({ source: 'creator_payout', sourceId: updated._id }).session(session);
        const creatorStillApproved = await User.exists({
          _id: updated.user,
          isCreator: true,
          creatorMonetizationStatus: 'approved',
          isActive: true
        }).session(session);
        await EarningsSnapshot.updateMany(
          { user: updated.user, disbursementId: updated._id },
          { $set: {
            disbursementReservedAt: null,
            disbursementSource: null,
            disbursementId: null,
            disbursementReviewedAt: null,
            ...(previousStatus === 'held' && creatorStillApproved ? { held: false, holdReason: '' } : {})
          } },
          { session }
        );
      }
      if (action === 'paid') {
        await CreatorBankDetails.updateOne({ activePayoutLocks: updated._id }, { $pull: { activePayoutLocks: updated._id } }, { session });
      }

      const historyAction = {
        approve: 'approved',
        hold: 'held',
        reject: 'rejected',
        cancel: 'cancelled'
      }[action] || action;
      const rows = await createHistory({
        payout: updated,
        action: historyAction,
        previousStatus,
        newStatus: updated.status,
        actor,
        req,
        reason,
        payment,
        idempotencyKey,
        metadata: { expectedVersion: payload.expectedVersion ?? null },
        session
      });
      history = rows[0];
    }, FINANCIAL_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const previous = await CreatorPayoutHistory.findOne({ payout: payoutId, idempotencyKey }).lean();
      const payout = await CreatorPayout.findById(payoutId).lean();
      if (previous && payout) return { payout, history: previous, idempotentReplay: true };
    }
    throw error;
  } finally {
    if (session) await session.endSession().catch(() => null);
  }

  await notifyPayout(updated, history.action).catch((error) => {
    log.error('Creator payout notification failed after commit', { payoutId: String(updated._id), action: history.action, error: String(error) });
  });
  return { payout: updated.toObject ? updated.toObject() : updated, history, idempotentReplay: false };
}

async function generatePayoutForSnapshot({ snapshotId, req, idempotencyKey = '' }) {
  const actor = actorFromRequest(req);
  let session;
  let payout;
  let generated = false;
  try {
    session = await startFinancialSession();
    await session.withTransaction(async () => {
      const snapshot = await EarningsSnapshot.findById(snapshotId).session(session);
      if (!snapshot) throw errorWithStatus('Earnings snapshot not found.', 404, 'SNAPSHOT_NOT_FOUND');
      const cycle = await PayoutCycle.findById(snapshot.payoutCycle).session(session);
      if (!cycle || cycle.status !== 'closed') throw errorWithStatus('Only closed payout cycles can be generated.', 409, 'PAYOUT_CYCLE_NOT_CLOSED');
      if (snapshot.held) throw errorWithStatus('Earnings are held.', 409, 'EARNINGS_HELD');
      payout = await CreatorPayout.findOne({ user: snapshot.user, payoutCycle: snapshot.payoutCycle }).session(session);
      if (payout && !TERMINAL_RETRYABLE_STATUSES.has(payout.status)) return;
      const sourceCycleIds = await PayoutCycle.distinct('_id', {
        status: { $in: ['closed', 'paid'] },
        endDate: { $lte: cycle.endDate }
      }).session(session);
      // MongoDB/DocumentDB sessions do not allow parallel operations in one
      // transaction; keep legacy reconciliation reads strictly ordered.
      const legacyPayoutCycles = await CreatorPayout.distinct('payoutCycle', {
        user: snapshot.user,
        payoutCycle: { $in: sourceCycleIds },
        status: { $nin: [...TERMINAL_RETRYABLE_STATUSES] },
        ...(payout?._id ? { _id: { $ne: payout._id } } : {})
      }).session(session);
      const legacyWithdrawalCycles = await WithdrawalRequest.distinct('payoutCycle', {
        user: snapshot.user,
        payoutCycle: { $in: sourceCycleIds },
        status: { $nin: [...TERMINAL_RETRYABLE_STATUSES] }
      }).session(session);
      const excludedCycleIds = [...legacyPayoutCycles, ...legacyWithdrawalCycles];
      let sourceSnapshots = await EarningsSnapshot.find({
        user: snapshot.user,
        payoutCycle: { $in: sourceCycleIds },
        ...(excludedCycleIds.length ? { payoutCycle: { $in: sourceCycleIds, $nin: excludedCycleIds } } : {}),
        held: { $ne: true },
        disbursementReservedAt: null,
        disbursementId: null,
        amount: { $gt: 0 }
      }).session(session).lean();
      const previousStatus = payout?.status || '';
      if (payout) {
        const retryIds = payout.sourceSnapshots?.length ? new Set(payout.sourceSnapshots.map(String)) : new Set([String(snapshot._id)]);
        sourceSnapshots = sourceSnapshots.filter((row) => retryIds.has(String(row._id)));
        if (sourceSnapshots.length !== retryIds.size) {
          throw errorWithStatus('The original payout sources are no longer all available for retry.', 409, 'PAYOUT_RETRY_SOURCES_UNAVAILABLE');
        }
      }
      if (!sourceSnapshots.length) throw errorWithStatus('No finalized earnings are available for payout.', 409, 'NO_PAYOUT_EARNINGS');
      const aggregateAmountMinor = payout
        ? (Number.isSafeInteger(payout.amountMinor) ? payout.amountMinor : toMinor(payout.amount))
        : sourceSnapshots.reduce((sum, row) => (
        sum + (Number.isSafeInteger(row.amountMinor) ? row.amountMinor : toMinor(row.amount))
        ), 0);
      if (fromMinor(aggregateAmountMinor) < Number(cycle.minimumPayoutThreshold ?? 500)) {
        throw errorWithStatus('Earnings are below the payout threshold and will carry forward.', 409, 'BELOW_PAYOUT_THRESHOLD');
      }
      const creator = await User.exists({
        _id: snapshot.user,
        userType: 'player',
        isCreator: true,
        creatorMonetizationStatus: 'approved',
        isActive: true
      }).session(session);
      if (!creator) throw errorWithStatus('Creator monetization is not active.', 409, 'CREATOR_MONETIZATION_NOT_ACTIVE');

      const reservation = await CreatorDisbursementReservation.findOne({ user: snapshot.user, payoutCycle: snapshot.payoutCycle }).session(session);
      if (reservation) {
        payout = reservation.source === 'creator_payout' ? await CreatorPayout.findById(reservation.sourceId).session(session) : null;
        if (!payout) throw errorWithStatus('This earnings snapshot is already reserved.', 409, 'EARNINGS_ALREADY_RESERVED');
        return;
      }

      const amountMinor = aggregateAmountMinor;
      if (!payout) {
        payout = new CreatorPayout({
          user: snapshot.user,
          payoutCycle: snapshot.payoutCycle,
          amount: fromMinor(amountMinor),
          amountMinor,
          currency: snapshot.currency || 'INR',
          sourceSnapshots: sourceSnapshots.map((row) => row._id),
          status: 'pending'
        });
      } else {
        payout.status = 'pending';
        payout.preHoldStatus = '';
        payout.failureReason = '';
        payout.cancellationReason = '';
        payout.heldReason = '';
        payout.attemptNumber = Number(payout.attemptNumber || 1) + 1;
        payout.version = Number(payout.version || 0) + 1;
      }
      const sourceSnapshotIds = sourceSnapshots.map((row) => row._id);
      const claim = await EarningsSnapshot.updateMany(
        { _id: { $in: sourceSnapshotIds }, held: { $ne: true }, disbursementReservedAt: null, disbursementId: null },
        { $set: { disbursementReservedAt: new Date(), disbursementSource: 'creator_payout', disbursementId: payout._id } },
        { session }
      );
      if (claim.matchedCount !== sourceSnapshotIds.length) throw errorWithStatus('Earnings were reserved concurrently.', 409, 'EARNINGS_ALREADY_RESERVED');
      await CreatorDisbursementReservation.create([{
        user: snapshot.user,
        payoutCycle: snapshot.payoutCycle,
        source: 'creator_payout',
        sourceId: payout._id
      }], { session });
      await payout.save({ session });
      const attemptIdempotencyKey = previousStatus
        ? `${idempotencyKey || `generate:${String(snapshot._id)}`}:attempt:${payout.attemptNumber || 1}`
        : idempotencyKey;
      await createHistory({
        payout,
        action: 'generated',
        previousStatus,
        newStatus: 'pending',
        actor,
        req,
        idempotencyKey: attemptIdempotencyKey,
        metadata: {
          snapshotId: String(snapshot._id),
          sourceSnapshotIds: sourceSnapshotIds.map(String),
          carryForwardAmount: fromMinor(amountMinor) - Number(snapshot.amount || 0),
          attemptNumber: payout.attemptNumber || 1,
          cycleLabel: cycle.cycleLabel
        },
        session
      });
      generated = true;
    }, FINANCIAL_TRANSACTION_OPTIONS);
  } finally {
    if (session) await session.endSession().catch(() => null);
  }
  if (generated) await notifyPayout(payout, 'generated').catch((error) => log.error('Generated payout notification failed', { payoutId: String(payout._id), error: String(error) }));
  return { payout: payout?.toObject ? payout.toObject() : payout, generated };
}

async function generatePayouts({ cycleId, creatorIds = [], req, limit = 100 }) {
  const query = { held: { $ne: true }, disbursementReservedAt: null };
  if (cycleId) {
    if (!mongoose.isValidObjectId(cycleId)) throw errorWithStatus('Valid payout cycle ID is required.', 400, 'INVALID_CYCLE_ID');
    query.payoutCycle = cycleId;
  } else {
    const closedCycles = await PayoutCycle.find({ status: 'closed' }).select('_id').lean();
    query.payoutCycle = { $in: closedCycles.map((cycle) => cycle._id) };
  }
  if (creatorIds.length) {
    const validIds = creatorIds.filter((id) => mongoose.isValidObjectId(id)).slice(0, 100);
    query.user = { $in: validIds };
  }
  const requestedLimit = Math.min(100, Math.max(1, Number(limit) || 100));
  const candidates = await EarningsSnapshot.find(query)
    .sort({ calculatedAt: -1, _id: -1 })
    .limit(Math.min(1000, requestedLimit * 10))
    .lean();
  // Carry-forward generation consumes every eligible source snapshot for one
  // creator in a single payout. Starting the same creator once per historical
  // snapshot creates noisy false conflicts and can starve other creators.
  const snapshots = [...new Map(candidates.map((snapshot) => [String(snapshot.user), snapshot])).values()]
    .slice(0, requestedLimit);
  const results = [];
  for (const snapshot of snapshots) {
    try {
      const result = await generatePayoutForSnapshot({
        snapshotId: snapshot._id,
        req,
        idempotencyKey: `generate:${String(snapshot._id)}`
      });
      results.push({ snapshotId: snapshot._id, success: true, generated: result.generated, payout: result.payout });
    } catch (error) {
      results.push({ snapshotId: snapshot._id, success: false, code: error.code || 'GENERATION_FAILED', message: error.message });
    }
  }
  return { requested: snapshots.length, generated: results.filter((row) => row.generated).length, results };
}

async function generateStatement({ payoutId, req }) {
  if (!mongoose.isValidObjectId(payoutId)) throw errorWithStatus('Valid payout ID is required.', 400, 'INVALID_PAYOUT_ID');
  let session;
  let payout;
  let statementNumber;
  try {
    session = await startFinancialSession();
    await session.withTransaction(async () => {
      payout = await CreatorPayout.findById(payoutId).populate('payoutCycle', 'cycleLabel').session(session);
      if (!payout) throw errorWithStatus('Creator payout not found.', 404, 'PAYOUT_NOT_FOUND');
      statementNumber = payout.statementNumber || `STMT-${payout.payoutCycle?.cycleLabel || 'CYCLE'}-${String(payout._id).slice(-8).toUpperCase()}`;
      if (!payout.statementNumber) {
        payout.statementNumber = statementNumber;
        payout.statementGeneratedAt = new Date();
        await payout.save({ session });
        await createHistory({
          payout,
          action: 'statement_generated',
          previousStatus: payout.status,
          newStatus: payout.status,
          actor: actorFromRequest(req),
          req,
          idempotencyKey: `statement:${statementNumber}`,
          metadata: { statementNumber },
          session
        });
      }
    }, FINANCIAL_TRANSACTION_OPTIONS);
  } finally {
    if (session) await session.endSession().catch(() => null);
  }
  return { payout: payout.toObject(), statementNumber };
}

module.exports = {
  ACTIVE_STATUSES,
  PAYMENT_METHODS,
  TERMINAL_RETRYABLE_STATUSES,
  actorFromRequest,
  fromMinor,
  generatePayouts,
  generateStatement,
  notifyPayout,
  toMinor,
  transitionPayout,
  __testables: {
    generatePayoutForSnapshot,
    normalizeManualPaymentInput: normalizePaymentPayload,
    toMinor,
    fromMinor
  }
};
