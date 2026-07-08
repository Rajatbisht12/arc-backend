const assert = require('node:assert/strict');

const payoutId = '507f1f77bcf86cd799439011';
const creatorId = '507f1f77bcf86cd799439012';
const cycleId = '507f1f77bcf86cd799439013';
const bankId = '507f1f77bcf86cd799439014';
const sourceSnapshotIds = [
  '507f1f77bcf86cd799439016',
  '507f1f77bcf86cd799439017'
];

const state = {
  existingHistory: null,
  casSucceeds: true,
  payoutStatus: 'processing',
  sessionsStarted: 0,
  payoutUpdates: [],
  snapshotUpdates: [],
  historyRows: [],
  notifications: []
};

const resetState = () => {
  state.existingHistory = null;
  state.casSucceeds = true;
  state.payoutStatus = 'processing';
  state.sessionsStarted = 0;
  state.payoutUpdates.length = 0;
  state.snapshotUpdates.length = 0;
  state.historyRows.length = 0;
  state.notifications.length = 0;
};

const payoutDocument = () => ({
  _id: payoutId,
  user: creatorId,
  payoutCycle: cycleId,
  bankDetails: bankId,
  bankDetailsVersion: 3,
  bankDetailsSnapshot: {},
  amount: 123.45,
  amountMinor: 12345,
  currency: 'INR',
  status: state.payoutStatus,
  version: 2,
  sourceSnapshots: sourceSnapshotIds,
  createdAt: new Date('2026-06-01T00:00:00.000Z')
});

const query = ({ sessionValue, leanValue, populateValue } = {}) => ({
  session: async () => sessionValue,
  lean: async () => leanValue,
  populate() {
    return query({ sessionValue: populateValue ?? sessionValue, leanValue, populateValue });
  }
});

const CreatorPayout = {
  findById() {
    const payout = payoutDocument();
    return query({ sessionValue: payout, leanValue: payout });
  },
  async findOneAndUpdate(filter, update, options) {
    state.payoutUpdates.push({ filter, update, options });
    if (!state.casSucceeds) return null;
    const payout = {
      ...payoutDocument(),
      ...update.$set,
      version: payoutDocument().version + Number(update.$inc?.version || 0)
    };
    payout.toObject = () => ({ ...payout, toObject: undefined });
    return payout;
  }
};

const CreatorPayoutHistory = {
  findOne() {
    return query({ leanValue: state.existingHistory });
  },
  async create(rows) {
    state.historyRows.push(...rows);
    return rows.map((row, index) => ({ _id: `history-${index + 1}`, ...row }));
  }
};

const CreatorBankDetails = {
  findOneAndUpdate() {
    return {
      select: async () => ({
        _id: bankId,
        version: 3,
        accountHolderName: 'Creator Test',
        bankName: 'Test Bank',
        lastFourDigits: '1234',
        ifsc: 'TEST0000001',
        branch: 'Main'
      })
    };
  },
  async updateOne() {
    return { matchedCount: 1 };
  }
};

const EarningsSnapshot = {
  async updateOne(filter, update, options) {
    state.snapshotUpdates.push({ filter, update, options });
    return { matchedCount: 1 };
  },
  async updateMany(filter, update, options) {
    state.snapshotUpdates.push({ filter, update, options });
    return { matchedCount: sourceSnapshotIds.length };
  }
};

const CreatorDisbursementReservation = {
  deleteOne() {
    return query({ sessionValue: { deletedCount: 1 } });
  }
};

const User = {
  exists() {
    return query({ sessionValue: { _id: creatorId } });
  }
};

const session = () => ({
  async withTransaction(work) {
    return work();
  },
  async endSession() {}
});

const mocks = {
  '../models/CreatorPayout': CreatorPayout,
  '../models/CreatorPayoutHistory': CreatorPayoutHistory,
  '../models/CreatorBankDetails': CreatorBankDetails,
  '../models/CreatorDisbursementReservation': CreatorDisbursementReservation,
  '../models/EarningsSnapshot': EarningsSnapshot,
  '../models/PayoutCycle': {},
  '../models/User': User,
  '../utils/notificationService': {
    async createSystemNotification(...args) {
      state.notifications.push(args);
      return { success: true };
    }
  },
  '../utils/notificationChannelPolicy': {
    EMAIL_INTENTS: { PAYMENT_TRANSACTIONAL: 'payment_transactional' }
  },
  '../utils/financialTransactions': {
    FINANCIAL_TRANSACTION_OPTIONS: { readPreference: 'primary' },
    async startFinancialSession() {
      state.sessionsStarted += 1;
      return session();
    },
    maskedBankSnapshot(bank) {
      return { bankName: bank.bankName, lastFourDigits: bank.lastFourDigits, capturedAt: new Date() };
    }
  },
  '../utils/logger': { error() {} }
};

for (const [request, exports] of Object.entries(mocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

delete require.cache[require.resolve('./CreatorPayoutAdminService')];
const { transitionPayout } = require('./CreatorPayoutAdminService');

const request = (idempotencyKey = '') => ({
  user: {
    _id: '507f1f77bcf86cd799439015',
    username: 'finance-admin',
    adminRole: 'finance_admin'
  },
  ip: '203.0.113.10',
  headers: { 'user-agent': 'qa-agent' },
  get(name) {
    if (name === 'idempotency-key') return idempotencyKey;
    if (name === 'user-agent') return this.headers['user-agent'];
    return '';
  }
});

const expectError = async (work, statusCode, code) => {
  await assert.rejects(work, (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
};

const run = async () => {
  resetState();
  await expectError(
    () => transitionPayout({ payoutId: 'invalid', action: 'paid', payload: {}, req: request() }),
    400,
    'INVALID_PAYOUT_ID'
  );
  assert.equal(state.sessionsStarted, 0, 'invalid IDs must fail before opening a transaction');

  resetState();
  await expectError(
    () => transitionPayout({
      payoutId,
      action: 'paid',
      payload: { paymentMethod: 'bank_transfer', paymentDate: '2026-07-01T00:00:00.000Z' },
      req: request()
    }),
    422,
    'REFERENCE_NUMBER_REQUIRED'
  );
  assert.equal(state.payoutUpdates.length, 0, 'invalid payment details must not mutate a payout');
  assert.equal(state.historyRows.length, 0, 'invalid payment details must not append history');

  resetState();
  state.payoutStatus = 'pending';
  await expectError(
    () => transitionPayout({ payoutId, action: 'paid', payload: {}, req: request() }),
    409,
    'INVALID_PAYOUT_TRANSITION'
  );
  assert.equal(state.payoutUpdates.length, 0);

  resetState();
  const result = await transitionPayout({
    payoutId,
    action: 'paid',
    payload: {
      expectedVersion: 2,
      transactionId: 'TXN-123',
      referenceNumber: 'UTR-456',
      paymentMethod: 'bank_transfer',
      notes: 'Paid after finance review',
      paymentDate: '2026-07-01T00:00:00.000Z'
    },
    req: request('paid-request-1')
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.payout.status, 'paid');
  assert.equal(state.payoutUpdates.length, 1);
  assert.deepEqual(state.payoutUpdates[0].filter, {
    _id: payoutId,
    status: 'processing',
    version: 2
  });
  assert.equal(state.payoutUpdates[0].update.$set.transactionId, 'TXN-123');
  assert.equal(state.payoutUpdates[0].update.$set.bankReference, 'UTR-456');
  assert.equal(state.payoutUpdates[0].update.$set.paymentMethod, 'bank_transfer');
  assert.deepEqual(state.payoutUpdates[0].update.$inc, { version: 1 });
  assert.equal(state.payoutUpdates[0].options.runValidators, true);
  assert.equal(state.snapshotUpdates.length, 1, 'all carry-forward source snapshots must be reviewed together');
  assert.deepEqual(state.snapshotUpdates[0].filter, {
    user: creatorId,
    disbursementId: payoutId,
    held: { $ne: true }
  });
  assert.ok(state.snapshotUpdates[0].update.$set.disbursementReviewedAt instanceof Date);

  assert.equal(state.historyRows.length, 1);
  assert.equal(state.historyRows[0].action, 'paid');
  assert.equal(state.historyRows[0].previousStatus, 'processing');
  assert.equal(state.historyRows[0].newStatus, 'paid');
  assert.equal(state.historyRows[0].amountMinor, 12345);
  assert.equal(state.historyRows[0].currency, 'INR');
  assert.equal(state.historyRows[0].idempotencyKey, 'paid-request-1');
  assert.equal(state.historyRows[0].payment.referenceNumber, 'UTR-456');
  assert.equal(state.historyRows[0].payment.method, 'bank_transfer');
  assert.equal(state.historyRows[0].actor.role, 'finance_admin');
  assert.equal(state.historyRows[0].ip, '203.0.113.10');

  assert.equal(state.notifications.length, 1);
  const notificationOptions = state.notifications[0][4];
  assert.equal(notificationOptions.email.intent, 'payment_transactional');
  assert.equal(notificationOptions.email.eventType, 'payout_paid');
  assert.match(state.notifications[0][3].notificationDedupeKey, /^creator-payout-paid:/);

  resetState();
  state.existingHistory = { _id: 'history-existing', payout: payoutId, idempotencyKey: 'paid-request-1', action: 'paid' };
  const replay = await transitionPayout({
    payoutId,
    action: 'paid',
    payload: {},
    req: request('paid-request-1')
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.history._id, 'history-existing');
  assert.equal(state.sessionsStarted, 0, 'idempotent replay must not open another transaction');
  assert.equal(state.payoutUpdates.length, 0);
  assert.equal(state.historyRows.length, 0);
  assert.equal(state.notifications.length, 0);

  resetState();
  state.casSucceeds = false;
  await expectError(
    () => transitionPayout({
      payoutId,
      action: 'paid',
      payload: {
        referenceNumber: 'UTR-CAS',
        paymentMethod: 'upi',
        paymentDate: '2026-07-01T00:00:00.000Z'
      },
      req: request('cas-conflict')
    }),
    409,
    'PAYOUT_VERSION_CONFLICT'
  );
  assert.equal(state.historyRows.length, 0, 'a failed compare-and-swap must not append history');
  assert.equal(state.notifications.length, 0, 'a failed compare-and-swap must not notify the creator');

  console.log('Creator payout transition, validation, history, idempotency, and notification tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
