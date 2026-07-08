const assert = require('node:assert/strict');

const viewerId = '507f1f77bcf86cd799439401';
const otherViewerId = '507f1f77bcf86cd799439402';
const postId = '507f1f77bcf86cd799439403';
const campaignId = '507f1f77bcf86cd799439404';
const otherCampaignId = '507f1f77bcf86cd799439405';
const authorId = '507f1f77bcf86cd799439406';

const query = (value) => {
  const chain = {
    select() { return chain; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
  return chain;
};

const findIndex = (indexes, expectedKeys, expectedOptions = {}) => indexes.find(([keys, options]) => (
  Object.entries(expectedKeys).every(([key, value]) => keys[key] === value) &&
  Object.entries(expectedOptions).every(([key, value]) => options[key] === value)
));

const actualAttributionModel = require('../models/BoostDeliveryAttribution');
const indexes = actualAttributionModel.schema.indexes();
assert.ok(
  findIndex(indexes, { user: 1, post: 1, campaign: 1, context: 1 }, { unique: true }),
  'delivery proofs must be unique per viewer/post/campaign/context'
);
assert.ok(
  findIndex(indexes, { expiresAt: 1 }, { expireAfterSeconds: 0 }),
  'delivery proofs must have an absolute-expiry TTL index'
);
assert.ok(
  findIndex(indexes, { user: 1, post: 1, campaign: 1, expiresAt: -1 }),
  'proof validation lookup must be indexed'
);
assert.equal(actualAttributionModel.schema.path('expiresAt').isRequired, true);
assert.deepEqual(actualAttributionModel.schema.path('context').enumValues, ['feed', 'clips', 'profile', 'search', 'post', 'unknown']);

const deliveryState = {
  campaignPaymentStatus: 'paid',
  campaignFilters: [],
  attributionWrites: [],
  postUpdates: []
};

const activePost = () => ({
  _id: postId,
  author: authorId,
  isActive: true,
  visibility: 'public',
  hiddenByAdmin: false,
  boostMeta: {
    activeCampaign: campaignId,
    status: 'running',
    remainingReach: 10,
    purchasedReach: 100,
    endTime: new Date(Date.now() + 60 * 60 * 1000)
  }
});

const DeliveryPost = {
  async updateOne(filter, update) {
    deliveryState.postUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  }
};

const DeliveryCampaign = {
  async findOneAndUpdate(filter) {
    deliveryState.campaignFilters.push(filter);
    if (filter.paymentStatus !== 'paid' || deliveryState.campaignPaymentStatus !== 'paid') return null;
    return {
      _id: campaignId,
      status: 'running',
      paymentStatus: 'paid',
      remainingReach: 9,
      endTime: new Date(Date.now() + 60 * 60 * 1000)
    };
  },
  async updateOne() { return { matchedCount: 1 }; }
};

const DeliveryAttribution = {
  async findOneAndUpdate(filter, update, options) {
    deliveryState.attributionWrites.push({ filter, update, options });
    return { ...filter, ...update.$set };
  }
};

const serviceMocks = {
  '../models/Post': DeliveryPost,
  '../models/BoostCampaign': DeliveryCampaign,
  '../models/BoostDeliveryAttribution': DeliveryAttribution
};

for (const [request, exports] of Object.entries(serviceMocks)) {
  const filename = require.resolve(request, { paths: [__dirname] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
delete require.cache[require.resolve('./boostService')];
const { recordBoostDelivery } = require('./boostService');

const resetDelivery = (paymentStatus = 'paid') => {
  deliveryState.campaignPaymentStatus = paymentStatus;
  deliveryState.campaignFilters.length = 0;
  deliveryState.attributionWrites.length = 0;
  deliveryState.postUpdates.length = 0;
};

const controllerState = {
  proofs: [],
  proofQueries: [],
  postUpdates: [],
  campaignUpdates: [],
  engagementEvents: []
};

const matchesProof = (proof, filter) => (
  String(proof.user) === String(filter.user) &&
  String(proof.post) === String(filter.post) &&
  String(proof.campaign) === String(filter.campaign) &&
  new Date(proof.expiresAt).getTime() > filter.expiresAt.$gt.getTime()
);

const ControllerAttribution = {
  async exists(filter) {
    controllerState.proofQueries.push(filter);
    return controllerState.proofs.some((proof) => matchesProof(proof, filter)) ? { _id: 'proof' } : null;
  }
};

const ControllerPost = {
  findById() { return query(activePost()); },
  findOneAndUpdate(filter, update) {
    controllerState.postUpdates.push({ filter, update });
    return query({ ...activePost(), views: 1, viewedBy: [{ user: viewerId }] });
  },
  async updateOne(filter, update) {
    controllerState.postUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  }
};

const ControllerCampaign = {
  async updateOne(filter, update) {
    controllerState.campaignUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  }
};

const normalizeContext = (value) => (
  ['feed', 'clips', 'profile', 'search', 'post'].includes(String(value)) ? String(value) : 'unknown'
);

const controllerMocks = {
  '../models/Post': ControllerPost,
  '../models/User': {},
  '../models/Notification': {},
  '../models/BoostCampaign': ControllerCampaign,
  '../models/BoostDeliveryAttribution': ControllerAttribution,
  '../utils/cloudinary': { async uploadMultipleFiles() { return []; } },
  '../utils/notificationService': {
    async createLikeNotification() {},
    async createCommentNotification() {},
    async createMentionNotification() {}
  },
  '../utils/dto': { formatPostDTO(value) { return value; } },
  '../services/recommendationService': {
    async getRecommendedPosts() { return { posts: [] }; },
    async recordEngagementEvent(event) {
      controllerState.engagementEvents.push(event);
    },
    normalizeEngagementContext: normalizeContext,
    normalizeEngagementDuration(value) { return Math.max(0, Number(value) || 0); },
    normalizeCompletionRate(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  },
  '../services/boostService': { isActiveBoost() { return true; } },
  '../utils/logger': { error() {} },
  '../utils/mediaUploadError': { respondToMediaUploadError() { return false; } },
  '../utils/privacyPolicy': {
    async resolvePostAccess() { return { allowed: true }; },
    async filterPostsForViewer(value) { return value; }
  }
};

const controllerDir = require('node:path').resolve(__dirname, '../controllers');
for (const [request, exports] of Object.entries(controllerMocks)) {
  const filename = require.resolve(request, { paths: [controllerDir] });
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const controllerPath = require.resolve('../controllers/postController');
delete require.cache[controllerPath];
const { recordClipView } = require(controllerPath);

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const resetController = (proofs = []) => {
  controllerState.proofs = proofs;
  controllerState.proofQueries.length = 0;
  controllerState.postUpdates.length = 0;
  controllerState.campaignUpdates.length = 0;
  controllerState.engagementEvents.length = 0;
};

const recordView = async ({
  user = viewerId,
  context = 'clips',
  source = 'boost',
  deliverySource = 'boost',
  boostCampaign = otherCampaignId
} = {}) => {
  const res = response();
  await recordClipView({
    params: { id: postId },
    user: { _id: user },
    query: {},
    body: { context, source, deliverySource, boostCampaign, durationMs: 1000, completionRate: 0.25 }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(controllerState.engagementEvents.length, 1);
  return controllerState.engagementEvents[0];
};

const assertOrganic = (event) => {
  assert.equal(event.source, 'organic');
  assert.equal(event.boostCampaign, null);
  assert.equal(controllerState.postUpdates[0].update.$inc['metrics.organicViews'], 1);
  assert.equal(controllerState.postUpdates[0].update.$inc['metrics.boostViews'], undefined);
  assert.equal(controllerState.campaignUpdates.length, 0);
};

const run = async () => {
  resetDelivery('paid');
  const attributed = await recordBoostDelivery(activePost(), 'clips', viewerId);
  assert.equal(attributed.has(postId), true);
  assert.equal(deliveryState.campaignFilters.length, 1);
  assert.equal(deliveryState.campaignFilters[0].status, 'running');
  assert.equal(deliveryState.campaignFilters[0].paymentStatus, 'paid', 'proofs require a successfully paid campaign placement');
  assert.deepEqual(deliveryState.campaignFilters[0].remainingReach, { $gt: 0 });
  assert.equal(deliveryState.attributionWrites.length, 1);
  assert.deepEqual(deliveryState.attributionWrites[0].filter, {
    user: viewerId,
    post: postId,
    campaign: campaignId,
    context: 'clips'
  });
  assert.ok(deliveryState.attributionWrites[0].update.$set.deliveredAt instanceof Date);
  assert.ok(deliveryState.attributionWrites[0].update.$set.expiresAt > deliveryState.attributionWrites[0].update.$set.deliveredAt);
  assert.equal(deliveryState.attributionWrites[0].options.upsert, true);
  assert.equal(deliveryState.attributionWrites[0].options.runValidators, true);

  resetDelivery('pending');
  const unpaid = await recordBoostDelivery(activePost(), 'clips', viewerId);
  assert.equal(unpaid.size, 0);
  assert.equal(deliveryState.attributionWrites.length, 0, 'an unpaid/failed placement must never mint attribution proof');

  resetDelivery('paid');
  await recordBoostDelivery(activePost(), 'clips', null);
  assert.equal(deliveryState.attributionWrites.length, 0, 'anonymous delivery cannot create viewer attribution proof');

  resetController([]);
  assertOrganic(await recordView({ source: 'boost', deliverySource: 'boost', boostCampaign: campaignId }));
  assert.equal(controllerState.proofQueries[0].user, viewerId);
  assert.equal(controllerState.proofQueries[0].post, postId);
  assert.equal(controllerState.proofQueries[0].campaign, campaignId);
  assert.equal(Object.hasOwn(controllerState.proofQueries[0], 'context'), false, 'client context must not gate paid-delivery proof');
  assert.ok(controllerState.proofQueries[0].expiresAt.$gt instanceof Date);

  resetController([{
    user: viewerId,
    post: postId,
    campaign: campaignId,
    context: 'clips',
    expiresAt: new Date(Date.now() + 60_000)
  }]);
  const boosted = await recordView();
  assert.equal(boosted.source, 'boost');
  assert.equal(boosted.boostCampaign, campaignId);
  assert.equal(controllerState.postUpdates[0].update.$inc['metrics.boostViews'], 1);
  assert.equal(controllerState.campaignUpdates.length, 1);

  resetController([{
    user: viewerId,
    post: postId,
    campaign: campaignId,
    context: 'clips',
    expiresAt: new Date(Date.now() - 1)
  }]);
  assertOrganic(await recordView());

  resetController([{
    user: otherViewerId,
    post: postId,
    campaign: campaignId,
    context: 'clips',
    expiresAt: new Date(Date.now() + 60_000)
  }]);
  assertOrganic(await recordView());

  resetController([{
    user: viewerId,
    post: postId,
    campaign: campaignId,
    context: 'feed',
    expiresAt: new Date(Date.now() + 60_000)
  }]);
  const forgedContext = await recordView({ context: 'clips' });
  assert.equal(forgedContext.source, 'boost', 'forging context must not downgrade paid delivery to organic');
  assert.equal(forgedContext.boostCampaign, campaignId);
  assert.equal(controllerState.postUpdates[0].update.$inc['metrics.boostViews'], 1);

  resetController([{
    user: viewerId,
    post: postId,
    campaign: otherCampaignId,
    context: 'clips',
    expiresAt: new Date(Date.now() + 60_000)
  }]);
  assertOrganic(await recordView({ source: 'boost', deliverySource: 'boost', boostCampaign: otherCampaignId }));

  console.log('Secure boost delivery attribution and monetization source regression tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
