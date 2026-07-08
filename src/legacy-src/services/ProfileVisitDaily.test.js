const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewerId = '507f1f77bcf86cd799439501';
const ownerId = '507f1f77bcf86cd799439502';

const ProfileVisitDaily = require('../models/ProfileVisitDaily');
const indexes = ProfileVisitDaily.schema.indexes();
const hasIndex = (keys, options = {}) => indexes.some(([candidateKeys, candidateOptions]) => (
  JSON.stringify(candidateKeys) === JSON.stringify(keys) &&
  Object.entries(options).every(([key, value]) => candidateOptions[key] === value)
));

assert.ok(hasIndex(
  { profileOwner: 1, viewer: 1, day: 1 },
  { unique: true }
), 'profile visits must dedupe one viewer/profile/day');
assert.ok(hasIndex(
  { profileOwner: 1, day: -1 }
), 'profile owner date-range aggregation must be indexed');
assert.ok(hasIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
), 'profile visit retention must be bounded by TTL');
assert.equal(ProfileVisitDaily.schema.options.strict, 'throw');
assert.equal(ProfileVisitDaily.PROFILE_VISIT_RETENTION_DAYS, 400);
for (const forbiddenPath of ['ip', 'ipAddress', 'userAgent', 'device', 'location', 'metadata', 'requestPath']) {
  assert.equal(ProfileVisitDaily.schema.path(forbiddenPath), undefined, `privacy-sensitive ${forbiddenPath} must not be stored`);
}

const writes = [];
let mode = 'insert';
const ProfileVisitDailyMock = {
  PROFILE_VISIT_RETENTION_DAYS: 400,
  async updateOne(filter, update, options) {
    writes.push({ filter, update, options });
    if (mode === 'duplicate') {
      const error = new Error('simulated concurrent daily unique race');
      error.code = 11000;
      throw error;
    }
    if (mode === 'dedupe') return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: 'daily-visit' };
  }
};

const modelPath = require.resolve('../models/ProfileVisitDaily');
require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: ProfileVisitDailyMock };
delete require.cache[require.resolve('./profileVisitService')];
const { RETENTION_DAYS, recordSuccessfulProfileVisit, utcDayStart } = require('./profileVisitService');

const run = async () => {
  assert.equal(RETENTION_DAYS, 400);
  assert.equal(utcDayStart('2026-07-08T23:59:59.999+05:30').toISOString(), '2026-07-08T00:00:00.000Z');
  assert.equal(utcDayStart('not-a-date'), null);

  assert.deepEqual(
    await recordSuccessfulProfileVisit({ viewerId, profileOwnerId: viewerId }),
    { recorded: false, reason: 'self_view' }
  );
  assert.deepEqual(
    await recordSuccessfulProfileVisit({ viewerId: 'guest-installation', profileOwnerId: ownerId }),
    { recorded: false, reason: 'invalid_identity' }
  );
  assert.equal(writes.length, 0, 'self and non-account viewers must never create analytics rows');

  mode = 'insert';
  const first = await recordSuccessfulProfileVisit({
    viewerId,
    profileOwnerId: ownerId,
    now: new Date('2026-07-08T01:00:00.000Z'),
    ip: '203.0.113.1',
    userAgent: 'must-not-be-stored'
  });
  assert.equal(first.recorded, true);
  assert.equal(first.deduped, false);

  mode = 'dedupe';
  const repeat = await recordSuccessfulProfileVisit({
    viewerId,
    profileOwnerId: ownerId,
    now: new Date('2026-07-08T23:59:59.999Z')
  });
  assert.equal(repeat.recorded, false);
  assert.equal(repeat.deduped, true);
  assert.deepEqual(writes[0].filter, writes[1].filter, 'same UTC day must address the same unique visit row');
  assert.equal(writes[0].filter.day.toISOString(), '2026-07-08T00:00:00.000Z');
  assert.equal(
    writes[0].update.$setOnInsert.expiresAt.getTime() - writes[0].filter.day.getTime(),
    400 * 24 * 60 * 60 * 1000
  );
  assert.deepEqual(Object.keys(writes[0].update.$setOnInsert), ['expiresAt']);
  assert.equal(JSON.stringify(writes[0]).includes('203.0.113.1'), false);
  assert.equal(JSON.stringify(writes[0]).includes('must-not-be-stored'), false);
  assert.deepEqual(writes[0].options, { upsert: true, setDefaultsOnInsert: true, runValidators: true });

  mode = 'insert';
  await recordSuccessfulProfileVisit({
    viewerId,
    profileOwnerId: ownerId,
    now: new Date('2026-07-09T00:00:00.000Z')
  });
  assert.notEqual(writes[2].filter.day.getTime(), writes[1].filter.day.getTime(), 'a new UTC day creates a new dedupe bucket');

  mode = 'duplicate';
  const concurrentLoser = await recordSuccessfulProfileVisit({
    viewerId,
    profileOwnerId: ownerId,
    now: new Date('2026-07-10T00:00:00.000Z')
  });
  assert.equal(concurrentLoser.recorded, false);
  assert.equal(concurrentLoser.deduped, true, 'duplicate-key loser must be treated as an already-recorded visit');

  const backendRoot = path.resolve(__dirname, '../../..');
  const readSource = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
  const userController = readSource('src/legacy-src/controllers/userController.js');
  const adminController = readSource('src/legacy-src/controllers/adminMonetizationController.js');
  const migration = readSource('scripts/migrate-monetization-admin.js');
  const getUserStart = userController.indexOf('const getUser = async');
  const getUserEnd = userController.indexOf('const invalidateFollowCaches', getUserStart);
  const getUserSource = userController.slice(getUserStart, getUserEnd);
  const restrictedReturn = getUserSource.indexOf('return res.status(200).json(restrictedResponse)');
  const fullResponse = getUserSource.indexOf('const responseData =');
  const analyticsWrite = getUserSource.indexOf('await recordSuccessfulProfileVisit({');
  assert.ok(restrictedReturn >= 0 && fullResponse > restrictedReturn && analyticsWrite > fullResponse, 'only full successful profile responses may be counted');
  assert.ok(getUserSource.includes('requestingUserId && !isGuest && !isSelf && !isBlockedByMe'));
  assert.ok(getUserSource.includes('viewerId: req.user._id'));
  assert.ok(getUserSource.includes('profileOwnerId: user._id'));
  assert.equal(getUserSource.includes('ip: req.ip'), false);
  assert.equal(getUserSource.includes("req.get('user-agent')"), false);
  assert.ok(getUserSource.includes(".catch((visitError) =>"), 'analytics failure must not fail a profile request');

  assert.ok(adminController.includes("const ProfileVisitDaily = require('../models/ProfileVisitDaily')"));
  assert.ok(adminController.includes('ProfileVisitDaily.countDocuments({ profileOwner: objectId, day: profileVisitRange(start, end) })'));
  assert.ok(adminController.includes('profileVisitRetentionDays: ProfileVisitDaily.PROFILE_VISIT_RETENTION_DAYS'));
  assert.ok(adminController.includes('trackingAvailability: {\n      profileVisits: true'));
  assert.ok(adminController.includes("date: '$day'"), 'charts must group daily visit buckets without exposing viewer identities');
  assert.equal(adminController.includes("from: 'profilevisitdailies'"), false, 'profile visit APIs must not join or expose viewer records');

  assert.ok(migration.includes("const ProfileVisitDaily = require(modelPath('ProfileVisitDaily'))"));
  assert.ok(migration.includes('profileVisitDailyIdentity'));
  assert.ok(migration.includes('profileVisitAnalytics'));
  assert.ok(migration.includes('profileVisitRetentionTtl'));
  assert.ok(migration.includes('BoostDeliveryAttribution, ProfileVisitDaily'));

  console.log('Privacy-safe daily profile visit source and admin analytics tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
