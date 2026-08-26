// Real-DB proof of the authoritative monthly Recruitment quota core: seeding
// from current-month records (Phase 28), atomic reserve up to the tier limit,
// blocking beyond it, race-safety under concurrency (Phase 23), release/rollback,
// and calendar-month windowing/reset (Phase 3/21).
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RecruitmentMonthlyUsage = require('../models/RecruitmentMonthlyUsage');
const PlayerProfile = require('../models/PlayerProfile');
const User = require('../models/User');
const {
  monthWindow, ensureUsageDoc, reserveSlot, releaseSlot, readUsage,
  getPlayerRecruitmentEntitlements, getTeamRecruitmentEntitlements
} = require('./recruitmentUsage');
const { USAGE_TYPES, playerLimits, teamLimits } = require('../config/recruitmentLimits');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
test.after(async () => { await mongoose.disconnect(); await mongod.stop(); });
test.beforeEach(async () => {
  await RecruitmentMonthlyUsage.deleteMany({});
  await PlayerProfile.deleteMany({});
});

const oid = () => new mongoose.Types.ObjectId();

test('canonical config matches the product rules', () => {
  assert.equal(playerLimits('free').playerCardsPerMonth, 2);
  assert.equal(playerLimits('free').applicationsPerMonth, 5);
  assert.equal(playerLimits('premium').playerCardsPerMonth, 10);
  assert.equal(playerLimits('premium').applicationsPerMonth, 20);
  assert.equal(teamLimits('free').recruitmentsPerMonth, 7);
  assert.equal(teamLimits('premium').recruitmentsPerMonth, 30);
});

test('monthWindow is a UTC calendar month with next-month reset', () => {
  const w = monthWindow(new Date('2026-08-14T09:30:00Z'));
  assert.equal(w.monthKey, '2026-08');
  assert.equal(w.periodStart.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(w.resetAt.toISOString(), '2026-09-01T00:00:00.000Z');
  // December rolls to next year.
  assert.equal(monthWindow(new Date('2026-12-31T23:59:59Z')).resetAt.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('usage seeds from actual current-month records (Phase 28), ignoring other months', async () => {
  const owner = oid();
  const now = new Date('2026-08-15T00:00:00Z');
  // 2 player cards this month, 1 last month.
  await PlayerProfile.collection.insertMany([
    { player: owner, profileCode: 'SEED-A', createdAt: new Date('2026-08-02T00:00:00Z') },
    { player: owner, profileCode: 'SEED-B', createdAt: new Date('2026-08-10T00:00:00Z') },
    { player: owner, profileCode: 'SEED-C', createdAt: new Date('2026-07-20T00:00:00Z') },
  ]);
  const usage = await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now });
  assert.equal(usage.used, 2);
  assert.equal(usage.remaining, 0);
});

test('reserve advances usage up to the limit, then blocks (free player: 2)', async () => {
  const owner = oid();
  const now = new Date('2026-08-15T00:00:00Z');
  const seed = { [USAGE_TYPES.PLAYER_CARD]: async () => 0 }; // no prior records
  const r1 = await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  const r2 = await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  const r3 = await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  assert.ok(r1 && r2, 'first two reservations succeed');
  assert.equal(r3, null, 'third is blocked at 2/2');
  const usage = await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  assert.equal(usage.used, 2);
});

test('concurrent reservations can never exceed the quota (Phase 23 race-safety)', async () => {
  const owner = oid();
  const now = new Date('2026-08-15T00:00:00Z');
  const seed = { [USAGE_TYPES.APPLICATION]: async () => 4 }; // already 4/5
  // Two simultaneous "apply" requests race for the single remaining slot.
  const [a, b] = await Promise.all([
    reserveSlot({ owner, usageType: USAGE_TYPES.APPLICATION, limit: 5, now, seedCounters: seed }),
    reserveSlot({ owner, usageType: USAGE_TYPES.APPLICATION, limit: 5, now, seedCounters: seed }),
  ]);
  const succeeded = [a, b].filter(Boolean).length;
  assert.equal(succeeded, 1, 'exactly one of the two concurrent requests wins');
  const usage = await readUsage({ owner, usageType: USAGE_TYPES.APPLICATION, limit: 5, now, seedCounters: seed });
  assert.equal(usage.used, 5, 'final usage is 5, never 6');

  // Ten simultaneous reservations against a fresh 0/7 team quota → exactly 7.
  const team = oid();
  const teamSeed = { [USAGE_TYPES.TEAM_RECRUITMENT]: async () => 0 };
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    reserveSlot({ owner: team, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: 7, now, seedCounters: teamSeed })));
  assert.equal(results.filter(Boolean).length, 7, 'exactly 7 of 10 concurrent team creates succeed');
  const teamUsage = await readUsage({ owner: team, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: 7, now, seedCounters: teamSeed });
  assert.equal(teamUsage.used, 7);
});

test('release rolls a reserved slot back (create-failure rollback)', async () => {
  const owner = oid();
  const now = new Date('2026-08-15T00:00:00Z');
  const seed = { [USAGE_TYPES.PLAYER_CARD]: async () => 0 };
  const r = await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  await releaseSlot({ usageId: r.usageId });
  const usage = await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  assert.equal(usage.used, 0, 'slot returned to the pool');
});

test('a tier change mid-month keeps usage and re-evaluates the limit (Phase 20)', async () => {
  const owner = oid();
  const now = new Date('2026-08-15T00:00:00Z');
  const seed = { [USAGE_TYPES.PLAYER_CARD]: async () => 0 };
  // Free player exhausts 2/2.
  await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  assert.equal((await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed })).used, 2);
  // Upgrades to premium: used stays 2, limit becomes 10, remaining 8, can reserve again.
  const afterUpgrade = await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 10, now, seedCounters: seed });
  assert.equal(afterUpgrade.used, 2);
  assert.equal(afterUpgrade.remaining, 8);
  const r = await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 10, now, seedCounters: seed });
  assert.ok(r, 'premium can post again with the same monthly usage carried over');
  // Downgrade with used(3) > free limit(2): blocked until reset, no negative remaining.
  const afterDowngrade = await readUsage({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed });
  assert.equal(afterDowngrade.used, 3);
  assert.equal(afterDowngrade.remaining, 0);
  assert.equal(await reserveSlot({ owner, usageType: USAGE_TYPES.PLAYER_CARD, limit: 2, now, seedCounters: seed }), null);
});

test('entitlements endpoint composes tier + usage into the client-facing shape', async () => {
  await User.deleteMany({});
  // A free player with 1 player card + 3 applications already this month.
  const player = await User.create({
    username: 'freeplayer', email: 'freeplayer@example.com', password: 'x'.repeat(12),
    userType: 'player', isActive: true, profile: { displayName: 'Free Player' }
  });
  const now = new Date('2026-08-15T00:00:00Z');
  await PlayerProfile.collection.insertOne({ player: player._id, profileCode: 'PC-1', createdAt: now });
  const RecruitmentApplication = require('../models/RecruitmentApplication');
  await RecruitmentApplication.collection.insertMany([
    { applicant: player._id, createdAt: now }, { applicant: player._id, createdAt: now }, { applicant: player._id, createdAt: now },
  ]);

  const ent = await getPlayerRecruitmentEntitlements({ userId: player._id, now });
  assert.equal(ent.accountType, 'user');
  assert.equal(ent.tier, 'free');
  assert.equal(ent.period, 'monthly');
  assert.deepEqual(ent.playerCards, { used: 1, limit: 2, remaining: 1 });
  assert.deepEqual(ent.applications, { used: 3, limit: 5, remaining: 2 });
  assert.equal(ent.visibilityBoost, false);
  assert.equal(ent.resetAt.toISOString(), '2026-09-01T00:00:00.000Z');

  // A free team with no recruitments yet.
  const team = await User.create({
    username: 'freeteam', email: 'freeteam@example.com', password: 'x'.repeat(12),
    userType: 'team', isActive: true, profile: { displayName: 'Free Team' }
  });
  const teamEnt = await getTeamRecruitmentEntitlements({ teamId: team._id, now });
  assert.equal(teamEnt.accountType, 'team');
  assert.equal(teamEnt.tier, 'free');
  assert.deepEqual(teamEnt.recruitments, { used: 0, limit: 7, remaining: 7 });
  assert.equal(teamEnt.visibilityBoost, false);
});

test('a new calendar month starts fresh (Phase 21)', async () => {
  const owner = oid();
  const seed = { [USAGE_TYPES.TEAM_RECRUITMENT]: async () => 0 };
  const aug = new Date('2026-08-31T23:00:00Z');
  await reserveSlot({ owner, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: 7, now: aug, seedCounters: seed });
  assert.equal((await readUsage({ owner, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: 7, now: aug, seedCounters: seed })).used, 1);
  const sep = new Date('2026-09-01T00:30:00Z');
  const sepUsage = await readUsage({ owner, usageType: USAGE_TYPES.TEAM_RECRUITMENT, limit: 7, now: sep, seedCounters: seed });
  assert.equal(sepUsage.used, 0, 'September is a new monthKey → fresh quota');
});
