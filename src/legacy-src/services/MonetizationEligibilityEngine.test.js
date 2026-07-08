const assert = require('node:assert/strict');
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
  constructor(resolveValue) {
    this.resolveValue = resolveValue;
    this.projection = '';
  }

  select(projection) {
    this.projection = projection;
    return this;
  }

  async lean() {
    return this.resolveValue(this.projection);
  }
}

async function run() {
  const userId = new mongoose.Types.ObjectId();
  const clipIds = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  const clips = clipIds.map((_id, index) => ({
    _id,
    content: { text: `Original creator clip ${index}` },
    createdAt: new Date('2026-06-25T12:00:00.000Z')
  }));
  let followerCountCalls = 0;
  let clipFilter = null;

  try {
    User.findById = (id) => {
      assert.equal(String(id), String(userId));
      return new ProjectionQuery(() => ({
        _id: userId,
        userType: 'player',
        role: 'player',
        // Deliberately stale. The canonical Follow collection must win.
        followers: [],
        membership: {
          tier: 'player_pro',
          validUntil: new Date('2026-12-31T23:59:59.999Z')
        },
        createdAt: new Date('2025-01-01T00:00:00.000Z')
      }));
    };

    Follow.getFollowerCount = async (id) => {
      followerCountCalls += 1;
      assert.equal(String(id), String(userId));
      return 1000;
    };

    Post.find = (filter) => {
      if (filter?.['content.media']) clipFilter = filter;
      return new ProjectionQuery((projection) => {
        if (projection === '_id') return clipIds.map((_id) => ({ _id }));
        if (projection === 'createdAt') {
          return [{ createdAt: new Date('2026-06-25T12:00:00.000Z') }];
        }
        return clips;
      });
    };
    Post.aggregate = async () => [];
    Story.find = () => new ProjectionQuery(() => []);
    Story.aggregate = async () => [];
    Report.countDocuments = async () => 0;
    CreatorDailyActivity.findOneAndUpdate = async () => null;

    PostEngagement.aggregate = async (pipeline) => {
      const sourceStage = pipeline.find((stage) => stage.$match?.source);
      if (sourceStage?.$match?.source === 'organic') {
        return clipIds.map((_id) => ({ _id, views: 20000 }));
      }
      if (sourceStage?.$match?.source === 'boost') {
        return clipIds.map((_id) => ({ _id, views: 999999 }));
      }
      const eventTypes = pipeline[0]?.$match?.eventType?.$in || [];
      if (eventTypes.includes('view')) {
        return Array.from({ length: 24 }, (_, index) => ({
          _id: `2026-06-${String(index + 1).padStart(2, '0')}`
        }));
      }
      return [];
    };

    const result = await engine.calculateEligibility(userId);
    assert.equal(followerCountCalls, 1, 'eligibility must read follower count from the canonical Follow collection');
    assert.equal(result.metrics.followersCount, 1000);
    assert.equal(result.metrics.totalOrganicClipViews45d, 100000);
    assert.equal(result.metrics.totalBoostedClipViews45d, 4999995);
    assert.equal(result.metrics.totalClipViews45d, 100000, 'the legacy total alias must remain organic-only');
    assert.equal(result.metrics.clipsWith3kOrganicViews45d, 5);
    assert.equal(result.metrics.activeDays45d, 25);
    assert.equal(result.isEligible, true, 'boosted views must not influence an otherwise exact threshold result');
    assert.equal(result.failedConditions.length, 0);

    assert.equal(clipFilter.isActive, true);
    assert.deepEqual(
      clipFilter.hiddenByAdmin,
      { $ne: true },
      'hidden clips must not count toward eligibility'
    );
  } finally {
    User.findById = originals.userFindById;
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

run()
  .then(() => console.log('Monetization eligibility source-of-truth regression tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
