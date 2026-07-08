const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../../..');
const controller = fs.readFileSync(path.join(__dirname, 'adminMonetizationController.js'), 'utf8');
const payoutService = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/services/CreatorPayoutAdminService.js'), 'utf8');
const routes = fs.readFileSync(path.join(backendRoot, 'src/modules/admin/admin.routes.ts'), 'utf8');
const payoutModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/CreatorPayout.js'), 'utf8');
const payoutHistoryModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/CreatorPayoutHistory.js'), 'utf8');
const migration = fs.readFileSync(path.join(backendRoot, 'scripts/migrate-monetization-admin.js'), 'utf8');

const requireRoute = (method, routePath, fragments) => {
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = routes.split('\n').find((candidate) => new RegExp(`router\\.${method}\\(\\s*["']${escapedPath}["']`).test(candidate));
  assert.ok(line, `${method.toUpperCase()} ${routePath} must be registered`);
  for (const fragment of fragments) {
    assert.ok(line.includes(fragment), `${method.toUpperCase()} ${routePath} must include ${fragment}`);
  }
  return line;
};

for (const [routePath, permission] of [
  ['/monetization/dashboard', 'monetization:read'],
  ['/monetization/charts', 'monetization:read'],
  ['/monetization/leaderboards', 'monetization:read'],
  ['/monetization/creators/:userId/overview', 'earnings:read'],
  ['/monetization/payouts/:id', 'transactions:read'],
  ['/monetization/payouts/:id/history', 'transactions:read'],
  ['/monetization/reports', 'monetization:read'],
  ['/monetization/reports/export', 'financial_reports:export']
]) {
  requireRoute('get', routePath, [`requireAdminPermission("${permission}")`]);
}

for (const [routePath, action, permission] of [
  ['/monetization/payouts/generate', 'GENERATE_CREATOR_PAYOUTS', 'payouts:manage'],
  ['/monetization/payouts/bulk/:action', 'BULK_CREATOR_PAYOUT_ACTION', 'payouts:manage'],
  ['/monetization/payouts/:id/statement', 'GENERATE_CREATOR_PAYOUT_STATEMENT', 'financial_reports:export'],
  ['/monetization/payouts/:id/paid', 'MARK_CREATOR_PAYOUT_PAID', 'payouts:manage'],
  ['/monetization/payouts/:id/failed', 'MARK_CREATOR_PAYOUT_FAILED', 'payouts:manage']
]) {
  requireRoute('post', routePath, [
    `auditLog("${action}")`,
    `requireAdminPermission("${permission}")`,
    `durableMutationAudit("${action}")`
  ]);
}

assert.ok(
  routes.indexOf('"/monetization/payouts/generate"') < routes.indexOf('"/monetization/payouts/:id"'),
  'static payout generation route must be registered before the dynamic payout detail route'
);
assert.ok(
  routes.indexOf('"/monetization/payouts/bulk/:action"') < routes.indexOf('"/monetization/payouts/:id"'),
  'bulk payout route must be registered before the dynamic payout detail route'
);

for (const requiredField of [
  'totalMonetizedCreators',
  'creatorsEligible',
  'creatorsPendingEligibility',
  'creatorsSuspended',
  'creatorsUnderReview',
  'creatorsPaidThisMonth',
  'creatorsAwaitingPayout',
  'totalRevenueGenerated',
  'totalEstimatedCreatorEarnings',
  'totalPaid',
  'pendingPayoutAmount',
  'currentMonthRevenue',
  'previousMonthRevenue',
  'platformRevenue',
  'creatorRevenue',
  'averageRpm',
  'averageCpm',
  'averageEngagementRate'
]) {
  assert.ok(controller.includes(requiredField), `dashboard response must expose ${requiredField}`);
}

for (const requiredManualPaymentField of [
  'transactionId',
  'referenceNumber',
  'paymentMethod',
  'notes',
  'paymentDate',
  'idempotencyKey'
]) {
  assert.ok(payoutService.includes(requiredManualPaymentField), `manual payout must process ${requiredManualPaymentField}`);
}

assert.ok(payoutService.includes('CreatorPayoutHistory.create'), 'every payout transition must append immutable history');
assert.ok(payoutService.includes('runValidators: true'), 'payout transition updates must run schema validation');
assert.ok(payoutService.includes('status: previousStatus'), 'payout transitions must use status compare-and-swap');
assert.ok(payoutService.includes('$inc: { version: 1 }'), 'payout transitions must advance their optimistic concurrency version');
assert.ok(payoutService.includes('mongoose.isValidObjectId'), 'admin financial IDs must be validated before Mongoose queries');
assert.ok(payoutService.includes('idempotentReplay: true'), 'mutation retries must return an idempotent replay response');

assert.ok(payoutModel.includes('transactionId'));
assert.ok(payoutModel.includes('paymentMethod'));
assert.ok(payoutModel.includes('paymentNotes'));
assert.ok(payoutModel.includes('paymentDate'));
assert.ok(payoutHistoryModel.includes('Creator payout history is immutable'));
assert.ok(payoutHistoryModel.includes("action: {"));

assert.ok(controller.includes('spreadsheetSafe'), 'monetization exports must neutralize spreadsheet formulas');
assert.ok(controller.includes('/^[=+\\-@\\t\\r]/'), 'spreadsheet-safe export handling must detect formula-like values');
for (const format of ['csv', 'xls', 'pdf']) {
  assert.ok(controller.includes(`'${format}'`) || controller.includes(`"${format}"`), `reports must support ${format}`);
}

assert.ok(controller.includes('organicViews'), 'analytics must expose organic views');
assert.ok(controller.includes('boostedViews'), 'analytics must expose boosted views separately');
assert.ok(controller.includes('eligibleViews'), 'analytics must expose monetization-eligible views');
assert.ok(controller.includes('heldEarnings'), 'creator financial overview must expose held earnings');
assert.ok(controller.includes('paidEarnings'), 'creator financial overview must expose paid earnings');
assert.ok(controller.includes('pendingEarnings'), 'creator financial overview must expose pending earnings');

for (const requiredFinancialGate of [
  'missingSourceSnapshots',
  'invalidSourceSnapshots',
  'orphanedDisbursementTargets',
  'reservationWithoutIdentity',
  'orphanedTargets',
  'withoutSnapshotClaim',
  'paidWithoutPaymentDate',
  'reservationUserCycle',
  'reservationSource'
]) {
  assert.ok(migration.includes(requiredFinancialGate), `production migration must verify ${requiredFinancialGate}`);
}

console.log('Admin monetization routes, RBAC, payout, analytics, and report contracts passed');
