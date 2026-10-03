const MAX_COMMENT_MENTIONS = 5;

// The boundary excludes email addresses and usernames embedded in other words.
const mentionPattern = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

const extractCommentUsernames = (text) => {
  const names = new Map();
  for (const match of String(text || '').matchAll(mentionPattern)) {
    const username = match[2];
    names.set(username.toLowerCase(), username);
  }
  return [...names.values()];
};

const resolveCommentMentions = async (text, User) => {
  const usernames = extractCommentUsernames(text);
  if (usernames.length > MAX_COMMENT_MENTIONS) {
    const error = new Error(`A comment can mention at most ${MAX_COMMENT_MENTIONS} people`);
    error.code = 'COMMENT_MENTION_LIMIT';
    throw error;
  }
  if (!usernames.length) return [];
  const users = await User.find({
    isActive: true,
    moderationStatus: { $nin: ['suspended', 'banned', 'soft_deleted'] },
    isSuperUser: { $ne: true },
    $or: usernames.map((username) => ({ username: new RegExp(`^${username}$`, 'i') })),
  }).select('_id username blockedUsers privacySettings userType isActive').lean();
  const byName = new Map(users.map((user) => [user.username.toLowerCase(), user]));
  return usernames.map((username) => byName.get(username.toLowerCase())).filter(Boolean);
};

const mentionNotificationRecipients = (mentions, actorId, alreadyNotifiedId) => {
  const excluded = new Set([String(actorId), String(alreadyNotifiedId || '')]);
  return mentions.filter(({ _id }) => {
    const id = String(_id);
    if (excluded.has(id)) return false;
    excluded.add(id);
    return true;
  });
};

module.exports = { MAX_COMMENT_MENTIONS, extractCommentUsernames, resolveCommentMentions, mentionNotificationRecipients };
