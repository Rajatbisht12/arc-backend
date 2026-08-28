// Test matrix for the creator-earning eligibility fix:
//  - Active Days requirement is 45 (not 25): 0/10/44/45 + "historical > window" cases.
//  - Organic Clip Views are summed over the rolling 45-day window, boosted excluded.
// Uses the same lightweight model-mocking approach as the sibling engine test and
// exercises the REAL calculateEligibility, so the assertions cover production math.
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const User = require('../models/User');
const Follow = require('../models/Follow');
const Post = require('../models/Post');
const Story = require('../models/Story');
const Report = require('../models/Report');
const PostEngagement = require('../models/PostEngagement');
const CreatorDailyActivity = require('../models/CreatorDailyActivity');
const engine = require('./MonetizationEligibilityEngine');

const originals = {
  userFindById: User.findById,
  followerCount: Follow.getFollowerCount,
  postFind: Post.find,
  postAggregate: Post.aggregate,
  storyFind: Story.find,
  storyAggregate: Story.aggregate,
  reportCount: Report.countDocuments,
  engagementAggregate: PostEngagement.aggregate,
  dailyUpsert: CreatorDailyActivity.findOneAndUpdate
};

class ProjectionQuery {
  constructor(resolveValue) { this.resolveValue = resolveValue; this.projection = ''; }
  select(projection) { this.projection = projection; return this; }
  async lean() { return this.resolveValue(this.projection); }
}

// Generate `count` distinct contiguous UTC day strings starting 2026-06-01.
function windowDays(count) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date('2026-06-01T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Run the real engine with configurable active-day and per-clip view inputs.
// `activeDays` is the number of distinct days the (already 45-day-windowed)
// engagement aggregation returns; `organicPerClip`/`boostPerClip` are the
// per-clip windowed view counts the pipeline returns for each source.
async function computeWith({ activeDays = 0, clipCount = 5, organicPerClip = 20000, boostPerClip = 0 }) {
  const userId = new mongoose.Types.ObjectId();
  const clipIds = Array.from({ length: clipCount }, () => new mongoose.Types.ObjectId());
  const clips = clipIds.map((_id, i) => ({ _id, content: { text: `clip ${i}` }, createdAt: new Date('2026-06-01T12:00:00.000Z') }));
  const days = windowDays(activeDays);
  // Uploaded-post day: reuse the first windowed day when there is activity so it
  // does not inflate the distinct-day set; none when activeDays === 0.
  const uploadedPostDays = activeDays > 0 ? [{ createdAt: new Date(`${days[0]}T09:00:00.000Z`) }] : [];

  try {
    User.findById = () => new ProjectionQuery(() => ({
      _id: userId, userType: 'player', role: 'player', followers: [],
      membership: { tier: 'player_pro', validUntil: new Date('2026-12-31T23:59:59.999Z') },
      createdAt: new Date('2025-01-01T00:00:00.000Z')
    }));
    Follow.getFollowerCount = async () => 1000;
    Post.find = () => new ProjectionQuery((projection) => {
      if (projection === '_id') return clipIds.map((_id) => ({ _id }));
      if (projection === 'createdAt') return uploadedPostDays; // uploaded posts in window
      return clips; // video clip query (content.text createdAt)
    });
    Post.aggregate = async () => [];
    Story.find = () => new ProjectionQuery(() => []);
    Story.aggregate = async () => [];
    Report.countDocuments = async () => 0;
    CreatorDailyActivity.findOneAndUpdate = async () => null;
    PostEngagement.aggregate = async (pipeline) => {
      const sourceStage = pipeline.find((stage) => stage.$match && stage.$match.source);
      if (sourceStage && sourceStage.$match.source === 'organic') return clipIds.map((_id) => ({ _id, views: organicPerClip }));
      if (sourceStage && sourceStage.$match.source === 'boost') return clipIds.map((_id) => ({ _id, views: boostPerClip }));
      const eventTypes = (pipeline[0] && pipeline[0].$match && pipeline[0].$match.eventType && pipeline[0].$match.eventType.$in) || [];
      if (eventTypes.includes('view')) return days.map((_id) => ({ _id }));
      return [];
    };
    return await engine.calculateEligibility(userId);
  } finally {
    Object.assign(User, { findById: originals.userFindById });
    Follow.getFollowerCount = originals.followerCount;
    Post.find = originals.postFind;
    Post.aggregate = originals.postAggregate;
    Story.find = originals.storyFind;
    Story.aggregate = originals.storyAggregate;
    Report.countDocuments = originals.reportCount;
    PostEngagement.aggregate = originals.engagementAggregate;
    CreatorDailyActivity.findOneAndUpdate = originals.dailyUpsert;
  }
}

const activeReq = (r) => r.requirements.find((x) => x.condition === 'min_active_days_45d');
const viewsReq = (r) => r.requirements.find((x) => x.condition === 'min_total_clip_views_45d');

test('the active-days requirement is 45, not 25', () => {
  assert.equal(engine.THRESHOLDS.minActiveDays45d, 45);
});

test('active days 0 → 0/45, not met, 0% progress', async () => {
  const req = activeReq(await computeWith({ activeDays: 0 }));
  assert.equal(req.current, 0);
  assert.equal(req.required, 45);
  assert.equal(req.isMet, false);
  assert.equal(req.progressPercent, 0);
  assert.equal(Math.max(0, req.required - req.current), 45); // remaining
});

test('active days 10 → 10/45, not met, 35 remaining', async () => {
  const req = activeReq(await computeWith({ activeDays: 10 }));
  assert.equal(req.current, 10);
  assert.equal(req.required, 45);
  assert.equal(req.isMet, false);
  assert.equal(req.required - req.current, 35);
});

test('active days 44 → 44/45, not met, 1 remaining', async () => {
  const req = activeReq(await computeWith({ activeDays: 44 }));
  assert.equal(req.current, 44);
  assert.equal(req.required, 45);
  assert.equal(req.isMet, false);
  assert.equal(req.required - req.current, 1);
});

test('active days 45 → 45/45, criterion complete', async () => {
  const req = activeReq(await computeWith({ activeDays: 45 }));
  assert.equal(req.current, 45);
  assert.equal(req.required, 45);
  assert.equal(req.isMet, true);
  assert.equal(req.progressPercent, 100);
});

test('46 historical but only 30 inside the 45-day window → 30/45', async () => {
  // The engine trusts the windowed aggregation; only in-window days are returned.
  const req = activeReq(await computeWith({ activeDays: 30 }));
  assert.equal(req.current, 30);
  assert.equal(req.required, 45);
  assert.equal(req.isMet, false);
});

test('organic views: exactly 100,000 in window → complete (boosted ignored)', async () => {
  // 5 clips × 20,000 organic = 100,000; plus 5 × 999,999 boosted that must NOT count.
  const result = await computeWith({ activeDays: 45, organicPerClip: 20000, boostPerClip: 999999 });
  const req = viewsReq(result);
  assert.equal(req.current, 100000);
  assert.equal(req.required, 100000);
  assert.equal(req.isMet, true);
  assert.equal(result.metrics.totalBoostedClipViews45d, 5 * 999999, 'boosted counted separately, never in the organic total');
});

test('90,000 organic + 20,000 boosted in window → count = 90,000, not complete', async () => {
  // 5 clips × 18,000 organic = 90,000 organic; boosted excluded.
  const req = viewsReq(await computeWith({ activeDays: 45, organicPerClip: 18000, boostPerClip: 4000 }));
  assert.equal(req.current, 90000);
  assert.equal(req.isMet, false);
});

test('150,000 organic all-time but only 70,000 inside the window → not complete', async () => {
  // The pipeline is windowed by sinceDate, so it returns only the in-window 70,000.
  const req = viewsReq(await computeWith({ activeDays: 45, organicPerClip: 14000, boostPerClip: 0 }));
  assert.equal(req.current, 70000);
  assert.equal(req.isMet, false);
});
