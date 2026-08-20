const Post = require('../models/Post');
const User = require('../models/User');
const { filterPostsForViewer } = require('./privacyPolicy');

const idString = (value) => String(value?._id || value || '');
const SOCIAL_SENDER_TYPES = new Set([
  'like', 'comment', 'follow', 'message', 'story', 'clip', 'call', 'mention', 'achievement', 'recruitment'
]);

/**
 * Return row IDs that the current viewer cannot access. Calling this before
 * skip/limit/count prevents privacy filtering from creating short pages.
 */
const getRestrictedNotificationIdsForViewer = async (notifications, viewer) => {
  const rows = notifications || [];
  const viewerId = idString(viewer);
  const senderIds = [...new Set(rows.map((notification) => idString(notification?.sender)).filter(Boolean))];
  const [senders, viewerRecord] = await Promise.all([
    senderIds.length
      ? User.find({ _id: { $in: senderIds } }).select('_id isActive blockedUsers').lean()
      : [],
    viewerId && viewer?.blockedUsers === undefined
      ? User.findById(viewerId).select('blockedUsers').lean()
      : viewer
  ]);
  const viewerBlockedIds = new Set((viewerRecord?.blockedUsers || []).map(idString));
  const senderById = new Map(senders.map((sender) => [idString(sender._id), sender]));
  const restrictedIds = new Set();

  for (const notification of rows) {
    const senderId = idString(notification?.sender);
    const sender = senderById.get(senderId);
    if ((!senderId && SOCIAL_SENDER_TYPES.has(String(notification?.type || '')))
        || (senderId && (!sender
          || sender.isActive === false
          || viewerBlockedIds.has(senderId)
          || (sender.blockedUsers || []).some((blockedId) => idString(blockedId) === viewerId)))) {
      restrictedIds.add(idString(notification?._id));
    }
  }

  const postIds = [...new Set(rows.map((notification) => idString(notification?.data?.postId)).filter(Boolean))];
  if (!postIds.length) return [...restrictedIds].filter(Boolean);

  const posts = await Post.find({ _id: { $in: postIds } })
    .select('author content.text visibility isActive hiddenByAdmin')
    .populate('author', 'username userType profile.displayName profile.avatar privacySettings blockedUsers isActive')
    .lean();
  const visiblePosts = await filterPostsForViewer(posts, viewer);
  const visiblePostIds = new Set(visiblePosts.map((post) => idString(post._id)));
  for (const notification of rows) {
    const postId = idString(notification?.data?.postId);
    if (postId && !visiblePostIds.has(postId)) restrictedIds.add(idString(notification?._id));
  }

  return [...restrictedIds].filter(Boolean);
};

/**
 * Last-mile authorization and post hydration for realtime races. Restricted or
 * deleted targets are omitted; clients never receive an unavailable placeholder.
 */
const sanitizeNotificationsForViewer = async (notifications, viewer) => {
  const rows = notifications || [];
  const restrictedIds = new Set(await getRestrictedNotificationIdsForViewer(rows, viewer));
  const visibleRows = rows.filter((notification) => !restrictedIds.has(idString(notification?._id)));
  const postIds = [...new Set(visibleRows.map((notification) => idString(notification?.data?.postId)).filter(Boolean))];
  const posts = postIds.length
    ? await Post.find({ _id: { $in: postIds } })
      .select('author content.text visibility isActive hiddenByAdmin')
      .populate('author', 'username userType profile.displayName profile.avatar privacySettings blockedUsers isActive')
      .lean()
    : [];
  const authorizedPosts = postIds.length ? await filterPostsForViewer(posts, viewer) : [];
  const visibleById = new Map(authorizedPosts.map((post) => [idString(post._id), post]));

  return visibleRows.flatMap((notification) => {
    const postId = idString(notification?.data?.postId);
    const safe = notification?.toObject
      ? notification.toObject({ virtuals: true })
      : JSON.parse(JSON.stringify(notification || {}));
    if (!postId) return [safe];
    const visiblePost = visibleById.get(postId);
    if (!visiblePost) return [];
    safe.data = {
      ...(safe.data || {}),
      postId: {
        _id: visiblePost._id,
        content: { text: visiblePost.content?.text || '' }
      }
    };
    return [safe];
  });
};

module.exports = {
  getRestrictedNotificationIdsForViewer,
  sanitizeNotificationsForViewer
};
