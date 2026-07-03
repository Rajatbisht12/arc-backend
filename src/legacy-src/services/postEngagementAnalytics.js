const VIEW_GROUPS = new Set(['total', 'post', 'source']);

/**
 * Build a view-count pipeline that treats a user/post pair as one view even if
 * legacy records exist for multiple UI contexts. When duplicate records carry
 * different attribution, the earliest record in the requested window wins.
 */
function buildUniquePostViewPipeline({
  postIds,
  source,
  sinceDate,
  untilDate,
  groupBy = 'total'
} = {}) {
  if (!VIEW_GROUPS.has(groupBy)) throw new Error(`Unsupported view grouping: ${groupBy}`);

  const match = { eventType: 'view' };
  if (Array.isArray(postIds)) match.post = { $in: postIds };
  if (sinceDate || untilDate) {
    match.createdAt = {};
    if (sinceDate) match.createdAt.$gte = sinceDate;
    if (untilDate) match.createdAt.$lte = untilDate;
  }

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { user: '$user', post: '$post' },
        source: { $first: '$source' }
      }
    }
  ];

  if (source) pipeline.push({ $match: { source } });

  if (groupBy === 'post') {
    pipeline.push({ $group: { _id: '$_id.post', views: { $sum: 1 } } });
  } else if (groupBy === 'source') {
    pipeline.push({ $group: { _id: '$source', views: { $sum: 1 } } });
  } else {
    pipeline.push({ $group: { _id: null, views: { $sum: 1 } } });
  }

  return pipeline;
}

module.exports = { buildUniquePostViewPipeline };
