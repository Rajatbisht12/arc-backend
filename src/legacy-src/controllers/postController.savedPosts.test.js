const assert = require('assert');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Post = require('../models/Post');
const PostEngagement = require('../models/PostEngagement');
const { toggleSave } = require('./postController');
const { normalizeEngagementContext } = require('../services/recommendationService');
const { attachIsSavedFlags } = require('../utils/savedFlags');

const USER_ID = '507f1f77bcf86cd799439099';
const POST_ID = '507f1f77bcf86cd799439011';

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set() { return this; }
  };
  return res;
}

function makeReq() {
  return {
    params: { id: POST_ID },
    body: { context: 'post-card' },
    user: { _id: USER_ID, userType: 'player', isActive: true }
  };
}

// A chainable stub that resolves to `doc` regardless of select/lean chains.
function chainable(doc) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    populate: () => chain,
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
    catch: () => chain,
    exec: () => Promise.resolve(doc)
  };
  return chain;
}

async function run() {
  const originalUserUpdateOne = User.updateOne.bind(User);
  const originalUserFindById = User.findById.bind(User);
  const originalPostFindOne = Post.findOne.bind(Post);
  const originalPostUpdateOne = Post.updateOne.bind(Post);
  const originalEngagementCreate = PostEngagement.create.bind(PostEngagement);

  // Self-authored public post: privacy resolution allows without extra state.
  const postDoc = {
    _id: POST_ID,
    author: { _id: USER_ID, isActive: true, privacySettings: {} },
    visibility: 'public',
    isActive: true,
    hiddenByAdmin: false,
    boostMeta: null
  };

  const updateOneCalls = [];
  let pullResult = { matchedCount: 1, modifiedCount: 0 };
  let pushResult = { matchedCount: 1, modifiedCount: 1 };
  let savedPostsAfter = [{ post: POST_ID }];

  Post.findOne = () => chainable(postDoc);
  Post.updateOne = () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  PostEngagement.create = () => Promise.resolve({});
  User.findById = () => chainable({ _id: USER_ID, isActive: true, privacySettings: {}, savedPosts: savedPostsAfter });
  User.updateOne = (filter, update) => {
    updateOneCalls.push({ filter, update });
    if (update.$pull) return Promise.resolve(pullResult);
    return Promise.resolve(pushResult);
  };

  try {
    // 1. First tap saves: $pull misses, guarded $push inserts exactly once.
    let res = makeRes();
    await toggleSave(makeReq(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.isSaved, true);
    assert.strictEqual(res.body.data.savedCount, 1);
    const pushCall = updateOneCalls.find(call => call.update.$push);
    assert(pushCall, 'save must issue a $push');
    assert.deepStrictEqual(pushCall.filter['savedPosts.post'], { $ne: POST_ID },
      'the push must be guarded against duplicate save records');
    assert(pushCall.update.$push.savedPosts.savedAt instanceof Date, 'saves carry a timestamp');

    // 2. Second tap unsaves: $pull matches, no push happens.
    updateOneCalls.length = 0;
    pullResult = { matchedCount: 1, modifiedCount: 1 };
    savedPostsAfter = [];
    res = makeRes();
    await toggleSave(makeReq(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.isSaved, false);
    assert.strictEqual(res.body.data.savedCount, 0);
    assert(!updateOneCalls.some(call => call.update.$push), 'unsave must not push');

    // 3. Concurrent duplicate save: push guard misses because a parallel
    //    request already inserted — still a calm 200 "saved", never a 500/409.
    updateOneCalls.length = 0;
    pullResult = { matchedCount: 1, modifiedCount: 0 };
    pushResult = { matchedCount: 0, modifiedCount: 0 };
    savedPostsAfter = [{ post: POST_ID }];
    res = makeRes();
    await toggleSave(makeReq(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.isSaved, true);
    assert.strictEqual(res.body.data.savedCount, 1, 'no duplicate record is counted');

    // 4. Missing user: proper 404, not a 500.
    pullResult = { matchedCount: 0, modifiedCount: 0 };
    res = makeRes();
    await toggleSave(makeReq(), res);
    assert.strictEqual(res.statusCode, 404);

    // 5. Engagement contexts from every save surface normalize to canonical values.
    assert.strictEqual(normalizeEngagementContext('post-card'), 'feed');
    assert.strictEqual(normalizeEngagementContext('post-detail'), 'post');
    assert.strictEqual(normalizeEngagementContext('profile-saved'), 'profile');
    assert.strictEqual(normalizeEngagementContext('saved'), 'profile');
    assert.strictEqual(normalizeEngagementContext('clips'), 'clips');

    // 6. attachIsSavedFlags stamps viewer truth and never flags for guests.
    User.findById = () => chainable({ savedPosts: [{ post: POST_ID }] });
    const dtos = [{ _id: POST_ID }, { _id: '507f1f77bcf86cd799439012' }];
    await attachIsSavedFlags(dtos, { _id: USER_ID, userType: 'player' });
    assert.strictEqual(dtos[0].isSaved, true);
    assert.strictEqual(dtos[1].isSaved, false);
    const guestDtos = [{ _id: POST_ID }];
    await attachIsSavedFlags(guestDtos, { _id: USER_ID, userType: 'guest' });
    assert.strictEqual(guestDtos[0].isSaved, false, 'guests never receive personal saved flags');
  } finally {
    User.updateOne = originalUserUpdateOne;
    User.findById = originalUserFindById;
    Post.findOne = originalPostFindOne;
    Post.updateOne = originalPostUpdateOne;
    PostEngagement.create = originalEngagementCreate;
  }

  // 7. Source contracts: profile surfaces stamp isSaved; the saved list stays
  //    owner-scoped, paginated, and privacy-filtered.
  const userControllerSource = fs.readFileSync(path.join(__dirname, 'userController.js'), 'utf8');
  assert.strictEqual((userControllerSource.match(/attachIsSavedFlags\(/g) || []).length >= 3, true,
    'profile recentPosts, user posts, and user clips must stamp isSaved');

  const postControllerSource = fs.readFileSync(path.join(__dirname, 'postController.js'), 'utf8');
  assert.match(postControllerSource, /filterPostsForViewer\(posts, req\.user\)/,
    'saved list must run privacy filtering');
  assert.match(postControllerSource, /savedPosts\.post['"]?\]?: \{ \$ne: postId \}|'savedPosts\.post': \{ \$ne: postId \}/,
    'save insert must stay duplicate-guarded');

  console.log('saved posts backend contract tests passed');
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
