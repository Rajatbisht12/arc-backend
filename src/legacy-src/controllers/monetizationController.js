/**
 * Creator monetization: eligibility, apply, application status, bank details, earnings dashboard.
 */

const User = require('../models/User');
const MonetizationEligibility = require('../models/MonetizationEligibility');
const MonetizationApplication = require('../models/MonetizationApplication');
const CreatorBankDetails = require('../models/CreatorBankDetails');
const CreatorPayout = require('../models/CreatorPayout');
const PayoutCycle = require('../models/PayoutCycle');
const Post = require('../models/Post');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const MonetizationApplicationTimeline = require('../models/MonetizationApplicationTimeline');
const { getOrComputeEligibility } = require('../services/MonetizationEligibilityEngine');
const { getEstimatedEarningsForCreator, getOrCreateCurrentCycle } = require('../services/CreatorEarningsCalculationService');
const log = require('../utils/logger');

function normalizeCountry(country) {
  return String(country || 'IN').trim().toUpperCase().slice(0, 2);
}

function maskBankDetails(bank) {
  if (!bank) return null;
  return {
    accountHolderName: bank.accountHolderName,
    bankName: bank.bankName,
    ifsc: bank.ifsc,
    swiftCode: bank.swiftCode,
    branch: bank.branch,
    upiId: bank.upiId,
    paypalEmail: bank.paypalEmail,
    country: bank.country || 'IN',
    gstNumber: bank.gstNumber,
    lastFourDigits: bank.lastFourDigits,
    hasTaxId: Boolean(bank.taxIdEncrypted || bank.taxIdHash),
    verificationStatus: bank.verificationStatus
  };
}

function deriveCreatorStatus({ user, eligibility, application }) {
  const explicitStatus = user?.creatorMonetizationStatus;
  if (explicitStatus === 'suspended' || explicitStatus === 'disabled') return explicitStatus;
  if (user?.isCreator) return 'approved';
  if (application?.status === 'pending') return 'pending';
  if (application?.status === 'rejected') return 'rejected';
  if (application?.status === 'withdrawn') return eligibility?.isEligible ? 'eligible' : 'withdrawn';
  if (eligibility?.isEligible) return 'eligible';
  return 'not_eligible';
}

async function recordTimeline({ application, user, action, actor = null, actorType = 'creator', reason = '', oldValue = null, newValue = null }) {
  if (!application || !user || !action) return;
  await MonetizationApplicationTimeline.create({
    application,
    user,
    action,
    actor,
    actorType,
    reason,
    oldValue,
    newValue
  });
}

// Only players can be creators
async function assertPlayer(req, res, next) {
  if (req.user?.userType !== 'player') {
    return res.status(403).json({ success: false, message: 'Only players can access creator monetization.' });
  }
  next();
}

/**
 * GET /api/monetization/eligibility
 * Returns eligibility for current user (on profile load).
 */
async function getEligibility(req, res) {
  try {
    const userId = req.user._id;
    const eligibility = await getOrComputeEligibility(userId, false);
    if (!eligibility) {
      return res.status(404).json({ success: false, message: 'Eligibility could not be computed.' });
    }
    res.status(200).json({
      success: true,
      data: {
        isEligible: eligibility.isEligible,
        failedConditions: eligibility.failedConditions,
        requirements: eligibility.requirements || [],
        progressPercent: eligibility.progressPercent,
        metrics: eligibility.metrics,
        lastCalculatedAt: eligibility.lastCalculatedAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get eligibility', error: err.message });
  }
}

/**
 * GET /api/monetization/application
 * Returns current user's active/latest application status.
 */
async function getApplication(req, res) {
  try {
    const userId = req.user._id;
    const app = await MonetizationApplication.findOne({ user: userId })
      .sort({ appliedAt: -1 })
      .lean();
    if (!app) {
      return res.status(200).json({
        success: true,
        data: { application: null }
      });
    }
    res.status(200).json({
      success: true,
      data: {
        application: {
          _id: app._id,
          status: app.status,
          adminRemark: app.adminRemark,
          rejectionReason: app.rejectionReason,
          appliedAt: app.appliedAt,
          reviewedAt: app.reviewedAt,
          reapplyAfter: app.reapplyAfter,
          eligibilitySnapshot: app.eligibilitySnapshot
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get application', error: err.message });
  }
}

/**
 * POST /api/monetization/apply
 * Apply for monetization. Only if eligible; one active (pending) at a time.
 */
async function applyForMonetization(req, res) {
  try {
    const userId = req.user._id;

    const eligibility = await getOrComputeEligibility(userId, true);
    if (!eligibility.isEligible) {
      return res.status(400).json({
        success: false,
        message: 'You are not eligible for monetization yet.',
        failedConditions: eligibility.failedConditions
      });
    }

    const existingPending = await MonetizationApplication.findOne({
      user: userId,
      status: 'pending'
    });
    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: 'You already have an application under review.'
      });
    }

    const reapplyBlock = await MonetizationApplication.findOne({
      user: userId,
      status: 'rejected',
      reapplyAfter: { $gt: new Date() }
    }).sort({ reviewedAt: -1 });
    if (reapplyBlock) {
      return res.status(400).json({
        success: false,
        message: 'You cannot re-apply until after the cooldown period.',
        reapplyAfter: reapplyBlock.reapplyAfter
      });
    }

    const application = await MonetizationApplication.create({
      user: userId,
      status: 'pending',
          eligibilitySnapshot: {
            isEligible: eligibility.isEligible,
            progressPercent: eligibility.progressPercent,
            failedConditions: eligibility.failedConditions,
            requirements: eligibility.requirements || [],
            metrics: eligibility.metrics
          }
    });

    await User.findByIdAndUpdate(userId, { creatorMonetizationStatus: 'pending' });
    await recordTimeline({
      application: application._id,
      user: userId,
      action: 'applied',
      actor: userId,
      actorType: 'creator',
      newValue: { status: 'pending', eligibilitySnapshot: application.eligibilitySnapshot }
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted. It will be reviewed by the team.',
      data: {
        application: {
          _id: application._id,
          status: application.status,
          appliedAt: application.appliedAt
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to submit application', error: err.message });
  }
}

/**
 * POST /api/monetization/application/withdraw
 * Withdraw the current pending application.
 */
async function withdrawApplication(req, res) {
  try {
    const userId = req.user._id;
    const { reason = '' } = req.body || {};
    const application = await MonetizationApplication.findOne({ user: userId, status: 'pending' }).sort({ appliedAt: -1 });
    if (!application) {
      return res.status(404).json({ success: false, message: 'No pending application found to withdraw.' });
    }

    const before = application.toObject();
    application.status = 'withdrawn';
    application.adminRemark = String(reason || '').slice(0, 1000);
    application.reviewedAt = new Date();
    await application.save();

    const eligibility = await getOrComputeEligibility(userId, true);
    await User.findByIdAndUpdate(userId, {
      creatorMonetizationStatus: eligibility?.isEligible ? 'eligible' : 'withdrawn'
    });
    await recordTimeline({
      application: application._id,
      user: userId,
      action: 'withdrawn',
      actor: userId,
      actorType: 'creator',
      reason,
      oldValue: { status: before.status },
      newValue: { status: application.status }
    });

    res.status(200).json({
      success: true,
      message: 'Application withdrawn successfully.',
      data: { application: { _id: application._id, status: application.status } }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to withdraw application', error: err.message });
  }
}

/**
 * GET /api/monetization/application/history
 */
async function getApplicationHistory(req, res) {
  try {
    const userId = req.user._id;
    const [applications, timeline] = await Promise.all([
      MonetizationApplication.find({ user: userId })
        .sort({ appliedAt: -1 })
        .select('status adminRemark rejectionReason appliedAt reviewedAt reapplyAfter eligibilitySnapshot')
        .lean(),
      MonetizationApplicationTimeline.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    ]);
    res.status(200).json({
      success: true,
      data: { applications, timeline }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get application history', error: err.message });
  }
}

/**
 * GET /api/monetization/dashboard
 * Earnings dashboard for approved creators: estimated earnings, payout history, next payout, bank status.
 */
async function getDashboard(req, res) {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('isCreator creatorMonetizationStatus').lean();
    if (!user?.isCreator || user.creatorMonetizationStatus === 'suspended' || user.creatorMonetizationStatus === 'disabled') {
      return res.status(403).json({
        success: false,
        message: 'Monetization not enabled for your account. Apply and get approved first.'
      });
    }

    const cycle = await getOrCreateCurrentCycle();
    const estimated = await getEstimatedEarningsForCreator(userId);
    const creatorUser = await User.findById(userId).select('creatorCpm').lean();
    const PLATFORM_DEFAULT_CPM = Number(process.env.PLATFORM_DEFAULT_CPM) || 50;
    const cpm = (creatorUser?.creatorCpm != null && creatorUser.creatorCpm > 0)
      ? creatorUser.creatorCpm
      : PLATFORM_DEFAULT_CPM;

    const payouts = await CreatorPayout.find({ user: userId })
      .populate('payoutCycle', 'cycleLabel periodType endDate')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const bank = await CreatorBankDetails.findOne({ user: userId })
      .select('accountHolderName ifsc swiftCode branch upiId paypalEmail country taxIdEncrypted taxIdHash gstNumber bankName lastFourDigits verificationStatus')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        estimatedEarnings: {
          amount: estimated.amount,
          cycleLabel: estimated.cycleLabel,
          cycleEndDate: estimated.cycleEndDate,
          isEstimate: estimated.isEstimate,
          held: estimated.held,
          inputs: estimated.inputs
        },
        organicAnalytics: {
          totalOrganicClipViews: estimated.inputs?.totalOrganicClipViews || estimated.inputs?.totalClipViews || 0,
          cpm: estimated.inputs?.cpm || cpm,
          boostedViewsExcluded: true
        },
        cpm,
        nextPayoutDate: cycle.endDate,
        payoutHistory: payouts.map(p => ({
          _id: p._id,
          amount: p.amount,
          status: p.status,
          cycleLabel: p.payoutCycle?.cycleLabel,
          paidAt: p.paidAt,
          bankReference: p.bankReference,
          failureReason: p.failureReason
        })),
        bankDetails: maskBankDetails(bank)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get dashboard', error: err.message });
  }
}

async function getEarnings(req, res) {
  return getDashboard(req, res);
}

async function getPayoutHistory(req, res) {
  try {
    const userId = req.user._id;
    const [payouts, withdrawals] = await Promise.all([
      CreatorPayout.find({ user: userId })
        .populate('payoutCycle', 'cycleLabel periodType startDate endDate')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      WithdrawalRequest.find({ user: userId })
        .populate('payoutCycle', 'cycleLabel periodType startDate endDate')
        .sort({ requestedAt: -1 })
        .limit(50)
        .lean()
    ]);

    res.status(200).json({
      success: true,
      data: {
        payouts,
        withdrawalRequests: withdrawals
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get payout history', error: err.message });
  }
}

/**
 * GET /api/monetization/bank-details
 * Get current user's bank details (masked).
 */
async function getBankDetails(req, res) {
  try {
    const userId = req.user._id;
    const bank = await CreatorBankDetails.findOne({ user: userId })
      .select('accountHolderName ifsc swiftCode branch upiId paypalEmail country taxIdEncrypted taxIdHash gstNumber bankName lastFourDigits verificationStatus')
      .lean();
    if (!bank) {
      return res.status(200).json({ success: true, data: { bankDetails: null } });
    }
    res.status(200).json({
      success: true,
      data: {
        bankDetails: maskBankDetails(bank)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get bank details', error: err.message });
  }
}

/**
 * PUT /api/monetization/bank-details
 * Create or update bank details. Account number encrypted server-side.
 */
async function upsertBankDetails(req, res) {
  try {
    const userId = req.user._id;
    const {
      accountHolderName,
      accountNumber,
      accountNumberConfirm,
      ifsc,
      swiftCode,
      bankName,
      branch,
      upiId,
      paypalEmail,
      country,
      taxId,
      pan,
      gstNumber
    } = req.body || {};
    const normalizedCountry = normalizeCountry(country);
    const normalizedAccountNumber = String(accountNumber || '').replace(/\s/g, '');
    const normalizedAccountNumberConfirm = String(accountNumberConfirm || '').replace(/\s/g, '');

    if (!accountHolderName || !normalizedAccountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'accountHolderName, accountNumber, and bankName are required.'
      });
    }
    if (normalizedAccountNumberConfirm && normalizedAccountNumberConfirm !== normalizedAccountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Account number confirmation does not match.'
      });
    }
    if (normalizedCountry === 'IN' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').trim().toUpperCase())) {
      return res.status(400).json({ success: false, message: 'A valid IFSC code is required for Indian payout accounts.' });
    }
    if (normalizedCountry !== 'IN' && !String(swiftCode || '').trim()) {
      return res.status(400).json({ success: false, message: 'SWIFT code is required for international payout accounts.' });
    }

    const encrypted = CreatorBankDetails.encryptAccountNumber(normalizedAccountNumber);
    const lastFour = normalizedAccountNumber.replace(/\D/g, '').slice(-4);
    const taxValue = String(taxId || pan || '').trim();

    const bank = await CreatorBankDetails.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        accountHolderName: accountHolderName.trim(),
        accountNumberEncrypted: encrypted,
        accountNumberHash: CreatorBankDetails.hashSensitiveValue(normalizedAccountNumber),
        ifsc: String(ifsc || '').trim() ? String(ifsc).trim().toUpperCase() : undefined,
        swiftCode: String(swiftCode || '').trim() ? String(swiftCode).trim().toUpperCase() : undefined,
        bankName: bankName.trim(),
        branch: String(branch || '').trim() || undefined,
        upiId: String(upiId || '').trim().toLowerCase() || undefined,
        paypalEmail: String(paypalEmail || '').trim().toLowerCase() || undefined,
        country: normalizedCountry,
        taxIdEncrypted: taxValue ? CreatorBankDetails.encryptSensitiveValue(taxValue) : undefined,
        taxIdHash: taxValue ? CreatorBankDetails.hashSensitiveValue(taxValue) : undefined,
        gstNumber: String(gstNumber || '').trim() ? String(gstNumber).trim().toUpperCase() : undefined,
        lastFourDigits: lastFour,
        verificationStatus: 'pending'
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Bank details saved. They will be verified before payouts.',
      data: {
        bankDetails: {
          ...maskBankDetails(bank)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save bank details', error: err.message });
  }
}

async function deleteBankDetails(req, res) {
  try {
    const userId = req.user._id;
    await CreatorBankDetails.deleteOne({ user: userId });
    res.status(200).json({
      success: true,
      message: 'Bank details deleted successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete bank details', error: err.message });
  }
}

/**
 * GET /api/monetization/status
 * Combined status for profile Earnings tab: eligibility + application + approved (isCreator).
 */
async function getMonetizationStatus(req, res) {
  try {
    const userId = req.user._id;
    // forceRecalculate: true so cached eligibility is refreshed (testing: low thresholds apply)
    const [user, eligibility, application] = await Promise.all([
      User.findById(userId).select('isCreator creatorMonetizationStatus').lean(),
      getOrComputeEligibility(userId, true),
      MonetizationApplication.findOne({ user: userId }).sort({ appliedAt: -1 }).lean()
    ]);

    const creatorStatus = deriveCreatorStatus({ user, eligibility, application });
    const isApproved = creatorStatus === 'approved';
    const applicationStatus = application?.status || null;
    const reapplyAfter = application?.reapplyAfter || null;
    const rejectionReason = application?.rejectionReason || '';

    res.status(200).json({
      success: true,
      data: {
        isEligible: eligibility?.isEligible ?? false,
        isApproved,
        creatorStatus,
        applicationStatus,
        reapplyAfter,
        rejectionReason,
        failedConditions: eligibility?.failedConditions ?? [],
        progressPercent: eligibility?.progressPercent ?? 0,
        metrics: eligibility?.metrics ?? {},
        requirements: eligibility?.requirements ?? [],
        lastCalculatedAt: eligibility?.lastCalculatedAt,
        application: application ? {
          _id: application._id,
          status: application.status,
          appliedAt: application.appliedAt,
          reviewedAt: application.reviewedAt
        } : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get status', error: err.message });
  }
}

/**
 * POST /api/monetization/withdrawal-request
 * Creator submits a withdrawal request for the current payout cycle.
 */
async function submitWithdrawalRequest(req, res) {
  try {
    const userId = req.user._id;

    // Must be an approved creator
    const user = await User.findById(userId).select('isCreator').lean();
    if (!user?.isCreator) {
      return res.status(403).json({ success: false, message: 'Only approved creators can submit withdrawal requests.' });
    }

    // Must have verified bank details
    const bank = await CreatorBankDetails.findOne({ user: userId }).lean();
    if (!bank || bank.verificationStatus !== 'verified') {
      return res.status(400).json({ success: false, message: 'Bank details must be verified before submitting a withdrawal request.' });
    }

    // Get current payout cycle
    const cycle = await getOrCreateCurrentCycle();

    // Get earnings snapshot for this cycle
    const EarningsSnapshot = require('../models/EarningsSnapshot');
    const snapshot = await EarningsSnapshot.findOne({ user: userId, payoutCycle: cycle._id }).lean();
    const amount = snapshot?.amount || 0;

    // Check minimum threshold
    const threshold = cycle.minimumPayoutThreshold ?? 500;
    if (amount < threshold) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₹${threshold}. Your current earnings are ₹${amount}.`
      });
    }

    // Prevent duplicate requests for same cycle
    const existing = await WithdrawalRequest.findOne({ user: userId, payoutCycle: cycle._id });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A withdrawal request for this cycle already exists.' });
    }

    const request = await WithdrawalRequest.create({
      user: userId,
      payoutCycle: cycle._id,
      amount,
      status: 'pending',
      requestedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. It will be reviewed by the team.',
      data: {
        request: {
          _id: request._id,
          amount: request.amount,
          status: request.status,
          requestedAt: request.requestedAt
        }
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A withdrawal request for this cycle already exists.' });
    }
    res.status(500).json({ success: false, message: 'Failed to submit withdrawal request', error: err.message });
  }
}

module.exports = {
  assertPlayer,
  getEligibility,
  getApplication,
  applyForMonetization,
  withdrawApplication,
  getApplicationHistory,
  getDashboard,
  getEarnings,
  getPayoutHistory,
  getBankDetails,
  upsertBankDetails,
  deleteBankDetails,
  getMonetizationStatus,
  submitWithdrawalRequest
};
