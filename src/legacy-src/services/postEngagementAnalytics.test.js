const assert = require('assert');
const { buildUniquePostViewPipeline } = require('./postEngagementAnalytics');

const sinceDate = new Date('2026-06-01T00:00:00.000Z');
const untilDate = new Date('2026-06-30T23:59:59.999Z');
const postIds = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];

const totalPipeline = buildUniquePostViewPipeline({
  postIds,
  source: 'organic',
  sinceDate,
  untilDate,
  groupBy: 'total'
});
assert.deepStrictEqual(totalPipeline[0], {
  $match: {
    eventType: 'view',
    post: { $in: postIds },
    createdAt: { $gte: sinceDate, $lte: untilDate }
  }
});
assert.deepStrictEqual(totalPipeline[1], { $sort: { createdAt: 1, _id: 1 } });
assert.deepStrictEqual(totalPipeline[2], {
  $group: {
    _id: { user: '$user', post: '$post' },
    source: { $first: '$source' },
    createdAt: { $first: '$createdAt' }
  }
});
assert.deepStrictEqual(totalPipeline[3], { $match: { source: 'organic' } });
assert.deepStrictEqual(totalPipeline[4], { $group: { _id: null, views: { $sum: 1 } } });

const byPost = buildUniquePostViewPipeline({ postIds, groupBy: 'post' });
assert.deepStrictEqual(byPost.at(-1), { $group: { _id: '$_id.post', views: { $sum: 1 } } });

const bySource = buildUniquePostViewPipeline({ postIds, groupBy: 'source' });
assert.deepStrictEqual(bySource.at(-1), { $group: { _id: '$source', views: { $sum: 1 } } });
assert.strictEqual(bySource.filter((stage) => stage.$group?._id?.user === '$user').length, 1);

const byDay = buildUniquePostViewPipeline({ postIds, source: 'organic', groupBy: 'day' });
assert.deepStrictEqual(byDay.at(-2), {
  $group: {
    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
    views: { $sum: 1 }
  }
});
assert.deepStrictEqual(byDay.at(-1), { $sort: { _id: 1 } });

assert.throws(
  () => buildUniquePostViewPipeline({ groupBy: 'context' }),
  /Unsupported view grouping/
);

console.log('post engagement analytics aggregation tests passed');
