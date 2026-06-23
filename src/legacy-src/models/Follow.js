const mongoose = require('mongoose');

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
  const ids = await this.distinct('follower', { following: userId });
  return ids.length;
};

/**
 * Static: Get following count
 */
followSchema.statics.getFollowingCount = async function(userId) {
  const ids = await this.distinct('following', { follower: userId });
  return ids.length;
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

/**
 * Static: Get followers with pagination
 */
followSchema.statics.getFollowers = async function(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [docs, totalIds] = await Promise.all([
    this.find({ following: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('follower', 'username profile.displayName profile.avatar profile.bio profile.location userType createdAt')
      .lean(),
    this.distinct('follower', { following: userId })
  ]);
  const users = uniqueUsersById(docs.map(d => d.follower).filter(Boolean));
  return {
    users,
    total: totalIds.length,
    pages: Math.ceil(totalIds.length / limit),
    current: page
  };
};

/**
 * Static: Get following with pagination
 */
followSchema.statics.getFollowing = async function(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [docs, totalIds] = await Promise.all([
    this.find({ follower: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('following', 'username profile.displayName profile.avatar profile.bio profile.location userType createdAt')
      .lean(),
    this.distinct('following', { follower: userId })
  ]);
  const users = uniqueUsersById(docs.map(d => d.following).filter(Boolean));
  return {
    users,
    total: totalIds.length,
    pages: Math.ceil(totalIds.length / limit),
    current: page
  };
};

module.exports = mongoose.model('Follow', followSchema);
