const UsernameRegistry = require('../models/UsernameRegistry');
const { canonicalUsername, validateUsernameFormat } = require('../utils/usernamePolicy');

// The registry's unique normalizedUsername index is the same namespace used
// for signup, rename, and reservations. Resolve to the stable User ID before
// applying profile/privacy filters; never use an unindexed case-insensitive
// regex on the User collection for account identity.
async function usernameOwnerId(value) {
  // Existing profile routes historically accepted a slightly wider identifier
  // alphabet than new signups. Resolve legacy records too; the registry query
  // is an exact indexed string lookup, never a user-controlled regex.
  if (typeof value !== 'string' || !value || value.length > 100) return null;
  const normalizedUsername = canonicalUsername(value);
  if (!normalizedUsername) return null;
  const claim = await UsernameRegistry.findOne({ normalizedUsername })
    .select('kind ownerId').lean();
  if (claim?.kind === 'user' && claim.ownerId) return claim.ownerId;

  // The official system account may coexist with a permanent reservation,
  // rather than a user claim. Its exact canonical record is indexed by User.
  if (normalizedUsername === 'squadhunt') {
    const User = require('../models/User');
    const official = await User.findOne({
      username: 'SquadHunt', isSystemAccount: true, userType: 'system'
    }).select('_id').lean();
    return official?._id || null;
  }
  // Preserve exact-case reads while an older deployment's users are being
  // backfilled into the registry. Mixed-case reads require the verified claim.
  if (!claim) {
    const User = require('../models/User');
    const legacy = await User.findOne({ username: value }).select('_id').lean();
    return legacy?._id || null;
  }
  return null;
}

async function usernameOwnerFilter(value, additional = {}) {
  const ownerId = await usernameOwnerId(value);
  return { ...additional, _id: ownerId || null };
}

async function usernameOwnerIds(values) {
  const names = [...new Set(values
    .filter((value) => !validateUsernameFormat(value))
    .map(canonicalUsername))];
  if (!names.length) return [];
  const claims = await UsernameRegistry.find({
    normalizedUsername: { $in: names }, kind: 'user'
  }).select('ownerId').lean();
  const ids = claims.map((claim) => claim.ownerId).filter(Boolean);
  if (names.includes('squadhunt')) {
    const officialId = await usernameOwnerId('SquadHunt');
    if (officialId) ids.push(officialId);
  }
  return [...new Set(ids.map(String))];
}

module.exports = { usernameOwnerId, usernameOwnerFilter, usernameOwnerIds };
