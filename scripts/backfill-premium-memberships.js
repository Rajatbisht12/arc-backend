#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');

const legacyRoot = path.resolve(__dirname, '..', 'src', 'legacy-src');
const User = require(path.join(legacyRoot, 'models', 'User.js'));
const PaymentTransaction = require(path.join(legacyRoot, 'models', 'PaymentTransaction.js'));
const PremiumMembership = require(path.join(legacyRoot, 'models', 'PremiumMembership.js'));
const service = require(path.join(legacyRoot, 'services', 'premiumMembershipService.js'));

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const DAY_MS = 86_400_000;
const VALID_PLANS = new Set(['player_pro', 'player_pro_plus', 'team_pro', 'team_org']);
const VALID_PERIODS = new Set(['monthly', 'quarterly', 'yearly', 'lifetime']);
const SUCCESSFUL_PAYMENT_STATUSES = new Set(['completed', 'refunded']);
const VALID_PLATFORMS = new Set(['web', 'android', 'ios', 'admin', 'unknown']);

const asString = (value) => typeof value === 'string' ? value.trim() : '';
const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const objectIdDate = (value) => value && typeof value.getTimestamp === 'function'
  ? value.getTimestamp()
  : null;
const effectivePaymentDate = (transaction) => asDate(transaction?.paidAt)
  || asDate(transaction?.createdAt)
  || objectIdDate(transaction?._id);
const isSuccessfulPayment = (transaction) => SUCCESSFUL_PAYMENT_STATUSES.has(transaction?.status);

const parseOptions = (argv) => {
  const allowed = argv.filter((arg) => arg !== '--apply' && arg !== '--help' && !arg.startsWith('--after=') && !arg.startsWith('--limit='));
  if (allowed.length) throw new Error(`Unknown argument: ${allowed[0]}`);
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const rawLimit = limitArg ? limitArg.slice('--limit='.length) : String(DEFAULT_LIMIT);
  if (!/^\d+$/.test(rawLimit)) throw new Error('--limit must be a positive integer');
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LIMIT}`);
  }
  const afterArg = argv.find((arg) => arg.startsWith('--after='));
  const after = afterArg ? afterArg.slice('--after='.length).trim() : '';
  if (after && !/^[a-f\d]{24}$/i.test(after)) throw new Error('--after must be a 24-character MongoDB ObjectId');
  return { apply: argv.includes('--apply'), after, limit, help: argv.includes('--help') };
};

const providerId = (value, prefix) => {
  const candidate = asString(value);
  return candidate.length > prefix.length && candidate.length <= 200 && candidate.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(candidate)
    ? candidate
    : undefined;
};

const firstProviderId = (prefix, values) => {
  for (const value of values) {
    const candidate = providerId(value, prefix);
    if (candidate) return candidate;
  }
  return undefined;
};

const extractProviderIds = (transaction = {}) => {
  const metadata = transaction.metadata || {};
  const nested = metadata.razorpay || {};
  return {
    customerId: firstProviderId('cust_', [transaction.providerCustomerId, metadata.customerId, metadata.razorpayCustomerId, nested.customerId]),
    subscriptionId: firstProviderId('sub_', [transaction.providerSubscriptionId, metadata.subscriptionId, metadata.razorpaySubscriptionId, nested.subscriptionId]),
    planId: firstProviderId('plan_', [metadata.providerPlanId, metadata.razorpayPlanId, nested.planId]),
    paymentId: firstProviderId('pay_', [transaction.providerPaymentId, transaction.paymentId, metadata.paymentId, metadata.razorpayPaymentId, nested.paymentId]),
    orderId: firstProviderId('order_', [transaction.providerOrderId, transaction.orderId, metadata.orderId, metadata.razorpayOrderId, nested.orderId]),
    invoiceId: firstProviderId('inv_', [transaction.providerInvoiceId, metadata.invoiceId, metadata.razorpayInvoiceId, nested.invoiceId]),
  };
};

const selectLatestSuccessful = (transactions) => [...transactions]
  .filter(isSuccessfulPayment)
  .sort((left, right) => {
    const byDate = Number(effectivePaymentDate(right) || 0) - Number(effectivePaymentDate(left) || 0);
    if (byDate) return byDate;
    return String(right?._id || '').localeCompare(String(left?._id || ''));
  })[0] || null;

const inferFinitePeriod = (expiresAt, startedAt) => {
  if (!expiresAt || !startedAt || expiresAt <= startedAt) return 'monthly';
  const days = Math.max(1, (expiresAt.getTime() - startedAt.getTime()) / DAY_MS);
  if (days > 300) return 'yearly';
  if (days > 60) return 'quarterly';
  return 'monthly';
};

const inferPlan = (user, transaction, existing) => {
  const accountPlans = user?.userType === 'team'
    ? new Set(['team_pro', 'team_org'])
    : new Set(['player_pro', 'player_pro_plus']);
  const metadata = transaction?.metadata || {};
  const transactionCandidates = [metadata.planKey, metadata.tier, metadata.planId, metadata.plan];
  const transactionPlan = transactionCandidates.map((value) => asString(value).toLowerCase()).find((value) => accountPlans.has(value));
  if (transactionPlan) return { planKey: transactionPlan, fromTransaction: true };
  const fallback = [existing?.planKey, user?.membership?.tier].map((value) => asString(value).toLowerCase()).find((value) => accountPlans.has(value));
  return { planKey: fallback || null, fromTransaction: false };
};

const buildMembershipValues = ({ user, existing, latestSuccessful, now = new Date() }) => {
  const { planKey, fromTransaction } = inferPlan(user, latestSuccessful, existing);
  if (!planKey) return null;
  const paymentAt = effectivePaymentDate(latestSuccessful);
  const startedAt = paymentAt
    || asDate(existing?.startedAt)
    || asDate(user?.createdAt)
    || objectIdDate(user?._id);
  if (!startedAt) return null;

  const metadata = latestSuccessful?.metadata || {};
  const explicitPeriod = [metadata.billingPeriod, metadata.term, metadata.period]
    .map((value) => asString(value).toLowerCase())
    .find((value) => VALID_PERIODS.has(value));
  const candidateExpiry = asDate(user?.membership?.validUntil) || asDate(existing?.expiresAt);
  const strongLifetimeEvidence = Boolean(
    latestSuccessful?.status === 'completed'
    && explicitPeriod === 'lifetime'
    && fromTransaction
    && Number(latestSuccessful?.amount || 0) > 0
    && user?.isPremium === true
  );
  const billingPeriod = strongLifetimeEvidence
    ? 'lifetime'
    : explicitPeriod && explicitPeriod !== 'lifetime'
      ? explicitPeriod
      : inferFinitePeriod(candidateExpiry, startedAt);
  const expiresAt = strongLifetimeEvidence ? null : service.deriveExpiry(startedAt, billingPeriod);

  let membershipStatus;
  if (latestSuccessful?.status === 'refunded') membershipStatus = 'refunded';
  else if (!latestSuccessful) membershipStatus = expiresAt && expiresAt <= now ? 'expired' : 'cancelled';
  else if (user?.isPremium !== true) membershipStatus = expiresAt && expiresAt <= now ? 'expired' : 'cancelled';
  else membershipStatus = expiresAt && expiresAt <= now ? 'expired' : 'active';

  const ids = extractProviderIds(latestSuccessful || {});
  const terminal = ['expired', 'cancelled', 'refunded'].includes(membershipStatus);
  const endedAt = membershipStatus === 'expired'
    ? expiresAt
    : terminal
      ? paymentAt || startedAt
      : null;
  const platform = VALID_PLATFORMS.has(latestSuccessful?.platform) ? latestSuccessful.platform : 'unknown';
  const source = ids.subscriptionId
    ? 'razorpay_subscription'
    : ids.paymentId || ids.orderId
      ? 'razorpay_order'
      : 'migration';
  const rawAmount = Number(latestSuccessful?.amount || 0);
  const amount = Number.isFinite(rawAmount) && rawAmount >= 0 ? rawAmount : 0;
  const rawCurrency = asString(latestSuccessful?.currency).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'INR';

  return {
    user: user._id,
    isCurrent: true,
    accountType: user.userType === 'team' ? 'team' : user.userType === 'creator' ? 'creator' : 'player',
    planKey,
    planTier: planKey,
    billingPeriod,
    source,
    platform,
    membershipStatus,
    subscriptionStatus: ids.subscriptionId ? 'unknown' : 'not_applicable',
    autoRenew: false,
    cancelAtCycleEnd: false,
    startedAt,
    currentPeriodStart: startedAt,
    currentPeriodEnd: expiresAt,
    expiresAt,
    cancelledAt: membershipStatus === 'cancelled' ? endedAt : null,
    endedAt,
    lastPaymentAt: paymentAt,
    amount,
    currency,
    razorpay: ids,
    metadata: {
      ...(existing?.metadata || {}),
      backfilled: true,
      backfillVersion: 2,
      entitlementEvidence: latestSuccessful ? `successful_${latestSuccessful.status}` : 'legacy_ambiguous',
      billingPeriodInferred: !explicitPeriod || (explicitPeriod === 'lifetime' && !strongLifetimeEvidence),
    },
  };
};

const transactionNormalization = (transaction, membershipId) => {
  const ids = extractProviderIds(transaction);
  const hasRazorpayProof = Object.values(ids).some(Boolean);
  const existingProvider = ['manual', 'migration'].includes(transaction.provider) ? transaction.provider : 'unknown';
  const currentCaptured = Number(transaction.capturedAmount);
  const rawAmount = Number(transaction.amount || 0);
  const captured = Number.isFinite(currentCaptured) && currentCaptured > 0
    ? currentCaptured
    : Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  const paidAt = effectivePaymentDate(transaction);
  const set = {
    provider: hasRazorpayProof ? 'razorpay' : existingProvider,
    capturedAmount: captured,
    ...(paidAt ? { paidAt } : {}),
    ...(membershipId ? { membership: membershipId, referenceId: membershipId, referenceType: 'membership' } : {}),
  };
  const fieldMap = {
    customerId: 'providerCustomerId',
    subscriptionId: 'providerSubscriptionId',
    paymentId: 'providerPaymentId',
    orderId: 'providerOrderId',
    invoiceId: 'providerInvoiceId',
  };
  Object.entries(fieldMap).forEach(([key, field]) => {
    if (ids[key]) set[field] = ids[key];
  });
  return { $set: set };
};

const hasLegacyMembershipSignal = (user) => Boolean(
  user?.isPremium === true
  || VALID_PLANS.has(user?.membership?.tier)
  || asDate(user?.membership?.validUntil)
);

async function normalizeSuccessfulTransactions(transactions, membershipId, options, stats) {
  for (const transaction of transactions) {
    stats.wouldNormalizeTransactions += 1;
    if (membershipId) stats.wouldLinkTransactions += 1;
    if (!options.apply) continue;
    await PaymentTransaction.updateOne(
      { _id: transaction._id, status: { $in: Array.from(SUCCESSFUL_PAYMENT_STATUSES) } },
      transactionNormalization(transaction, membershipId)
    );
    stats.normalizedTransactions += 1;
    if (membershipId) stats.linkedTransactions += 1;
  }
}

async function processUser(user, options, stats) {
  const [existing, successfulTransactions] = await Promise.all([
    PremiumMembership.findOne({ user: user._id, isCurrent: true }),
    PaymentTransaction.find({
      user: user._id,
      type: 'subscription',
      status: { $in: Array.from(SUCCESSFUL_PAYMENT_STATUSES) },
    }).lean(),
  ]);
  const latestSuccessful = selectLatestSuccessful(successfulTransactions);
  if (!existing && !latestSuccessful && !hasLegacyMembershipSignal(user)) {
    stats.skippedNoEvidence += 1;
    return;
  }
  stats.candidateUsers += 1;
  stats.successfulTransactions += successfulTransactions.length;

  const shouldReevaluateExisting = Boolean(existing?.metadata?.backfilled);
  const values = buildMembershipValues({ user, existing, latestSuccessful });
  if (!values && !existing) {
    await normalizeSuccessfulTransactions(successfulTransactions, null, options, stats);
    stats.skippedInvalidPlan += 1;
    return;
  }

  let membership = existing;
  if (!membership) {
    stats.wouldCreate += 1;
    if (options.apply) {
      try {
        membership = await PremiumMembership.create(values);
        stats.created += 1;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        membership = await PremiumMembership.findOne({ user: user._id, isCurrent: true });
        if (!membership) throw error;
      }
    }
  } else {
    stats.wouldRepair += 1;
    if (options.apply && shouldReevaluateExisting && values) {
      membership.set(values);
      await membership.save();
      stats.reevaluatedBackfills += 1;
    }
  }

  await normalizeSuccessfulTransactions(successfulTransactions, membership?._id, options, stats);
  if (!options.apply || !membership) return;
  await service.projectEntitlement(membership);
  await service.appendEvent({
    membership,
    action: 'synchronization',
    source: 'migration',
    actor: service.systemActor('migration:premium-backfill-v2'),
    dedupeKey: `migration:premium-backfill:v2:${membership._id}`,
    metadata: {
      backfilled: true,
      backfillVersion: 2,
      successfulTransactions: successfulTransactions.length,
    },
  });
  stats.repaired += 1;
}

const connectionOptions = () => ({
  autoIndex: false,
  autoCreate: false,
  retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
  serverSelectionTimeoutMS: 15_000,
  ...(process.env.MONGODB_TLS === 'true' ? {
    tls: true,
    ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
      ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
      : {}),
  } : {}),
});

async function run(options = parseOptions(process.argv.slice(2))) {
  if (options.help) {
    console.log('Usage: node scripts/backfill-premium-memberships.js [--apply] [--after=<ObjectId>] [--limit=1..5000]');
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, connectionOptions());
  const stats = {
    mode: options.apply ? 'apply' : 'dry-run',
    requestedAfter: options.after || null,
    limit: options.limit,
    scannedUsers: 0,
    candidateUsers: 0,
    successfulTransactions: 0,
    wouldCreate: 0,
    created: 0,
    wouldRepair: 0,
    repaired: 0,
    reevaluatedBackfills: 0,
    wouldNormalizeTransactions: 0,
    normalizedTransactions: 0,
    wouldLinkTransactions: 0,
    linkedTransactions: 0,
    skippedNoEvidence: 0,
    skippedInvalidPlan: 0,
    errors: 0,
    failedUserId: null,
    nextCursor: options.after || null,
    hasMore: false,
  };
  try {
    const query = options.after ? { _id: { $gt: new mongoose.Types.ObjectId(options.after) } } : {};
    const cursor = User.find(query)
      .select('_id userType isPremium membership createdAt')
      .sort({ _id: 1 })
      .limit(options.limit)
      .lean()
      .cursor();
    for await (const user of cursor) {
      stats.scannedUsers += 1;
      try {
        await processUser(user, options, stats);
        stats.nextCursor = String(user._id);
      } catch (error) {
        stats.errors += 1;
        stats.failedUserId = String(user._id);
        console.error('[Premium Backfill] stopped at user', {
          userId: stats.failedUserId,
          code: error?.code || 'UNKNOWN',
          message: error?.message || String(error),
        });
        break;
      }
    }
    if (stats.errors) {
      stats.hasMore = true;
    } else if (stats.nextCursor) {
      stats.hasMore = Boolean(await User.exists({ _id: { $gt: new mongoose.Types.ObjectId(stats.nextCursor) } }));
    }
    console.log(JSON.stringify(stats, null, 2));
    if (stats.errors) process.exitCode = 1;
    return stats;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error('[Premium Backfill] fatal', error?.message || String(error));
    await mongoose.disconnect().catch(() => null);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_LIMIT,
  SUCCESSFUL_PAYMENT_STATUSES,
  buildMembershipValues,
  extractProviderIds,
  hasLegacyMembershipSignal,
  isSuccessfulPayment,
  parseOptions,
  selectLatestSuccessful,
  transactionNormalization,
};
