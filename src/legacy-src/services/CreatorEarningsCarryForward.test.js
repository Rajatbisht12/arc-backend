const assert = require('node:assert/strict');

const creatorId = '507f1f77bcf86cd799439101';
const currentCycleId = '507f1f77bcf86cd799439102';
const priorCycleId = '507f1f77bcf86cd799439103';
const currentSnapshotId = '507f1f77bcf86cd799439104';
const priorSnapshotId = '507f1f77bcf86cd799439105';
const payoutId = '507f1f77bcf86cd799439106';

const previousMonthLabel = () => {
  const now = new Date();
  const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

const state = {
  aggregateMinor: 50000,
  payoutRows: [],
  payoutSaves: [],
  snapshotFinds: [],
  snapshotUpdateMany: [],
  reservations: [],
  historyRows: [],
  notifications: [],
  cycleDistinctFilters: [],
  payoutFinds: [],
  withdrawalFinds: [],
  legacyPayouts: [],
  legacyWithdrawals: [],
  sessions: 0
};

const reset = (aggregateMinor) => {
  state.aggregateMinor = aggregateMinor;
  for (const key of [
    'payoutRows',
    'payoutSaves',
    'snapshotFinds',
    'snapshotUpdateMany',
    'reservations',
    'historyRows',
    'notifications',
    'cycleDistinctFilters',
    'payoutFinds',
    'withdrawalFinds',
    'legacyPayouts',
    'legacyWithdrawals'
  ]) state[key].length = 0;
  state.sessions = 0;
};

const currentSnapshot = () => ({
  _id: currentSnapshotId,
  user: creatorId,
  payoutCycle: currentCycleId,
  amountMinor: 24995,
  amount: 249.95,
  currency: 'INR',
  held: false,
  disbursementReservedAt: null,
  disbursementId: null
});

const sourceSnapshots = () => {
  const current = currentSnapshot();
  const priorMinor = state.aggregateMinor - current.amountMinor;
  return [
    {
      _id: priorSnapshotId,
      user: creatorId,
      payoutCycle: priorCycleId,
      amountMinor: priorMinor,
      amount: priorMinor / 100,
      currency: 'INR',
      held: false,
      disbursementReservedAt: null,
      disbursementId: null
    },
    current
  ];
};

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

const cycle = () => ({
  _id: currentCycleId,
  cycleLabel: previousMonthLabel(),
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: new Date('2026-06-30T23:59:59.999Z'),
  status: 'closing',
  minimumPayoutThreshold: 500,
  earningsFinalizedAt: new Date('2026-07-01T00:05:00.000Z'),
  payoutExecutedAt: null
});

const PayoutCycle = {
  async findOneAndUpdate(filter, update) {
    if (filter.cycleLabel) {
      return { ...cycle(), closeLeaseKey: update.$set.closeLeaseKey, closeLeaseExpiresAt: update.$set.closeLeaseExpiresAt };
    }
    if (update.$set?.status === 'closed') return { ...cycle(), status: 'closed', payoutExecutedAt: update.$set.payoutExecutedAt };
    return cycle();
  },
  async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; },
  findOne() { return query(cycle()); },
  distinct(field, filter) {
    assert.equal(field, '_id');
    state.cycleDistinctFilters.push(filter);
    return query([priorCycleId, currentCycleId]);
  }
};

const User = {
  distinct() { return query([creatorId]); },
  exists() { return query({ _id: creatorId }); },
  find() { return query([]); }
};

const EarningsSnapshot = {
  distinct(field, filter) {
    assert.equal(field, 'user');
    state.snapshotFinds.push(filter);
    return query([creatorId]);
  },
  find(filter) {
    state.snapshotFinds.push(filter);
    if (filter.payoutCycle && typeof filter.payoutCycle === 'object' && Array.isArray(filter.payoutCycle.$in)) {
      return query(sourceSnapshots());
    }
    return query([currentSnapshot()]);
  },
  findOne() { return query(currentSnapshot()); },
  async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; },
  async updateMany(filter, update, options) {
    state.snapshotUpdateMany.push({ filter, update, options });
    return { matchedCount: sourceSnapshots().length, modifiedCount: sourceSnapshots().length };
  }
};

class CreatorPayout {
  constructor(data) {
    Object.assign(this, data);
    this._id = payoutId;
    state.payoutRows.push(this);
  }

  async save() {
    state.payoutSaves.push(this);
    return this;
  }

  toObject() {
    return { ...this };
  }

  static findOne() { return query(null); }
  static findById() { return query(null); }
  static find(filter) {
    state.payoutFinds.push(filter);
    const excludedStatuses = filter.status?.$nin || [];
    return query(state.legacyPayouts.filter((row) => !excludedStatuses.includes(row.status)));
  }
  static distinct() { return query([]); }
}

const CreatorPayoutHistory = {
  exists() { return query(false); },
  async create(rows) {
    state.historyRows.push(...rows);
    return rows;
  }
};

const CreatorDisbursementReservation = {
  distinct() { return query([]); },
  findOne() { return query(null); },
  async create(rows) {
    state.reservations.push(...rows);
    return rows;
  }
};

const WithdrawalRequest = {
  distinct() { return query([]); },
  find(filter) {
    state.withdrawalFinds.push(filter);
    const excludedStatuses = filter.status?.$nin || [];
    return query(state.legacyWithdrawals.filter((row) => !excludedStatuses.includes(row.status)));
  },
  findOne() { return query(null); },
  exists() { return query(false); }
};

const mocks = {
  '../models/Post': { find() { return query([]); } },
  '../models/User': User,
  '../models/EarningsSnapshot': EarningsSnapshot,
  '../models/PayoutCycle': PayoutCycle,
  '../models/CreatorPayout': CreatorPayout,
  '../models/CreatorPayoutHistory': CreatorPayoutHistory,
  '../models/WithdrawalRequest': WithdrawalRequest,
  '../models/CreatorDisbursementReservation': CreatorDisbursementReservation,
  '../models/PostEngagement': { async aggregate() { return []; } },
  './postEngagementAnalytics': { buildUniquePostViewPipeline() { return []; } },
  '../utils/financialTransactions': {
    FINANCIAL_TRANSACTION_OPTIONS: { readPreference: 'primary' },
    async startFinancialSession() {
      state.sessions += 1;
      return {
        async withTransaction(work) { return work(); },
        async endSession() {}
      };
    }
  },
  '../utils/notificationService': {
    async createSystemNotification(...args) {
      state.notifications.push(args);
      return { success: true };
    }
  },
  '../utils/notificationChannelPolicy': { EMAIL_INTENTS: { PAYMENT_TRANSACTIONAL: 'payment_transactional' } },
  '../utils/logger': { error() {} }
};

for (const [request, exports] of Object.entries(mocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

delete require.cache[require.resolve('./CreatorEarningsCalculationService')];
const { closePreviousCycleAndCreatePayouts } = require('./CreatorEarningsCalculationService');

const assertFinalizedCycleFilter = (filter) => {
  assert.ok(filter.endDate?.$lte, 'carry-forward must not include a future cycle');
  assert.ok(Array.isArray(filter.$or), 'cycle eligibility must be explicit');
  assert.ok(
    filter.$or.some((branch) => branch.status?.$in?.includes('closed') && branch.status?.$in?.includes('paid')),
    'prior source cycles must be finalized as closed/paid'
  );
  assert.ok(
    filter.$or.some((branch) => String(branch._id) === currentCycleId && branch.earningsFinalizedAt?.$ne === null),
    'the current closing cycle must have finalized earnings'
  );
};

const run = async () => {
  reset(50000);
  const result = await closePreviousCycleAndCreatePayouts();
  assert.equal(result.done, true);
  assert.equal(result.payoutsCreated, 1);
  assert.equal(state.payoutRows.length, 1, 'one aggregate payout must be constructed');
  assert.equal(state.payoutSaves.length, 1, 'one aggregate payout must be persisted');
  assert.equal(state.payoutRows[0].amountMinor, 50000, 'minor units must be the aggregation source of truth');
  assert.equal(state.payoutRows[0].amount, 500);
  assert.deepEqual(state.payoutRows[0].sourceSnapshots, [priorSnapshotId, currentSnapshotId]);
  assert.equal(result.sourceSnapshotsClaimed, 2);

  assert.equal(state.cycleDistinctFilters.length, 1);
  assertFinalizedCycleFilter(state.cycleDistinctFilters[0]);
  const sourceQuery = state.snapshotFinds.find((filter) => Array.isArray(filter.payoutCycle?.$in));
  assert.ok(sourceQuery, 'source snapshots must be queried across finalized cycles');
  assert.deepEqual(sourceQuery.held, { $ne: true });
  assert.equal(sourceQuery.disbursementReservedAt, null);
  assert.equal(sourceQuery.disbursementId, null);
  assert.deepEqual(sourceQuery.amount, { $gt: 0 });

  assert.equal(state.snapshotUpdateMany.length, 1, 'all source snapshots must be claimed atomically');
  assert.deepEqual(state.snapshotUpdateMany[0].filter._id.$in, [priorSnapshotId, currentSnapshotId]);
  assert.equal(state.snapshotUpdateMany[0].update.$set.disbursementId, payoutId);
  assert.equal(state.snapshotUpdateMany[0].update.$set.disbursementSource, 'creator_payout');

  assert.equal(state.reservations.length, 1, 'only one cross-collection reservation must be created');
  assert.equal(state.reservations[0].payoutCycle, currentCycleId, 'reservation belongs to the closing cycle');
  assert.equal(state.reservations[0].sourceId, payoutId);

  assert.equal(state.historyRows.length, 1, 'payout generation must append immutable history');
  assert.deepEqual(state.historyRows[0].metadata.sourceSnapshotIds, [priorSnapshotId, currentSnapshotId]);
  assert.equal(state.historyRows[0].amountMinor, 50000);

  reset(49999);
  const belowThreshold = await closePreviousCycleAndCreatePayouts();
  assert.equal(belowThreshold.done, true);
  assert.equal(belowThreshold.payoutsCreated, 0);
  assert.equal(state.payoutRows.length, 0, 'sub-threshold aggregate must not create a payout');
  assert.equal(state.snapshotUpdateMany.length, 0, 'sub-threshold aggregate must remain unclaimed');
  assert.equal(state.reservations.length, 0, 'sub-threshold aggregate must not create a reservation');
  assert.equal(state.historyRows.length, 0, 'sub-threshold aggregate must not create payout history');
  assert.equal(state.notifications.length, 0, 'sub-threshold aggregate must not notify payout generation');

  reset(50000);
  state.legacyPayouts.push({ payoutCycle: priorCycleId, status: 'paid' });
  const priorPaid = await closePreviousCycleAndCreatePayouts();
  assert.equal(priorPaid.done, true);
  assert.equal(priorPaid.payoutsCreated, 0, 'a prior paid liability must not be paid again');
  assert.equal(state.payoutRows.length, 0);
  assert.equal(state.snapshotUpdateMany.length, 0, 'legacy-paid snapshots must remain excluded from a new claim');
  assert.deepEqual(state.payoutFinds[0].status, { $nin: ['failed', 'rejected', 'cancelled'] });

  reset(50000);
  state.legacyWithdrawals.push({ payoutCycle: priorCycleId, status: 'completed' });
  const priorWithdrawal = await closePreviousCycleAndCreatePayouts();
  assert.equal(priorWithdrawal.done, true);
  assert.equal(priorWithdrawal.payoutsCreated, 0, 'a completed legacy withdrawal must not be paid again');
  assert.equal(state.payoutRows.length, 0);
  assert.equal(state.snapshotUpdateMany.length, 0);
  assert.deepEqual(state.withdrawalFinds[0].status, { $nin: ['failed', 'rejected', 'cancelled'] });

  reset(50000);
  state.legacyPayouts.push(
    { payoutCycle: priorCycleId, status: 'failed' },
    { payoutCycle: priorCycleId, status: 'rejected' }
  );
  state.legacyWithdrawals.push({ payoutCycle: priorCycleId, status: 'cancelled' });
  const releasedAttempts = await closePreviousCycleAndCreatePayouts();
  assert.equal(releasedAttempts.done, true);
  assert.equal(releasedAttempts.payoutsCreated, 1, 'released terminal attempts must not suppress carry-forward earnings');
  assert.equal(state.payoutRows[0].amountMinor, 50000);
  assert.deepEqual(state.payoutRows[0].sourceSnapshots, [priorSnapshotId, currentSnapshotId]);
  assert.deepEqual(state.snapshotUpdateMany[0].filter._id.$in, [priorSnapshotId, currentSnapshotId]);

  console.log('Creator earnings automatic carry-forward payout regression tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
