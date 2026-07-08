const mongoose = require('mongoose');
const CreatorBankDetails = require('../models/CreatorBankDetails');
const CreatorBankDetailsHistory = require('../models/CreatorBankDetailsHistory');
const AdminAuditLog = require('../models/AdminAuditLog');
const User = require('../models/User');
const CreatorPayout = require('../models/CreatorPayout');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { createSystemNotification } = require('../utils/notificationService');
const log = require('../utils/logger');
const { FINANCIAL_TRANSACTION_OPTIONS, startFinancialSession } = require('../utils/financialTransactions');
const { redactBankHistorySnapshot } = require('../utils/bankDetailsRedaction');
const { normalizeAndValidateBankDetails } = require('../utils/bankDetailsPolicy');

const ALLOWED_STATUSES = new Set(['pending', 'verified', 'rejected']);
const ALLOWED_SORTS = new Set(['newest', 'oldest', 'alphabetical']);
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};
const setPrivateNoStore = (res) => res.setHeader('Cache-Control', 'private, no-store, max-age=0');
const parseRequestedIds = (raw) => {
  if (raw == null || String(raw).trim() === '') return [];
  const values = String(raw).split(',').map((id) => id.trim()).filter(Boolean);
  if (!values.length || values.length > 100 || values.some((id) => !mongoose.isValidObjectId(id))) {
    throw Object.assign(new Error('ids must contain 1 to 100 valid bank-detail IDs.'), { statusCode: 422, code: 'INVALID_BANK_DETAIL_IDS' });
  }
  return values;
};
const actorFor = (req) => ({
  actorKey: req.user?._id ? `user:${String(req.user._id)}` : `hardcoded:${String(req.user?.username || 'admin').toLowerCase()}`,
  username: req.user?.username || 'admin',
  role: req.user?.adminRole || (req.user?.isSuperUser ? 'super_admin' : 'admin'),
  type: 'admin'
});
const requestMetadata = (req) => ({
  ip: String(req.ip || req.headers?.['x-forwarded-for'] || ''),
  userAgent: req.get ? (req.get('user-agent') || '') : ''
});
const maskEmail = (value) => {
  const [local = '', domain = ''] = String(value || '').split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`;
};
const maskIdentifier = (value) => {
  const text = String(value || '');
  return text ? `•••• ${text.slice(-4)}` : '';
};
const maskPaymentAddress = (value) => {
  const [local = '', handle = ''] = String(value || '').split('@');
  return local && handle ? `${local.slice(0, 1)}***@${handle}` : '';
};
const sanitizeHistorySnapshot = redactBankHistorySnapshot;

const isVerifiableBankDestination = (bank) => {
  try {
    const accountNumber = CreatorBankDetails.decryptAccountNumber(bank.accountNumberEncrypted);
    if (!accountNumber || accountNumber.slice(-4) !== String(bank.lastFourDigits || '')) return false;
    if (bank.accountNumberHash !== CreatorBankDetails.hashSensitiveValue(accountNumber, 'account-number')) return false;
    return normalizeAndValidateBankDetails({
      accountHolderName: bank.accountHolderName,
      bankName: bank.bankName,
      accountNumber,
      accountNumberConfirm: accountNumber,
      country: bank.country || 'IN',
      ifsc: bank.ifsc || '',
      swiftCode: bank.swiftCode || '',
      branch: bank.branch || ''
    }).valid;
  } catch {
    return false;
  }
};

const maskedBank = (bank, includeInternalNotes = false) => ({
  _id: bank._id,
  accountHolderName: bank.accountHolderName,
  bankName: bank.bankName,
  accountNumberMasked: `•••• ${bank.lastFourDigits || '----'}`,
  lastFourDigits: bank.lastFourDigits || '',
  ifsc: bank.ifsc || '',
  swiftCode: bank.swiftCode || '',
  branch: bank.branch || '',
  upiIdMasked: bank.upiIdMasked || '',
  paypalEmailMasked: bank.paypalEmailMasked || '',
  gstNumberMasked: bank.gstNumberMasked || '',
  country: bank.country || 'IN',
  verificationStatus: bank.verificationStatus === 'failed' ? 'rejected' : bank.verificationStatus,
  verificationReason: bank.verificationReason || '',
  ...(includeInternalNotes ? { internalNotes: bank.internalNotes || '' } : {}),
  ...(includeInternalNotes ? { internalNotesVersion: Math.max(1, Number(bank.internalNotesVersion || 1)) } : {}),
  verifiedAt: bank.verifiedAt || null,
  rejectedAt: bank.rejectedAt || null,
  createdAt: bank.createdAt,
  updatedAt: bank.updatedAt,
  version: bank.version || 1
});

const userProjection = {
  _id: 1,
  username: 1,
  email: 1,
  userType: 1,
  isPremium: 1,
  isCreator: 1,
  creatorMonetizationStatus: 1,
  'membership.tier': 1,
  'profile.displayName': 1,
  'profile.avatar': 1
};

// Aggregations do not honor Mongoose's `select: false`. Keep encrypted values
// out of application memory (and exports) with an explicit allow-list.
const safeAggregateProjection = {
  _id: 1,
  user: 1,
  accountHolderName: 1,
  bankName: 1,
  lastFourDigits: 1,
  ifsc: 1,
  swiftCode: 1,
  branch: 1,
  upiIdMasked: 1,
  paypalEmailMasked: 1,
  gstNumberMasked: 1,
  country: 1,
  verificationStatus: 1,
  verificationReason: 1,
  verifiedAt: 1,
  rejectedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  internalNotesVersion: 1,
  version: 1,
  'userRecord._id': 1,
  'userRecord.username': 1,
  'userRecord.email': 1,
  'userRecord.userType': 1,
  'userRecord.isPremium': 1,
  'userRecord.isCreator': 1,
  'userRecord.creatorMonetizationStatus': 1,
  'userRecord.membership.tier': 1,
  'userRecord.profile.displayName': 1,
  'userRecord.profile.avatar': 1
};

const buildFilterPipeline = (query = {}) => {
  const bankMatch = {};
  const verificationStatus = String(query.verificationStatus || '').toLowerCase();
  if (verificationStatus && verificationStatus !== 'all') {
    bankMatch.verificationStatus = verificationStatus === 'rejected' ? { $in: ['rejected', 'failed'] } : verificationStatus;
  }
  const country = String(query.country || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) bankMatch.country = country;
  const ids = parseRequestedIds(query.ids);
  if (ids.length) bankMatch._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };

  const pipeline = [
    { $match: bankMatch },
    { $lookup: { from: User.collection.name, localField: 'user', foreignField: '_id', as: 'userRecord' } },
    { $unwind: '$userRecord' }
  ];

  const combinedMatch = {};
  const search = String(query.search || '').trim().slice(0, 120);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    combinedMatch.$or = [
      { accountHolderName: regex },
      { bankName: regex },
      { 'userRecord.username': regex },
      { 'userRecord.email': regex },
      { 'userRecord.profile.displayName': regex }
    ];
    if (mongoose.isValidObjectId(search)) combinedMatch.$or.push({ user: new mongoose.Types.ObjectId(search) });
  }
  const monetizationStatus = String(query.monetizationStatus || '').trim();
  if (monetizationStatus && monetizationStatus !== 'all') combinedMatch['userRecord.creatorMonetizationStatus'] = monetizationStatus;
  const profileType = String(query.profileType || '').trim();
  if (profileType && profileType !== 'all') combinedMatch['userRecord.userType'] = profileType;
  const payoutEligibility = String(query.payoutEligibility || '').trim();
  if (payoutEligibility === 'eligible') {
    combinedMatch.$and = [
      ...(combinedMatch.$and || []),
      { verificationStatus: 'verified' },
      { 'userRecord.isCreator': true },
      { 'userRecord.creatorMonetizationStatus': 'approved' }
    ];
  } else if (payoutEligibility === 'ineligible') {
    combinedMatch.$and = [
      ...(combinedMatch.$and || []),
      { $or: [
        { verificationStatus: { $ne: 'verified' } },
        { 'userRecord.isCreator': { $ne: true } },
        { 'userRecord.creatorMonetizationStatus': { $ne: 'approved' } }
      ] }
    ];
  }
  if (Object.keys(combinedMatch).length) pipeline.push({ $match: combinedMatch });
  pipeline.push({ $project: safeAggregateProjection });
  return pipeline;
};

const sortFor = (value) => {
  const sort = ALLOWED_SORTS.has(value) ? value : 'newest';
  if (sort === 'oldest') return { createdAt: 1, _id: 1 };
  if (sort === 'alphabetical') return { accountHolderName: 1, _id: 1 };
  return { createdAt: -1, _id: -1 };
};

const attachLatestPayoutStatus = async (rows) => {
  if (!rows.length) return rows;
  const userIds = Array.from(new Set(rows.map((row) => String(row.user)))).map((id) => new mongoose.Types.ObjectId(id));
  const latestPipeline = (match) => [
    { $match: { user: { $in: userIds }, ...match } },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $group: {
      _id: '$user',
      status: { $first: '$status' },
      amount: { $first: '$amount' },
      updatedAt: { $first: '$updatedAt' }
    } }
  ];
  const [payoutRows, withdrawalRows] = await Promise.all([
    CreatorPayout.aggregate(latestPipeline({})),
    WithdrawalRequest.aggregate(latestPipeline({}))
  ]);
  const payouts = payoutRows.map((entry) => ({ ...entry, record: { source: 'creator_payout', status: entry.status, amount: entry.amount, updatedAt: entry.updatedAt } }));
  const withdrawals = withdrawalRows.map((entry) => ({ ...entry, record: { source: 'withdrawal', status: entry.status, amount: entry.amount, updatedAt: entry.updatedAt } }));
  const byUser = new Map();
  [...payouts, ...withdrawals].forEach((entry) => {
    const key = String(entry._id);
    const current = byUser.get(key);
    if (!current || new Date(entry.record?.updatedAt || 0).getTime() > new Date(current.updatedAt || 0).getTime()) {
      byUser.set(key, entry.record);
    }
  });
  return rows.map((row) => ({ ...row, payoutStatus: byUser.get(String(row.user)) || null }));
};

const serializeRow = (row, includeInternalNotes = false) => {
  const user = row.userRecord || {};
  const payoutEligible = row.verificationStatus === 'verified' && user.isCreator === true && user.creatorMonetizationStatus === 'approved';
  return {
    _id: row._id,
    user: {
      _id: user._id,
      username: user.username,
      displayName: user.profile?.displayName || user.username,
      avatar: user.profile?.avatar || '',
      email: user.email,
      profileType: user.userType,
      premiumStatus: Boolean(user.isPremium || (user.membership?.tier && user.membership.tier !== 'free')),
      creatorStatus: Boolean(user.isCreator),
      monetizationStatus: user.creatorMonetizationStatus || 'not_eligible'
    },
    bankDetails: maskedBank(row, includeInternalNotes),
    payoutEligibility: payoutEligible ? 'eligible' : 'ineligible',
    payoutStatus: row.payoutStatus || null
  };
};

const listBankDetails = async (req, res) => {
  try {
    setPrivateNoStore(res);
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 20, 1, 100);
    const sort = String(req.query.sort || 'newest');
    const basePipeline = buildFilterPipeline(req.query);
    // Amazon DocumentDB does not support every MongoDB aggregation stage.
    // Separate row/count pipelines avoid `$facet` while preserving one
    // canonical filter implementation for pagination and exports.
    const [rawRows, totalRows, pending, verified, rejected] = await Promise.all([
      CreatorBankDetails.aggregate([
        ...basePipeline,
        { $sort: sortFor(sort) },
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ]),
      CreatorBankDetails.aggregate([...basePipeline, { $count: 'count' }]),
      CreatorBankDetails.countDocuments({ verificationStatus: 'pending' }),
      CreatorBankDetails.countDocuments({ verificationStatus: 'verified' }),
      CreatorBankDetails.countDocuments({ verificationStatus: { $in: ['rejected', 'failed'] } })
    ]);
    const rows = await attachLatestPayoutStatus(rawRows);
    const total = totalRows?.[0]?.count || 0;
    return res.json({
      success: true,
      data: {
        bankAccounts: rows.map(serializeRow),
        summary: { total: pending + verified + rejected, pending, verified, rejected },
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      }
    });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    log.error('List creator bank details error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to fetch bank details.' });
  }
};

const getBankDetails = async (req, res) => {
  try {
    setPrivateNoStore(res);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_BANK_DETAILS_ID', message: 'Invalid bank details ID.' });
    const canViewInternalNotes = req.user?.adminRole === 'super_admin';
    const query = CreatorBankDetails.findById(req.params.id);
    if (canViewInternalNotes) query.select('+internalNotes');
    const bank = await query.lean();
    if (!bank) return res.status(404).json({ success: false, message: 'Bank details not found.' });
    const user = await User.findById(bank.user).select(userProjection).lean();
    if (!user) return res.status(404).json({ success: false, message: 'Bank account owner not found.' });
    const [record] = await attachLatestPayoutStatus([{ ...bank, userRecord: user }]);
    return res.json({ success: true, data: serializeRow(record, canViewInternalNotes) });
  } catch (error) {
    log.error('Get masked creator bank details error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to fetch bank details.' });
  }
};

const updateVerification = async (req, res) => {
  try {
    setPrivateNoStore(res);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_BANK_DETAILS_ID', message: 'Invalid bank details ID.' });
    const status = String(req.body?.status || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(422).json({ success: false, code: 'INVALID_VERIFICATION_STATUS', message: 'Status must be pending, verified, or rejected.' });
    }
    if (status === 'rejected' && reason.length < 3) {
      return res.status(422).json({ success: false, code: 'VERIFICATION_REASON_REQUIRED', message: 'A rejection reason is required.' });
    }
    const actor = actorFor(req);
    const session = await startFinancialSession();
    let previous;
    let updated;
    let idempotent = false;
    try {
      await session.withTransaction(async () => {
        previous = await CreatorBankDetails.findById(req.params.id).select('+accountNumberEncrypted +accountNumberHash +internalNotes').session(session).lean();
        if (!previous) throw Object.assign(new Error('Bank details not found.'), { code: 'BANK_DETAILS_NOT_FOUND' });
        const effectiveVersion = Math.max(1, Number(previous.version || 1));
        if (!Number.isInteger(expectedVersion) || expectedVersion !== effectiveVersion) {
          throw Object.assign(new Error('Bank details changed since this review was opened. Refresh and review the latest version.'), { code: 'STALE_BANK_DETAILS' });
        }
        if (status === 'verified' && !isVerifiableBankDestination(previous)) {
          throw Object.assign(
            new Error('Bank details are incomplete or could not be validated. Request an update from the creator.'),
            { code: 'BANK_DETAILS_NOT_VERIFIABLE' }
          );
        }
        if (previous.verificationStatus === status && (previous.verificationReason || '') === reason) {
          updated = previous;
          idempotent = true;
          return;
        }
        const activePayout = await CreatorPayout.exists({
          user: previous.user,
          $or: [
            { status: { $in: ['approved', 'processing'] } },
            { status: 'held', bankDetails: { $ne: null } }
          ]
        }).session(session);
        const activeWithdrawal = await WithdrawalRequest.exists({ user: previous.user, status: { $in: ['pending', 'approved', 'processing'] } }).session(session);
        if (activePayout || activeWithdrawal || previous.activePayoutLocks?.length || previous.activeWithdrawalLocks?.length) {
          throw Object.assign(new Error('Verification cannot change while a payout or withdrawal is pending or processing.'), { code: 'BANK_DETAILS_LOCKED_FOR_PAYOUT' });
        }
        const now = new Date();
        const $set = { verificationStatus: status, verificationReason: reason };
        const $unset = {};
        if (status === 'verified') {
          $set.verifiedAt = now;
          $set.verifiedByActorKey = actor.actorKey;
          $unset.rejectedAt = 1;
        } else if (status === 'rejected') {
          $set.rejectedAt = now;
          $unset.verifiedAt = 1;
          $unset.verifiedByActorKey = 1;
        } else {
          $unset.verifiedAt = 1;
          $unset.verifiedByActorKey = 1;
          $unset.rejectedAt = 1;
        }
        const versionFilter = previous.version == null
          ? { $or: [{ version: { $exists: false } }, { version: 1 }] }
          : { version: expectedVersion };
        if (previous.version == null) $set.version = effectiveVersion + 1;
        updated = await CreatorBankDetails.findOneAndUpdate(
          { _id: previous._id, verificationStatus: previous.verificationStatus, 'activePayoutLocks.0': { $exists: false }, 'activeWithdrawalLocks.0': { $exists: false }, ...versionFilter },
          previous.version == null ? { $set, $unset } : { $set, $unset, $inc: { version: 1 } },
          { new: true, runValidators: true, session }
        ).select('+internalNotes').lean();
        if (!updated) throw Object.assign(new Error('Bank details changed while being reviewed. Refresh and try again.'), { code: 'STALE_BANK_DETAILS' });
        await CreatorBankDetailsHistory.create([{
          bankDetails: updated._id,
          user: updated.user,
          action: 'verification_changed',
          actor,
          previous: maskedBank(previous),
          next: maskedBank(updated),
          reason,
          ...requestMetadata(req)
        }], { session });
      }, FINANCIAL_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'BANK_DETAILS_NOT_FOUND') return res.status(404).json({ success: false, message: error.message });
      if (error?.code === 'BANK_DETAILS_NOT_VERIFIABLE') return res.status(409).json({ success: false, code: error.code, message: error.message });
      if (error?.code === 'STALE_BANK_DETAILS' || error?.code === 'BANK_DETAILS_LOCKED_FOR_PAYOUT') return res.status(409).json({ success: false, code: error.code, message: error.message });
      throw error;
    } finally {
      await session.endSession().catch(() => null);
    }
    res.locals.auditBefore = { bankDetailsId: String(previous._id), userId: String(previous.user), verificationStatus: previous.verificationStatus };
    res.locals.auditAfter = { bankDetailsId: String(updated._id), userId: String(updated.user), verificationStatus: updated.verificationStatus };
    if (!idempotent) await createSystemNotification(
      updated.user,
      status === 'verified' ? 'Bank account verified' : status === 'rejected' ? 'Bank account needs correction' : reason ? 'Bank account update requested' : 'Bank account review pending',
      status === 'verified'
        ? 'Your payout bank account has been verified.'
        : status === 'rejected'
          ? `Your payout bank account could not be verified.${reason ? ` ${reason}` : ''}`
          : reason
            ? `Please update and resubmit your payout bank details. ${reason}`
            : 'Your payout bank account has been returned to pending review.',
      { type: reason && status === 'pending' ? 'bank_details_update_requested' : `bank_details_${status}`, bankDetailsId: String(updated._id) }
    ).catch((notificationError) => {
      log.error('Bank verification notification enqueue failed after committed update', {
        bankDetailsId: String(updated._id),
        status,
        error: String(notificationError)
      });
    });
    const user = await User.findById(updated.user).select(userProjection).lean();
    const [record] = await attachLatestPayoutStatus([{ ...updated, userRecord: user }]);
    return res.json({ success: true, message: idempotent ? 'Bank verification status is already up to date.' : `Bank account marked ${status}.`, data: serializeRow(record, true) });
  } catch (error) {
    log.error('Update bank verification error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to update bank verification.' });
  }
};

const requestUpdate = async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (reason.length < 3) {
    return res.status(422).json({ success: false, code: 'UPDATE_REASON_REQUIRED', message: 'A reason is required when requesting updated bank details.' });
  }
  req.body = { ...req.body, status: 'pending', reason };
  return updateVerification(req, res);
};

const updateNotes = async (req, res) => {
  try {
    setPrivateNoStore(res);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_BANK_DETAILS_ID', message: 'Invalid bank details ID.' });
    const notes = String(req.body?.notes || '').trim();
    const expectedInternalNotesVersion = Number(req.body?.expectedInternalNotesVersion);
    if (notes.length > 2000) return res.status(422).json({ success: false, message: 'Internal notes cannot exceed 2000 characters.' });
    const session = await startFinancialSession();
    let previous;
    let updated;
    let idempotent = false;
    try {
      await session.withTransaction(async () => {
        previous = await CreatorBankDetails.findById(req.params.id).select('+internalNotes').session(session).lean();
        if (!previous) throw Object.assign(new Error('Bank details not found.'), { code: 'BANK_DETAILS_NOT_FOUND' });
        const effectiveInternalNotesVersion = Math.max(1, Number(previous.internalNotesVersion || 1));
        if (!Number.isInteger(expectedInternalNotesVersion) || expectedInternalNotesVersion !== effectiveInternalNotesVersion) {
          throw Object.assign(new Error('Bank details changed since these notes were opened. Refresh and try again.'), { code: 'STALE_BANK_DETAILS' });
        }
        if ((previous.internalNotes || '') === notes) {
          updated = previous;
          idempotent = true;
          return;
        }
        const notesVersionFilter = previous.internalNotesVersion == null
          ? { $or: [{ internalNotesVersion: { $exists: false } }, { internalNotesVersion: 1 }] }
          : { internalNotesVersion: effectiveInternalNotesVersion };
        const update = previous.internalNotesVersion == null
          ? { $set: { internalNotes: notes, internalNotesVersion: effectiveInternalNotesVersion + 1 } }
          : { $set: { internalNotes: notes }, $inc: { internalNotesVersion: 1 } };
        updated = await CreatorBankDetails.findOneAndUpdate(
          { _id: previous._id, ...notesVersionFilter },
          update,
          { new: true, runValidators: true, session }
        ).select('+internalNotes').lean();
        if (!updated) throw Object.assign(new Error('Bank details changed while saving notes. Refresh and try again.'), { code: 'STALE_BANK_DETAILS' });
        await CreatorBankDetailsHistory.create([{
          bankDetails: updated._id,
          user: updated.user,
          action: 'notes_updated',
          actor: actorFor(req),
          previous: { hasInternalNotes: Boolean(previous.internalNotes) },
          next: { hasInternalNotes: Boolean(notes) },
          reason: 'Internal notes updated',
          ...requestMetadata(req)
        }], { session });
      }, FINANCIAL_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'BANK_DETAILS_NOT_FOUND') return res.status(404).json({ success: false, message: error.message });
      if (error?.code === 'STALE_BANK_DETAILS') return res.status(409).json({ success: false, code: error.code, message: error.message });
      throw error;
    } finally {
      await session.endSession().catch(() => null);
    }
    res.locals.auditBefore = { bankDetailsId: String(previous._id), hasInternalNotes: Boolean(previous.internalNotes) };
    res.locals.auditAfter = { bankDetailsId: String(updated._id), hasInternalNotes: Boolean(notes) };
    return res.json({
      success: true,
      message: idempotent ? 'Internal notes are already up to date.' : 'Internal notes updated.',
      data: {
        internalNotes: notes,
        internalNotesVersion: Math.max(1, Number(updated.internalNotesVersion || 1))
      }
    });
  } catch (error) {
    log.error('Update bank notes error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to update internal notes.' });
  }
};

const getHistory = async (req, res) => {
  try {
    setPrivateNoStore(res);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_BANK_DETAILS_ID', message: 'Invalid bank details ID.' });
    const bank = await CreatorBankDetails.findById(req.params.id).select('user').lean();
    if (!bank) return res.status(404).json({ success: false, message: 'Bank details not found.' });
    const history = await CreatorBankDetailsHistory.find({ user: bank.user })
      .sort({ createdAt: -1 })
      .limit(200)
      .select('action actor previous next reason createdAt')
      .lean();
    return res.json({
      success: true,
      data: {
        history: history.map((entry) => ({
          ...entry,
          previous: sanitizeHistorySnapshot(entry.previous),
          next: sanitizeHistorySnapshot(entry.next)
        }))
      }
    });
  } catch (error) {
    log.error('Get bank history error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to fetch bank history.' });
  }
};

const createSensitiveReadAudit = async (req, bank, reason) => {
  const actor = actorFor(req);
  const metadata = requestMetadata(req);
  let session;
  try {
    session = await startFinancialSession();
    await session.withTransaction(async () => {
      await AdminAuditLog.create([{
        actor: { actorKey: actor.actorKey, user: req.user?._id || null, username: actor.username, role: actor.role, permissions: req.user?.adminPermissions || [] },
        action: 'REVEAL_CREATOR_BANK_DETAILS_SENSITIVE',
        resourceType: 'creator-bank-details',
        resourceId: String(bank._id),
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: 200,
        request: { query: {}, body: { reason: '[RECORDED]' } },
        after: { userId: String(bank.user), fieldsRevealed: ['accountNumber', 'taxId', 'upiId', 'paypalEmail', 'gstNumber'] },
        ip: metadata.ip,
        userAgent: metadata.userAgent,
        metadata: { reason }
      }], { session });
      await CreatorBankDetailsHistory.create([{
        bankDetails: bank._id,
        user: bank.user,
        action: 'sensitive_viewed',
        actor,
        previous: null,
        next: { fieldsRevealed: ['accountNumber', 'taxId', 'upiId', 'paypalEmail', 'gstNumber'] },
        reason,
        ...metadata
      }], { session });
    }, FINANCIAL_TRANSACTION_OPTIONS);
  } finally {
    if (session) await session.endSession().catch(() => null);
  }
};

const revealBankDetails = async (req, res) => {
  try {
    setPrivateNoStore(res);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_BANK_DETAILS_ID', message: 'Invalid bank details ID.' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5 || reason.length > 500) {
      return res.status(422).json({ success: false, message: 'A 5 to 500 character business reason is required.' });
    }
    const bank = await CreatorBankDetails.findById(req.params.id)
      .select('+accountNumberEncrypted +taxIdEncrypted +upiId +upiIdEncrypted +paypalEmail +paypalEmailEncrypted +gstNumber +gstNumberEncrypted +internalNotes')
      .lean();
    if (!bank) return res.status(404).json({ success: false, message: 'Bank details not found.' });
    const user = await User.findById(bank.user).select(userProjection).lean();
    if (!user) return res.status(404).json({ success: false, message: 'Bank account owner not found.' });
    const accountNumber = CreatorBankDetails.decryptAccountNumber(bank.accountNumberEncrypted);
    const taxId = bank.taxIdEncrypted ? CreatorBankDetails.decryptAccountNumber(bank.taxIdEncrypted) : '';
    const upiId = bank.upiIdEncrypted ? CreatorBankDetails.decryptAccountNumber(bank.upiIdEncrypted) : bank.upiId || '';
    const paypalEmail = bank.paypalEmailEncrypted ? CreatorBankDetails.decryptAccountNumber(bank.paypalEmailEncrypted) : bank.paypalEmail || '';
    const gstNumber = bank.gstNumberEncrypted ? CreatorBankDetails.decryptAccountNumber(bank.gstNumberEncrypted) : bank.gstNumber || '';
    // Sensitive disclosure fails closed if either immutable audit cannot be persisted.
    await createSensitiveReadAudit(req, bank, reason);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.json({
      success: true,
      data: {
        ...serializeRow({ ...bank, userRecord: user }, true),
        sensitive: {
          accountNumber,
          taxId,
          upiId,
          paypalEmail,
          gstNumber
        }
      }
    });
  } catch (error) {
    log.error('Reveal bank details error', { error: String(error) });
    return res.status(503).json({ success: false, message: 'Sensitive bank details could not be securely disclosed.' });
  }
};

const spreadsheetSafe = (value) => {
  const text = value == null ? '' : String(value);
  return /^[\u0000-\u0020\u007f\u00a0]*[=+\-@]/.test(text) ? `'${text}` : text;
};
const csvEscape = (value) => `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;
const xmlEscape = (value) => spreadsheetSafe(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const exportRows = async (query) => {
  const pipeline = buildFilterPipeline(query);
  const [countResult] = await CreatorBankDetails.aggregate([...pipeline, { $count: 'count' }]);
  const total = countResult?.count || 0;
  if (total > 5000) {
    throw Object.assign(new Error('This export contains more than 5,000 records. Narrow the filters and try again.'), { statusCode: 413, code: 'BANK_EXPORT_TOO_LARGE' });
  }
  pipeline.push({ $sort: sortFor(String(query.sort || 'newest')) });
  const records = await attachLatestPayoutStatus(await CreatorBankDetails.aggregate(pipeline));
  return [
    ['Display Name', 'Username', 'User ID', 'Email', 'Profile Type', 'Premium', 'Creator', 'Monetization Status', 'Account Holder', 'Bank', 'Account Number', 'IFSC', 'SWIFT', 'Branch', 'UPI ID', 'PayPal', 'GST', 'Country', 'Verification', 'Payout Eligibility', 'Latest Payout Status', 'Date Added', 'Last Updated'],
    ...records.map((record) => {
      const row = serializeRow(record);
      return [
        row.user.displayName,
        row.user.username,
        row.user._id,
        row.user.email,
        row.user.profileType,
        row.user.premiumStatus ? 'Active' : 'Inactive',
        row.user.creatorStatus ? 'Yes' : 'No',
        row.user.monetizationStatus,
        row.bankDetails.accountHolderName,
        row.bankDetails.bankName,
        row.bankDetails.accountNumberMasked,
        row.bankDetails.ifsc,
        row.bankDetails.swiftCode,
        row.bankDetails.branch,
        row.bankDetails.upiIdMasked,
        row.bankDetails.paypalEmailMasked,
        row.bankDetails.gstNumberMasked,
        row.bankDetails.country,
        row.bankDetails.verificationStatus,
        row.payoutEligibility,
        row.payoutStatus?.status || 'none',
        row.bankDetails.createdAt ? new Date(row.bankDetails.createdAt).toISOString() : '',
        row.bankDetails.updatedAt ? new Date(row.bankDetails.updatedAt).toISOString() : ''
      ];
    })
  ];
};

const exportCsv = async (req, res) => {
  try {
    setPrivateNoStore(res);
    const rows = await exportRows(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="creator-bank-details.csv"');
    return res.send(`\ufeff${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`);
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    log.error('Export bank details CSV error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to export bank details.' });
  }
};

const exportExcel = async (req, res) => {
  try {
    setPrivateNoStore(res);
    const rows = await exportRows(req.query);
    const xmlRows = rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`).join('');
    const document = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Bank Details"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="creator-bank-details.xls"');
    return res.send(document);
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    log.error('Export bank details Excel error', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Failed to export bank details.' });
  }
};

module.exports = {
  listBankDetails,
  getBankDetails,
  updateVerification,
  requestUpdate,
  updateNotes,
  getHistory,
  revealBankDetails,
  exportCsv,
  exportExcel,
  buildFilterPipeline,
  spreadsheetSafe
};
