const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(path.join(__dirname, 'adminController.js'), 'utf8');
const timelineModel = require('../models/MonetizationApplicationTimeline');

const extract = (start, end) => {
  const startIndex = controller.indexOf(start);
  const endIndex = controller.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing boundary ${end}`);
  return controller.slice(startIndex, endIndex);
};

const helperSource = extract(
  'const recordMonetizationTimeline = async',
  'const csvEscape ='
);
const revokeSource = extract(
  'const revokeMonetization = async',
  '// Task 5.3: Grant creator monetization'
);
const grantSource = extract(
  'const grantMonetization = async',
  '// Task 5.4: Set and get per-creator CPM'
);
const cpmSource = extract(
  'const setCreatorCpm = async',
  'const getCreatorCpm = async'
);
const suspendSource = extract(
  'const suspendMonetization = async',
  'const resumeMonetization = async'
);
const resumeSource = extract(
  'const resumeMonetization = async',
  'const disableMonetization = revokeMonetization'
);

const lifecycleFunctions = [
  ['revoke', revokeSource],
  ['grant', grantSource],
  ['suspend', suspendSource],
  ['resume', resumeSource],
  ['CPM', cpmSource]
];

for (const [name, source] of lifecycleFunctions) {
  assert.ok(source.includes('session = await startFinancialSession()'), `${name} must start a financial session`);
  assert.ok(source.includes('await session.withTransaction(async () => {'), `${name} must use a transaction`);
  assert.ok(source.includes('}, FINANCIAL_TRANSACTION_OPTIONS)'), `${name} must use financial transaction options`);
  assert.ok(source.includes('await user.save({ session })'), `${name} user mutation must share the transaction session`);
  assert.ok(source.includes('await application.save({ session })'), `${name} application mutation must share the transaction session`);
  assert.ok(source.includes('recordMonetizationTimeline({'), `${name} must append lifecycle history`);
  assert.ok(source.includes('session\n'), `${name} timeline call must carry the same session`);
  assert.ok(source.includes('if (session) await session.endSession()'), `${name} must always release its session`);

  const transactionCommit = source.indexOf('}, FINANCIAL_TRANSACTION_OPTIONS)');
  const cacheInvalidation = source.indexOf('await invalidateUserCache(userId)');
  assert.ok(cacheInvalidation > transactionCommit, `${name} cache invalidation must happen only after transaction commit`);
}

for (const [name, source] of [
  ['revoke', revokeSource],
  ['grant', grantSource],
  ['suspend', suspendSource],
  ['resume', resumeSource]
]) {
  assert.ok(source.includes("userType: 'player'"), `${name} must reject team accounts`);
  assert.ok(source.includes('isActive: true'), `${name} must reject inactive/deleted accounts`);
  assert.ok(source.includes('.session(session)'), `${name} user lookup must be transaction-bound`);
  assert.ok(source.includes('getOrCreateLatestMonetizationApplication({'), `${name} must update/create the latest application`);
  assert.ok(source.includes('session\n'), `${name} application helper must receive the transaction session`);
}

assert.ok(helperSource.includes("MonetizationApplication.findOne({ user: userId })"));
assert.ok(helperSource.includes(".sort({ appliedAt: -1, _id: -1 })"), 'lifecycle mutations must target the latest application');
assert.ok(helperSource.includes('.session(session)'), 'latest application read must share the transaction session');
assert.ok(helperSource.includes('MonetizationApplication.create([{'));
assert.ok(helperSource.includes('}], { session })'), 'new application must be created in the transaction');
assert.ok(helperSource.includes('MonetizationApplicationTimeline.create([entry], { session })'), 'timeline row must be created in the transaction');

assert.ok(grantSource.includes("type: 'monetization_approved'"));
assert.ok(grantSource.includes("notificationEmail(EMAIL_INTENTS.ACCOUNT_LIFECYCLE, 'monetization_approved')"));
assert.ok(
  grantSource.includes('notificationDedupeKey: `monetization-approved:${String(application._id)}:${String(timelineEntry?._id'),
  'grant email/push must have a stable application+timeline dedupe key'
);
assert.equal(revokeSource.includes('notificationEmail('), false, 'revoke must remain in-app/push only');
assert.equal(suspendSource.includes('notificationEmail('), false, 'suspend must remain in-app/push only');
assert.equal(resumeSource.includes('notificationEmail('), false, 'resume must remain in-app/push only');
assert.ok(revokeSource.includes("type: 'monetization_revoked'"));
assert.ok(resumeSource.includes("type: 'monetization_reactivated'"));
assert.ok(suspendSource.includes('CreatorPayoutHistory.create(['), 'suspension must append immutable history for every affected payout');
assert.ok(suspendSource.includes("preHoldStatus: previousStatus"), 'suspension must preserve each payout state for explicit resume');
assert.ok(suspendSource.includes("creatorMonetizationStatus !== 'approved'"), 'only active approved monetization can be suspended');

assert.ok(controller.includes('const CREATOR_CPM_MIN = 0.01;'));
assert.ok(controller.includes('const CREATOR_CPM_MAX = 10000;'));
assert.ok(cpmSource.includes("typeof rawCpm !== 'number'"), 'numeric-looking strings must be rejected');
assert.ok(cpmSource.includes('!Number.isFinite(cpm)'), 'NaN and Infinity must be rejected');
assert.ok(cpmSource.includes('cpm < CREATOR_CPM_MIN'));
assert.ok(cpmSource.includes('cpm > CREATOR_CPM_MAX'));
assert.ok(cpmSource.includes('const normalizedCpm = Math.round(cpm * 100) / 100;'), 'CPM must be normalized to two decimals');
for (const fragment of [
  "userType: 'player'",
  'isActive: true',
  'isCreator: true',
  "creatorMonetizationStatus: 'approved'"
]) {
  assert.ok(cpmSource.includes(fragment), `CPM update lookup must include ${fragment}`);
}
assert.ok(cpmSource.includes("action: 'cpm_updated'"));
assert.ok(cpmSource.includes('oldValue: { creatorCpm: previousCpm'));
assert.ok(cpmSource.includes("newValue: { creatorCpm: normalizedCpm, applicationStatus: 'approved' }"));

const normalizeCpm = (rawCpm) => {
  const cpm = Number(rawCpm);
  if (typeof rawCpm !== 'number' || !Number.isFinite(cpm) || cpm < 0.01 || cpm > 10000) return null;
  return Math.round(cpm * 100) / 100;
};
for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, '50', 0, 0.009, 10000.01]) {
  assert.equal(normalizeCpm(invalid), null, `CPM ${String(invalid)} must be rejected`);
}
assert.equal(normalizeCpm(0.01), 0.01);
assert.equal(normalizeCpm(10000), 10000);
assert.equal(normalizeCpm(12.345), 12.35);

assert.ok(
  timelineModel.schema.path('action').enumValues.includes('cpm_updated'),
  'immutable application timeline must accept cpm_updated'
);

console.log('Admin creator lifecycle transaction, notification, and CPM contracts passed');
