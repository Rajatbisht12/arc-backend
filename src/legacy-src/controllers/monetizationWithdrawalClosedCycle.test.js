const assert = require('node:assert/strict');

const userId = '507f1f77bcf86cd799439201';
const closedCycleId = '507f1f77bcf86cd799439202';
const openCycleId = '507f1f77bcf86cd799439203';
const snapshotId = '507f1f77bcf86cd799439204';
const withdrawalId = '507f1f77bcf86cd799439205';
const bankId = '507f1f77bcf86cd799439206';

const state = {
  mode: 'success',
  currentCycleCalls: 0,
  payoutCycleFinds: [],
  payoutCycleDistincts: [],
  snapshotFinds: [],
  snapshotExists: [],
  snapshotUpdates: [],
  withdrawalRows: [],
  withdrawalSaves: [],
  reservations: [],
  bankUpdates: [],
  sessions: 0
};

const reset = (mode) => {
  state.mode = mode;
  state.currentCycleCalls = 0;
  state.sessions = 0;
  for (const key of [
    'payoutCycleFinds',
    'payoutCycleDistincts',
    'snapshotFinds',
    'snapshotExists',
    'snapshotUpdates',
    'withdrawalRows',
    'withdrawalSaves',
    'reservations',
    'bankUpdates'
  ]) state[key].length = 0;
};

const query = (value) => {
  const chain = {
    select() { return chain; },
    sort() { return chain; },
    session() { return chain; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
  return chain;
};

const User = {
  findById() {
    return query({ _id: userId, isCreator: true, creatorMonetizationStatus: 'approved' });
  }
};

const bank = {
  _id: bankId,
  user: userId,
  accountHolderName: 'Creator Test',
  bankName: 'Test Bank',
  lastFourDigits: '1234',
  ifsc: 'TEST0000001',
  branch: 'Main',
  country: 'IN',
  version: 4
};

const CreatorBankDetails = {
  findOne() { return query(bank); },
  async updateOne(filter, update, options) {
    state.bankUpdates.push({ filter, update, options });
    return { matchedCount: 1, modifiedCount: 1 };
  },
  decryptAccountNumber() { return ''; }
};

const closedCycle = {
  _id: closedCycleId,
  cycleLabel: '2026-06',
  minimumPayoutThreshold: 500,
  endDate: new Date('2026-06-30T23:59:59.999Z'),
  status: 'closed'
};

const PayoutCycle = {
  find(filter) {
    state.payoutCycleFinds.push(filter);
    return query(state.mode === 'success' ? [closedCycle] : []);
  },
  distinct(field, filter) {
    state.payoutCycleDistincts.push({ field, filter });
    return query(state.mode === 'unfinished' ? [openCycleId] : []);
  }
};

const finalizedSnapshot = {
  _id: snapshotId,
  user: userId,
  payoutCycle: closedCycleId,
  amount: 600,
  amountMinor: 60000,
  held: false,
  disbursementReservedAt: null,
  disbursementId: null,
  calculatedAt: new Date('2026-07-01T00:00:00.000Z')
};

const EarningsSnapshot = {
  find(filter) {
    state.snapshotFinds.push(filter);
    return query(state.mode === 'success' ? [finalizedSnapshot] : []);
  },
  exists(filter) {
    state.snapshotExists.push(filter);
    return query(state.mode === 'unfinished' ? { _id: 'unfinished-snapshot' } : null);
  },
  async updateOne(filter, update, options) {
    state.snapshotUpdates.push({ filter, update, options });
    return { matchedCount: 1, modifiedCount: 1 };
  }
};

class WithdrawalRequest {
  constructor(data) {
    Object.assign(this, data);
    this._id = withdrawalId;
    state.withdrawalRows.push(this);
  }

  async save() {
    state.withdrawalSaves.push(this);
    return this;
  }

  static exists() { return query(false); }
}

const CreatorPayout = { exists() { return query(false); } };

const CreatorDisbursementReservation = {
  async create(rows) {
    state.reservations.push(...rows);
    return rows;
  }
};

const earningsService = {
  async getEstimatedEarningsForCreator() { return {}; },
  async getOrCreateCurrentCycle() {
    state.currentCycleCalls += 1;
    return { _id: openCycleId, status: 'open' };
  }
};

const noOpModel = {};
const mocks = {
  '../models/User': User,
  '../models/MonetizationEligibility': noOpModel,
  '../models/MonetizationApplication': noOpModel,
  '../models/CreatorBankDetails': CreatorBankDetails,
  '../models/CreatorBankDetailsHistory': noOpModel,
  '../models/CreatorPayout': CreatorPayout,
  '../models/PayoutCycle': PayoutCycle,
  '../models/Post': noOpModel,
  '../models/WithdrawalRequest': WithdrawalRequest,
  '../models/CreatorDisbursementReservation': CreatorDisbursementReservation,
  '../models/MonetizationApplicationTimeline': noOpModel,
  '../models/EarningsSnapshot': EarningsSnapshot,
  '../services/MonetizationEligibilityEngine': { async getOrComputeEligibility() { return null; } },
  '../services/CreatorEarningsCalculationService': earningsService,
  '../utils/logger': { error() {} },
  '../utils/internalErrorResponse': {
    sendInternalError({ res, publicMessage }) {
      return res.status(500).json({ success: false, message: publicMessage });
    }
  },
  '../utils/bankDetailsPolicy': {
    normalizeAndValidateBankDetails(value) { return { value, errors: [] }; },
    firstValidationMessage() { return ''; }
  },
  '../utils/financialTransactions': {
    FINANCIAL_TRANSACTION_OPTIONS: { readPreference: 'primary' },
    async startFinancialSession() {
      state.sessions += 1;
      return {
        async withTransaction(work) { return work(); },
        async endSession() {}
      };
    },
    maskedBankSnapshot(value) {
      return {
        accountHolderName: value.accountHolderName,
        bankName: value.bankName,
        lastFourDigits: value.lastFourDigits,
        ifsc: value.ifsc,
        version: value.version
      };
    }
  }
};

for (const [request, exports] of Object.entries(mocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

delete require.cache[require.resolve('./monetizationController')];
const { submitWithdrawalRequest } = require('./monetizationController');

const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; }
});

const request = () => ({ user: { _id: userId } });

const run = async () => {
  reset('success');
  const successResponse = response();
  await submitWithdrawalRequest(request(), successResponse);

  assert.equal(successResponse.statusCode, 201);
  assert.equal(successResponse.body.success, true);
  assert.equal(state.currentCycleCalls, 0, 'withdrawal submission must not create/read the current open cycle');
  assert.equal(state.payoutCycleFinds.length, 1);
  assert.deepEqual(state.payoutCycleFinds[0], { status: { $in: ['closed', 'paid'] } });
  assert.equal(state.payoutCycleFinds[0].status.$in.includes('open'), false);
  assert.equal(state.payoutCycleFinds[0].status.$in.includes('closing'), false);

  assert.equal(state.snapshotFinds.length, 1);
  assert.deepEqual(state.snapshotFinds[0].payoutCycle, { $in: [closedCycleId] });
  assert.equal(state.snapshotFinds[0].disbursementReservedAt, null);
  assert.equal(state.snapshotFinds[0].disbursementId, null);
  assert.deepEqual(state.snapshotFinds[0].amount, { $gt: 0 });

  assert.equal(state.withdrawalRows.length, 1);
  assert.equal(state.withdrawalRows[0].payoutCycle, closedCycleId);
  assert.equal(state.withdrawalRows[0].amount, 600);
  assert.equal(state.withdrawalSaves.length, 1);

  assert.equal(state.snapshotUpdates.length, 1);
  assert.equal(state.snapshotUpdates[0].filter._id, snapshotId);
  assert.equal(state.snapshotUpdates[0].filter.payoutCycle, closedCycleId);
  assert.deepEqual(state.snapshotUpdates[0].filter.held, { $ne: true });
  assert.equal(state.snapshotUpdates[0].filter.disbursementReservedAt, null);
  assert.equal(state.snapshotUpdates[0].filter.disbursementId, null);
  assert.equal(state.snapshotUpdates[0].update.$set.disbursementSource, 'withdrawal');
  assert.equal(state.snapshotUpdates[0].update.$set.disbursementId, withdrawalId);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.reservations[0].payoutCycle, closedCycleId);
  assert.equal(state.reservations[0].sourceId, withdrawalId);

  reset('unfinished');
  const unfinishedResponse = response();
  await submitWithdrawalRequest(request(), unfinishedResponse);

  assert.equal(unfinishedResponse.statusCode, 409);
  assert.equal(unfinishedResponse.body.success, false);
  assert.equal(unfinishedResponse.body.code, 'EARNINGS_CYCLE_NOT_FINALIZED');
  assert.equal(state.currentCycleCalls, 0, 'unfinished earnings check must not call getOrCreateCurrentCycle');
  assert.equal(state.payoutCycleDistincts.length, 1);
  assert.deepEqual(state.payoutCycleDistincts[0].filter, { status: { $in: ['open', 'closing'] } });
  assert.equal(state.snapshotExists.length, 1);
  assert.deepEqual(state.snapshotExists[0].payoutCycle, { $in: [openCycleId] });
  assert.equal(state.snapshotUpdates.length, 0, 'open-cycle earnings must never be claimed');
  assert.equal(state.withdrawalRows.length, 0, 'open-cycle earnings must not create a withdrawal');
  assert.equal(state.reservations.length, 0, 'open-cycle earnings must not create a disbursement reservation');
  assert.equal(state.bankUpdates.length, 0, 'open-cycle earnings must not lock bank details');

  console.log('Creator withdrawal finalized-cycle isolation regression tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
