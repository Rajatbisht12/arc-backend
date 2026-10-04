/**
 * Count active-user follow relationships for one Discover page in two bounded
 * database round trips instead of two aggregation pipelines per result.
 */
const getVisibleFollowCounts = async (Follow, userIds) => {
  if (!userIds.length) return { followers: new Map(), following: new Map() };

  const aggregateCounts = (key, relatedKey) => Follow.aggregate([
    { $match: { [key]: { $in: userIds } } },
    { $lookup: { from: 'users', localField: relatedKey, foreignField: '_id', as: 'relatedUser' } },
    { $unwind: '$relatedUser' },
    { $match: { 'relatedUser.isActive': true } },
    { $group: { _id: `$${key}`, total: { $sum: 1 } } }
  ]);

  const [followerRows, followingRows] = await Promise.all([
    aggregateCounts('following', 'follower'),
    aggregateCounts('follower', 'following')
  ]);

  return {
    followers: new Map(followerRows.map((row) => [String(row._id), Number(row.total) || 0])),
    following: new Map(followingRows.map((row) => [String(row._id), Number(row.total) || 0]))
  };
};

module.exports = { getVisibleFollowCounts };
