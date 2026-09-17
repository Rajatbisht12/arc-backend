const User = require('../models/User');
const appleIapService = require('../services/appleIapService');
const appleIapCatalog = require('../services/appleIapCatalog');
const premiumService = require('../services/premiumMembershipService');

const sendError = (res, error, fallbackCode, fallbackMessage) => {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    code: error?.code || fallbackCode,
    message: status < 500 ? error.message : fallbackMessage
  });
};

async function getCatalog(req, res) {
  try {
    const user = await User.findById(req.user._id).select('userType').lean();
    if (!user) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: 'User not found' });
    return res.status(200).json({ success: true, data: appleIapCatalog.publicCatalogFor(user.userType) });
  } catch (error) {
    return sendError(res, error, 'APPLE_CATALOG_FAILED', 'Apple purchases are temporarily unavailable');
  }
}

async function createSubscriptionIntent(req, res) {
  try {
    const data = await appleIapService.createSubscriptionIntent({
      userId: req.user._id,
      planKey: req.body.planKey,
      billingPeriod: req.body.billingPeriod
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'APPLE_INTENT_CREATE_FAILED', 'Could not prepare the App Store purchase');
  }
}

async function createBoostIntent(req, res) {
  try {
    const data = await appleIapService.createBoostIntent({
      userId: req.user._id,
      postId: req.body.postId,
      frequency: req.body.frequency,
      targetReach: req.body.targetReach,
      targetPlayers: req.body.targetPlayers,
      targetTeams: req.body.targetTeams
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'APPLE_INTENT_CREATE_FAILED', 'Could not prepare the App Store purchase');
  }
}

async function verifyTransaction(req, res) {
  try {
    const result = await appleIapService.verifyAndFulfill({
      signedTransaction: req.body.signedTransaction,
      environmentHint: req.body.environment,
      userId: req.user._id
    });
    return res.status(200).json({
      success: true,
      idempotentReplay: result.idempotent === true,
      data: {
        kind: result.kind,
        transactionId: result.transactionId,
        finishTransaction: result.finishTransaction === true,
        membership: result.membership ? premiumService.serializeMembership(result.membership) : null,
        campaign: result.campaign ? {
          campaignId: result.campaign._id,
          postId: result.campaign.post,
          status: result.campaign.status,
          boostExpiresAt: result.campaign.endTime,
          purchasedReach: result.campaign.purchasedReach,
          remainingReach: result.campaign.remainingReach
        } : null
      }
    });
  } catch (error) {
    return sendError(res, error, 'APPLE_TRANSACTION_VERIFICATION_FAILED', 'Purchase verification is pending. It will be retried automatically.');
  }
}

async function restoreSubscriptions(req, res) {
  try {
    const result = await appleIapService.restoreSubscriptions({
      signedTransactions: req.body.signedTransactions,
      userId: req.user._id
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error, 'APPLE_RESTORE_FAILED', 'Could not restore App Store purchases');
  }
}

async function handleNotification(req, res) {
  try {
    const result = await appleIapService.handleNotification(req.body?.signedPayload);
    return res.status(200).json({ success: true, data: result });
  } catch (_error) {
    // Apple retries non-2xx responses. Never expose verifier/storage details.
    return res.status(500).json({ success: false, code: 'APPLE_NOTIFICATION_PROCESSING_FAILED' });
  }
}

module.exports = {
  getCatalog,
  createSubscriptionIntent,
  createBoostIntent,
  verifyTransaction,
  restoreSubscriptions,
  handleNotification
};
