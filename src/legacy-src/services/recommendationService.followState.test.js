// Real-DB proof that Clips/Feed authors carry the same follow-state the Profile
// endpoint returns, so the client renders Follow / Requested / Unfollow /
// Requests-off correctly instead of defaulting every non-followed author to
// "Requests Off". Truth table (public authors, whose clips are visible):
//   public + allowFollowRequests=true,  not following  -> Follow      (canFollow=true)
//   public + allowFollowRequests=false, not following  -> Requests Off (canFollow=false)
//   following                                          -> Unfollow    (isFollowing=true, canFollow=false)
//   pending request                                    -> Requested   (followStatus='pending')
//   self                                               -> no follow-state attached
const assert = require('assert');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Post = require('../models/Post');
const Follow = require('../models/Follow');
const FollowRequest = require('../models/FollowRequest');
const { getRecommendedPosts } = require('./recommendationService');

let mongod;

const makeUser = (username, privacy) => User.create({
  username,
  email: `${username}@example.com`,
  password: 'x'.repeat(12),
  userType: 'player',
  isActive: true,
  profile: { displayName: username },
  privacySettings: privacy,
});

const makeClip = (author) => Post.create({
  author: author._id,
  postType: 'general',
  visibility: 'public',
  content: { text: `clip by ${author.username}`, media: [{ type: 'video', url: 'https://example.com/v.mp4', publicId: `pub_${author.username}` }] },
  createdAt: new Date(),
});

test('clips authors carry canonical follow-state (Follow / Requests-off / Unfollow / Requested / self)', async (t) => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  t.after(async () => { await mongoose.disconnect(); await mongod.stop(); });

  const viewer = await makeUser('viewer', { profileVisibility: 'public', allowFollowRequests: true });
  const publicOpen = await makeUser('publicopen', { profileVisibility: 'public', allowFollowRequests: true });
  const publicClosed = await makeUser('publicclosed', { profileVisibility: 'public', allowFollowRequests: false });
  const followedAuthor = await makeUser('followed', { profileVisibility: 'public', allowFollowRequests: true });
  const pendingAuthor = await makeUser('pending', { profileVisibility: 'public', allowFollowRequests: true });

  for (const a of [viewer, publicOpen, publicClosed, followedAuthor, pendingAuthor]) await makeClip(a);

  await Follow.create({ follower: viewer._id, following: followedAuthor._id });
  await FollowRequest.create({ requester: viewer._id, target: pendingAuthor._id, status: 'pending' });

  const result = await getRecommendedPosts({
    user: { _id: viewer._id, userType: 'player', isActive: true },
    query: { limit: 30 },
    mode: 'clips',
  });

  const byAuthor = new Map();
  for (const post of result.posts) {
    if (post?.author?._id) byAuthor.set(String(post.author._id), post.author);
  }

  const open = byAuthor.get(String(publicOpen._id));
  assert.ok(open, 'public-open author clip should be visible');
  assert.strictEqual(open.canFollow, true, 'public + requests-on + not following -> Follow');
  assert.strictEqual(open.isFollowing, false);
  assert.strictEqual(open.followStatus, 'none');
  assert.strictEqual(open.privacyAccess.canFollow, true);

  const closed = byAuthor.get(String(publicClosed._id));
  assert.ok(closed, 'public-closed author clip should be visible');
  assert.strictEqual(closed.canFollow, false, 'allowFollowRequests=false -> Requests Off');
  assert.strictEqual(closed.followStatus, 'none');

  const followed = byAuthor.get(String(followedAuthor._id));
  assert.ok(followed, 'followed author clip should be visible');
  assert.strictEqual(followed.isFollowing, true, 'following -> Unfollow');
  assert.strictEqual(followed.canFollow, false, 'already following is not followable again');
  assert.strictEqual(followed.followStatus, 'accepted');

  const pending = byAuthor.get(String(pendingAuthor._id));
  assert.ok(pending, 'pending author clip should be visible');
  assert.strictEqual(pending.followStatus, 'pending', 'pending request -> Requested');
  assert.strictEqual(pending.followRequestPending, true);
  assert.strictEqual(pending.canFollow, false, 'pending is not re-followable');

  const own = byAuthor.get(String(viewer._id));
  if (own) {
    assert.strictEqual(own.isFollowing, undefined, 'self author gets no follow-state');
    assert.strictEqual(own.canFollow, undefined);
  }
});
