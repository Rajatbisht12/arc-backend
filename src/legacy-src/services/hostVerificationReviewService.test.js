const assert = require('node:assert/strict');

const {
  createHostVerificationReviewService,
  normalizeRejectionReason
} = require('./hostVerificationReviewService');

const clone = (value) => (value == null ? value : structuredClone(value));

const matches = (document, filter = {}) => Object.entries(filter).every(([key, expected]) => (
  String(document?.[key]) === String(expected)
));

const makeQuery = (resolveValue, calls, operation) => ({
  session(session) {
    calls.push({ operation, session });
    this.boundSession = session;
    return this;
  },
  select() { return this; },
  lean() { return Promise.resolve(clone(resolveValue())); }
});

const createHarness = ({ application, user, failUserUpdate = false } = {}) => {
  const state = {
    application: clone(application),
    user: clone(user)
  };
  const calls = [];
  let sessionSequence = 0;

  const restore = (snapshot) => {
    state.application = clone(snapshot.application);
    state.user = clone(snapshot.user);
  };

  const startSession = async () => {
    const session = {
      id: `session-${++sessionSequence}`,
      async withTransaction(work, options) {
        calls.push({ operation: 'withTransaction', session, options });
        const snapshot = clone(state);
        try {
          return await work();
        } catch (error) {
          if (session.mutated) restore(snapshot);
          throw error;
        }
      },
      async endSession() {
        calls.push({ operation: 'endSession', session });
      }
    };
    return session;
  };

  const ApplicationModel = {
    findOne(filter) {
      return makeQuery(
        () => (state.application && matches(state.application, filter) ? state.application : null),
        calls,
        'application.findOne'
      );
    },
    async findOneAndUpdate(filter, update, options) {
      calls.push({ operation: 'application.findOneAndUpdate', filter, update, options });
      if (!state.application || !matches(state.application, filter)) return null;
      options.session.mutated = true;
      Object.assign(state.application, clone(update.$set || {}));
      return clone(state.application);
    }
  };

  const UserModel = {
    findOne(filter) {
      return makeQuery(
        () => (state.user && matches(state.user, filter) ? state.user : null),
        calls,
        'user.findOne'
      );
    },
    async updateOne(filter, update, options) {
      calls.push({ operation: 'user.updateOne', filter, update, options });
      if (failUserUpdate) throw new Error('simulated user write failure');
      if (!state.user || !matches(state.user, filter)) return { matchedCount: 0, modifiedCount: 0 };
      options.session.mutated = true;
      Object.assign(state.user, clone(update.$set || {}));
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  return {
    state,
    calls,
    startSession,
    service: createHostVerificationReviewService({ ApplicationModel, UserModel, startSession })
  };
};

const baseApplication = () => ({
  _id: '507f1f77bcf86cd799439011',
  user: '507f1f77bcf86cd799439012',
  status: 'pending',
  reviewedAt: null,
  reviewedBy: null,
  rejectionReason: ''
});

const baseUser = () => ({
  _id: '507f1f77bcf86cd799439012',
  username: 'host_candidate',
  isVerifiedHost: false
});

(async () => {
  assert.equal(normalizeRejectionReason(undefined), '');
  assert.equal(normalizeRejectionReason('x'.repeat(500)).length, 500);
  assert.throws(
    () => normalizeRejectionReason('x'.repeat(501)),
    (error) => error.statusCode === 400 && error.code === 'HOST_REJECTION_REASON_TOO_LONG'
  );
  assert.throws(
    () => normalizeRejectionReason({ reason: 'invalid' }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_HOST_REJECTION_REASON'
  );

  {
    const harness = createHarness({ application: baseApplication(), user: baseUser() });
    assert.throws(
      () => harness.service.approve({ applicationId: 'not-an-object-id' }),
      (error) => error.statusCode === 400 && error.code === 'INVALID_HOST_APPLICATION_ID'
    );
    assert.throws(
      () => harness.service.reject({ applicationId: '../invalid', rejectionReason: '' }),
      (error) => error.statusCode === 400 && error.code === 'INVALID_HOST_APPLICATION_ID'
    );
    assert.throws(
      () => harness.service.revoke({ userId: '' }),
      (error) => error.statusCode === 400 && error.code === 'INVALID_HOST_USER_ID'
    );
    assert.equal(harness.calls.length, 0, 'invalid IDs must be rejected before a transaction starts');
  }

  {
    const harness = createHarness({ application: baseApplication(), user: baseUser() });
    const result = await harness.service.approve({
      applicationId: baseApplication()._id,
      adminId: '507f1f77bcf86cd799439013'
    });
    assert.equal(result.application.status, 'approved');
    assert.equal(harness.state.application.status, 'approved');
    assert.equal(harness.state.user.isVerifiedHost, true);
    const applicationWrite = harness.calls.find((entry) => entry.operation === 'application.findOneAndUpdate');
    const userWrite = harness.calls.find((entry) => entry.operation === 'user.updateOne');
    assert.equal(applicationWrite.filter.status, 'pending', 'application transition must be compare-and-set');
    assert.equal(applicationWrite.options.session, userWrite.options.session, 'application and user writes must share one session');
    assert(harness.calls.some((entry) => entry.operation === 'endSession'), 'session must always be released');
  }

  {
    const harness = createHarness({ application: baseApplication(), user: baseUser() });
    const attempts = await Promise.allSettled([
      harness.service.approve({ applicationId: baseApplication()._id, adminId: '507f1f77bcf86cd799439013' }),
      harness.service.approve({ applicationId: baseApplication()._id, adminId: '507f1f77bcf86cd799439014' })
    ]);
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    assert.equal(harness.state.application.status, 'approved');
    assert.equal(harness.state.user.isVerifiedHost, true);
  }

  {
    const harness = createHarness({
      application: baseApplication(),
      user: baseUser(),
      failUserUpdate: true
    });
    await assert.rejects(
      () => harness.service.approve({ applicationId: baseApplication()._id, adminId: '507f1f77bcf86cd799439013' }),
      /simulated user write failure/
    );
    assert.equal(harness.state.application.status, 'pending', 'failed user write must roll back application transition');
    assert.equal(harness.state.user.isVerifiedHost, false);
  }

  {
    const harness = createHarness({ application: baseApplication(), user: baseUser() });
    const reason = 'Incomplete supporting information';
    const result = await harness.service.reject({
      applicationId: baseApplication()._id,
      adminId: '507f1f77bcf86cd799439013',
      rejectionReason: reason
    });
    assert.equal(result.application.status, 'rejected');
    assert.equal(result.application.rejectionReason, reason);
    assert.equal(harness.state.user.isVerifiedHost, false, 'reject must preserve the existing verification business rule');
  }

  {
    const application = { ...baseApplication(), status: 'approved' };
    const user = { ...baseUser(), isVerifiedHost: true };
    const harness = createHarness({ application, user });
    const result = await harness.service.revoke({
      userId: user._id,
      adminId: '507f1f77bcf86cd799439013'
    });
    assert.equal(result.user.username, user.username);
    assert.equal(harness.state.user.isVerifiedHost, false);
    assert.equal(harness.state.application.status, 'rejected');
    assert.equal(harness.state.application.rejectionReason, 'Verification revoked by admin');
    const applicationWrite = harness.calls.find((entry) => entry.operation === 'application.findOneAndUpdate');
    const userWrite = harness.calls.find((entry) => entry.operation === 'user.updateOne');
    assert.equal(applicationWrite.options.session, userWrite.options.session, 'revoke writes must share one session');
  }

  console.log('Host verification review transaction and validation tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
