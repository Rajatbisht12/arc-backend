/**
 * Host Verification: user-facing apply and status endpoints.
 */

const HostVerificationApplication = require('../models/HostVerificationApplication');
const log = require('../utils/logger');

/**
 * POST /api/host-verification/apply
 * Submit a new host verification application.
 */
async function applyForHostVerification(req, res) {
  try {
    const { fullName, contactNumber, gamingExperience, reasonForHosting, socialLinks } = req.body || {};

    // Validate required fields — must be non-empty and non-whitespace
    const requiredFields = { fullName, contactNumber, gamingExperience, reasonForHosting };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !value || !String(value).trim())
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Required fields are missing: ${missingFields.join(', ')}`
      });
    }

    const userId = req.user._id;

    // Check for existing pending or approved application
    const existingActive = await HostVerificationApplication.findOne({
      user: userId,
      status: { $in: ['pending', 'approved'] }
    });

    if (existingActive) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending or approved application.'
      });
    }

    // If a rejected document exists, delete it to allow re-application
    await HostVerificationApplication.deleteOne({ user: userId, status: 'rejected' });

    // Create new application
    const application = await HostVerificationApplication.create({
      user: userId,
      fullName: String(fullName).trim(),
      contactNumber: String(contactNumber).trim(),
      gamingExperience: String(gamingExperience).trim(),
      reasonForHosting: String(reasonForHosting).trim(),
      socialLinks: socialLinks ? String(socialLinks).trim() : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully. It is now under review.',
      data: { application }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: err.message
    });
  }
}

/**
 * GET /api/host-verification/status
 * Get the current user's host verification application status.
 */
async function getMyHostVerificationStatus(req, res) {
  try {
    const userId = req.user._id;

    const application = await HostVerificationApplication.findOne({ user: userId }).lean();

    return res.status(200).json({
      success: true,
      data: { application: application || null }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get application status',
      error: err.message
    });
  }
}

module.exports = {
  applyForHostVerification,
  getMyHostVerificationStatus
};
