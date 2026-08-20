const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Post = require('../models/Post');
const Tournament = require('../models/Tournament');
const TeamRecruitment = require('../models/TeamRecruitment');
const Scrim = require('../models/Scrim');
const Story = require('../models/Story');
const PlayerProfile = require('../models/PlayerProfile');
const User = require('../models/User');

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const ACTOR_REQUIRED_TYPES = new Set(['like', 'comment', 'follow', 'mention', 'story', 'clip', 'achievement']);

const idString = (value) => String(value?._id || value || '').trim();
const isObjectId = (value) => OBJECT_ID_PATTERN.test(idString(value));
const targetVariants = (targetId) => ({ $in: [targetId, idString(targetId)] });
const customDataOf = (notification) => (
  notification?.data?.customData && typeof notification.data.customData === 'object'
    ? notification.data.customData
    : {}
);

const buildLikeNotificationDedupeKey = ({ sender, postId }) => {
  const actorId = idString(sender);
  const targetId = idString(postId);
  return actorId && targetId ? `like:${actorId}:${targetId}` : '';
};

const TARGET_MATCH_BUILDERS = Object.freeze({
  post: (targetId) => ({
    $or: [
      { 'data.postId': targetId },
      { 'data.customData.postId': targetVariants(targetId) },
      { 'data.customData.clipId': targetVariants(targetId) },
      { 'data.customData.sharedPostId': targetVariants(targetId) },
      { 'data.customData.targetType': { $in: ['post', 'clip', 'achievement'] }, 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  comment: (targetId) => ({
    $or: [
      { 'data.commentId': targetId },
      { 'data.customData.commentId': targetVariants(targetId) },
      { 'data.customData.rootCommentId': targetVariants(targetId) },
      { 'data.customData.replyId': targetVariants(targetId) },
      { 'data.customData.targetType': 'comment', 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  tournament: (targetId) => ({
    $or: [
      { 'data.tournamentId': targetId },
      { 'data.customData.tournamentId': targetVariants(targetId) },
      { 'data.customData.targetType': 'tournament', 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  recruitment: (targetId) => ({
    $or: [
      { 'data.recruitmentId': targetId },
      { 'data.customData.recruitmentId': targetVariants(targetId) },
      { 'data.customData.targetType': 'recruitment', 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  profile: (targetId) => ({
    $or: [
      { 'data.profileId': targetId },
      { 'data.customData.profileId': targetVariants(targetId) },
      { 'data.customData.targetType': { $in: ['profile', 'player_profile'] }, 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  scrim: (targetId) => ({
    $or: [
      { 'data.scrimId': targetId },
      { 'data.customData.scrimId': targetVariants(targetId) },
      { 'data.customData.targetType': 'scrim', 'data.customData.targetId': targetVariants(targetId) }
    ]
  }),
  story: (targetId) => ({
    $or: [
      { 'data.storyId': targetId },
      { 'data.customData.storyId': targetVariants(targetId) },
      { 'data.customData.targetType': 'story', 'data.customData.targetId': targetVariants(targetId) }
    ]
  })
});

const deleteNotificationsForTarget = async ({ targetType, targetId, session } = {}) => {
  const normalizedType = String(targetType || '').trim().toLowerCase();
  const targetMatch = TARGET_MATCH_BUILDERS[normalizedType];
  if (!targetMatch || !isObjectId(targetId)) return { acknowledged: true, deletedCount: 0 };
  return Notification.deleteMany(targetMatch(new mongoose.Types.ObjectId(idString(targetId))), session ? { session } : undefined);
};

const getExplicitTargetReferences = (notification) => {
  const custom = customDataOf(notification);
  const references = [];
  const add = (type, value) => {
    const id = idString(value);
    if (id && !references.some((reference) => reference.type === type && reference.id === id)) {
      references.push({ type, id });
    }
  };

  add('post', notification?.data?.postId || custom.postId || custom.clipId || custom.sharedPostId);
  add('tournament', notification?.data?.tournamentId || custom.tournamentId);
  add('recruitment', notification?.data?.recruitmentId || custom.recruitmentId);
  add('profile', notification?.data?.profileId || custom.profileId);
  add('scrim', notification?.data?.scrimId || custom.scrimId);
  add('story', notification?.data?.storyId || custom.storyId);
  const targetType = String(custom.targetType || '').trim().toLowerCase();
  if (TARGET_MATCH_BUILDERS[targetType]) add(targetType, custom.targetId);
  const commentId = idString(notification?.data?.commentId || custom.commentId || custom.replyId || custom.rootCommentId);
  if (commentId) add('comment', commentId);
  return references;
};

const queryExistingTargetIds = async (type, ids) => {
  const validIds = [...new Set(ids.filter(isObjectId))].map((id) => new mongoose.Types.ObjectId(id));
  if (!validIds.length) return new Set();
  let query;
  if (type === 'post') {
    query = Post.find({ _id: { $in: validIds }, isActive: { $ne: false }, hiddenByAdmin: { $ne: true } });
  } else if (type === 'tournament') query = Tournament.find({ _id: { $in: validIds } });
  else if (type === 'recruitment') query = TeamRecruitment.find({ _id: { $in: validIds } });
  else if (type === 'profile') query = PlayerProfile.find({ _id: { $in: validIds } });
  else if (type === 'scrim') query = Scrim.find({ _id: { $in: validIds } });
  else if (type === 'story') query = Story.find({ _id: { $in: validIds } });
  else return new Set();
  const rows = await query.select('_id').lean();
  return new Set(rows.map((row) => idString(row._id)));
};

const inspectNotificationHistory = async ({ recipientId } = {}) => {
  const baseFilter = recipientId ? { recipient: recipientId } : {};
  const notifications = await Notification.find(baseFilter)
    .select('_id recipient sender type data createdAt updatedAt')
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const orphanIds = new Set();
  const referencesByType = new Map();
  const referencesByNotification = new Map();

  for (const notification of notifications) {
    const references = getExplicitTargetReferences(notification);
    referencesByNotification.set(idString(notification._id), references);
    for (const reference of references) {
      if (!referencesByType.has(reference.type)) referencesByType.set(reference.type, []);
      referencesByType.get(reference.type).push(reference.id);
      if (!isObjectId(reference.id)) orphanIds.add(idString(notification._id));
    }
    if (ACTOR_REQUIRED_TYPES.has(String(notification.type || '')) && !idString(notification.sender)) {
      orphanIds.add(idString(notification._id));
    }
  }

  const existingByType = new Map();
  for (const [type, ids] of referencesByType.entries()) {
    if (type === 'comment') continue;
    existingByType.set(type, await queryExistingTargetIds(type, ids));
  }
  for (const notification of notifications) {
    const notificationId = idString(notification._id);
    for (const reference of referencesByNotification.get(notificationId) || []) {
      if (reference.type === 'comment') continue;
      if (!existingByType.get(reference.type)?.has(reference.id)) orphanIds.add(notificationId);
    }
  }

  const actorIds = [...new Set(notifications
    .filter((notification) => ACTOR_REQUIRED_TYPES.has(String(notification.type || '')))
    .map((notification) => idString(notification.sender))
    .filter(isObjectId))];
  if (actorIds.length) {
    // Account deactivation can be reversible. Only a genuinely missing actor
    // makes history orphaned; privacy filtering temporarily hides inactive users.
    const existingActors = await User.find({
      _id: { $in: actorIds.map((id) => new mongoose.Types.ObjectId(id)) }
    }).select('_id').lean();
    const existingActorIds = new Set(existingActors.map((actor) => idString(actor._id)));
    for (const notification of notifications) {
      if (ACTOR_REQUIRED_TYPES.has(String(notification.type || ''))
          && !existingActorIds.has(idString(notification.sender))) {
        orphanIds.add(idString(notification._id));
      }
    }
  }

  const commentNotifications = notifications.filter((notification) => (
    (referencesByNotification.get(idString(notification._id)) || []).some((reference) => reference.type === 'comment')
  ));
  if (commentNotifications.length) {
    const postIds = [...new Set(commentNotifications
      .map((notification) => idString(notification?.data?.postId || customDataOf(notification).postId))
      .filter(isObjectId))];
    const posts = await Post.find({ _id: { $in: postIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id comments._id').lean();
    const commentsByPost = new Map(posts.map((post) => [
      idString(post._id),
      new Set((post.comments || []).map((comment) => idString(comment._id)))
    ]));
    for (const notification of commentNotifications) {
      const postId = idString(notification?.data?.postId || customDataOf(notification).postId);
      const commentRefs = (referencesByNotification.get(idString(notification._id)) || [])
        .filter((reference) => reference.type === 'comment');
      if (!postId || commentRefs.some((reference) => !commentsByPost.get(postId)?.has(reference.id))) {
        orphanIds.add(idString(notification._id));
      }
    }
  }

  const duplicateLikeIds = new Set();
  const likeWinners = [];
  const likeGroups = new Map();
  for (const notification of notifications) {
    if (notification.type !== 'like' || orphanIds.has(idString(notification._id))) continue;
    const key = buildLikeNotificationDedupeKey({ sender: notification.sender, postId: notification?.data?.postId });
    if (!key) continue;
    const groupKey = `${idString(notification.recipient)}:${key}`;
    if (!likeGroups.has(groupKey)) likeGroups.set(groupKey, []);
    likeGroups.get(groupKey).push(notification);
  }
  for (const rows of likeGroups.values()) {
    const [winner, ...duplicates] = rows;
    likeWinners.push({ notificationId: idString(winner._id), key: buildLikeNotificationDedupeKey({
      sender: winner.sender,
      postId: winner?.data?.postId
    }) });
    duplicates.forEach((notification) => duplicateLikeIds.add(idString(notification._id)));
  }

  return {
    scanned: notifications.length,
    orphanIds: [...orphanIds],
    duplicateLikeIds: [...duplicateLikeIds],
    likeWinners
  };
};

const repairNotificationHistory = async ({ recipientId, dryRun = false } = {}) => {
  const inspection = await inspectNotificationHistory({ recipientId });
  const deleteIds = [...new Set([...inspection.orphanIds, ...inspection.duplicateLikeIds])];
  if (!dryRun) {
    if (deleteIds.length) await Notification.deleteMany({ _id: { $in: deleteIds } });
    const survivors = inspection.likeWinners.filter((winner) => !deleteIds.includes(winner.notificationId));
    if (survivors.length) {
      await Notification.bulkWrite(survivors.map((winner) => ({
        updateOne: {
          filter: { _id: winner.notificationId },
          update: {
            $set: {
              'data.customData.notificationDedupeKey': winner.key,
              'data.customData.pushRequestId': winner.key
            }
          }
        }
      })), { ordered: false });
    }
  }
  return { ...inspection, deleted: dryRun ? 0 : deleteIds.length, dryRun };
};

module.exports = {
  ACTOR_REQUIRED_TYPES,
  TARGET_MATCH_BUILDERS,
  buildLikeNotificationDedupeKey,
  deleteNotificationsForTarget,
  getExplicitTargetReferences,
  inspectNotificationHistory,
  repairNotificationHistory
};
