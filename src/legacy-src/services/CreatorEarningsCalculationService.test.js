const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const Post = require('../models/Post');
const PostEngagement = require('../models/PostEngagement');
const service = require('./CreatorEarningsCalculationService');

const originalUserFindById = User.findById;
const originalPostFind = Post.find;
const originalAggregate = PostEngagement.aggregate;

const queryReturning = (value) => ({
  select() { return this; },
  lean: async () => value
});

async function run() {
  const userId = new mongoose.Types.ObjectId();
  const postA = new mongoose.Types.ObjectId();
  const postB = new mongoose.Types.ObjectId();
  const cycle = {
    _id: new mongoose.Types.ObjectId(),
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-30T23:59:59.999Z')
  };
  let capturedPostFilter = null;
  let capturedPipeline = null;

  try {
    User.findById = (id) => {
      assert.equal(String(id), String(userId));
      return queryReturning({ creatorCpm: 80 });
    };
    Post.find = (filter) => {
      capturedPostFilter = filter;
      return queryReturning([{ _id: postA }, { _id: postB }]);
    };
    PostEngagement.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [{ _id: null, views: 6172 }];
    };

    const result = await service.calculateCreatorEarnings(userId, cycle);
    assert.equal(result.amount, 493.76, 'earnings must use the creator CPM and round to paise');
    assert.equal(result.inputs.totalClipViews, 6172);
    assert.equal(result.inputs.totalOrganicClipViews, 6172);
    assert.equal(result.inputs.totalBoostedClipViews || 0, 0);
    assert.equal(result.inputs.cpm, 80);

    assert.equal(capturedPostFilter.author, userId);
    assert.equal(capturedPostFilter.isActive, true);
    assert.deepEqual(
      capturedPostFilter.hiddenByAdmin,
      { $ne: true },
      'admin-hidden clips must not generate creator earnings'
    );
    assert.deepEqual(capturedPostFilter['content.media'], { $elemMatch: { type: 'video' } });

    assert.ok(
      capturedPipeline.some((stage) => stage.$match?.source === 'organic'),
      'only organic unique views may contribute to creator earnings'
    );
    assert.ok(
      !capturedPipeline.some((stage) => stage.$match?.source === 'boost'),
      'boost-attributed views must never enter the earnings pipeline'
    );
    const firstMatch = capturedPipeline.find((stage) => stage.$match?.eventType === 'view')?.$match;
    assert.deepEqual(firstMatch.createdAt, { $gte: cycle.startDate, $lte: cycle.endDate });
    assert.deepEqual(firstMatch.post.$in, [postA, postB]);

    let aggregateCalls = 0;
    Post.find = () => queryReturning([]);
    PostEngagement.aggregate = async () => {
      aggregateCalls += 1;
      return [{ views: 999999 }];
    };
    const empty = await service.calculateCreatorEarnings(userId, cycle);
    assert.equal(empty.amount, 0);
    assert.equal(empty.inputs.totalOrganicClipViews, 0);
    assert.equal(aggregateCalls, 0, 'no engagement aggregation should run without eligible clips');
  } finally {
    User.findById = originalUserFindById;
    Post.find = originalPostFind;
    PostEngagement.aggregate = originalAggregate;
  }
}

run()
  .then(() => console.log('Creator earnings organic-view regression tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
