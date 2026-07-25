// Pure helpers for Instagram-style two-level comment threading over the Post
// document's embedded `comments` array. No database access so they can be unit
// tested directly.

const idToString = (value) => {
  if (value == null) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

/**
 * Resolve where a new comment/reply belongs given the existing comments and the
 * requested parent. Replies are flattened to a single visual level: a reply to
 * a reply still attaches to the top-level root thread (like Instagram), while
 * `parentComment` records who was actually answered so the UI can prefix the
 * mention.
 *
 * @returns { ok, reason?, parentComment, rootComment, replyTargetUserId }
 *   - ok:false with reason 'parent_not_found' when parentCommentId is invalid.
 *   - For a top-level comment (no parentCommentId): parentComment/rootComment
 *     are null and replyTargetUserId is null.
 */
function resolveCommentRelation(comments, parentCommentId) {
  if (!parentCommentId) {
    return { ok: true, parentComment: null, rootComment: null, replyTargetUserId: null };
  }
  const list = Array.isArray(comments) ? comments : [];
  const parent = list.find((comment) => idToString(comment._id) === idToString(parentCommentId));
  if (!parent) {
    return { ok: false, reason: 'parent_not_found' };
  }
  // Flatten: the root is the parent's own root (if the parent is itself a
  // reply) or the parent when it is top-level.
  const rootComment = idToString(parent.rootComment) || idToString(parent._id);
  return {
    ok: true,
    parentComment: idToString(parent._id),
    rootComment,
    replyTargetUserId: idToString(parent.user) || null,
  };
}

/**
 * Count replies belonging to a given root thread. Used to keep the root
 * comment's `replyCount` accurate without a separate aggregation.
 */
function countRepliesForRoot(comments, rootCommentId) {
  const rootId = idToString(rootCommentId);
  if (!rootId) return 0;
  return (Array.isArray(comments) ? comments : []).reduce((total, comment) => {
    return idToString(comment.rootComment) === rootId ? total + 1 : total;
  }, 0);
}

/** True when the comment has no parent — i.e. it is a top-level thread root. */
function isTopLevel(comment) {
  return !comment || (!comment.parentComment && !comment.rootComment);
}

module.exports = {
  idToString,
  resolveCommentRelation,
  countRepliesForRoot,
  isTopLevel,
};
