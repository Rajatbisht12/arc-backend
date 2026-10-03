const idString = (value) => String(value?._id || value || '').trim();

const getCommentPermissions = ({ viewerId, contentOwnerId, commentAuthorId } = {}) => {
  const viewer = idString(viewerId);
  const owner = idString(contentOwnerId);
  const author = idString(commentAuthorId);
  const authenticated = Boolean(viewer);

  return {
    canDelete: authenticated && (viewer === author || viewer === owner),
    // Reporting your own comment creates noisy, unactionable moderation rows.
    // A content owner may report every other author's comment on their content.
    canReport: authenticated && Boolean(author) && viewer !== author,
  };
};

const buildCommentDeletion = (comments, targetId) => {
  const source = Array.isArray(comments) ? comments : [];
  const target = source.find((comment) => idString(comment?._id) === idString(targetId));
  if (!target) return null;

  const deletedIds = new Set([idString(target._id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of source) {
      const commentId = idString(comment?._id);
      const parentId = idString(comment?.parentComment);
      if (commentId && parentId && deletedIds.has(parentId) && !deletedIds.has(commentId)) {
        deletedIds.add(commentId);
        changed = true;
      }
    }
  }

  // rootComment is the authoritative flattened-thread relationship. Include it
  // as a guard for legacy rows whose immediate parent reference is incomplete.
  if (!target.parentComment) {
    for (const comment of source) {
      if (idString(comment?.rootComment) === idString(target._id)) deletedIds.add(idString(comment?._id));
    }
  }

  const remaining = source
    .filter((comment) => !deletedIds.has(idString(comment?._id)))
    .map((comment) => (typeof comment?.toObject === 'function' ? comment.toObject() : { ...comment }));

  const replyCounts = new Map();
  for (const comment of remaining) {
    const rootId = idString(comment?.rootComment);
    if (rootId) replyCounts.set(rootId, (replyCounts.get(rootId) || 0) + 1);
  }
  for (const comment of remaining) {
    if (!comment.parentComment) comment.replyCount = replyCounts.get(idString(comment._id)) || 0;
  }

  return {
    target,
    deletedCommentIds: [...deletedIds],
    comments: remaining,
  };
};

module.exports = {
  idString,
  getCommentPermissions,
  buildCommentDeletion,
};
