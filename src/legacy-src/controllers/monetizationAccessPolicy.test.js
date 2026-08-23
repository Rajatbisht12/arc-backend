const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const state = { user: null, eligibility: null, eligibilityCalls: 0 };

const query = (value) => {
  const chain = {
    select() { return chain; },
    lean: async () => value
  };
  return chain;
};

const mocks = {
  '../models/User': { findById() { return query(state.user); } },
  '../models/MonetizationEligibility': {},
  '../models/MonetizationApplication': {},
  '../models/CreatorBankDetails': {},
  '../models/CreatorBankDetailsHistory': {},
  '../models/CreatorPayout': {},
  '../models/PayoutCycle': {},
  '../models/Post': {},
  '../models/WithdrawalRequest': {},
  '../models/CreatorDisbursementReservation': {},
  '../models/MonetizationApplicationTimeline': {},
  '../services/MonetizationEligibilityEngine': {
    async getOrComputeEligibility() {
      state.eligibilityCalls += 1;
      return state.eligibility;
    }
  },
  '../services/CreatorEarningsCalculationService': {},
  '../utils/logger': { error() {} },
  '../utils/internalErrorResponse': {
    sendInternalError({ res, publicMessage }) {
      return res.status(500).json({ success: false, message: publicMessage });
    }
  },
  '../utils/bankDetailsPolicy': {
    normalizeAndValidateBankDetails() { return { valid: true, value: {} }; },
    firstValidationMessage() { return ''; }
  },
  '../utils/financialTransactions': {
    FINANCIAL_TRANSACTION_OPTIONS: {},
    async startFinancialSession() { throw new Error('not used'); },
    maskedBankSnapshot() { return {}; }
  }
};

for (const [request, exports] of Object.entries(mocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

delete require.cache[require.resolve('./monetizationController')];
const { assertApprovedCreator } = require('./monetizationController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

async function run() {
  let nextCalls = 0;
  state.user = { isCreator: true, creatorMonetizationStatus: 'approved' };
  state.eligibility = { isEligible: false };
  state.eligibilityCalls = 0;
  const approvedResponse = response();
  await assertApprovedCreator({ user: { _id: 'approved' } }, approvedResponse, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(state.eligibilityCalls, 0, 'approved creators should not need eligibility recomputation');

  state.user = { isCreator: false, creatorMonetizationStatus: 'not_eligible' };
  state.eligibility = { isEligible: false };
  const ineligibleResponse = response();
  await assertApprovedCreator({ user: { _id: 'ineligible' } }, ineligibleResponse, () => { nextCalls += 1; });
  assert.equal(ineligibleResponse.statusCode, 403);
  assert.equal(ineligibleResponse.body.code, 'CREATOR_NOT_ELIGIBLE');

  state.user = { isCreator: false, creatorMonetizationStatus: 'pending' };
  state.eligibility = { isEligible: true };
  const pendingResponse = response();
  await assertApprovedCreator({ user: { _id: 'pending' } }, pendingResponse, () => { nextCalls += 1; });
  assert.equal(pendingResponse.statusCode, 403);
  assert.equal(pendingResponse.body.code, 'CREATOR_NOT_APPROVED');
  assert.equal(nextCalls, 1);

  const root = path.resolve(__dirname, '../../..');
  const modularRoutes = fs.readFileSync(path.join(root, 'src/modules/monetization/monetization.routes.ts'), 'utf8');
  for (const route of ['/bank-details', '/payout-history', '/dashboard']) {
    const line = modularRoutes.split('\n').find(value => value.includes(`\"${route}\"`));
    assert(line?.includes('assertApprovedCreator'), `${route} must be approval-gated`);
  }
  const controller = fs.readFileSync(path.join(root, 'src/legacy-src/controllers/monetizationController.js'), 'utf8');
  assert(controller.includes("code: 'CREATOR_NOT_ELIGIBLE'"));
  assert(controller.includes('allRequirementsCompleted'));
  const applicationModel = fs.readFileSync(path.join(root, 'src/legacy-src/models/MonetizationApplication.js'), 'utf8');
  assert(applicationModel.includes('uniq_pending_monetization_application_per_user'));
  const migration = fs.readFileSync(path.join(root, 'scripts/migrate-monetization-admin.js'), 'utf8');
  assert(migration.includes("modelPath('MonetizationApplication')"));
  assert(migration.includes('ProfileVisitDaily, MonetizationApplication'));
}

run()
  .then(() => console.log('Creator monetization access policy tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
