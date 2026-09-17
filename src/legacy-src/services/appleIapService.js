const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Post = require('../models/Post');
const PremiumMembership = require('../models/PremiumMembership');
const PaymentTransaction = require('../models/PaymentTransaction');
const BoostCampaign = require('../models/BoostCampaign');
const ApplePurchaseIntent = require('../models/ApplePurchaseIntent');
const AppleNotificationReceipt = require('../models/AppleNotificationReceipt');
const premiumService = require('./premiumMembershipService');
const {
  calculateBoostPrice,
  createPendingBoostCampaign,
  activateBoostCampaign,
  revokeBoostCampaign
} = require('./boostService');
const catalog = require('./appleIapCatalog');
const verifier = require('./appleSignedDataVerifier');
const appStoreClient = require('./appleAppStoreClient');
const log = require('../utils/logger');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

const fail = (message, statusCode = 400, code = 'APPLE_IAP_ERROR') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const safeId = (value) => typeof value === 'string' ? value.trim().slice(0, 255) : '';
const dateFromMs = (value) => Number.isFinite(Number(value)) && Number(value) > 0
  ? new Date(Number(value))
  : null;
const amountFromMilliunits = (value) => Number.isFinite(Number(value))
  ? Math.max(0, Number(value) / 1000)
  : 0;
const transactionEnvironment = (transaction) => {
  const value = safeId(transaction?.environment);
  return ['Sandbox', 'Production', 'Xcode'].includes(value) ? value : undefined;
};

const latestDate = (...values) => values
  .map(dateFromMs)
  .filter(Boolean)
  .sort((left, right) => right.getTime() - left.getTime())[0] || null;

const shouldIgnoreStaleSubscriptionEvent = ({
  membership,
  originalTransactionId,
  transactionId,
  expiresAt,
  eventAt
}) => {
  if (!membership || String(membership.apple?.originalTransactionId || '') !== String(originalTransactionId || '')) {
    return false;
  }
  const previousEventAt = membership.providerLastEventAt ? new Date(membership.providerLastEventAt) : null;
  if (previousEventAt && eventAt && previousEventAt.getTime() > eventAt.getTime()) return true;

  const previousPeriodEnd = membership.currentPeriodEnd ? new Date(membership.currentPeriodEnd) : null;
  const isDifferentTransaction = String(membership.apple?.latestTransactionId || '') !== String(transactionId || '');
  return Boolean(
    isDifferentTransaction
    && previousPeriodEnd
    && expiresAt
    && previousPeriodEnd.getTime() > expiresAt.getTime()
  );
};

const resolveOwner = async (transaction) => {
  const transactionId = safeId(transaction?.transactionId);
  const originalTransactionId = safeId(transaction?.originalTransactionId);
  const appAccountToken = safeId(transaction?.appAccountToken).toLowerCase();

  const existingPayment = transactionId
    ? await PaymentTransaction.findOne({ provider: 'apple', providerPaymentId: transactionId }).select('user').lean()
    : null;
  if (existingPayment?.user) return String(existingPayment.user);

  const membership = originalTransactionId
    ? await PremiumMembership.findOne({ 'apple.originalTransactionId': originalTransactionId }).select('user').lean()
    : null;
  if (membership?.user) return String(membership.user);

  const intent = appAccountToken && UUID_PATTERN.test(appAccountToken)
    ? await ApplePurchaseIntent.findOne({ appAccountToken }).select('user').lean()
    : null;
  return intent?.user ? String(intent.user) : null;
};

const assertTransactionShape = (transaction, expectedProduct) => {
  const transactionId = safeId(transaction?.transactionId);
  const productId = safeId(transaction?.productId);
  const bundleId = safeId(transaction?.bundleId);
  if (!transactionId || !productId) throw fail('Apple transaction data is incomplete', 400, 'INVALID_APPLE_TRANSACTION');
  if (expectedProduct && productId !== expectedProduct) {
    throw fail('Apple transaction product does not match the purchase intent', 409, 'APPLE_PRODUCT_MISMATCH');
  }
  if (bundleId !== String(process.env.APPLE_IAP_BUNDLE_ID || '').trim()) {
    throw fail('Apple transaction belongs to a different app', 400, 'APPLE_BUNDLE_MISMATCH');
  }
  return { transactionId, productId };
};

const assertProductKind = (transaction, kind) => {
  const expectedType = kind === 'subscription' ? 'Auto-Renewable Subscription' : 'Consumable';
  if (safeId(transaction?.type) !== expectedType) {
    throw fail(
      `Apple transaction is not a valid ${kind === 'subscription' ? 'subscription' : 'consumable'} purchase`,
      409,
      'APPLE_PRODUCT_TYPE_MISMATCH'
    );
  }
};

const createSubscriptionIntent = async ({ userId, planKey, billingPeriod }) => {
  const user = await User.findById(userId).select('userType').lean();
  if (!user) throw fail('User not found', 404, 'USER_NOT_FOUND');
  const plan = premiumService.findPlan(planKey, user.userType);
  const normalizedPeriod = premiumService.normalizeBillingPeriod(billingPeriod, { recurring: true });
  const product = catalog.getSubscription(plan.id, normalizedPeriod);
  if (!product) throw fail('This subscription is not configured in the App Store', 503, 'APPLE_PRODUCT_NOT_CONFIGURED');

  const appAccountToken = uuidv4();
  const intent = await ApplePurchaseIntent.create({
    user: userId,
    appAccountToken,
    kind: 'subscription',
    productId: product.productId,
    planKey: product.planKey,
    billingPeriod: product.billingPeriod,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS)
  });
  return { intentId: String(intent._id), appAccountToken, productId: product.productId };
};

const createBoostIntent = async ({ userId, postId, frequency, targetReach, targetPlayers, targetTeams }) => {
  const product = catalog.getBoost({ frequency, targetReach, targetPlayers, targetTeams });
  if (!product) throw fail('This Boost package is not configured in the App Store', 503, 'APPLE_PRODUCT_NOT_CONFIGURED');
  const post = await Post.findById(postId).select('author isActive hiddenByAdmin').lean();
  if (!post || post.isActive === false || post.hiddenByAdmin === true) throw fail('Post not found', 404, 'POST_NOT_FOUND');
  if (String(post.author) !== String(userId)) throw fail('You can only boost your own posts', 403, 'BOOST_FORBIDDEN');

  const appAccountToken = uuidv4();
  const intent = await ApplePurchaseIntent.create({
    user: userId,
    appAccountToken,
    kind: 'boost',
    productId: product.productId,
    boost: {
      post: postId,
      frequency: product.frequency,
      targetReach: product.targetReach,
      targetPlayers: product.targetPlayers,
      targetTeams: product.targetTeams
    },
    expiresAt: new Date(Date.now() + INTENT_TTL_MS)
  });

  try {
    const accountingBudget = calculateBoostPrice(product);
    const campaign = await createPendingBoostCampaign({
      userId,
      postId,
      amount: accountingBudget,
      frequency: product.frequency,
      targetReach: product.targetReach,
      targetPlayers: product.targetPlayers,
      targetTeams: product.targetTeams,
      paymentProvider: 'apple',
      providerOrderId: appAccountToken,
      apple: { productId: product.productId, appAccountToken },
      currency: 'INR'
    });
    intent.boost.campaign = campaign._id;
    await intent.save();
  } catch (error) {
    intent.status = 'failed';
    intent.failureCode = 'BOOST_CAMPAIGN_CREATE_FAILED';
    await intent.save().catch(() => {});
    throw error;
  }

  return { intentId: String(intent._id), appAccountToken, productId: product.productId };
};

const claimIntent = async (transaction, expectedKind, requestedUserId) => {
  const appAccountToken = safeId(transaction?.appAccountToken).toLowerCase();
  if (!UUID_PATTERN.test(appAccountToken)) {
    throw fail('Apple transaction is not linked to a SquadHunt purchase intent', 409, 'APPLE_ACCOUNT_TOKEN_MISSING');
  }
  const intent = await ApplePurchaseIntent.findOne({ appAccountToken });
  if (!intent) throw fail('Apple purchase intent was not found', 409, 'APPLE_PURCHASE_INTENT_NOT_FOUND');
  if (intent.kind !== expectedKind) throw fail('Apple product type does not match the purchase intent', 409, 'APPLE_PURCHASE_KIND_MISMATCH');
  if (requestedUserId && String(intent.user) !== String(requestedUserId)) {
    throw fail('This Apple purchase belongs to another SquadHunt account', 403, 'APPLE_PURCHASE_ACCOUNT_MISMATCH');
  }
  assertTransactionShape(transaction, intent.productId);
  return intent;
};

const recordApplePayment = async ({ transaction, userId, type, referenceId, referenceType, membership, description, metadata }) => {
  const transactionId = safeId(transaction.transactionId);
  const originalTransactionId = safeId(transaction.originalTransactionId || transaction.transactionId);
  const amount = amountFromMilliunits(transaction.price);
  const currency = safeId(transaction.currency || 'USD').toUpperCase().slice(0, 3);
  const revoked = Boolean(transaction.revocationDate);
  try {
    return await PaymentTransaction.findOneAndUpdate(
      { provider: 'apple', providerPaymentId: transactionId },
      {
        $setOnInsert: {
          user: userId,
          type,
          amount,
          currency,
          description,
          referenceId,
          referenceType,
          provider: 'apple',
          providerPaymentId: transactionId,
          providerSubscriptionId: type === 'subscription' ? originalTransactionId : undefined,
          platform: 'ios',
          membership: membership?._id || null,
          capturedAmount: amount,
          paidAt: dateFromMs(transaction.purchaseDate) || new Date(),
          metadata: {
            ...metadata,
            appleProductId: transaction.productId,
            appleOriginalTransactionId: originalTransactionId,
            appleEnvironment: transactionEnvironment(transaction)
          }
        },
        $set: {
          status: revoked ? 'refunded' : 'completed',
          ...(revoked ? { refundStatus: 'full', refundedAmount: amount } : {})
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code === 11000) {
      return PaymentTransaction.findOne({ provider: 'apple', providerPaymentId: transactionId });
    }
    throw error;
  }
};

const assertOwner = async (transaction, userId) => {
  const existingOwner = await resolveOwner(transaction);
  if (existingOwner && String(existingOwner) !== String(userId)) {
    throw fail('This Apple purchase belongs to another SquadHunt account', 403, 'APPLE_PURCHASE_ACCOUNT_MISMATCH');
  }
};

const fulfillSubscription = async ({ transaction, renewalInfo = null, requestedUserId = null, source = 'apple_transaction', notificationUUID = '' }) => {
  const { transactionId, productId } = assertTransactionShape(transaction);
  const product = catalog.getProduct(productId);
  if (!product || product.kind !== 'subscription') throw fail('Apple subscription product is not recognized', 400, 'UNKNOWN_APPLE_PRODUCT');
  assertProductKind(transaction, 'subscription');

  let intent = null;
  if (transaction.appAccountToken) {
    intent = await claimIntent(transaction, 'subscription', requestedUserId);
  }
  const ownerId = requestedUserId || (intent ? String(intent.user) : await resolveOwner(transaction));
  if (!ownerId) throw fail('Apple subscription cannot be matched to a SquadHunt account', 409, 'APPLE_PURCHASE_OWNER_UNKNOWN');
  await assertOwner(transaction, ownerId);

  const user = await User.findById(ownerId).select('userType').lean();
  if (!user) throw fail('User not found', 404, 'USER_NOT_FOUND');
  premiumService.findPlan(product.planKey, user.userType);

  const originalTransactionId = safeId(transaction.originalTransactionId || transactionId);
  const existingByOriginal = await PremiumMembership.findOne({ 'apple.originalTransactionId': originalTransactionId });
  if (existingByOriginal && String(existingByOriginal.user) !== String(ownerId)) {
    throw fail('This Apple subscription belongs to another SquadHunt account', 403, 'APPLE_PURCHASE_ACCOUNT_MISMATCH');
  }
  let membership = existingByOriginal || await PremiumMembership.findOne({ user: ownerId, isCurrent: true });
  const previousState = membership ? {
    planKey: membership.planKey,
    billingPeriod: membership.billingPeriod,
    membershipStatus: membership.membershipStatus,
    subscriptionStatus: membership.subscriptionStatus,
    autoRenew: membership.autoRenew,
    cancelAtCycleEnd: membership.cancelAtCycleEnd,
    expiresAt: membership.expiresAt
  } : {};

  const purchasedAt = dateFromMs(transaction.purchaseDate) || new Date();
  const transactionExpiry = dateFromMs(transaction.expiresDate) || premiumService.deriveExpiry(purchasedAt, product.billingPeriod);
  const graceExpiry = dateFromMs(renewalInfo?.gracePeriodExpiresDate);
  const expiresAt = graceExpiry && graceExpiry > transactionExpiry ? graceExpiry : transactionExpiry;
  const now = new Date();
  const eventAt = latestDate(transaction.signedDate, renewalInfo?.signedDate) || purchasedAt;
  if (shouldIgnoreStaleSubscriptionEvent({
    membership,
    originalTransactionId,
    transactionId,
    expiresAt,
    eventAt
  })) {
    await recordApplePayment({
      transaction,
      userId: ownerId,
      type: 'subscription',
      referenceId: membership._id,
      referenceType: 'membership',
      membership,
      description: `Apple Premium subscription (${product.billingPeriod})`,
      metadata: { planKey: product.planKey, billingPeriod: product.billingPeriod, staleNotification: true }
    });
    if (intent && intent.status !== 'completed') {
      intent.status = 'completed';
      intent.transactionId = transactionId;
      intent.originalTransactionId = originalTransactionId;
      intent.environment = transactionEnvironment(transaction);
      intent.completedAt = new Date();
      await intent.save();
    }
    return {
      kind: 'subscription',
      membership,
      active: membership.membershipStatus === 'active' && (!membership.expiresAt || new Date(membership.expiresAt) > now),
      transactionId,
      idempotent: true,
      stale: true
    };
  }
  const revoked = Boolean(transaction.revocationDate);
  const active = !revoked && expiresAt > now;
  const autoRenew = renewalInfo?.autoRenewStatus === undefined
    ? (membership?.autoRenew ?? true)
    : Number(renewalInfo.autoRenewStatus) === 1;
  const environment = transactionEnvironment(transaction);

  if (!membership) {
    membership = new PremiumMembership({ user: ownerId, isCurrent: true });
  }
  membership.set({
    accountType: user.userType || 'unknown',
    planKey: product.planKey,
    planTier: product.planKey,
    billingPeriod: product.billingPeriod,
    source: 'apple_subscription',
    platform: 'ios',
    membershipStatus: revoked ? 'refunded' : active ? 'active' : 'expired',
    subscriptionStatus: revoked ? 'cancelled' : active ? (renewalInfo?.isInBillingRetryPeriod ? 'pending' : 'active') : 'expired',
    autoRenew: active && autoRenew,
    cancelAtCycleEnd: active && !autoRenew,
    startedAt: membership.startedAt || purchasedAt,
    currentPeriodStart: purchasedAt,
    currentPeriodEnd: expiresAt,
    expiresAt,
    endedAt: active ? null : (dateFromMs(transaction.revocationDate) || expiresAt),
    cancelledAt: active && !autoRenew ? (membership.cancelledAt || now) : (revoked ? dateFromMs(transaction.revocationDate) : null),
    lastPaymentAt: purchasedAt,
    amount: amountFromMilliunits(transaction.price),
    currency: safeId(transaction.currency || membership.currency || 'USD').toUpperCase().slice(0, 3),
    razorpay: {},
    apple: {
      originalTransactionId,
      latestTransactionId: transactionId,
      productId,
      appAccountToken: safeId(transaction.appAccountToken || membership.apple?.appAccountToken).toLowerCase() || undefined,
      subscriptionGroupIdentifier: safeId(transaction.subscriptionGroupIdentifier) || undefined,
      webOrderLineItemId: safeId(transaction.webOrderLineItemId) || undefined,
      environment
    },
    providerSnapshot: {
      apple: {
        transactionReason: safeId(transaction.transactionReason),
        inAppOwnershipType: safeId(transaction.inAppOwnershipType),
        isUpgraded: Boolean(transaction.isUpgraded),
        isInBillingRetryPeriod: Boolean(renewalInfo?.isInBillingRetryPeriod),
        expirationIntent: renewalInfo?.expirationIntent ?? null
      }
    },
    providerLastEventAt: eventAt,
    providerLastEventId: notificationUUID || transactionId,
    version: Number(membership.version || 0) + 1
  });
  await membership.save();
  await premiumService.projectEntitlement(membership);
  if (active && typeof premiumService.grantPeriodCredits === 'function') {
    await premiumService.grantPeriodCredits(membership, `apple:${originalTransactionId}:${expiresAt.toISOString()}`);
  }

  const eventAction = revoked ? 'refund' : active
    ? (safeId(transaction.transactionReason).toUpperCase() === 'RENEWAL' ? 'renewal' : 'purchase')
    : 'expiration';
  await premiumService.appendEvent({
    membership,
    action: eventAction,
    source,
    actor: premiumService.systemActor(`provider:apple:${source}`),
    previousState,
    amount: amountFromMilliunits(transaction.price),
    currency: transaction.currency,
    dedupeKey: `apple:${transactionId}:${eventAction}`,
    metadata: {
      appleTransactionId: transactionId,
      appleOriginalTransactionId: originalTransactionId,
      appleProductId: productId,
      appleEnvironment: environment,
      notificationUUID
    },
    apple: {
      originalTransactionId,
      transactionId,
      productId,
      environment,
      notificationUUID
    }
  });

  await recordApplePayment({
    transaction,
    userId: ownerId,
    type: 'subscription',
    referenceId: membership._id,
    referenceType: 'membership',
    membership,
    description: `Apple Premium subscription (${product.billingPeriod})`,
    metadata: { planKey: product.planKey, billingPeriod: product.billingPeriod }
  });

  if (intent) {
    intent.status = 'completed';
    intent.transactionId = transactionId;
    intent.originalTransactionId = originalTransactionId;
    intent.environment = environment;
    intent.completedAt = new Date();
    await intent.save();
  }

  return { kind: 'subscription', membership, active, transactionId, idempotent: false };
};

const fulfillBoost = async ({ transaction, requestedUserId }) => {
  const { transactionId, productId } = assertTransactionShape(transaction);
  const product = catalog.getProduct(productId);
  if (!product || product.kind !== 'boost') throw fail('Apple Boost product is not recognized', 400, 'UNKNOWN_APPLE_PRODUCT');
  assertProductKind(transaction, 'boost');
  let intent = await claimIntent(transaction, 'boost', requestedUserId);
  const ownerId = String(intent.user);
  await assertOwner(transaction, ownerId);

  const existing = await PaymentTransaction.findOne({ provider: 'apple', providerPaymentId: transactionId });
  if (existing) {
    const campaign = await BoostCampaign.findById(intent.boost.campaign).lean();
    return { kind: 'boost', campaign, transactionId, active: campaign?.status === 'running', idempotent: true };
  }
  if (transaction.revocationDate) throw fail('This Apple Boost purchase was revoked', 409, 'APPLE_TRANSACTION_REVOKED');

  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
  const claimedIntent = await ApplePurchaseIntent.findOneAndUpdate(
    {
      _id: intent._id,
      $or: [
        { status: { $in: ['pending', 'failed'] } },
        { status: 'processing', processingAt: { $lt: staleBefore } }
      ]
    },
    {
      $set: {
        status: 'processing',
        processingAt: new Date(),
        transactionId,
        originalTransactionId: safeId(transaction.originalTransactionId || transactionId),
        environment: transactionEnvironment(transaction),
        failureCode: ''
      }
    },
    { new: true }
  );
  if (!claimedIntent) {
    const currentIntent = await ApplePurchaseIntent.findById(intent._id);
    if (currentIntent?.status === 'completed') {
      const campaign = await BoostCampaign.findById(currentIntent.boost.campaign).lean();
      return { kind: 'boost', campaign, transactionId, active: campaign?.status === 'running', idempotent: true };
    }
    throw fail('This Boost purchase is already being processed', 409, 'APPLE_TRANSACTION_PROCESSING');
  }
  intent = claimedIntent;

  try {
    const campaign = await BoostCampaign.findById(intent.boost.campaign);
    if (!campaign || String(campaign.user) !== ownerId) throw fail('Boost campaign was not found', 404, 'BOOST_CAMPAIGN_NOT_FOUND');
    const apple = {
      productId,
      transactionId,
      appAccountToken: intent.appAccountToken,
      environment: transactionEnvironment(transaction)
    };
    const activated = campaign.status === 'running' && campaign.providerPaymentId === transactionId
      ? campaign
      : await activateBoostCampaign({
          campaign,
          paymentId: transactionId,
          paymentAmount: campaign.budget,
          paymentProvider: 'apple',
          apple
        });

    await recordApplePayment({
      transaction,
      userId: ownerId,
      type: 'boost',
      referenceId: activated.post,
      referenceType: 'post',
      description: `Apple post Boost (${activated.frequency})`,
      metadata: {
        campaignId: activated._id,
        frequency: product.frequency,
        targetReach: product.targetReach,
        targetPlayers: product.targetPlayers,
        targetTeams: product.targetTeams,
        boostExpiresAt: activated.endTime,
        purchasedReach: activated.purchasedReach
      }
    });

    intent.status = 'completed';
    intent.processingAt = null;
    intent.completedAt = new Date();
    await intent.save();

    return { kind: 'boost', campaign: activated, transactionId, active: true, idempotent: false };
  } catch (error) {
    await ApplePurchaseIntent.updateOne(
      { _id: intent._id, status: 'processing', transactionId },
      { $set: { status: 'failed', processingAt: null, failureCode: safeId(error?.code || 'BOOST_FULFILLMENT_FAILED').slice(0, 120) } }
    ).catch(() => {});
    throw error;
  }
};

const verifyAndFulfill = async ({ signedTransaction, userId, environmentHint }) => {
  let transaction = await verifier.verifyTransaction(signedTransaction, environmentHint);
  transaction = await appStoreClient.getCurrentTransaction(transaction);
  const { transactionId, productId } = assertTransactionShape(transaction);
  const product = catalog.getProduct(productId);
  if (!product) throw fail('Apple product is not recognized', 400, 'UNKNOWN_APPLE_PRODUCT');

  const existing = await PaymentTransaction.findOne({ provider: 'apple', providerPaymentId: transactionId });
  if (existing) {
    if (String(existing.user) !== String(userId)) {
      throw fail('This Apple purchase belongs to another SquadHunt account', 403, 'APPLE_PURCHASE_ACCOUNT_MISMATCH');
    }
    return {
      kind: product.kind,
      transactionId,
      idempotent: true,
      finishTransaction: true,
      membership: existing.membership ? await PremiumMembership.findById(existing.membership) : null,
      campaign: product.kind === 'boost' ? await BoostCampaign.findOne({ providerPaymentId: transactionId }) : null
    };
  }

  const result = product.kind === 'subscription'
    ? await fulfillSubscription({ transaction, requestedUserId: userId })
    : await fulfillBoost({ transaction, requestedUserId: userId });
  return { ...result, finishTransaction: true };
};

const restoreSubscriptions = async ({ signedTransactions, userId }) => {
  const inputs = Array.isArray(signedTransactions) ? signedTransactions.slice(0, 100) : [];
  const restored = [];
  const rejected = [];
  for (const signedTransaction of inputs) {
    try {
      let transaction = await verifier.verifyTransaction(signedTransaction);
      transaction = await appStoreClient.getCurrentTransaction(transaction);
      const product = catalog.getProduct(transaction.productId);
      if (!product || product.kind !== 'subscription') continue;
      const result = await fulfillSubscription({ transaction, requestedUserId: userId });
      restored.push({ productId: transaction.productId, transactionId: transaction.transactionId, active: result.active });
    } catch (error) {
      rejected.push({ code: error?.code || 'RESTORE_FAILED' });
    }
  }
  return { restored, rejected, active: restored.some((entry) => entry.active) };
};

const handleNotification = async (signedPayload) => {
  const digest = crypto.createHash('sha256').update(String(signedPayload || '')).digest('hex');
  const notification = await verifier.verifyNotification(signedPayload);
  const notificationUUID = safeId(notification.notificationUUID);
  if (!notificationUUID) throw fail('Apple notification identifier is missing', 400, 'INVALID_APPLE_NOTIFICATION');

  let receipt;
  try {
    receipt = await AppleNotificationReceipt.create({
      notificationUUID,
      notificationType: safeId(notification.notificationType),
      subtype: safeId(notification.subtype),
      environment: safeId(notification.data?.environment),
      payloadDigest: digest
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const prior = await AppleNotificationReceipt.findOne({ notificationUUID });
    if (prior?.payloadDigest !== digest) throw fail('Apple notification replay payload mismatch', 409, 'APPLE_NOTIFICATION_REPLAY_MISMATCH');
    if (prior?.status === 'completed') return { duplicate: true, status: 'completed' };
    const processingIsFresh = prior?.status === 'processing'
      && prior.updatedAt
      && prior.updatedAt.getTime() > Date.now() - PROCESSING_LEASE_MS;
    if (processingIsFresh) return { duplicate: true, status: 'processing' };
    receipt = prior;
    receipt.status = 'processing';
    receipt.errorCode = '';
    receipt.processedAt = null;
    await receipt.save();
  }

  try {
    const signedTransaction = notification.data?.signedTransactionInfo;
    if (signedTransaction) {
      const transaction = await verifier.verifyTransaction(signedTransaction, notification.data?.environment);
      receipt.transactionId = safeId(transaction.transactionId);
      const product = catalog.getProduct(transaction.productId);
      if (!product) {
        throw fail('Apple notification references an unknown product', 503, 'UNKNOWN_APPLE_PRODUCT');
      }
      if (product.kind === 'subscription') {
        const renewalInfo = notification.data?.signedRenewalInfo
          ? await verifier.verifyRenewal(notification.data.signedRenewalInfo, notification.data?.environment)
          : null;
        await fulfillSubscription({ transaction, renewalInfo, source: 'apple_notification', notificationUUID });
      } else if (product.kind === 'boost' && transaction.revocationDate) {
        const payment = await PaymentTransaction.findOneAndUpdate(
          { provider: 'apple', providerPaymentId: transaction.transactionId },
          { $set: { status: 'refunded', refundStatus: 'full', refundedAmount: amountFromMilliunits(transaction.price) } },
          { new: true }
        );
        if (payment) {
          const campaign = await BoostCampaign.findOne({ providerPaymentId: transaction.transactionId }).select('_id');
          if (campaign) {
            await revokeBoostCampaign({
              campaignId: campaign._id,
              paymentStatus: 'refunded',
              reason: 'apple_transaction_revoked'
            });
          }
        }
      }
    }
    receipt.status = 'completed';
    receipt.processedAt = new Date();
    await receipt.save();
    return { duplicate: false, status: 'completed' };
  } catch (error) {
    receipt.status = 'failed';
    receipt.errorCode = safeId(error?.code || 'APPLE_NOTIFICATION_PROCESSING_FAILED').slice(0, 120);
    receipt.processedAt = new Date();
    await receipt.save().catch(() => {});
    log.error('Apple IAP notification processing failed', {
      notificationUUID,
      notificationType: safeId(notification.notificationType),
      code: error?.code || 'APPLE_NOTIFICATION_PROCESSING_FAILED'
    });
    throw error;
  }
};

module.exports = {
  createSubscriptionIntent,
  createBoostIntent,
  verifyAndFulfill,
  restoreSubscriptions,
  handleNotification,
  fulfillSubscription,
  shouldIgnoreStaleSubscriptionEvent
};
