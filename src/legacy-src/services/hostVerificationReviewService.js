const mongoose = require('mongoose');
const User = require('../models/User');
const HostVerificationApplication = require('../models/HostVerificationApplication');
const {
  FINANCIAL_TRANSACTION_OPTIONS,
  startFinancialSession
} = require('../utils/financialTransactions');

const reviewError = (statusCode, code, message) => Object.assign(new Error(message), {
  statusCode,
  code
});

const requireObjectId = (value, code, message) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw reviewError(400, code, message);
  }
  return value;
};

const normalizeRejectionReason = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw reviewError(400, 'INVALID_HOST_REJECTION_REASON', 'Rejection reason must be a string');
  }
  if (value.length > 500) {
    throw reviewError(400, 'HOST_REJECTION_REASON_TOO_LONG', 'Rejection reason cannot exceed 500 characters');
  }
  return value;
};

const createHostVerificationReviewService = ({
  ApplicationModel = HostVerificationApplication,
  UserModel = User,
  startSession = startFinancialSession,
  transactionOptions = FINANCIAL_TRANSACTION_OPTIONS
} = {}) => {
  const inTransaction = async (operation) => {
    let session;
    try {
      session = await startSession();
      let result;
      await session.withTransaction(async () => {
        result = await operation(session);
      }, transactionOptions);
      return result;
    } finally {
      if (session) await session.endSession().catch(() => null);
    }
  };

  const loadApplication = (applicationId, session) => ApplicationModel.findOne({ _id: applicationId })
    .session(session)
    .lean();

  const loadUser = (userId, session) => UserModel.findOne({ _id: userId })
    .session(session)
    .select('_id username isVerifiedHost')
    .lean();

  const approve = ({ applicationId, adminId }) => {
    requireObjectId(
      applicationId,
      'INVALID_HOST_APPLICATION_ID',
      'Valid host application ID is required'
    );
    return inTransaction(async (session) => {
      const beforeApplication = await loadApplication(applicationId, session);
      if (!beforeApplication) {
        throw reviewError(404, 'HOST_APPLICATION_NOT_FOUND', 'Application not found');
      }
      if (beforeApplication.status !== 'pending') {
        throw reviewError(400, 'HOST_APPLICATION_NOT_PENDING', 'Application is not pending');
      }

      const beforeUser = await loadUser(beforeApplication.user, session);
      if (!beforeUser) {
        throw reviewError(409, 'HOST_APPLICATION_OWNER_NOT_FOUND', 'Application owner no longer exists');
      }

      const reviewedAt = new Date();
      const application = await ApplicationModel.findOneAndUpdate(
        { _id: beforeApplication._id, status: 'pending' },
        {
          $set: {
            status: 'approved',
            reviewedAt,
            reviewedBy: adminId || null,
            rejectionReason: ''
          }
        },
        { new: true, runValidators: true, session }
      );
      if (!application) {
        throw reviewError(409, 'HOST_APPLICATION_REVIEW_CONFLICT', 'Application changed while it was being reviewed');
      }

      const userUpdate = await UserModel.updateOne(
        { _id: beforeApplication.user },
        { $set: { isVerifiedHost: true } },
        { session }
      );
      if (userUpdate.matchedCount !== 1) {
        throw reviewError(409, 'HOST_APPLICATION_OWNER_NOT_FOUND', 'Application owner no longer exists');
      }

      return { application, beforeApplication, beforeUser, userId: beforeApplication.user };
    });
  };

  const reject = ({ applicationId, adminId, rejectionReason }) => {
    requireObjectId(
      applicationId,
      'INVALID_HOST_APPLICATION_ID',
      'Valid host application ID is required'
    );
    const normalizedReason = normalizeRejectionReason(rejectionReason);
    return inTransaction(async (session) => {
      const beforeApplication = await loadApplication(applicationId, session);
      if (!beforeApplication) {
        throw reviewError(404, 'HOST_APPLICATION_NOT_FOUND', 'Application not found');
      }
      if (beforeApplication.status !== 'pending') {
        throw reviewError(400, 'HOST_APPLICATION_NOT_PENDING', 'Application is not pending');
      }

      const beforeUser = await loadUser(beforeApplication.user, session);
      if (!beforeUser) {
        throw reviewError(409, 'HOST_APPLICATION_OWNER_NOT_FOUND', 'Application owner no longer exists');
      }

      const application = await ApplicationModel.findOneAndUpdate(
        { _id: beforeApplication._id, status: 'pending' },
        {
          $set: {
            status: 'rejected',
            reviewedAt: new Date(),
            reviewedBy: adminId || null,
            rejectionReason: normalizedReason
          }
        },
        { new: true, runValidators: true, session }
      );
      if (!application) {
        throw reviewError(409, 'HOST_APPLICATION_REVIEW_CONFLICT', 'Application changed while it was being reviewed');
      }

      // Rejection intentionally preserves User.isVerifiedHost. That is the
      // existing product rule; only approval and explicit revocation mutate it.
      return {
        application,
        beforeApplication,
        beforeUser,
        userId: beforeApplication.user,
        rejectionReason: normalizedReason
      };
    });
  };

  const revoke = ({ userId, adminId }) => {
    requireObjectId(userId, 'INVALID_HOST_USER_ID', 'Valid user ID is required');
    return inTransaction(async (session) => {
      const beforeUser = await loadUser(userId, session);
      if (!beforeUser) {
        throw reviewError(404, 'VERIFIED_HOST_NOT_FOUND', 'User not found');
      }
      if (beforeUser.isVerifiedHost !== true) {
        throw reviewError(400, 'USER_NOT_VERIFIED_HOST', 'User is not a verified host');
      }

      const beforeApplication = await ApplicationModel.findOne({ user: userId, status: 'approved' })
        .session(session)
        .lean();
      const userUpdate = await UserModel.updateOne(
        { _id: userId, isVerifiedHost: true },
        { $set: { isVerifiedHost: false } },
        { session }
      );
      if (userUpdate.matchedCount !== 1) {
        throw reviewError(409, 'HOST_REVOCATION_CONFLICT', 'Verified Host status changed while it was being revoked');
      }

      let application = null;
      if (beforeApplication) {
        application = await ApplicationModel.findOneAndUpdate(
          { _id: beforeApplication._id, status: 'approved' },
          {
            $set: {
              status: 'rejected',
              rejectionReason: 'Verification revoked by admin',
              reviewedAt: new Date(),
              reviewedBy: adminId || null
            }
          },
          { new: true, runValidators: true, session }
        );
        if (!application) {
          throw reviewError(409, 'HOST_REVOCATION_CONFLICT', 'Host application changed while verification was being revoked');
        }
      }

      return { user: beforeUser, beforeUser, beforeApplication, application, userId };
    });
  };

  return { approve, reject, revoke };
};

const defaultService = createHostVerificationReviewService();

module.exports = {
  ...defaultService,
  createHostVerificationReviewService,
  normalizeRejectionReason
};
