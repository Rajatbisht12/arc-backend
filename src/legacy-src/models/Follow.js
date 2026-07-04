const mongoose = require('mongoose');
const { buildPrefixRegex } = require('../utils/searchQuery');

/**
 * Follow Model
 * ------------
 * Separates the follow relationship into its own collection instead of
 * storing unbounded arrays on the User document.
 *
 * This enables:
 * - O(1) follow/unfollow via insertOne/deleteOne
 * - Efficient paginated follower/following queries
 * - No document bloat on the User model
 * - Atomic operations without race conditions
 *
 * Migration note: The User.followers[] and User.following[] arrays are
 * still maintained as denormalized copies for backward compatibility.
 * New code should query this collection instead.
 */
const followSchema = new mongoose.Schema({
  follower: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  following: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound unique index prevents duplicate follows
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// Index for "get all followers of user X" queries
followSchema.index({ following: 1, createdAt: -1 });

// Index for "get all users that user X follows" queries
followSchema.index({ follower: 1, createdAt: -1 });

/**
 * Static: Follow a user (idempotent)
 */
followSchema.statics.follow = async function(followerId, followingId) {
  try {
    await this.create({ follower: followerId, following: followingId });
    return true;
  } catch (error) {
    if (error.code === 11000) return false; // Already following
    throw error;
  }
};

/**
 * Static: Unfollow a user
 */
followSchema.statics.unfollow = async function(followerId, followingId) {
  const result = await this.deleteOne({ follower: followerId, following: followingId });
  return result.deletedCount > 0;
};

/**
 * Static: Check if user A follows user B
 */
followSchema.statics.isFollowing = async function(followerId, followingId) {
  const count = await this.countDocuments({ follower: followerId, following: followingId });
  return count > 0;
};

/**
 * Static: Get follower count
 */
followSchema.statics.getFollowerCount = async function(userId) {
  const followingId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  const [result] = await this.aggregate([
    { $match: { following: followingId } },
    { $lookup: { from: 'users', localField: 'follower', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.isActive': true } },
    { $count: 'total' }
  ]);
  return Number(result?.total || 0);
};

/**
 * Static: Get following count
 */
followSchema.statics.getFollowingCount = async function(userId) {
  const followerId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  const [result] = await this.aggregate([
    { $match: { follower: followerId } },
    { $lookup: { from: 'users', localField: 'following', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.isActive': true } },
    { $count: 'total' }
  ]);
  return Number(result?.total || 0);
};

function uniqueUsersById(users) {
  const seen = new Set();
  return users.filter((user) => {
    const id = user?._id?.toString();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const buildVisibleUserMatch = ({ excludeUserIds = [], search = '' } = {}) => {
  const conditions = [
    { 'user.isActive': true },
    { 'user.username': { $not: /^duo_/i } }
  ];
  const excludedObjectIds = (excludeUserIds || [])
    .filter((value) => mongoose.Types.ObjectId.isValid(String(value)))
    .map((value) => new mongoose.Types.ObjectId(String(value)));
  if (excludedObjectIds.length) {
    conditions.push({ 'user._id': { $nin: excludedObjectIds } });
  }
  const pattern = buildPrefixRegex(search);
  if (pattern) {
    conditions.push({
      $or: [
        { 'user.username': { $regex: pattern, $options: 'i' } },
        { 'user.profile.displayName': { $regex: pattern, $options: 'i' } }
      ]
    });
  }
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

const FOLLOW_USER_PROJECTION = {
  $project: {
    _id: '$user._id',
    username: '$user.username',
    userType: '$user.userType',
    profile: '$user.profile',
    privacySettings: '$user.privacySettings',
    blockedUsers: '$user.blockedUsers',
    isActive: '$user.isActive',
    createdAt: '$user.createdAt'
  }
};

/**
 * Fetch a page of joined users plus the total match count for a follower/
 * following pipeline. Amazon DocumentDB does not support `$facet`, so the page
 * and the count are issued as two aggregations that share the same filter
 * pipeline instead of being combined in a single stage.
 */
async function paginateFollowUsers(model, filterPipeline, { page, limit }) {
  const skip = (page - 1) * limit;
  const [records, countRows] = await Promise.all([
    model.aggregate([
      ...filterPipeline,
      { $sort: { createdAt: -1, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      FOLLOW_USER_PROJECTION
    ]),
    model.aggregate([...filterPipeline, { $count: 'total' }])
  ]);
  const users = uniqueUsersById(records || []);
  const total = Number(countRows?.[0]?.total || 0);
  return {
    users,
    total,
    pages: Math.ceil(total / limit),
    current: page
  };
}

/**
 * Static: Get followers with pagination
 */
followSchema.statics.getFollowers = async function(userId, {
  page = 1,
  limit = 20,
  excludeUserIds = [],
  search = ''
} = {}) {
  const followingId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  return paginateFollowUsers(this, [
    { $match: { following: followingId } },
    { $lookup: { from: 'users', localField: 'follower', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: buildVisibleUserMatch({ excludeUserIds, search }) }
  ], { page, limit });
};

/**
 * Static: Get following with pagination
 */
followSchema.statics.getFollowing = async function(userId, {
  page = 1,
  limit = 20,
  excludeUserIds = [],
  search = ''
} = {}) {
  const followerId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  return paginateFollowUsers(this, [
    { $match: { follower: followerId } },
    { $lookup: { from: 'users', localField: 'following', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: buildVisibleUserMatch({ excludeUserIds, search }) }
  ], { page, limit });
};

module.exports = mongoose.model('Follow', followSchema);
