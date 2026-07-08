const assert = require('node:assert/strict');

const payoutId = '507f1f77bcf86cd799439301';
const creatorId = '507f1f77bcf86cd799439302';
const cycleId = '507f1f77bcf86cd799439303';
const snapshotIds = [
  '507f1f77bcf86cd799439304',
  '507f1f77bcf86cd799439305'
];
const baseIdempotencyKey = `generate:${snapshotIds[0]}`;

const query = (value) => {
  const chain = {
    session() { return chain; },
    select() { return chain; },
    sort() { return chain; },
    limit() { return chain; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
  return chain;
};

const state = {
  payout: null,
  snapshots: [],
  activeReservation: null,
  historyKeys: new Set([baseIdempotencyKey]),
  historyRows: [],
  payoutSaves: 0,
  snapshotClaims: [],
  reservations: [],
  notifications: []
};

const reset = () => {
  state.payout = {
    _id: payoutId,
    user: creatorId,
    payoutCycle: cycleId,
    amount: 550,
    amountMinor: 55000,
    currency: 'INR',
    status: 'failed',
    attemptNumber: 1,
    version: 2,
    sourceSnapshots: [...snapshotIds],
    failureReason: 'Bank timeout',
    cancellationReason: '',
    heldReason: '',
    preHoldStatus: '',
    async save() {
      state.payoutSaves += 1;
      return this;
    },
    toObject() { return { ...this }; }
  };
  state.snapshots = snapshotIds.map((id, index) => ({
    _id: id,
    user: creatorId,
    payoutCycle: cycleId,
    amount: index === 0 ? 300 : 250,
    amountMinor: index === 0 ? 30000 : 25000,
    held: false,
    disbursementReservedAt: null,
    disbursementId: null,
    currency: 'INR'
  }));
  state.activeReservation = null;
  state.historyKeys = new Set([baseIdempotencyKey]);
  state.historyRows.length = 0;
  state.payoutSaves = 0;
  state.snapshotClaims.length = 0;
  state.reservations.length = 0;
  state.notifications.length = 0;
};

const CreatorPayout = {
  findOne() { return query(state.payout); },
  findById() { return query(state.payout); },
  distinct() { return query([]); }
};

const CreatorPayoutHistory = {
  findOne() { return query(null); },
  async create(rows) {
    for (const row of rows) {
      if (row.idempotencyKey && state.historyKeys.has(row.idempotencyKey)) {
        const duplicate = new Error('duplicate history idempotency key');
        duplicate.code = 11000;
        throw duplicate;
      }
      if (row.idempotencyKey) state.historyKeys.add(row.idempotencyKey);
      state.historyRows.push(row);
    }
    return rows;
  }
};

const EarningsSnapshot = {
  findById(id) {
    return query(state.snapshots.find((row) => row._id === String(id)) || null);
  },
  find(filter) {
    const available = state.snapshots.filter((row) => row.disbursementReservedAt == null && row.disbursementId == null);
    // generatePayouts first selects one requested snapshot. The internal
    // generation transaction then loads every eligible source snapshot.
    const isInternalCreatorQuery = String(filter.user || '') === creatorId;
    return query(isInternalCreatorQuery ? available : available.slice(0, 1));
  },
  async updateMany(filter, update, options) {
    const ids = new Set(filter._id.$in.map(String));
    const rows = state.snapshots.filter((row) => (
      ids.has(String(row._id)) &&
      row.held !== true &&
      row.disbursementReservedAt == null &&
      row.disbursementId == null
    ));
    state.snapshotClaims.push({ filter, update, options, matchedCount: rows.length });
    for (const row of rows) Object.assign(row, update.$set);
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }
};

const PayoutCycle = {
  findById() {
    return query({
      _id: cycleId,
      cycleLabel: '2026-06',
      status: 'closed',
      minimumPayoutThreshold: 500,
      endDate: new Date('2026-06-30T23:59:59.999Z')
    });
  },
  distinct() { return query([cycleId]); }
};

const CreatorDisbursementReservation = {
  findOne() { return query(state.activeReservation); },
  async create(rows) {
    state.reservations.push(...rows);
    state.activeReservation = rows[0];
    return rows;
  }
};

const User = { exists() { return query({ _id: creatorId }); } };

const mocks = {
  '../models/CreatorPayout': CreatorPayout,
  '../models/CreatorPayoutHistory': CreatorPayoutHistory,
  '../models/CreatorBankDetails': { findOneAndUpdate() { return { select: async () => null }; } },
  '../models/CreatorDisbursementReservation': CreatorDisbursementReservation,
  '../models/EarningsSnapshot': EarningsSnapshot,
  '../models/PayoutCycle': PayoutCycle,
  '../models/WithdrawalRequest': { distinct() { return query([]); } },
  '../models/User': User,
  '../utils/notificationService': {
    async createSystemNotification(...args) {
      state.notifications.push(args);
      return { success: true };
    }
  },
  '../utils/notificationChannelPolicy': { EMAIL_INTENTS: { PAYMENT_TRANSACTIONAL: 'payment_transactional' } },
  '../utils/financialTransactions': {
    FINANCIAL_TRANSACTION_OPTIONS: { readPreference: 'primary' },
    async startFinancialSession() {
      return {
        async withTransaction(work) { return work(); },
        async endSession() {}
      };
    },
    maskedBankSnapshot() { return {}; }
  },
  '../utils/logger': { error() {} }
};

for (const [request, exports] of Object.entries(mocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

delete require.cache[require.resolve('./CreatorPayoutAdminService')];
const { generatePayouts } = require('./CreatorPayoutAdminService');

const req = {
  user: { _id: '507f1f77bcf86cd799439306', username: 'finance-admin', adminRole: 'finance_admin' },
  ip: '203.0.113.20',
  headers: { 'user-agent': 'qa-agent' },
  get(name) { return name === 'user-agent' ? this.headers['user-agent'] : ''; }
};

const releaseFailedAttempt = () => {
  state.payout.status = 'failed';
  state.payout.failureReason = 'Retryable bank timeout';
  state.activeReservation = null;
  for (const snapshot of state.snapshots) {
    snapshot.disbursementReservedAt = null;
    snapshot.disbursementId = null;
  }
};

const run = async () => {
  reset();
  const retry = await generatePayouts({
    cycleId,
    creatorIds: [creatorId],
    req,
    limit: 1
  });

  assert.equal(retry.generated, 1);
  assert.equal(retry.results[0].generated, true);
  assert.equal(retry.results[0].payout.status, 'pending');
  assert.equal(retry.results[0].payout.attemptNumber, 2);
  assert.equal(state.payoutSaves, 1);
  assert.equal(state.snapshotClaims.length, 1);
  assert.equal(state.snapshotClaims[0].matchedCount, 2);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.historyRows.length, 1);
  assert.equal(state.historyRows[0].previousStatus, 'failed');
  assert.equal(state.historyRows[0].metadata.attemptNumber, 2);
  assert.equal(state.historyRows[0].idempotencyKey, `${baseIdempotencyKey}:attempt:2`);
  assert.notEqual(state.historyRows[0].idempotencyKey, baseIdempotencyKey, 'retry history must not collide with original generation history');

  const repeatedRetry = await generatePayouts({
    cycleId,
    creatorIds: [creatorId],
    req,
    limit: 1
  });
  assert.equal(repeatedRetry.generated, 0, 'repeating the same active retry must be idempotent');
  assert.equal(repeatedRetry.requested, 0);
  assert.equal(state.payoutSaves, 1, 'same retry must not save payout twice');
  assert.equal(state.snapshotClaims.length, 1, 'same retry must not claim snapshots twice');
  assert.equal(state.reservations.length, 1, 'same retry must not create a second reservation');
  assert.equal(state.historyRows.length, 1, 'same retry must not append a second history row');
  assert.equal(state.notifications.length, 1, 'same retry must not emit a second payout-generated notification');

  releaseFailedAttempt();
  const nextRetry = await generatePayouts({
    cycleId,
    creatorIds: [creatorId],
    req,
    limit: 1
  });
  assert.equal(nextRetry.generated, 1);
  assert.equal(nextRetry.results[0].payout.attemptNumber, 3);
  assert.equal(state.historyRows.length, 2);
  assert.equal(state.historyRows[1].idempotencyKey, `${baseIdempotencyKey}:attempt:3`);
  assert.notEqual(state.historyRows[1].idempotencyKey, state.historyRows[0].idempotencyKey);
  assert.equal(state.historyKeys.size, 3, 'original, attempt 2, and attempt 3 keys must all remain unique');

  console.log('Creator payout terminal retry idempotency regression tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
