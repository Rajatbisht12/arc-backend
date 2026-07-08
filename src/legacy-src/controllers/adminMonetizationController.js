const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Story = require('../models/Story');
const PostEngagement = require('../models/PostEngagement');
const Follow = require('../models/Follow');
const PaymentTransaction = require('../models/PaymentTransaction');
const MonetizationEligibility = require('../models/MonetizationEligibility');
const MonetizationApplication = require('../models/MonetizationApplication');
const CreatorEligibilityHistory = require('../models/CreatorEligibilityHistory');
const CreatorPayout = require('../models/CreatorPayout');
const CreatorPayoutHistory = require('../models/CreatorPayoutHistory');
const CreatorBankDetails = require('../models/CreatorBankDetails');
const EarningsSnapshot = require('../models/EarningsSnapshot');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const PayoutCycle = require('../models/PayoutCycle');
const AdminAuditLog = require('../models/AdminAuditLog');
const ProfileVisitDaily = require('../models/ProfileVisitDaily');
const {
  generatePayouts,
  generateStatement,
  toMinor,
  transitionPayout
} = require('../services/CreatorPayoutAdminService');
const {
  PLATFORM_DEFAULT_CPM,
  getEstimatedEarningsForCreator
} = require('../services/CreatorEarningsCalculationService');
const { buildUniquePostViewPipeline } = require('../services/postEngagementAnalytics');
const log = require('../utils/logger');

const DAY_MS = 86_400_000;
const MAX_EXPORT_ROWS = 10_000;
const PAYOUT_STATUSES = new Set(['pending', 'approved', 'processing', 'paid', 'completed', 'failed', 'rejected', 'held', 'cancelled']);
const CREATOR_STATUSES = new Set(['eligible', 'pending', 'approved', 'rejected', 'suspended', 'disabled', 'withdrawn']);

const normalizePage = (value) => Math.min(10_000, Math.max(1, Number.parseInt(value, 10) || 1));
const normalizeLimit = (value, fallback = 25, max = 100) => Math.min(max, Math.max(1, Number.parseInt(value, 10) || fallback));
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const asObjectId = (value) => new mongoose.Types.ObjectId(value);
const utcDayStart = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const profileVisitRange = (start, end) => ({ $gte: utcDayStart(start), $lte: utcDayStart(end) });

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
};

const parseRange = (query = {}) => {
  const now = new Date();
  const periodAliases = { daily: '1d', weekly: '7d', monthly: '30d', yearly: '1y' };
  const requested = String(query.range || periodAliases[String(query.period || '').toLowerCase()] || '30d').toLowerCase();
  const key = requested;
  const daysByKey = { '1d': 1, '7d': 7, '30d': 30, '45d': 45, '90d': 90, '1y': 365 };
  let end = parseDate(query.to, true) || now;
  let start = key === 'custom' ? parseDate(query.from) : new Date(end.getTime() - ((daysByKey[key] || 30) - 1) * DAY_MS);
  if (!start) start = new Date(end.getTime() - 29 * DAY_MS);
  if (start > end) [start, end] = [end, start];
  if (end.getTime() - start.getTime() > 366 * DAY_MS) start = new Date(end.getTime() - 366 * DAY_MS);
  return { start, end, range: key === 'custom' ? 'custom' : (daysByKey[key] ? key : '30d') };
};

const monthBounds = (offset = 0) => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { start, end };
};

const sumAggregate = async (model, match, field = '$amount') => {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: field }, count: { $sum: 1 } } }]);
  return { amount: roundMoney(rows[0]?.amount || 0), count: rows[0]?.count || 0 };
};

const maskedBank = (bank) => bank ? {
  _id: bank._id,
  accountHolderName: bank.accountHolderName || '',
  bankName: bank.bankName || '',
  accountNumber: `•••• ${bank.lastFourDigits || '----'}`,
  ifsc: bank.ifsc || '',
  branch: bank.branch || '',
  upi: bank.upiIdMasked || '',
  panAvailable: Boolean(bank.taxIdHash),
  gst: bank.gstNumberMasked || '',
  country: bank.country || 'IN',
  verificationStatus: bank.verificationStatus || 'pending',
  version: bank.version || 1,
  updatedAt: bank.updatedAt
} : null;

const sendFailure = (res, error, fallback) => {
  if (error?.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  log.error(fallback, { error: String(error), stack: error?.stack });
  return res.status(500).json({ success: false, code: 'MONETIZATION_ADMIN_ERROR', message: fallback });
};

const recordFinancialAccess = async (req, { action, resourceType, resourceId = '', metadata = {} }) => {
  await AdminAuditLog.create({
    actor: {
      actorKey: req.user?._id ? `user:${String(req.user._id)}` : `hardcoded:${String(req.user?.username || 'admin').toLowerCase()}`,
      user: req.user?._id || null,
      username: req.user?.username || 'admin',
      role: req.user?.adminRole || (req.user?.isSuperUser ? 'super_admin' : 'admin'),
      permissions: Array.isArray(req.user?.adminPermissions) ? req.user.adminPermissions : []
    },
    action,
    resourceType,
    resourceId: String(resourceId || ''),
    method: req.method,
    path: req.originalUrl || req.path,
    statusCode: 200,
    request: {
      query: Object.fromEntries(Object.entries(req.query || {}).map(([key, value]) => [key, String(value).slice(0, 500)])),
      body: {}
    },
    ip: String(req.ip || req.headers?.['x-forwarded-for'] || ''),
    userAgent: req.get ? (req.get('user-agent') || '') : '',
    metadata
  });
};

const getPayoutAggregates = async (match = {}) => {
  const [payouts, withdrawals] = await Promise.all([
    CreatorPayout.aggregate([{ $match: match }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 }, creators: { $addToSet: '$user' } } }]),
    WithdrawalRequest.aggregate([{ $match: match }, { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 }, creators: { $addToSet: '$user' } } }])
  ]);
  return [...payouts, ...withdrawals].reduce((acc, row) => {
    const key = row._id === 'completed' ? 'paid' : row._id;
    const current = acc[key] || { amount: 0, count: 0, creators: new Set() };
    current.amount = roundMoney(current.amount + safeNumber(row.amount));
    current.count += row.count || 0;
    (row.creators || []).forEach((id) => current.creators.add(String(id)));
    acc[key] = current;
    return acc;
  }, {});
};

const buildLeaderboard = async ({ start, end, metric, limit = 10 }) => {
  const boundedLimit = normalizeLimit(limit, 10, 25);
  let rows = [];
  if (metric === 'followers') {
    rows = await Follow.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$following', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: boundedLimit }
    ]);
  } else if (metric === 'revenue') {
    rows = await EarningsSnapshot.aggregate([
      { $match: { calculatedAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$user', value: { $sum: '$amount' } } },
      { $sort: { value: -1 } },
      { $limit: boundedLimit }
    ]);
  } else {
    const eventMatch = {
      eventType: metric === 'watchTime' ? { $in: ['watch', 'dwell'] } : 'view',
      createdAt: { $gte: start, $lte: end },
      ...(metric === 'organicReach' ? { source: 'organic' } : {})
    };
    rows = await PostEngagement.aggregate([
      { $match: eventMatch },
      { $group: { _id: '$author', value: { $sum: metric === 'watchTime' ? '$durationMs' : 1 } } },
      { $sort: { value: -1 } },
      { $limit: boundedLimit }
    ]);
  }
  const users = await User.find({ _id: { $in: rows.map((row) => row._id).filter(Boolean) } })
    .select('username profile.displayName profile.avatar creatorMonetizationStatus').lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return rows.map((row, index) => ({ rank: index + 1, creator: byId.get(String(row._id)) || null, value: metric === 'watchTime' ? Math.round(safeNumber(row.value) / 60_000) : roundMoney(row.value) })).filter((row) => row.creator);
};

const getDashboard = async (req, res) => {
  try {
    const { start, end, range } = parseRange(req.query);
    const current = monthBounds(0);
    const previous = monthBounds(-1);
    const awaitingStatuses = ['pending', 'approved', 'processing', 'held'];
    const paidStatuses = ['paid', 'completed'];
    const [
      totalMonetizedCreators,
      creatorsEligible,
      creatorsPendingEligibility,
      creatorsSuspended,
      creatorsUnderReview,
      payoutAggregates,
      currentMonthRevenue,
      previousMonthRevenue,
      lifetimeRevenue,
      estimatedEarnings,
      rangeRevenue,
      rangeEarnings,
      unreservedEarnings,
      unreservedCreators,
      organicViews,
      boostedViews,
      engagementRows,
      averageCpmRows,
      topCreators,
      fastestGrowingCreators,
      highestRevenueCreators,
      highestWatchTimeCreators,
      highestOrganicReachCreators
    ] = await Promise.all([
      User.countDocuments({ userType: 'player', isCreator: true, creatorMonetizationStatus: 'approved', isActive: true }),
      MonetizationEligibility.countDocuments({ isEligible: true }),
      MonetizationEligibility.countDocuments({ isEligible: false, progressPercent: { $gt: 0 } }),
      User.countDocuments({ userType: 'player', creatorMonetizationStatus: 'suspended' }),
      MonetizationApplication.countDocuments({ status: 'pending' }),
      getPayoutAggregates({}),
      sumAggregate(PaymentTransaction, { status: 'completed', type: { $in: ['boost', 'subscription'] }, createdAt: { $gte: current.start, $lt: current.end } }),
      sumAggregate(PaymentTransaction, { status: 'completed', type: { $in: ['boost', 'subscription'] }, createdAt: { $gte: previous.start, $lt: previous.end } }),
      sumAggregate(PaymentTransaction, { status: 'completed', type: { $in: ['boost', 'subscription'] } }),
      sumAggregate(EarningsSnapshot, {}),
      sumAggregate(PaymentTransaction, { status: 'completed', type: { $in: ['boost', 'subscription'] }, createdAt: { $gte: start, $lte: end } }),
      sumAggregate(EarningsSnapshot, { calculatedAt: { $gte: start, $lte: end } }),
      sumAggregate(EarningsSnapshot, { held: { $ne: true }, disbursementReservedAt: null, disbursementId: null }),
      EarningsSnapshot.distinct('user', { held: { $ne: true }, disbursementReservedAt: null, disbursementId: null, amount: { $gt: 0 } }),
      PostEngagement.countDocuments({ eventType: 'view', source: 'organic', createdAt: { $gte: start, $lte: end } }),
      PostEngagement.countDocuments({ eventType: 'view', source: 'boost', createdAt: { $gte: start, $lte: end } }),
      PostEngagement.aggregate([
        { $match: { eventType: { $in: ['view', 'like', 'comment', 'share', 'save'] }, createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$eventType', count: { $sum: 1 } } }
      ]),
      User.aggregate([{ $match: { userType: 'player', isCreator: true, creatorMonetizationStatus: 'approved', creatorCpm: { $gt: 0 } } }, { $group: { _id: null, average: { $avg: '$creatorCpm' } } }]),
      buildLeaderboard({ start, end, metric: 'views', limit: 5 }),
      buildLeaderboard({ start, end, metric: 'followers', limit: 5 }),
      buildLeaderboard({ start, end, metric: 'revenue', limit: 5 }),
      buildLeaderboard({ start, end, metric: 'watchTime', limit: 5 }),
      buildLeaderboard({ start, end, metric: 'organicReach', limit: 5 })
    ]);

    const paid = payoutAggregates.paid || { amount: 0, count: 0, creators: new Set() };
    const awaiting = awaitingStatuses.reduce((acc, status) => {
      const row = payoutAggregates[status];
      if (!row) return acc;
      acc.amount += row.amount;
      acc.count += row.count;
      row.creators.forEach((creator) => acc.creators.add(creator));
      return acc;
    }, { amount: 0, count: 0, creators: new Set() });
    const paidThisMonthCreatorRows = await CreatorPayout.distinct('user', { status: { $in: paidStatuses }, paidAt: { $gte: current.start, $lt: current.end } });
    const paidWithdrawalsThisMonth = await WithdrawalRequest.distinct('user', { status: { $in: paidStatuses }, paidAt: { $gte: current.start, $lt: current.end } });
    const creatorsPaidThisMonth = new Set([...paidThisMonthCreatorRows, ...paidWithdrawalsThisMonth].map(String)).size;
    const interactionCounts = Object.fromEntries(engagementRows.map((row) => [row._id, row.count]));
    const interactions = safeNumber(interactionCounts.like) + safeNumber(interactionCounts.comment) + safeNumber(interactionCounts.share) + safeNumber(interactionCounts.save);
    const eligibleOrganicViews = organicViews;
    const creatorRevenue = roundMoney(rangeEarnings.amount);
    const platformRevenue = roundMoney(Math.max(0, rangeRevenue.amount - creatorRevenue));

    return res.json({
      success: true,
      data: {
        range: { key: range, start, end },
        totals: {
          totalMonetizedCreators,
          creatorsEligible,
          creatorsPendingEligibility,
          creatorsSuspended,
          creatorsUnderReview,
          creatorsPaidThisMonth,
          creatorsAwaitingPayout: new Set([...awaiting.creators, ...unreservedCreators.map(String)]).size,
          totalRevenueGenerated: lifetimeRevenue.amount,
          totalEstimatedCreatorEarnings: estimatedEarnings.amount,
          totalPaid: paid.amount,
          pendingPayoutAmount: roundMoney(awaiting.amount + unreservedEarnings.amount),
          currentMonthRevenue: currentMonthRevenue.amount,
          previousMonthRevenue: previousMonthRevenue.amount,
          platformRevenue,
          creatorRevenue,
          averageRpm: eligibleOrganicViews ? roundMoney((creatorRevenue / eligibleOrganicViews) * 1000) : 0,
          averageCpm: roundMoney(averageCpmRows[0]?.average || PLATFORM_DEFAULT_CPM),
          averageEngagementRate: organicViews + boostedViews ? roundMoney((interactions / (organicViews + boostedViews)) * 100) : 0,
          organicViews,
          boostedViews,
          eligibleViews: eligibleOrganicViews
        },
        payoutStatus: Object.fromEntries(Object.entries(payoutAggregates).map(([key, row]) => [key, { amount: row.amount, count: row.count, creators: row.creators.size }])),
        rankings: { topCreators, fastestGrowingCreators, highestRevenueCreators, highestWatchTimeCreators, highestOrganicReachCreators },
        accountingBasis: {
          grossRevenueTypes: ['boost', 'subscription'],
          creatorEarningsBasis: 'eligible_unique_organic_clip_views_x_creator_cpm',
          boostedViewsExcludedFromEligibilityAndEarnings: true,
          currency: 'INR'
        }
      }
    });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load monetization dashboard');
  }
};

const getCharts = async (req, res) => {
  try {
    const { start, end, range } = parseRange(req.query);
    const dayExpression = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } };
    const calculatedDay = { $dateToString: { format: '%Y-%m-%d', date: '$calculatedAt', timezone: 'UTC' } };
    const [views, eligibleViews, watch, engagement, followers, revenue, earnings, posting, profileVisits] = await Promise.all([
      PostEngagement.aggregate([{ $match: { eventType: 'view', createdAt: { $gte: start, $lte: end } } }, { $group: { _id: { day: dayExpression, source: '$source' }, value: { $sum: 1 } } }, { $sort: { '_id.day': 1 } }]),
      PostEngagement.aggregate(buildUniquePostViewPipeline({ source: 'organic', sinceDate: start, untilDate: end, groupBy: 'day' })),
      PostEngagement.aggregate([{ $match: { eventType: { $in: ['watch', 'dwell'] }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: dayExpression, value: { $sum: '$durationMs' } } }, { $sort: { _id: 1 } }]),
      PostEngagement.aggregate([{ $match: { eventType: { $in: ['like', 'comment', 'share', 'save'] }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: dayExpression, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Follow.aggregate([{ $match: { createdAt: { $gte: start, $lte: end } } }, { $group: { _id: dayExpression, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      PaymentTransaction.aggregate([{ $match: { status: 'completed', type: { $in: ['boost', 'subscription'] }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: dayExpression, value: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
      EarningsSnapshot.aggregate([{ $match: { calculatedAt: { $gte: start, $lte: end } } }, { $group: { _id: calculatedDay, value: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
      Post.aggregate([{ $match: { isActive: true, hiddenByAdmin: { $ne: true }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: dayExpression, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      ProfileVisitDaily.aggregate([{ $match: { day: profileVisitRange(start, end) } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$day', timezone: 'UTC' } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    ]);
    return res.json({ success: true, data: { range: { key: range, start, end }, views, eligibleViews: eligibleViews.map((row) => ({ _id: row._id, value: row.views })), watchTime: watch.map((row) => ({ ...row, value: Math.round(row.value / 1000) })), engagement, followers, revenue, earnings, postingFrequency: posting, profileVisits } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load monetization charts');
  }
};

const getLeaderboards = async (req, res) => {
  try {
    const { start, end, range } = parseRange(req.query);
    const metric = String(req.query.metric || 'views');
    const allowed = new Set(['views', 'followers', 'revenue', 'watchTime', 'organicReach']);
    if (!allowed.has(metric)) return res.status(400).json({ success: false, code: 'INVALID_LEADERBOARD_METRIC', message: 'Unsupported leaderboard metric' });
    const rows = await buildLeaderboard({ start, end, metric, limit: req.query.limit });
    return res.json({ success: true, data: { range: { key: range, start, end }, metric, rows } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load creator leaderboard');
  }
};

const buildCreatorBaseQuery = (query) => {
  const filter = { userType: 'player', isActive: true };
  if (query.status && query.status !== 'all') {
    if (!CREATOR_STATUSES.has(String(query.status))) throw Object.assign(new Error('Invalid creator monetization status'), { statusCode: 400, code: 'INVALID_CREATOR_STATUS' });
    filter.creatorMonetizationStatus = String(query.status);
  } else {
    // Suspension/rejection/disable intentionally clears `isCreator`. Keep
    // those historical creator accounts visible to Finance while excluding
    // ordinary users who have never entered monetization.
    filter.$or = [
      { isCreator: true },
      { creatorMonetizationStatus: { $in: ['eligible', 'pending', 'approved', 'rejected', 'suspended', 'disabled', 'withdrawn'] } }
    ];
  }
  if (query.premium === 'true') filter['membership.tier'] = { $ne: 'free' };
  if (query.premium === 'false') filter['membership.tier'] = 'free';
  if (query.verified === 'true') filter.isVerifiedHost = true;
  if (query.verified === 'false') filter.isVerifiedHost = false;
  if (query.game) filter['playerInfo.games.name'] = new RegExp(`^${escapeRegex(String(query.game).slice(0, 80))}$`, 'i');
  if (query.joinedFrom || query.joinedTo) {
    filter.createdAt = {
      ...(query.joinedFrom ? { $gte: parseDate(query.joinedFrom) || new Date(0) } : {}),
      ...(query.joinedTo ? { $lte: parseDate(query.joinedTo, true) || new Date() } : {})
    };
  }
  return filter;
};

const appendCreatorSearch = (filter, clauses) => {
  if (!Array.isArray(clauses) || clauses.length === 0) return filter;
  if (Array.isArray(filter.$or)) {
    const monetizationScope = filter.$or;
    delete filter.$or;
    filter.$and = [...(filter.$and || []), { $or: monetizationScope }, { $or: clauses }];
  } else {
    filter.$or = clauses;
  }
  return filter;
};

const listCreators = async (req, res) => {
  try {
    const page = normalizePage(req.query.page);
    const limit = normalizeLimit(req.query.limit);
    const query = buildCreatorBaseQuery(req.query);
    if (req.query.country) {
      const bankUsers = await CreatorBankDetails.distinct('user', {
        country: String(req.query.country).toUpperCase().slice(0, 2)
      });
      query._id = { $in: bankUsers };
    }
    const search = String(req.query.q || '').trim().slice(0, 120);
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const bankUsers = await CreatorBankDetails.distinct('user', { $or: [{ accountHolderName: regex }, { bankName: regex }] });
      appendCreatorSearch(query, [{ username: regex }, { email: regex }, { phone: regex }, { 'profile.displayName': regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : []), { _id: { $in: bankUsers } }]);
    }
    const candidateSets = [];
    if (req.query.eligible === 'true' || req.query.eligible === 'false') {
      candidateSets.push((await MonetizationEligibility.distinct('user', { isEligible: req.query.eligible === 'true' })).map(String));
    }
    if (req.query.minFollowers || req.query.maxFollowers) {
      const followerRows = await Follow.aggregate([
        { $group: { _id: '$following', value: { $sum: 1 } } },
        { $match: { value: { ...(req.query.minFollowers ? { $gte: safeNumber(req.query.minFollowers) } : {}), ...(req.query.maxFollowers ? { $lte: safeNumber(req.query.maxFollowers) } : {}) } } }
      ]);
      candidateSets.push(followerRows.map((row) => String(row._id)));
    }
    if (req.query.minRevenue || req.query.maxRevenue) {
      const revenueRows = await EarningsSnapshot.aggregate([
        { $group: { _id: '$user', value: { $sum: '$amount' } } },
        { $match: { value: { ...(req.query.minRevenue ? { $gte: safeNumber(req.query.minRevenue) } : {}), ...(req.query.maxRevenue ? { $lte: safeNumber(req.query.maxRevenue) } : {}) } } }
      ]);
      candidateSets.push(revenueRows.map((row) => String(row._id)));
    }
    if (req.query.minViews || req.query.maxViews) {
      const viewRows = await MonetizationEligibility.find({
        'metrics.totalOrganicClipViews45d': {
          ...(req.query.minViews ? { $gte: safeNumber(req.query.minViews) } : {}),
          ...(req.query.maxViews ? { $lte: safeNumber(req.query.maxViews) } : {})
        }
      }).distinct('user');
      candidateSets.push(viewRows.map(String));
    }
    if (candidateSets.length) {
      const intersection = candidateSets.reduce((current, next) => {
        const allowed = new Set(next);
        return current == null ? next : current.filter((id) => allowed.has(id));
      }, null) || [];
      const countryIds = Array.isArray(query._id?.$in) ? new Set(query._id.$in.map(String)) : null;
      query._id = { $in: intersection.filter((id) => !countryIds || countryIds.has(id)).map((id) => asObjectId(id)) };
    }
    const allowedSorts = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { 'profile.displayName': 1 },
      status: { creatorMonetizationStatus: 1, createdAt: -1 }
    };
    const sort = allowedSorts[String(req.query.sort || 'newest')] || allowedSorts.newest;
    let creators;
    let total;
    const derivedSort = String(req.query.sort || '');
    if (['revenue_desc', 'followers_desc', 'views_desc'].includes(derivedSort)) {
      const baseIds = await User.find(query).distinct('_id');
      let scored;
      if (derivedSort === 'revenue_desc') {
        scored = await EarningsSnapshot.aggregate([{ $match: { user: { $in: baseIds } } }, { $group: { _id: '$user', score: { $sum: '$amount' } } }, { $sort: { score: -1, _id: 1 } }]);
      } else if (derivedSort === 'followers_desc') {
        scored = await Follow.aggregate([{ $match: { following: { $in: baseIds } } }, { $group: { _id: '$following', score: { $sum: 1 } } }, { $sort: { score: -1, _id: 1 } }]);
      } else {
        scored = await MonetizationEligibility.find({ user: { $in: baseIds } }).select('user metrics.totalOrganicClipViews45d').lean();
        scored = scored.map((row) => ({ _id: row.user, score: safeNumber(row.metrics?.totalOrganicClipViews45d) })).sort((a, b) => b.score - a.score);
      }
      const scoredIds = scored.map((row) => String(row._id));
      const scoredSet = new Set(scoredIds);
      baseIds.forEach((id) => { if (!scoredSet.has(String(id))) scoredIds.push(String(id)); });
      total = scoredIds.length;
      const pageIds = scoredIds.slice((page - 1) * limit, page * limit);
      const unsortedCreators = await User.find({ _id: { $in: pageIds } })
        .select('username email phone profile.displayName profile.avatar profile.location membership isPremium isVerifiedHost isCreator creatorMonetizationStatus creatorCpm playerInfo.games createdAt lastActive').lean();
      const order = new Map(pageIds.map((id, index) => [id, index]));
      creators = unsortedCreators.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
    } else {
      [creators, total] = await Promise.all([
        User.find(query)
          .select('username email phone profile.displayName profile.avatar profile.location membership isPremium isVerifiedHost isCreator creatorMonetizationStatus creatorCpm playerInfo.games createdAt lastActive')
          .sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        User.countDocuments(query)
      ]);
    }
    const userIds = creators.map((creator) => creator._id);
    const [eligibilities, followerRows, earningRows, payoutRows, banks] = await Promise.all([
      MonetizationEligibility.find({ user: { $in: userIds } }).lean(),
      Follow.aggregate([{ $match: { following: { $in: userIds } } }, { $group: { _id: '$following', count: { $sum: 1 } } }]),
      EarningsSnapshot.aggregate([{ $match: { user: { $in: userIds } } }, { $group: { _id: '$user', estimated: { $sum: '$amount' }, organicRevenue: { $sum: '$breakdown.organicRevenue' } } }]),
      CreatorPayout.aggregate([{ $match: { user: { $in: userIds } } }, { $group: { _id: { user: '$user', status: '$status' }, amount: { $sum: '$amount' } } }]),
      CreatorBankDetails.find({ user: { $in: userIds } }).select('user accountHolderName bankName lastFourDigits ifsc branch upiIdMasked country verificationStatus updatedAt').lean()
    ]);
    const eligibilityMap = new Map(eligibilities.map((row) => [String(row.user), row]));
    const followersMap = new Map(followerRows.map((row) => [String(row._id), row.count]));
    const earningsMap = new Map(earningRows.map((row) => [String(row._id), row]));
    const banksMap = new Map(banks.map((row) => [String(row.user), row]));
    const payoutsMap = new Map();
    payoutRows.forEach((row) => {
      const id = String(row._id.user);
      const current = payoutsMap.get(id) || { paid: 0, pending: 0, held: 0 };
      if (['paid', 'completed'].includes(row._id.status)) current.paid += row.amount;
      else if (row._id.status === 'held') current.held += row.amount;
      else if (['pending', 'approved', 'processing'].includes(row._id.status)) current.pending += row.amount;
      payoutsMap.set(id, current);
    });
    let rows = creators.map((creator) => ({
      ...creator,
      followers: followersMap.get(String(creator._id)) || 0,
      eligibility: eligibilityMap.get(String(creator._id)) || null,
      earnings: { ...(earningsMap.get(String(creator._id)) || { estimated: 0, organicRevenue: 0 }), ...(payoutsMap.get(String(creator._id)) || { paid: 0, pending: 0, held: 0 }) },
      bankDetails: maskedBank(banksMap.get(String(creator._id)))
    }));
    return res.json({ success: true, data: { creators: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load monetized creators');
  }
};

const exportCreators = async (req, res) => {
  try {
    const query = buildCreatorBaseQuery(req.query);
    const search = String(req.query.q || '').trim().slice(0, 120);
    if (req.query.country) {
      query._id = { $in: await CreatorBankDetails.distinct('user', { country: String(req.query.country).toUpperCase().slice(0, 2) }) };
    }
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const bankUsers = await CreatorBankDetails.distinct('user', { $or: [{ accountHolderName: regex }, { bankName: regex }] });
      appendCreatorSearch(query, [{ username: regex }, { email: regex }, { phone: regex }, { 'profile.displayName': regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : []), { _id: { $in: bankUsers } }]);
    }
    const creators = await User.find(query).select('username email phone profile.displayName creatorMonetizationStatus creatorCpm membership isVerifiedHost createdAt').sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS + 1).lean();
    if (creators.length > MAX_EXPORT_ROWS) return res.status(413).json({ success: false, code: 'CREATOR_EXPORT_TOO_LARGE', message: 'Narrow the creator filters to 10,000 records or fewer.' });
    const ids = creators.map((creator) => creator._id);
    const [eligibilities, followers, earnings, banks] = await Promise.all([
      MonetizationEligibility.find({ user: { $in: ids } }).lean(),
      Follow.aggregate([{ $match: { following: { $in: ids } } }, { $group: { _id: '$following', count: { $sum: 1 } } }]),
      EarningsSnapshot.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', amount: { $sum: '$amount' } } }]),
      CreatorBankDetails.find({ user: { $in: ids } }).select('user accountHolderName bankName country verificationStatus').lean()
    ]);
    const eligibilityMap = new Map(eligibilities.map((row) => [String(row.user), row]));
    const followerMap = new Map(followers.map((row) => [String(row._id), row.count]));
    const earningMap = new Map(earnings.map((row) => [String(row._id), row.amount]));
    const bankMap = new Map(banks.map((row) => [String(row.user), row]));
    let rows = creators.map((creator) => ({ creator, eligibility: eligibilityMap.get(String(creator._id)), followers: followerMap.get(String(creator._id)) || 0, earnings: roundMoney(earningMap.get(String(creator._id)) || 0), bank: bankMap.get(String(creator._id)) }));
    if (req.query.eligible === 'true') rows = rows.filter((row) => row.eligibility?.isEligible);
    if (req.query.eligible === 'false') rows = rows.filter((row) => !row.eligibility?.isEligible);
    if (req.query.minRevenue) rows = rows.filter((row) => row.earnings >= safeNumber(req.query.minRevenue));
    if (req.query.minFollowers) rows = rows.filter((row) => row.followers >= safeNumber(req.query.minFollowers));
    if (req.query.minViews) rows = rows.filter((row) => safeNumber(row.eligibility?.metrics?.totalOrganicClipViews45d) >= safeNumber(req.query.minViews));
    const table = [
      ['Creator', 'Username', 'User ID', 'Email', 'Phone', 'Status', 'Premium', 'Verified Host', 'Followers', 'Organic Views 45d', 'Boosted Views 45d', 'Eligible', 'Eligibility %', 'Estimated Earnings', 'CPM', 'Bank Holder', 'Bank', 'Bank Country', 'Bank Verification', 'Joined'],
      ...rows.map(({ creator, eligibility, followers: count, earnings: amount, bank }) => [
        creator.profile?.displayName || creator.username,
        creator.username,
        creator._id,
        creator.email || '',
        creator.phone || '',
        creator.creatorMonetizationStatus || '',
        creator.membership?.tier !== 'free' ? creator.membership?.tier : 'free',
        creator.isVerifiedHost ? 'Yes' : 'No',
        count,
        eligibility?.metrics?.totalOrganicClipViews45d || 0,
        eligibility?.metrics?.totalBoostedClipViews45d || 0,
        eligibility?.isEligible ? 'Yes' : 'No',
        eligibility?.progressPercent || 0,
        amount,
        creator.creatorCpm || PLATFORM_DEFAULT_CPM,
        bank?.accountHolderName || '',
        bank?.bankName || '',
        bank?.country || '',
        bank?.verificationStatus || 'missing',
        creator.createdAt ? new Date(creator.createdAt).toISOString() : ''
      ])
    ];
    await recordFinancialAccess(req, {
      action: 'EXPORT_MONETIZED_CREATORS_SECURE',
      resourceType: 'creator-monetization-export',
      metadata: { rows: rows.length, format: 'csv' }
    });
    res.type('text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', 'attachment; filename="monetized-creators.csv"');
    return res.send(table.map((row) => row.map(csvCell).join(',')).join('\n'));
  } catch (error) {
    return sendFailure(res, error, 'Failed to export monetized creators');
  }
};

const creatorPerformance = async (userId, start, end) => {
  const objectId = asObjectId(userId);
  const posts = await Post.find({ author: objectId, isActive: true, hiddenByAdmin: { $ne: true } }).select('_id content.media createdAt').lean();
  const postIds = posts.map((post) => post._id);
  const rangeMatch = { author: objectId, createdAt: { $gte: start, $lte: end } };
  const last45DaysStart = new Date(Date.now() - (44 * DAY_MS));
  const [events, followerCount, followerGrowth, profileApplications, stories, viewerStatsRows, audienceRows, profileVisits, eligibleViewRows, last45DaysViews] = await Promise.all([
    PostEngagement.aggregate([{ $match: rangeMatch }, { $group: { _id: { event: '$eventType', source: '$source' }, count: { $sum: 1 }, durationMs: { $sum: '$durationMs' }, averageCompletion: { $avg: '$completionRate' } } }]),
    Follow.countDocuments({ following: objectId }),
    Follow.countDocuments({ following: objectId, createdAt: { $gte: start, $lte: end } }),
    MonetizationApplication.countDocuments({ user: objectId }),
    Story.countDocuments({ author: objectId, createdAt: { $gte: start, $lte: end } }),
    PostEngagement.aggregate([
      { $match: { author: objectId, eventType: 'view', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$user', viewedPosts: { $addToSet: '$post' } } },
      { $group: { _id: null, uniqueViewers: { $sum: 1 }, returningViewers: { $sum: { $cond: [{ $gt: [{ $size: '$viewedPosts' }, 1] }, 1, 0] } } } }
    ]),
    PostEngagement.aggregate([
      { $match: { author: objectId, eventType: 'view', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$user' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'viewer' } },
      { $unwind: '$viewer' },
      { $group: { _id: { $ifNull: ['$viewer.profile.gender', 'unspecified'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    ProfileVisitDaily.countDocuments({ profileOwner: objectId, day: profileVisitRange(start, end) }),
    postIds.length
      ? PostEngagement.aggregate(buildUniquePostViewPipeline({ postIds, source: 'organic', sinceDate: start, untilDate: end, groupBy: 'total' }))
      : Promise.resolve([]),
    postIds.length
      ? PostEngagement.countDocuments({ post: { $in: postIds }, eventType: 'view', createdAt: { $gte: last45DaysStart } })
      : Promise.resolve(0)
  ]);
  const counts = {};
  events.forEach((row) => { counts[`${row._id.event}:${row._id.source}`] = row; });
  const organicViews = safeNumber(counts['view:organic']?.count);
  const boostedViews = safeNumber(counts['view:boost']?.count);
  const likes = safeNumber(counts['like:organic']?.count) + safeNumber(counts['like:boost']?.count);
  const comments = safeNumber(counts['comment:organic']?.count) + safeNumber(counts['comment:boost']?.count);
  const shares = safeNumber(counts['share:organic']?.count) + safeNumber(counts['share:boost']?.count);
  const saves = safeNumber(counts['save:organic']?.count) + safeNumber(counts['save:boost']?.count);
  const watchMs = events.filter((row) => ['watch', 'dwell'].includes(row._id.event)).reduce((sum, row) => sum + safeNumber(row.durationMs), 0);
  const completionRows = events.filter((row) => ['watch', 'dwell', 'view'].includes(row._id.event));
  const completionEvents = completionRows.reduce((sum, row) => sum + safeNumber(row.count), 0);
  const activeDays = new Set(posts.filter((post) => post.createdAt >= start && post.createdAt <= end).map((post) => new Date(post.createdAt).toISOString().slice(0, 10))).size;
  const videos = posts.filter((post) => (post.content?.media || []).some((media) => media?.type === 'video')).length;
  const images = posts.filter((post) => (post.content?.media || []).some((media) => media?.type === 'image')).length;
  const totalViews = organicViews + boostedViews;
  return {
    followers: followerCount,
    followerGrowth,
    totalViews,
    uniqueViews: safeNumber(viewerStatsRows[0]?.uniqueViewers),
    returningViewers: safeNumber(viewerStatsRows[0]?.returningViewers),
    organicViews,
    boostedViews,
    eligibleViews: safeNumber(eligibleViewRows[0]?.views),
    last45DaysViews,
    reach: totalViews,
    watchTimeSeconds: Math.round(watchMs / 1000),
    averageWatchTimeSeconds: totalViews ? Math.round((watchMs / totalViews) / 1000) : 0,
    completionRate: completionEvents ? roundMoney((completionRows.reduce((sum, row) => sum + (safeNumber(row.averageCompletion) * safeNumber(row.count)), 0) / completionEvents) * 100) : 0,
    posts: posts.length,
    videos,
    images,
    stories,
    likes,
    comments,
    shares,
    saves,
    engagementRate: totalViews ? roundMoney(((likes + comments + shares + saves) / totalViews) * 100) : 0,
    profileVisits,
    postingFrequency: roundMoney(posts.filter((post) => post.createdAt >= start && post.createdAt <= end).length / Math.max(1, Math.ceil((end - start) / DAY_MS))),
    activeDays,
    activityScore: Math.min(100, Math.round((activeDays / Math.max(1, Math.ceil((end - start) / DAY_MS))) * 100)),
    audienceBreakdown: { gender: audienceRows.map((row) => ({ label: row._id || 'unspecified', value: row.count })) },
    trackedProfileApplications: profileApplications,
    trackingAvailability: {
      profileVisits: true,
      profileVisitRetentionDays: ProfileVisitDaily.PROFILE_VISIT_RETENTION_DAYS,
      historicalStoriesBeyondTtl: false
    }
  };
};

const creatorChartSeries = async (userId, start, end) => {
  const objectId = asObjectId(userId);
  const engagementDay = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } };
  const earningsDay = { $dateToString: { format: '%Y-%m-%d', date: '$calculatedAt', timezone: 'UTC' } };
  const eligiblePostIds = await Post.find({ author: objectId, isActive: true, hiddenByAdmin: { $ne: true } }).distinct('_id');
  const [views, eligibleViews, watchTime, engagement, followers, earnings, postingFrequency, profileVisits] = await Promise.all([
    PostEngagement.aggregate([{ $match: { author: objectId, eventType: 'view', createdAt: { $gte: start, $lte: end } } }, { $group: { _id: { day: engagementDay, source: '$source' }, value: { $sum: 1 } } }, { $sort: { '_id.day': 1 } }]),
    eligiblePostIds.length
      ? PostEngagement.aggregate(buildUniquePostViewPipeline({ postIds: eligiblePostIds, source: 'organic', sinceDate: start, untilDate: end, groupBy: 'day' }))
      : Promise.resolve([]),
    PostEngagement.aggregate([{ $match: { author: objectId, eventType: { $in: ['watch', 'dwell'] }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: engagementDay, value: { $sum: '$durationMs' } } }, { $sort: { _id: 1 } }]),
    PostEngagement.aggregate([{ $match: { author: objectId, eventType: { $in: ['like', 'comment', 'share', 'save'] }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: engagementDay, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Follow.aggregate([{ $match: { following: objectId, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: engagementDay, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    EarningsSnapshot.aggregate([{ $match: { user: objectId, calculatedAt: { $gte: start, $lte: end } } }, { $group: { _id: earningsDay, value: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
    Post.aggregate([{ $match: { author: objectId, isActive: true, hiddenByAdmin: { $ne: true }, createdAt: { $gte: start, $lte: end } } }, { $group: { _id: engagementDay, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ProfileVisitDaily.aggregate([{ $match: { profileOwner: objectId, day: profileVisitRange(start, end) } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$day', timezone: 'UTC' } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  ]);
  return {
    views,
    organicViews: views.filter((row) => row._id.source === 'organic'),
    eligibleViews: eligibleViews.map((row) => ({ _id: row._id, value: row.views })),
    watchTime: watchTime.map((row) => ({ ...row, value: Math.round(safeNumber(row.value) / 1000) })),
    engagement,
    followers,
    revenue: earnings,
    estimatedEarnings: earnings,
    postingFrequency,
    profileVisits
  };
};

const getCreatorOverview = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, code: 'INVALID_CREATOR_ID', message: 'Valid creator ID is required' });
    const { start, end, range } = parseRange(req.query);
    const creator = await User.findOne({ _id: userId, userType: 'player' })
      .select('username email phone profile membership isPremium isVerifiedHost isCreator creatorMonetizationStatus creatorCpm playerInfo.games createdAt lastActive').lean();
    if (!creator) return res.status(404).json({ success: false, code: 'CREATOR_NOT_FOUND', message: 'Creator not found' });
    const currentMonth = monthBounds(0);
    const previousMonth = monthBounds(-1);
    const [performance, eligibility, eligibilityHistory, application, snapshots, payouts, withdrawals, bank, charts, currentCycle, currentEstimate] = await Promise.all([
      creatorPerformance(userId, start, end),
      MonetizationEligibility.findOne({ user: userId }).lean(),
      CreatorEligibilityHistory.find({ user: userId }).sort({ calculatedAt: -1 }).limit(60).lean(),
      MonetizationApplication.findOne({ user: userId }).sort({ appliedAt: -1 }).lean(),
      EarningsSnapshot.find({ user: userId }).populate('payoutCycle', 'cycleLabel startDate endDate status').sort({ calculatedAt: -1 }).lean(),
      CreatorPayout.find({ user: userId }).populate('payoutCycle', 'cycleLabel startDate endDate').sort({ createdAt: -1 }).lean(),
      WithdrawalRequest.find({ user: userId }).populate('payoutCycle', 'cycleLabel startDate endDate').sort({ createdAt: -1 }).lean(),
      CreatorBankDetails.findOne({ user: userId }).select('accountHolderName bankName lastFourDigits ifsc branch upiIdMasked country taxIdHash gstNumberMasked verificationStatus version updatedAt').lean(),
      creatorChartSeries(userId, start, end),
      PayoutCycle.findOne({ status: 'open' }).sort({ endDate: -1 }).lean(),
      getEstimatedEarningsForCreator(userId)
    ]);
    const lifetimeEarnings = roundMoney(snapshots.reduce((sum, row) => sum + safeNumber(row.amount), 0));
    const paidEarnings = roundMoney([...payouts, ...withdrawals].filter((row) => ['paid', 'completed'].includes(row.status)).reduce((sum, row) => sum + safeNumber(row.amount), 0));
    const unreservedCarryForward = roundMoney(snapshots.filter((row) => !row.held && !row.disbursementId && !row.disbursementReservedAt).reduce((sum, row) => sum + safeNumber(row.amount), 0));
    const pendingEarnings = roundMoney(
      [...payouts, ...withdrawals].filter((row) => ['pending', 'approved', 'processing'].includes(row.status)).reduce((sum, row) => sum + safeNumber(row.amount), 0)
      + unreservedCarryForward
    );
    const heldEarnings = roundMoney([...payouts, ...withdrawals].filter((row) => row.status === 'held').reduce((sum, row) => sum + safeNumber(row.amount), 0) + snapshots.filter((row) => row.held && !row.disbursementId).reduce((sum, row) => sum + safeNumber(row.amount), 0));
    const currentMonthEstimated = roundMoney(currentEstimate?.amount || 0);
    const lastMonthEarnings = roundMoney(snapshots.filter((row) => {
      const cycleStart = row.payoutCycle?.startDate ? new Date(row.payoutCycle.startDate) : null;
      const basisDate = cycleStart && !Number.isNaN(cycleStart.getTime()) ? cycleStart : new Date(row.calculatedAt);
      return basisDate >= previousMonth.start && basisDate < currentMonth.start;
    }).reduce((sum, row) => sum + safeNumber(row.amount), 0));
    const breakdown = snapshots.reduce((acc, row) => {
      acc.organicRevenue += safeNumber(row.breakdown?.organicRevenue || row.amount);
      acc.bonusRevenue += safeNumber(row.breakdown?.bonusRevenue);
      acc.referralRevenue += safeNumber(row.breakdown?.referralRevenue);
      acc.platformAdjustments += safeNumber(row.breakdown?.platformAdjustments);
      acc.taxes += safeNumber(row.breakdown?.taxes);
      return acc;
    }, { organicRevenue: 0, bonusRevenue: 0, referralRevenue: 0, platformAdjustments: 0, taxes: 0 });
    Object.keys(breakdown).forEach((key) => { breakdown[key] = roundMoney(breakdown[key]); });
    const allDisbursements = [...payouts, ...withdrawals];
    const lastPaid = allDisbursements.filter((row) => ['paid', 'completed'].includes(row.status) && row.paidAt).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0] || null;
    const effectiveCurrentCycle = currentCycle || (currentEstimate?.cycleId ? {
      _id: currentEstimate.cycleId,
      cycleLabel: currentEstimate.cycleLabel,
      endDate: currentEstimate.cycleEndDate
    } : null);
    const payoutSummary = {
      currentCycle: effectiveCurrentCycle ? { _id: effectiveCurrentCycle._id, cycleLabel: effectiveCurrentCycle.cycleLabel, startDate: effectiveCurrentCycle.startDate, endDate: effectiveCurrentCycle.endDate } : null,
      pendingAmount: roundMoney(allDisbursements.filter((row) => row.status === 'pending').reduce((sum, row) => sum + safeNumber(row.amount), 0) + unreservedCarryForward),
      approvedAmount: roundMoney(allDisbursements.filter((row) => row.status === 'approved').reduce((sum, row) => sum + safeNumber(row.amount), 0)),
      processingAmount: roundMoney(allDisbursements.filter((row) => row.status === 'processing').reduce((sum, row) => sum + safeNumber(row.amount), 0)),
      paidAmount: paidEarnings,
      heldAmount: heldEarnings,
      nextPayoutDate: effectiveCurrentCycle?.endDate || null,
      lastPayoutDate: lastPaid?.paidAt || null,
      bankVerificationStatus: bank?.verificationStatus || 'missing',
      payoutStatus: allDisbursements[0]?.status || (unreservedCarryForward > 0 ? 'awaiting_generation' : 'none'),
      paymentMethod: allDisbursements[0]?.paymentMethod || (bank ? 'bank_transfer' : '')
    };
    await recordFinancialAccess(req, {
      action: 'VIEW_CREATOR_EARNINGS_PROFILE_SECURE',
      resourceType: 'creator-monetization',
      resourceId: userId,
      metadata: { range }
    });
    return res.json({
      success: true,
      data: {
        range: { key: range, start, end },
        creator,
        performance,
        earnings: {
          currentMonthEstimated,
          lastMonthEarnings,
          lifetimeEarnings,
          pendingEarnings,
          paidEarnings,
          heldEarnings,
          carryForwardEarnings: unreservedCarryForward,
          ...breakdown,
          // Snapshot.amount is already the final post-adjustment/post-tax
          // liability; applying adjustments again would double count them.
          finalPayoutAmount: pendingEarnings
        },
        eligibility: eligibility || null,
        eligibilityCriteria: {
          premiumMembership: true,
          followers: 1000,
          organicViews45d: 100000,
          clipsAbove3000Views: 5,
          activeDays45d: 25
        },
        application: application || null,
        eligibilityHistory,
        bankDetails: maskedBank(bank),
        payouts,
        withdrawals,
        payoutSummary,
        charts
      }
    });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load creator analytics');
  }
};

const buildPayoutQuery = async (query) => {
  const filter = {};
  if (query.status && query.status !== 'all') {
    if (!PAYOUT_STATUSES.has(String(query.status))) throw Object.assign(new Error('Invalid payout status'), { statusCode: 400, code: 'INVALID_PAYOUT_STATUS' });
    filter.status = String(query.status);
  }
  const reportTypeStatuses = {
    pending_payouts: ['pending', 'approved', 'processing'],
    completed_payouts: ['paid', 'completed'],
    held_payouts: ['held'],
    failed_payouts: ['failed']
  };
  if (!filter.status && reportTypeStatuses[String(query.reportType || '')]) {
    filter.status = { $in: reportTypeStatuses[String(query.reportType)] };
  }
  if (!filter.status && query.paidState === 'paid') filter.status = { $in: ['paid', 'completed'] };
  if (!filter.status && query.paidState === 'not_paid') filter.status = { $nin: ['paid', 'completed'] };
  if (query.from || query.to) {
    const start = parseDate(query.from) || new Date(0);
    const end = parseDate(query.to, true) || new Date();
    filter.createdAt = { $gte: start, $lte: end };
  }
  if (query.minAmount || query.maxAmount) filter.amount = { ...(query.minAmount ? { $gte: safeNumber(query.minAmount) } : {}), ...(query.maxAmount ? { $lte: safeNumber(query.maxAmount) } : {}) };
  const selectedIds = String(query.ids || '').split(',').filter((id) => mongoose.isValidObjectId(id)).slice(0, 1000);
  if (selectedIds.length) filter._id = { $in: selectedIds.map(asObjectId) };
  if (query.bankStatus && query.bankStatus !== 'all') {
    const bankUsers = query.bankStatus === 'missing'
      ? await CreatorBankDetails.distinct('user', {})
      : await CreatorBankDetails.distinct('user', { verificationStatus: String(query.bankStatus) });
    filter.$and = [...(filter.$and || []), { user: query.bankStatus === 'missing' ? { $nin: bankUsers } : { $in: bankUsers } }];
  }
  const search = String(query.q || '').trim().slice(0, 120);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const [users, banks] = await Promise.all([
      User.distinct('_id', { $or: [{ username: regex }, { email: regex }, { phone: regex }, { 'profile.displayName': regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] }),
      CreatorBankDetails.find({ $or: [{ accountHolderName: regex }, { bankName: regex }] }).select('_id user').lean()
    ]);
    filter.$or = [{ user: { $in: [...users, ...banks.map((bank) => bank.user)] } }, { bankReference: regex }, { transactionId: regex }, { bankDetails: { $in: banks.map((bank) => bank._id) } }];
  }
  return filter;
};

const listPayouts = async (req, res) => {
  try {
    const page = normalizePage(req.query.page);
    const limit = normalizeLimit(req.query.limit);
    const query = await buildPayoutQuery(req.query);
    const sortKey = String(req.query.sort || 'newest');
    const sort = sortKey === 'oldest' ? { createdAt: 1 } : sortKey === 'amount_desc' ? { amount: -1 } : sortKey === 'amount_asc' ? { amount: 1 } : { createdAt: -1 };
    let payouts;
    let total;
    if (sortKey === 'alphabetical') {
      const baseRows = await CreatorPayout.find(query).select('_id user createdAt').lean();
      const users = await User.find({ _id: { $in: baseRows.map((row) => row.user) } }).select('_id username profile.displayName').sort({ 'profile.displayName': 1, username: 1 }).lean();
      const userOrder = new Map(users.map((user, index) => [String(user._id), index]));
      baseRows.sort((left, right) => (userOrder.get(String(left.user)) ?? Number.MAX_SAFE_INTEGER) - (userOrder.get(String(right.user)) ?? Number.MAX_SAFE_INTEGER) || new Date(right.createdAt) - new Date(left.createdAt));
      total = baseRows.length;
      const pageIds = baseRows.slice((page - 1) * limit, page * limit).map((row) => String(row._id));
      const pageRows = await CreatorPayout.find({ _id: { $in: pageIds } }).populate('user', 'username email phone profile.displayName profile.avatar').populate('payoutCycle', 'cycleLabel periodType startDate endDate status').lean();
      const order = new Map(pageIds.map((id, index) => [id, index]));
      payouts = pageRows.sort((left, right) => order.get(String(left._id)) - order.get(String(right._id)));
    } else {
      [payouts, total] = await Promise.all([
        CreatorPayout.find(query).populate('user', 'username email phone profile.displayName profile.avatar').populate('payoutCycle', 'cycleLabel periodType startDate endDate status').sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        CreatorPayout.countDocuments(query)
      ]);
    }
    const pages = Math.ceil(total / limit);
    return res.json({ success: true, data: { payouts: payouts.map((payout) => ({ ...payout, bankDetails: payout.bankDetailsSnapshot ? { ...payout.bankDetailsSnapshot, accountNumber: `•••• ${payout.bankDetailsSnapshot.lastFourDigits || '----'}` } : null })), total, page, pages, pagination: { page, limit, total, pages } } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load creator payouts');
  }
};

const getPayoutDetail = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_PAYOUT_ID', message: 'Valid payout ID is required' });
    const payout = await CreatorPayout.findById(req.params.id).populate('user', 'username email phone profile.displayName profile.avatar creatorMonetizationStatus').populate('payoutCycle', 'cycleLabel periodType startDate endDate status minimumPayoutThreshold').lean();
    if (!payout) return res.status(404).json({ success: false, code: 'PAYOUT_NOT_FOUND', message: 'Creator payout not found' });
    const [history, snapshots, bank] = await Promise.all([
      CreatorPayoutHistory.find({ payout: payout._id }).sort({ createdAt: -1 }).lean(),
      EarningsSnapshot.find({
        user: payout.user?._id || payout.user,
        $or: [
          { disbursementId: payout._id },
          { payoutCycle: payout.payoutCycle?._id || payout.payoutCycle }
        ]
      }).populate('payoutCycle', 'cycleLabel startDate endDate').sort({ calculatedAt: 1 }).lean(),
      payout.bankDetails ? CreatorBankDetails.findById(payout.bankDetails).select('accountHolderName bankName lastFourDigits ifsc branch upiIdMasked country taxIdHash gstNumberMasked verificationStatus version updatedAt').lean() : null
    ]);
    await recordFinancialAccess(req, {
      action: 'VIEW_CREATOR_PAYOUT_DETAIL_SECURE',
      resourceType: 'creator-payout',
      resourceId: payout._id,
      metadata: { creatorId: String(payout.user?._id || payout.user) }
    });
    return res.json({
      success: true,
      data: {
        payout,
        bankDetails: maskedBank(bank) || (payout.bankDetailsSnapshot ? { ...payout.bankDetailsSnapshot, accountNumber: `•••• ${payout.bankDetailsSnapshot.lastFourDigits || '----'}` } : null),
        earnings: {
          snapshots,
          amount: roundMoney(snapshots.reduce((sum, row) => sum + safeNumber(row.amount), 0)),
          carryForwardAmount: roundMoney(Math.max(0, snapshots.reduce((sum, row) => sum + safeNumber(row.amount), 0) - safeNumber(snapshots.at(-1)?.amount)))
        },
        history
      }
    });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load creator payout');
  }
};

const getPayoutHistory = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_PAYOUT_ID', message: 'Valid payout ID is required' });
    if (!await CreatorPayout.exists({ _id: req.params.id })) return res.status(404).json({ success: false, code: 'PAYOUT_NOT_FOUND', message: 'Creator payout not found' });
    const rows = await CreatorPayoutHistory.find({ payout: req.params.id }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: { history: rows } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load payout history');
  }
};

const payoutAction = (action) => async (req, res) => {
  try {
    const result = await transitionPayout({ payoutId: req.params.id, action, payload: req.body || {}, req });
    res.locals.auditBefore = { payoutId: req.params.id, expectedVersion: req.body?.expectedVersion ?? null };
    res.locals.auditAfter = { payoutId: req.params.id, status: result.payout?.status, version: result.payout?.version, idempotentReplay: result.idempotentReplay };
    return res.json({ success: true, message: `Payout ${action} completed`, data: result });
  } catch (error) {
    return sendFailure(res, error, `Failed to ${action} payout`);
  }
};

const generate = async (req, res) => {
  try {
    const result = await generatePayouts({ cycleId: req.body?.cycleId, creatorIds: Array.isArray(req.body?.creatorIds) ? req.body.creatorIds : [], limit: req.body?.limit, req });
    res.locals.auditAfter = { requested: result.requested, generated: result.generated };
    return res.status(result.generated ? 201 : 200).json({ success: true, message: `${result.generated} payout(s) generated`, data: result });
  } catch (error) {
    return sendFailure(res, error, 'Failed to generate payouts');
  }
};

const bulkAction = async (req, res) => {
  try {
    const action = String(req.params.action || '');
    if (action === 'generate') return generate(req, res);
    if (!['approve', 'hold'].includes(action)) return res.status(400).json({ success: false, code: 'INVALID_BULK_ACTION', message: 'Bulk action must be approve, hold, or generate' });
    const ids = [...new Set((Array.isArray(req.body?.payoutIds) ? req.body.payoutIds : []).filter((id) => mongoose.isValidObjectId(id)))].slice(0, 100);
    if (!ids.length) return res.status(422).json({ success: false, code: 'PAYOUT_IDS_REQUIRED', message: 'At least one valid payout ID is required' });
    const results = [];
    for (const id of ids) {
      try {
        const result = await transitionPayout({ payoutId: id, action, payload: { ...req.body, idempotencyKey: `${req.body?.idempotencyKey || `bulk-${Date.now()}`}:${id}` }, req });
        results.push({ payoutId: id, success: true, status: result.payout.status });
      } catch (error) {
        results.push({ payoutId: id, success: false, code: error.code || 'ACTION_FAILED', message: error.message });
      }
    }
    res.locals.auditAfter = { action, requested: ids.length, succeeded: results.filter((row) => row.success).length };
    return res.json({ success: true, data: { action, results } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to apply bulk payout action');
  }
};

const statement = async (req, res) => {
  try {
    const result = await generateStatement({ payoutId: req.params.id, req });
    res.locals.auditAfter = { payoutId: req.params.id, statementNumber: result.statementNumber };
    return res.json({ success: true, message: 'Payout statement generated', data: result });
  } catch (error) {
    return sendFailure(res, error, 'Failed to generate payout statement');
  }
};

const downloadStatement = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, code: 'INVALID_PAYOUT_ID', message: 'Valid payout ID is required' });
    const payout = await CreatorPayout.findById(req.params.id)
      .populate('user', 'username email profile.displayName')
      .populate('payoutCycle', 'cycleLabel startDate endDate')
      .lean();
    if (!payout) return res.status(404).json({ success: false, code: 'PAYOUT_NOT_FOUND', message: 'Creator payout not found' });
    if (!payout.statementNumber) return res.status(409).json({ success: false, code: 'STATEMENT_NOT_GENERATED', message: 'Generate this payout statement first' });
    const lines = [
      'SquadHunt Creator Payout Statement',
      `Statement: ${payout.statementNumber}`,
      `Creator: ${payout.user?.profile?.displayName || payout.user?.username || ''} (@${payout.user?.username || ''})`,
      `Email: ${payout.user?.email || ''}`,
      `Cycle: ${payout.payoutCycle?.cycleLabel || ''}`,
      `Period: ${payout.payoutCycle?.startDate ? new Date(payout.payoutCycle.startDate).toISOString().slice(0, 10) : ''} to ${payout.payoutCycle?.endDate ? new Date(payout.payoutCycle.endDate).toISOString().slice(0, 10) : ''}`,
      `Amount: ${payout.currency || 'INR'} ${Number(payout.amount || 0).toFixed(2)}`,
      `Status: ${payout.status}`,
      `Payment method: ${payout.paymentMethod || ''}`,
      `Reference: ${payout.bankReference || ''}`,
      `Transaction ID: ${payout.transactionId || ''}`,
      `Payment date: ${payout.paymentDate || payout.paidAt ? new Date(payout.paymentDate || payout.paidAt).toISOString() : ''}`,
      `Generated: ${payout.statementGeneratedAt ? new Date(payout.statementGeneratedAt).toISOString() : ''}`
    ];
    await recordFinancialAccess(req, {
      action: 'DOWNLOAD_CREATOR_PAYOUT_STATEMENT_SECURE',
      resourceType: 'creator-payout-statement',
      resourceId: payout._id,
      metadata: { statementNumber: payout.statementNumber }
    });
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (String(req.query.format || 'pdf').toLowerCase() === 'csv') {
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${payout.statementNumber}.csv"`);
      return res.send(lines.map((line) => csvCell(line)).join('\n'));
    }
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payout.statementNumber}.pdf"`);
    return res.send(makePdf(lines));
  } catch (error) {
    return sendFailure(res, error, 'Failed to download payout statement');
  }
};

const spreadsheetSafe = (value) => {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
const csvCell = (value) => `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;

const reportRows = async (query = {}) => {
  const reportType = String(query.reportType || '').toLowerCase();
  const periodByReport = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' };
  const effectiveRange = parseRange({
    ...query,
    ...(!query.from && !query.to && periodByReport[reportType] ? { period: periodByReport[reportType] } : {})
  });
  if (reportType === 'creator_revenue') {
    const count = await EarningsSnapshot.countDocuments({ calculatedAt: { $gte: effectiveRange.start, $lte: effectiveRange.end } });
    if (count > MAX_EXPORT_ROWS) throw Object.assign(new Error('Narrow the report range to 10,000 records or fewer.'), { statusCode: 413, code: 'REPORT_TOO_LARGE' });
    const snapshots = await EarningsSnapshot.find({ calculatedAt: { $gte: effectiveRange.start, $lte: effectiveRange.end } })
      .populate('user', 'username email profile.displayName')
      .populate('payoutCycle', 'cycleLabel startDate endDate')
      .sort({ calculatedAt: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();
    return snapshots.map((snapshot) => ({
      source: 'creator_revenue',
      statement: '',
      creator: snapshot.user?.profile?.displayName || snapshot.user?.username || '',
      username: snapshot.user?.username || '',
      email: snapshot.user?.email || '',
      cycle: snapshot.payoutCycle?.cycleLabel || '',
      amount: roundMoney(snapshot.amount),
      currency: snapshot.currency || 'INR',
      status: snapshot.disbursementId ? 'reserved' : snapshot.held ? 'held' : 'estimated',
      method: 'eligible_organic_views_cpm',
      transactionId: '',
      referenceNumber: '',
      createdAt: snapshot.calculatedAt ? new Date(snapshot.calculatedAt).toISOString() : '',
      paymentDate: ''
    }));
  }
  if (reportType === 'platform_revenue') {
    const platformMatch = {
      status: 'completed',
      type: { $in: ['boost', 'subscription'] },
      createdAt: { $gte: effectiveRange.start, $lte: effectiveRange.end }
    };
    const count = await PaymentTransaction.countDocuments(platformMatch);
    if (count > MAX_EXPORT_ROWS) throw Object.assign(new Error('Narrow the report range to 10,000 records or fewer.'), { statusCode: 413, code: 'REPORT_TOO_LARGE' });
    const payments = await PaymentTransaction.find({
      ...platformMatch
    }).populate('user', 'username email profile.displayName').sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean();
    return payments.map((payment) => ({
      source: 'platform_revenue',
      statement: '',
      creator: payment.user?.profile?.displayName || payment.user?.username || '',
      username: payment.user?.username || '',
      email: payment.user?.email || '',
      cycle: payment.type || '',
      amount: roundMoney(payment.amount),
      currency: payment.currency || 'INR',
      status: payment.status,
      method: payment.paymentMethod || payment.provider || '',
      transactionId: payment.providerPaymentId || payment.paymentId || '',
      referenceNumber: payment.providerOrderId || payment.orderId || '',
      createdAt: payment.createdAt ? new Date(payment.createdAt).toISOString() : '',
      paymentDate: payment.paidAt ? new Date(payment.paidAt).toISOString() : ''
    }));
  }
  if (!query.from && !query.to && periodByReport[reportType]) {
    query = { ...query, from: effectiveRange.start.toISOString(), to: effectiveRange.end.toISOString() };
  }
  const payoutQuery = await buildPayoutQuery(query);
  const withdrawalQuery = {
    ...(payoutQuery.status ? { status: payoutQuery.status } : {}),
    ...(payoutQuery.createdAt ? { createdAt: payoutQuery.createdAt } : {}),
    ...(payoutQuery.amount ? { amount: payoutQuery.amount } : {})
  };
  if (String(query.ids || '').trim()) withdrawalQuery._id = { $in: [] };
  if (query.bankStatus && query.bankStatus !== 'all') {
    const bankUsers = query.bankStatus === 'missing'
      ? await CreatorBankDetails.distinct('user', {})
      : await CreatorBankDetails.distinct('user', { verificationStatus: String(query.bankStatus) });
    withdrawalQuery.user = query.bankStatus === 'missing' ? { $nin: bankUsers } : { $in: bankUsers };
  }
  const search = String(query.q || '').trim().slice(0, 120);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const [users, banks] = await Promise.all([
      User.distinct('_id', { $or: [{ username: regex }, { email: regex }, { phone: regex }, { 'profile.displayName': regex }, ...(mongoose.isValidObjectId(search) ? [{ _id: search }] : [])] }),
      CreatorBankDetails.find({ $or: [{ accountHolderName: regex }, { bankName: regex }] }).select('_id user').lean()
    ]);
    withdrawalQuery.$or = [
      { user: { $in: [...users, ...banks.map((bank) => bank.user)] } },
      { bankReference: regex },
      { bankDetails: { $in: banks.map((bank) => bank._id) } }
    ];
  }
  const [payoutCount, withdrawalCount] = await Promise.all([
    CreatorPayout.countDocuments(payoutQuery),
    WithdrawalRequest.countDocuments(withdrawalQuery)
  ]);
  if (payoutCount + withdrawalCount > MAX_EXPORT_ROWS) {
    throw Object.assign(new Error('Narrow the report filters to 10,000 records or fewer.'), { statusCode: 413, code: 'REPORT_TOO_LARGE' });
  }
  const [payouts, withdrawals] = await Promise.all([
    CreatorPayout.find(payoutQuery).populate('user', 'username email profile.displayName').populate('payoutCycle', 'cycleLabel startDate endDate').sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean(),
    WithdrawalRequest.find(withdrawalQuery).populate('user', 'username email profile.displayName').populate('payoutCycle', 'cycleLabel startDate endDate').sort({ createdAt: -1 }).limit(MAX_EXPORT_ROWS).lean()
  ]);
  const payoutRows = payouts.map((payout) => ({
    source: 'creator_payout',
    statement: payout.statementNumber || '',
    creator: payout.user?.profile?.displayName || payout.user?.username || '',
    username: payout.user?.username || '',
    email: payout.user?.email || '',
    cycle: payout.payoutCycle?.cycleLabel || '',
    amount: roundMoney(payout.amount),
    currency: payout.currency || 'INR',
    status: payout.status,
    method: payout.paymentMethod || '',
    transactionId: payout.transactionId || '',
    referenceNumber: payout.bankReference || '',
    createdAt: payout.createdAt ? new Date(payout.createdAt).toISOString() : '',
    paymentDate: payout.paymentDate || payout.paidAt ? new Date(payout.paymentDate || payout.paidAt).toISOString() : ''
  }));
  const withdrawalRows = withdrawals.map((withdrawal) => ({
    source: 'withdrawal',
    statement: '',
    creator: withdrawal.user?.profile?.displayName || withdrawal.user?.username || '',
    username: withdrawal.user?.username || '',
    email: withdrawal.user?.email || '',
    cycle: withdrawal.payoutCycle?.cycleLabel || '',
    amount: roundMoney(withdrawal.amount),
    currency: 'INR',
    status: withdrawal.status,
    method: 'bank_transfer',
    transactionId: '',
    referenceNumber: withdrawal.bankReference || '',
    createdAt: withdrawal.createdAt ? new Date(withdrawal.createdAt).toISOString() : '',
    paymentDate: withdrawal.paidAt ? new Date(withdrawal.paidAt).toISOString() : ''
  }));
  return [...payoutRows, ...withdrawalRows]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_EXPORT_ROWS);
};

const getReports = async (req, res) => {
  try {
    const { start, end, range } = parseRange(req.query);
    const [revenue, earnings, paid, paidWithdrawals, pending, pendingWithdrawals, held, failed, failedWithdrawals] = await Promise.all([
      sumAggregate(PaymentTransaction, { status: 'completed', type: { $in: ['boost', 'subscription'] }, createdAt: { $gte: start, $lte: end } }),
      sumAggregate(EarningsSnapshot, { calculatedAt: { $gte: start, $lte: end } }),
      sumAggregate(CreatorPayout, { status: { $in: ['paid', 'completed'] }, paidAt: { $gte: start, $lte: end } }),
      sumAggregate(WithdrawalRequest, { status: { $in: ['paid', 'completed'] }, paidAt: { $gte: start, $lte: end } }),
      sumAggregate(CreatorPayout, { status: { $in: ['pending', 'approved', 'processing'] }, createdAt: { $lte: end } }),
      sumAggregate(WithdrawalRequest, { status: { $in: ['pending', 'approved', 'processing'] }, createdAt: { $lte: end } }),
      sumAggregate(CreatorPayout, { status: 'held', createdAt: { $lte: end } }),
      sumAggregate(CreatorPayout, { status: 'failed', updatedAt: { $gte: start, $lte: end } }),
      sumAggregate(WithdrawalRequest, { status: 'failed', updatedAt: { $gte: start, $lte: end } })
    ]);
    const combine = (left, right) => ({ amount: roundMoney(left.amount + right.amount), count: left.count + right.count });
    return res.json({ success: true, data: { range: { key: range, start, end }, creatorRevenue: earnings, platformRevenue: { amount: roundMoney(Math.max(0, revenue.amount - earnings.amount)), count: revenue.count }, grossRevenue: revenue, pendingPayouts: combine(pending, pendingWithdrawals), completedPayouts: combine(paid, paidWithdrawals), heldPayouts: held, failedPayouts: combine(failed, failedWithdrawals) } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load monetization reports');
  }
};

const makePdf = (lines) => {
  const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');
  const chunks = [];
  const safeLines = lines.length ? lines : ['No records'];
  for (let index = 0; index < safeLines.length; index += 55) chunks.push(safeLines.slice(index, index + 55));
  const fontId = 3 + (chunks.length * 2);
  const pageIds = chunks.map((_, index) => 3 + (index * 2));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${chunks.length} >>`
  ];
  chunks.forEach((chunk, pageIndex) => {
    const contentId = 4 + (pageIndex * 2);
    const text = chunk.map((line, index) => `BT /F1 9 Tf 40 ${790 - index * 13} Td (${escape(line).slice(0, 150)}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
};

const exportReports = async (req, res) => {
  try {
    const filters = { ...(req.query || {}), ...(req.body || {}) };
    const format = String(filters.format || 'csv').toLowerCase();
    if (!['csv', 'xls', 'pdf'].includes(format)) return res.status(400).json({ success: false, code: 'INVALID_EXPORT_FORMAT', message: 'Format must be csv, xls, or pdf' });
    const rows = await reportRows(filters);
    const headers = ['Source', 'Statement', 'Creator', 'Username', 'Email', 'Cycle', 'Amount', 'Currency', 'Status', 'Method', 'Transaction ID', 'Reference', 'Created At', 'Payment Date'];
    const values = rows.map((row) => [row.source, row.statement, row.creator, row.username, row.email, row.cycle, row.amount, row.currency, row.status, row.method, row.transactionId, row.referenceNumber, row.createdAt, row.paymentDate]);
    await recordFinancialAccess(req, {
      action: 'EXPORT_MONETIZATION_REPORT_SECURE',
      resourceType: 'creator-monetization-report',
      metadata: { rows: rows.length, format, reportType: String(filters.reportType || 'payouts') }
    });
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (format === 'csv') {
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="creator-payout-report.csv"');
      return res.send([headers, ...values].map((row) => row.map(csvCell).join(',')).join('\n'));
    }
    if (format === 'xls') {
      const xmlEscape = (value) => spreadsheetSafe(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const xmlRows = [headers, ...values].map((row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`).join('')}</Row>`).join('');
      res.type('application/vnd.ms-excel');
      res.setHeader('Content-Disposition', 'attachment; filename="creator-payout-report.xls"');
      return res.send(`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Payouts"><Table>${xmlRows}</Table></Worksheet></Workbook>`);
    }
    res.type('application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="creator-payout-report.pdf"');
    return res.send(makePdf(['SquadHunt Creator Payout Report', `Generated: ${new Date().toISOString()}`, '', headers.join(' | '), ...values.map((row) => row.join(' | '))]));
  } catch (error) {
    return sendFailure(res, error, 'Failed to export monetization report');
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const page = normalizePage(req.query.page);
    const limit = normalizeLimit(req.query.limit);
    const scope = [{ path: /\/monetization\// }, { resourceType: /monetization|payout|bank/i }, { action: /MONETIZATION|PAYOUT|WITHDRAWAL|BANK/i }];
    const query = { $and: [{ $or: scope }] };
    if (req.query.action) query.$and.push({ action: new RegExp(escapeRegex(String(req.query.action).slice(0, 100)), 'i') });
    if (req.query.actor) query.$and.push({ 'actor.username': new RegExp(escapeRegex(String(req.query.actor).slice(0, 100)), 'i') });
    if (req.query.statusCode && Number.isInteger(Number(req.query.statusCode))) query.$and.push({ statusCode: Number(req.query.statusCode) });
    if (req.query.q) {
      const regex = new RegExp(escapeRegex(String(req.query.q).slice(0, 120)), 'i');
      query.$and.push({ $or: [{ action: regex }, { 'actor.username': regex }, { resourceType: regex }, { resourceId: regex }, { path: regex }] });
    }
    if (req.query.payoutId) query.resourceId = String(req.query.payoutId);
    if (req.query.creatorId) query.$and.push({ $or: [{ resourceId: String(req.query.creatorId) }, { 'before.userId': String(req.query.creatorId) }, { 'after.userId': String(req.query.creatorId) }] });
    if (req.query.from || req.query.to) query.createdAt = { $gte: parseDate(req.query.from) || new Date(0), $lte: parseDate(req.query.to, true) || new Date() };
    const [logs, total] = await Promise.all([AdminAuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AdminAuditLog.countDocuments(query)]);
    return res.json({ success: true, data: { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    return sendFailure(res, error, 'Failed to load monetization audit logs');
  }
};

module.exports = {
  approvePayout: payoutAction('approve'),
  bulkAction,
  cancelPayout: payoutAction('cancel'),
  downloadStatement,
  exportReports,
  exportCreators,
  failPayout: payoutAction('failed'),
  generate,
  getAuditLogs,
  getCharts,
  getCreatorOverview,
  getDashboard,
  getLeaderboards,
  getPayoutDetail,
  getPayoutHistory,
  getReports,
  holdPayout: payoutAction('hold'),
  listCreators,
  listPayouts,
  markPayoutPaid: payoutAction('paid'),
  processPayout: payoutAction('processing'),
  rejectPayout: payoutAction('reject'),
  resumePayout: payoutAction('resume'),
  statement,
  __testables: {
    appendCreatorSearch,
    buildCreatorBaseQuery,
    parseRange,
    spreadsheetSafe,
    makePdf
  }
};
