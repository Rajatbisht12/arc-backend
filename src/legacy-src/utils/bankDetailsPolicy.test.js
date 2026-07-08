const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeAndValidateBankDetails,
  normalizeAccountNumber
} = require('./bankDetailsPolicy');
const {
  redactBankHistorySnapshot,
  historySnapshotNeedsRedaction
} = require('./bankDetailsRedaction');

const validIndian = {
  accountHolderName: 'Test Creator',
  bankName: 'Test Bank',
  accountNumber: '1234 5678 9012',
  accountNumberConfirm: '123456789012',
  country: 'in',
  ifsc: 'test0123456',
  branch: 'Main Branch',
  upiId: 'creator@testbank'
};

const indianResult = normalizeAndValidateBankDetails(validIndian);
assert.strictEqual(indianResult.valid, true, JSON.stringify(indianResult.errors));
assert.strictEqual(indianResult.value.accountNumber, '123456789012');
assert.strictEqual(indianResult.value.ifsc, 'TEST0123456');

const mismatch = normalizeAndValidateBankDetails({ ...validIndian, accountNumberConfirm: '000000000000' });
assert.strictEqual(mismatch.valid, false);
assert(mismatch.errors.some((entry) => entry.field === 'accountNumberConfirm'));

const missingConfirmation = normalizeAndValidateBankDetails({ ...validIndian, accountNumberConfirm: '' });
assert.strictEqual(missingConfirmation.valid, false);
assert(missingConfirmation.errors.some((entry) => entry.field === 'accountNumberConfirm'));

const international = normalizeAndValidateBankDetails({
  ...validIndian,
  country: 'GB',
  accountNumber: 'GB82 WEST 1234 5698 7654 32',
  accountNumberConfirm: 'GB82WEST12345698765432',
  ifsc: '',
  swiftCode: 'DEUTGB2L'
});
assert.strictEqual(international.valid, true, JSON.stringify(international.errors));

const invalidStructuredInput = normalizeAndValidateBankDetails({
  accountHolderName: { $gt: '' },
  bankName: ['bad'],
  accountNumber: { value: '123' },
  accountNumberConfirm: null,
  country: 'INDIA'
});
assert.strictEqual(invalidStructuredInput.valid, false);
assert.strictEqual(normalizeAccountNumber('AB-12 34'), 'AB1234');

const invalidOptional = normalizeAndValidateBankDetails({
  ...validIndian,
  upiId: 'not-upi',
  paypalEmail: 'not-email',
  gstNumber: 'INVALID'
});
assert.strictEqual(invalidOptional.valid, false);
assert(invalidOptional.errors.some((entry) => entry.field === 'upiId'));
assert(invalidOptional.errors.some((entry) => entry.field === 'paypalEmail'));
assert(invalidOptional.errors.some((entry) => entry.field === 'gstNumber'));

const unsafeHistory = {
  previous: {
    accountNumber: '123456789012',
    taxId: 'ABCDE1234F',
    nested: {
      upiId: 'creator@testbank',
      paypalEmail: 'creator@example.com',
      accountNumberEncrypted: 'ciphertext-must-not-leak',
      internalNotes: 'private reviewer note'
    }
  },
  next: { gstNumber: '22ABCDE1234F1Z5' }
};
assert.strictEqual(historySnapshotNeedsRedaction(unsafeHistory), true);
const safeHistory = {
  previous: redactBankHistorySnapshot(unsafeHistory.previous),
  next: redactBankHistorySnapshot(unsafeHistory.next)
};
const safeHistoryJson = JSON.stringify(safeHistory);
assert(!safeHistoryJson.includes('123456789012'));
assert(!safeHistoryJson.includes('ABCDE1234F'));
assert(!safeHistoryJson.includes('creator@testbank'));
assert(!safeHistoryJson.includes('creator@example.com'));
assert(!safeHistoryJson.includes('ciphertext-must-not-leak'));
assert(!safeHistoryJson.includes('private reviewer note'));
assert.strictEqual(historySnapshotNeedsRedaction(safeHistory), false);

const backendRoot = path.resolve(__dirname, '../../..');
const controller = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/controllers/monetizationController.js'), 'utf8');
const routes = fs.readFileSync(path.join(backendRoot, 'src/modules/admin/admin.routes.ts'), 'utf8');
const monetizationRoutes = fs.readFileSync(path.join(backendRoot, 'src/modules/monetization/monetization.routes.ts'), 'utf8');
const adminController = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/controllers/adminBankDetailsController.js'), 'utf8');
const updateNotesSource = adminController.slice(adminController.indexOf('const updateNotes'), adminController.indexOf('const getHistory'));
const payoutAdminController = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/controllers/adminController.js'), 'utf8');
const authController = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/controllers/authController.js'), 'utf8');
const earningsService = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/services/CreatorEarningsCalculationService.js'), 'utf8');
const bankModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/CreatorBankDetails.js'), 'utf8');
const payoutModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/CreatorPayout.js'), 'utf8');
const withdrawalModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/WithdrawalRequest.js'), 'utf8');
const historyModel = fs.readFileSync(path.join(backendRoot, 'src/legacy-src/models/CreatorBankDetailsHistory.js'), 'utf8');
const migration = fs.readFileSync(path.join(backendRoot, 'scripts/migrate-bank-details.js'), 'utf8');
const preflight = fs.readFileSync(path.join(backendRoot, 'scripts/preflight-push-release.js'), 'utf8');
const deploy = fs.readFileSync(path.join(backendRoot, 'deploy.sh'), 'utf8');
const configVerifier = fs.readFileSync(path.join(backendRoot, 'scripts/verify-bank-details-config.js'), 'utf8');
const adminAuth = fs.readFileSync(path.join(backendRoot, 'src/modules/admin/admin-auth.middleware.ts'), 'utf8');
const adminLogin = fs.readFileSync(path.join(backendRoot, 'src/modules/admin/admin-login.routes.ts'), 'utf8');
const envConfig = fs.readFileSync(path.join(backendRoot, 'src/config/env.ts'), 'utf8');
const { hasPermission } = require('../middleware/adminAuth');
assert(controller.includes('normalizeAndValidateBankDetails'));
assert(controller.includes('$unset'));
assert(controller.includes("runValidators: true"));
assert(routes.includes('/monetization/bank-details/:id/verification'));
assert(routes.includes('/monetization/bank-details/:id/reveal'));
assert(routes.includes('requireAdminPermission("bank_details:read"), adminBankDetailsController.listBankDetails'));
assert(routes.includes('requireAdminPermission("bank_details:read"), adminBankDetailsController.getHistory'));
assert(routes.includes('requireAdminPermission("bank_details:read"), adminBankDetailsController.getBankDetails'));
assert(routes.includes('requireAdminPermission("bank_details:read"), requireAdminPermission("financial_reports:export"), adminBankDetailsController.exportCsv'));
assert(routes.includes('requireAdminPermission("bank_details:read"), requireAdminPermission("financial_reports:export"), adminBankDetailsController.exportExcel'));
assert(routes.includes('/monetization/payout-hold/:userId/release'));
assert(routes.includes('durableMutationAudit("SUSPEND_MONETIZATION")'));
assert(adminController.includes('REVEAL_CREATOR_BANK_DETAILS_SENSITIVE'));
assert(adminController.includes('spreadsheetSafe'));
assert(!/\{\s*\$facet\s*:/.test(adminController));
assert(adminController.includes("Cache-Control', 'private, no-store"));
assert(adminController.includes('activeWithdrawalLocks'));
assert(adminController.includes('redactBankHistorySnapshot'));
assert(adminController.includes("hashSensitiveValue(accountNumber, 'account-number')"));
assert(adminController.includes("+accountNumberEncrypted +accountNumberHash +internalNotes"));
assert(adminController.includes('expectedInternalNotesVersion'));
assert(adminController.includes('$inc: { internalNotesVersion: 1 }'));
assert(
  adminController.indexOf("status === 'verified' && !isVerifiableBankDestination(previous)") <
    adminController.indexOf("previous.verificationStatus === status"),
  'verification integrity must be checked before accepting an idempotent verified status'
);
assert(!updateNotesSource.includes('$inc: { version: 1 }'));
assert(controller.includes('expectedVersion'));
assert(controller.includes('...versionFilter'));
assert(adminController.includes('isVerifiableBankDestination'));
assert(adminController.includes('BANK_DETAILS_NOT_VERIFIABLE'));
assert(controller.includes("creatorMonetizationStatus !== 'approved'"));
assert(controller.includes("status: { $in: ['pending', 'approved', 'processing'] }"));
assert(controller.includes("code: 'PAYOUT_ON_HOLD'"));
assert(controller.includes('knownStatuses.has(explicitStatus)'));
assert(controller.includes('disbursementReservedAt: new Date()'));
assert(monetizationRoutes.includes('router.delete("/bank-details/tax-id"'));
assert(bankModel.includes('activeWithdrawalLocks'));
assert(/user:\s*\{[\s\S]*?immutable:\s*true[\s\S]*?unique:\s*true/.test(bankModel));
assert(bankModel.includes("internalNotes: {"));
assert(/internalNotes:\s*\{[\s\S]*?select:\s*false[\s\S]*?\}/.test(bankModel));
assert(payoutModel.includes('bankDetailsSnapshot'));
assert(withdrawalModel.includes('bankDetailsSnapshot'));
assert(historyModel.includes('legacy_sensitive_data_redacted'));
assert(payoutAdminController.includes('legacy_destination_unavailable'));
assert(payoutAdminController.includes('WITHDRAWAL_BANK_RESERVATION_REQUIRED'));
assert(payoutAdminController.includes('releaseCreatorPayoutHold'));
assert(payoutAdminController.includes('ACTIVE_WITHDRAWAL_REQUIRES_RESOLUTION'));
assert(payoutAdminController.includes('BANK_REFERENCE_REQUIRED'));
assert(payoutAdminController.includes('disbursementReviewedAt'));
assert(authController.includes('ACTIVE_CREATOR_PAYOUT'));
assert(earningsService.includes("creatorMonetizationStatus: 'approved'"));
assert(earningsService.includes('const currentSnapshot = await EarningsSnapshot.findOne'));
assert(earningsService.includes('disbursementReservedAt: null'));
assert(earningsService.includes('$setOnInsert'));
assert(!earningsService.includes('held: false,\n        calculatedAt'));
assert(migration.includes("readPreference: 'primary'"));
assert(migration.includes('transactionProbe'));
assert(migration.includes('scanFinancialBindings'));
assert(migration.includes('scanBankHistory'));
assert(migration.includes('applyBankHistoryRedaction'));
assert(migration.includes('legacyCiphertexts'));
assert(migration.includes('isAuthenticatedCiphertext'));
assert(migration.includes('PayoutCycle.createIndexes()'));
assert(migration.includes('EarningsSnapshot.createIndexes()'));
assert(migration.includes('activeWithdrawalLocks'));
assert(migration.includes('missingSnapshotClaims'));
assert(migration.includes('orphanSnapshotClaims'));
assert(migration.includes('missingActiveEarningsSnapshots'));
assert(migration.includes('scanCreatorStatusConsistency'));
assert(migration.includes('creatorMonetizationStatus: { $nin: CREATOR_STATUSES }'));
assert(!migration.includes('deleteMany({ _id: { $in: orphanIds } })'));
assert(preflight.indexOf("run('migrate-bank-details.js');") < preflight.indexOf("run('migrate-bank-details.js', ['--apply']);"));
assert(preflight.includes("process.argv.includes('--audit-only')"));
assert(preflight.includes("process.argv.includes('--verify-only')"));
assert(deploy.includes('ALLOW_FINANCIAL_MAINTENANCE_WINDOW'));
assert(deploy.includes('BANK_DETAILS_SCHEMA_VERSION'));
assert(deploy.includes('MUTATING_PREFLIGHT_STARTED'));
assert(deploy.includes('RECOVER_FINANCIAL_CUTOVER'));
assert(deploy.includes('RECOVERY_DESIRED_COUNT'));
assert(deploy.includes('RESTORE_DESIRED_COUNT'));
assert(deploy.includes('Registered task definition failed the bank-schema/image verification gate.'));
assert(deploy.includes('TARGET_BANK_SCHEMA_VERSION="3"'));
assert(deploy.includes('run_preflight verify'));
assert(deploy.includes('Recovery failed; the service will remain at zero and legacy tasks will not be restarted.'));
assert(deploy.includes('npm run test:bank-details'));
assert(configVerifier.includes('PLACEHOLDER') || configVerifier.includes('placeholder'));
assert(configVerifier.includes('activeKey'));
assert(configVerifier.includes('ADMIN_JWT_SECRET'));
assert(configVerifier.includes('BANK_DETAILS_ENCRYPTION_KEY must be different from JWT_SECRET'));
assert(configVerifier.includes('BANK_DETAILS_ENCRYPTION_KEY must be different from ADMIN_JWT_SECRET'));
assert(envConfig.includes('ADMIN_JWT_SECRET'));
assert(adminAuth.includes('env.ADMIN_JWT_SECRET'));
assert(adminAuth.includes('issuer: "squadhunt-admin"'));
assert(adminAuth.includes('audience: "squadhunt-admin-panel"'));
assert(adminLogin.includes('tokenUse: "admin"'));
assert(!adminLogin.includes('env.JWT_SECRET'));
assert.strictEqual(hasPermission({ adminRole: 'admin' }, 'bank_details:read'), true);
assert.strictEqual(hasPermission({ adminRole: 'finance' }, 'bank_details:read'), true);
assert.strictEqual(hasPermission({ adminRole: 'creator_manager' }, 'bank_details:read'), false);
assert.strictEqual(hasPermission({ adminRole: 'creator_manager' }, 'financial_reports:export'), false);
assert.strictEqual(hasPermission({ adminRole: 'super_admin' }, 'bank_details:read'), true);
assert.strictEqual(hasPermission({ adminRole: 'super_admin' }, 'financial_reports:export'), true);
assert(deploy.includes('CONFIRM_FINANCIAL_SCHEDULES_PAUSED'));
assert(deploy.includes('application-autoscaling'));

console.log('Bank details validation and security contracts passed');
