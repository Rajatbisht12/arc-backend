const { extractCommentUsernames } = require('./commentMentions');
const { usernameOwnerIds } = require('../services/usernameLookupService');

// The comment mention boundary is shared with bios: email addresses and
// usernames embedded in other words must never become profile links.
const resolveBioMentions = async (bio, User, previous = [], resolveIds = usernameOwnerIds) => {
  const names = extractCommentUsernames(bio);
  if (!names.length) return [];

  const previousByName = new Map((Array.isArray(previous) ? previous : [])
    .filter((mention) => mention?.username && mention?.user)
    .map((mention) => [String(mention.username).toLowerCase(), String(mention.user?._id || mention.user)]));
  const unresolved = names.filter((name) => !previousByName.has(name.toLowerCase()));
  const currentIds = unresolved.length ? await resolveIds(unresolved) : [];
  const candidateIds = [...new Set([
    ...currentIds.map(String),
    ...names.map((name) => previousByName.get(name.toLowerCase())).filter(Boolean),
  ])];
  if (!candidateIds.length) return [];

  // One batched lookup validates that stored IDs still belong to available
  // accounts. Previously selected IDs win over a recycled username.
  const users = await User.find({
    _id: { $in: candidateIds },
    isActive: true,
    moderationStatus: { $nin: ['suspended', 'banned', 'soft_deleted'] },
  }).select('_id username').lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const byCurrentName = new Map(users.map((user) => [String(user.username).toLowerCase(), user]));

  return names.flatMap((name) => {
    const former = byId.get(previousByName.get(name.toLowerCase()));
    const current = byCurrentName.get(name.toLowerCase());
    const user = former || current;
    return user ? [{ user: user._id, username: name }] : [];
  });
};

module.exports = { resolveBioMentions };
