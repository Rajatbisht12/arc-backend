const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SHARE_CODE_PATTERNS,
  SUPPORTED_LEGACY_SHARE_CODE_PATTERNS,
  safeRoleAbbreviation,
  generateRecruitmentCode,
  generatePlayerProfileCode,
  saveWithUniqueShareCode
} = require('../utils/recruitmentShareCode');
const {
  utcDayWindow,
  reservePlayerCardSlot,
  releasePlayerCardSlot,
  getPlayerCardDailyLimit
} = require('./recruitmentPostingQuota');
// Resolve executable scripts at runtime. A literal `require('../../../scripts')`
// makes TypeScript pull files outside tsconfig.rootDir into the program even
// though this is a JavaScript contract test, which breaks the production
// typecheck with TS6059.
const loadScript = (relativePath) => require(path.resolve(__dirname, relativePath));
const {
  basicLookup,
  invalidOwnerConditions
} = loadScript('../../../scripts/audit-recruitment-integrity.js');
const { inspectIndexes } = loadScript('../../../scripts/migrate-recruitment-indexes.js');

assert.strictEqual(safeRoleAbbreviation('A B'), 'ABG');
assert.strictEqual(safeRoleAbbreviation('///'), 'GEN');
assert.strictEqual(safeRoleAbbreviation('igl/coach'), 'IGL');
assert(SHARE_CODE_PATTERNS.recruitment.test(generateRecruitmentCode({ recruitmentType: 'roster', role: 'A B' })));
assert(SHARE_CODE_PATTERNS.profile.test(generatePlayerProfileCode({ profileType: 'staff-position', staffRole: 'Coach' })));
assert(SUPPORTED_LEGACY_SHARE_CODE_PATTERNS.recruitment.test('RST-QA-AB12CD34'));
assert(!SHARE_CODE_PATTERNS.recruitment.test('RST-QA-AB12CD34'), 'supported legacy links are informational, not canonical corruption');

const ownerLookup = basicLookup('users', 'team', '__owner');
assert.deepStrictEqual(ownerLookup, {
  $lookup: { from: 'users', localField: 'team', foreignField: '_id', as: '__owner' }
});
assert(!ownerLookup.$lookup.let && !ownerLookup.$lookup.pipeline, 'integrity joins must remain DocumentDB-compatible');
assert(invalidOwnerConditions('__owner', 'team').some((entry) => entry['__owner.userType']));

const makeQuotaModel = () => {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async findOne(query) {
      return rows.find((row) => String(row.player) === String(query.player) && row.dayKey === query.dayKey) || null;
    },
    async create(value) {
      if (rows.some((row) => String(row.player) === String(value.player) && row.dayKey === value.dayKey)) {
        const error = new Error('duplicate quota');
        error.code = 11000;
        throw error;
      }
      const row = { ...value, _id: `quota-${nextId++}` };
      rows.push(row);
      return row;
    },
    async findOneAndUpdate(query, update) {
      const row = rows.find((candidate) => candidate._id === query._id && candidate.count < query.count.$lt);
      if (!row) return null;
      row.count += update.$inc.count;
      return row;
    },
    async updateOne(query, update) {
      const row = rows.find((candidate) => candidate._id === query._id && candidate.count > query.count.$gt);
      if (!row) return { modifiedCount: 0 };
      row.count += update.$inc.count;
      return { modifiedCount: 1 };
    }
  };
};

const profileModel = { countDocuments: async () => 0 };

(async () => {
  const now = new Date('2026-07-09T23:59:30.000Z');
  const window = utcDayWindow(now);
  assert.strictEqual(window.dayKey, '2026-07-09');
  assert.strictEqual(window.resetsAt.toISOString(), '2026-07-10T00:00:00.000Z');

  const quotaModel = makeQuotaModel();
  const missingNamespace = new Error('namespace not found');
  missingNamespace.code = 26;
  const missingCollectionAudit = await inspectIndexes([{
    modelName: 'MissingQuotaCollection',
    collection: { indexes: async () => { throw missingNamespace; } },
    schema: { indexes: () => [[{ player: 1, dayKey: 1 }, { unique: true }]] }
  }]);
  assert.strictEqual(missingCollectionAudit.missingCollections.length, 1);
  assert.strictEqual(missingCollectionAudit.missing.length, 1);

  const reservations = await Promise.all([
    reservePlayerCardSlot({ playerId: 'player-1', now, quotaModel, profileModel }),
    reservePlayerCardSlot({ playerId: 'player-1', now, quotaModel, profileModel }),
    reservePlayerCardSlot({ playerId: 'player-1', now, quotaModel, profileModel })
  ]);
  assert.strictEqual(reservations.filter(Boolean).length, 2, 'only two concurrent reservations may succeed');
  assert.strictEqual(quotaModel.rows.length, 1, 'the unique player/day boundary must converge on one quota row');
  assert.strictEqual(quotaModel.rows[0].count, 2);
  const status = await getPlayerCardDailyLimit({ playerId: 'player-1', now, quotaModel, profileModel });
  assert.deepStrictEqual({ used: status.used, limit: status.limit }, { used: 2, limit: 2 });

  await releasePlayerCardSlot({ quotaId: quotaModel.rows[0]._id, quotaModel });
  assert.strictEqual(quotaModel.rows[0].count, 1, 'failed profile writes release their reservation');

  let saveAttempts = 0;
  const codes = ['RST-GEN-00000001', 'RST-GEN-00000002'];
  const fakeDocument = {
    async save() {
      saveAttempts += 1;
      if (saveAttempts === 1) {
        const error = new Error('duplicate recruitmentCode');
        error.code = 11000;
        error.keyPattern = { recruitmentCode: 1 };
        throw error;
      }
    }
  };
  await saveWithUniqueShareCode({
    document: fakeDocument,
    codeField: 'recruitmentCode',
    generateCode: () => codes.shift()
  });
  assert.strictEqual(fakeDocument.recruitmentCode, 'RST-GEN-00000002');
  assert.strictEqual(saveAttempts, 2, 'share-code collisions must retry without surfacing HTTP 500');

  const controllerSource = fs.readFileSync(path.resolve(__dirname, '../controllers/recruitmentController.js'), 'utf8');
  assert(controllerSource.includes("message: 'Invalid application ID'"));
  assert(controllerSource.includes('Recruitment application compensation failed'));
  assert(controllerSource.includes('Recruitment withdrawal compensation failed'));
  assert(controllerSource.includes('getCanonicalApplicantRecipientIds'));
  assert(controllerSource.includes('recruitmentCode: recruitment.recruitmentCode'));
  assert(!controllerSource.includes("Message.deleteMany({ sender: teamId, recipient: applicantId, 'inviteData.type': 'recruitment_result' })"));

  const auditSource = fs.readFileSync(path.resolve(__dirname, '../../../scripts/audit-recruitment-integrity.js'), 'utf8');
  assert(auditSource.includes('basicLookup'));
  assert(!/\$lookup\s*:\s*\{[^}]*\blet\s*:/s.test(auditSource), 'integrity audit must not use correlated lookups');
  assert(auditSource.includes('duplicateQuotaKeys'));
  assert(auditSource.includes('applicantStatusDivergence'));
  assert(auditSource.includes('embeddedApplicantsWithoutCanonical'));

  const migrationSource = fs.readFileSync(path.resolve(__dirname, '../../../scripts/migrate-recruitment-indexes.js'), 'utf8');
  assert(migrationSource.indexOf('repairDuplicateQuotas(duplicateQuotas)') < migrationSource.indexOf('createMissingIndexes(before.missing)'));

  console.log('Recruitment infrastructure contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
