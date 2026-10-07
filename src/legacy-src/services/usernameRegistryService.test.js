const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const UsernameRegistry = require('../models/UsernameRegistry');
const { checkUsername } = require('./usernameRegistryService');
const reservations = require('../controllers/usernameReservationController');
const { checkUsernameAvailability } = require('../controllers/authController');
const { requireAdminPermission } = require('../middleware/adminAuth');

let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  await UsernameRegistry.createCollection();
  await UsernameRegistry.createIndexes();
  await User.collection.createIndex({ email: 1 }, { unique: true });
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

const userData = (username, userType = 'player') => ({
  username, email: `${username.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'password123', userType, profile: { displayName: username }
});
const response = () => ({
  statusCode: 200, body: null, locals: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('reservation blocks case variants for players, teams, OAuth-style save, and availability', async () => {
  const res = response();
  await reservations.reserve({ body: { username: 'TestName', reason: 'Test' }, user: { username: 'admin' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.reservation.normalizedUsername, 'testname');
  for (const username of ['testname', 'TESTNAME']) {
    assert.equal((await checkUsername(username)).code, 'USERNAME_RESERVED');
    const availability = response();
    await checkUsernameAvailability({ query: { username } }, availability);
    assert.equal(availability.body.available, false);
    assert.equal(availability.body.reason, 'reserved');
    await assert.rejects(User.create(userData(username)), { code: 'USERNAME_RESERVED' });
  }
  await assert.rejects(User.create(userData('TeStNaMe', 'team')), { code: 'USERNAME_RESERVED' });
  const oauthUser = await User.create(userData('oauth_temp'));
  oauthUser.username = 'TESTNAME';
  await assert.rejects(oauthUser.save(), { code: 'USERNAME_RESERVED' });
  assert.equal((await User.findById(oauthUser._id).lean()).username, 'oauth_temp');
  const team = await User.create(userData('team_source', 'team'));
  await assert.rejects(User.findByIdAndUpdate(team._id, { username: 'testname' }, { new: true, runValidators: true }), { code: 'USERNAME_RESERVED' });
  assert.equal((await User.findById(team._id).lean()).username, 'team_source');
  const duplicate = response();
  await reservations.reserve({ body: { username: 'testname' }, user: { username: 'admin' } }, duplicate);
  assert.equal(duplicate.statusCode, 409);
  const removed = response();
  await reservations.remove({ params: { id: res.body.reservation._id } }, removed);
  assert.equal(removed.statusCode, 200);
  assert.equal((await checkUsername('testname')).available, true);
});

test('existing accounts cannot be stolen and protected system username stays reserved', async () => {
  const user = await User.create(userData('zoro'));
  const res = response();
  await reservations.reserve({ body: { username: 'ZORO' }, user: { username: 'admin' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'USERNAME_IN_USE');
  assert.equal((await User.findById(user._id).lean()).username, 'zoro');
  assert.equal((await checkUsername('SquadHunt')).code, 'USERNAME_RESERVED');
  await assert.rejects(User.create(userData('squadhunt')), /reserved system username/);
  await assert.rejects(User.create(userData('ZORO')), { code: 'USERNAME_TAKEN' });
  await assert.rejects(User.updateOne({ _id: user._id }, { $set: { username: 'unprotected' } }), /protected username update path/);
});

test('a rename and reservation compete for one normalized key', async () => {
  const user = await User.create(userData('rename_source'));
  const reservation = response();
  const [rename] = await Promise.allSettled([
    User.findByIdAndUpdate(user._id, { username: 'race_name' }, { new: true, runValidators: true }),
    reservations.reserve({ body: { username: 'RACE_NAME' }, user: { username: 'admin' } }, reservation)
  ]);
  const winnerUser = await User.findById(user._id).lean();
  const registry = await UsernameRegistry.findOne({ normalizedUsername: 'race_name' }).lean();
  assert.ok(registry);
  assert.notEqual(winnerUser.username === 'race_name', reservation.statusCode === 201);
  if (winnerUser.username === 'race_name') {
    assert.equal(registry.kind, 'user');
    assert.equal(reservation.statusCode, 409);
    assert.equal(rename.status, 'fulfilled');
  } else {
    assert.equal(registry.kind, 'reservation');
    assert.equal(reservation.statusCode, 201);
    assert.equal(rename.status, 'rejected');
  }
});

test('reservation management permission rejects a normal user', () => {
  const res = response();
  let admitted = false;
  requireAdminPermission('users:manage')({ user: { userType: 'player', username: 'normal' } }, res, () => { admitted = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(admitted, false);
});

test('a failed user insert does not strand its username claim', async () => {
  const first = await User.create(userData('email_owner'));
  const second = userData('failed_claim');
  second.email = first.email;
  await assert.rejects(User.create(second), { code: 11000 });
  assert.equal(await UsernameRegistry.countDocuments({ normalizedUsername: 'failed_claim' }), 0);
});

test('hard deletion releases a user claim; soft deletion keeps it', async () => {
  const hardDeleted = await User.create(userData('hard_deleted_name'));
  assert.equal(await UsernameRegistry.countDocuments({ normalizedUsername: 'hard_deleted_name', kind: 'user' }), 1);
  await User.deleteOne({ _id: hardDeleted._id });
  assert.equal(await UsernameRegistry.countDocuments({ normalizedUsername: 'hard_deleted_name' }), 0);
  const reserveAfterHardDelete = response();
  await reservations.reserve({ body: { username: 'hard_deleted_name' }, user: { username: 'admin' } }, reserveAfterHardDelete);
  assert.equal(reserveAfterHardDelete.statusCode, 201);

  const softDeleted = await User.create(userData('soft_deleted_name'));
  await User.updateOne({ _id: softDeleted._id }, { $set: { isActive: false, deletedAt: new Date() } });
  const reserveAfterSoftDelete = response();
  await reservations.reserve({ body: { username: 'soft_deleted_name' }, user: { username: 'admin' } }, reserveAfterSoftDelete);
  assert.equal(reserveAfterSoftDelete.statusCode, 409);
  assert.equal(reserveAfterSoftDelete.body.code, 'USERNAME_IN_USE');
});

test('admin reservation safely recovers an old orphan claim from legacy hard deletion', async () => {
  const oldUser = await User.create(userData('legacy_deleted_name'));
  // Simulate the old admin controller, which deleted User without its claim.
  await User.collection.deleteOne({ _id: oldUser._id });
  await UsernameRegistry.collection.updateOne(
    { normalizedUsername: 'legacy_deleted_name' },
    { $set: { createdAt: new Date(Date.now() - 120_000) } }
  );
  const res = response();
  await reservations.reserve({ body: { username: 'legacy_deleted_name' }, user: { username: 'admin' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.recoveredOrphanClaim, true);
  assert.equal((await UsernameRegistry.findOne({ normalizedUsername: 'legacy_deleted_name' }).lean()).kind, 'reservation');

  const recentUser = await User.create(userData('recent_deleted_name'));
  await User.collection.deleteOne({ _id: recentUser._id });
  const recent = response();
  await reservations.reserve({ body: { username: 'recent_deleted_name' }, user: { username: 'admin' } }, recent);
  assert.equal(recent.statusCode, 409);
  assert.equal(recent.body.code, 'USERNAME_CLAIM_PENDING');
});
