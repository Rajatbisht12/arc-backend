const UsernameRegistry = require('../models/UsernameRegistry');
const {
  canonicalUsername, normalizeUsernameInput, validateUsernameFormat,
  isCoreReservedUsername, escapeUsernameRegex
} = require('../utils/usernamePolicy');

const usernameError = (code, message) => Object.assign(new Error(message), { code });
const reservedError = () => usernameError('USERNAME_RESERVED', 'This username is reserved and cannot be used.');
const takenError = () => usernameError('USERNAME_TAKEN', 'Username is already taken');
const lookup = (username, excludeUserId) => ({
  username: { $regex: `^${escapeUsernameRegex(username)}$`, $options: 'i' },
  ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {})
});

const getUserModel = () => require('../models/User');

async function checkUsername(username, excludeUserId) {
  const name = normalizeUsernameInput(username);
  const formatError = validateUsernameFormat(name);
  if (formatError) return { available: false, code: 'INVALID_USERNAME', message: formatError };
  if (isCoreReservedUsername(name)) return { available: false, code: 'USERNAME_RESERVED', message: reservedError().message };
  const [registry, user] = await Promise.all([
    UsernameRegistry.findOne({ normalizedUsername: canonicalUsername(name) }).select('kind ownerId').lean(),
    getUserModel().findOne(lookup(name, excludeUserId)).select('_id').lean()
  ]);
  if (registry && (registry.kind === 'reservation' || String(registry.ownerId) !== String(excludeUserId || ''))) {
    return { available: false, code: registry.kind === 'reservation' ? 'USERNAME_RESERVED' : 'USERNAME_TAKEN', message: registry.kind === 'reservation' ? reservedError().message : takenError().message };
  }
  if (user) return { available: false, code: 'USERNAME_TAKEN', message: takenError().message };
  return { available: true, code: 'USERNAME_AVAILABLE', message: 'Username is available' };
}

async function claimForUser(username, ownerId, { system = false } = {}) {
  const name = normalizeUsernameInput(username);
  const formatError = validateUsernameFormat(name);
  if (formatError) throw usernameError('INVALID_USERNAME', formatError);
  if (isCoreReservedUsername(name) && !(system && name === 'SquadHunt')) throw reservedError();
  const normalizedUsername = canonicalUsername(name);
  const prior = await UsernameRegistry.findOne({ normalizedUsername }).select('kind ownerId').lean();
  if (prior) {
    if (prior.kind === 'user' && String(prior.ownerId) === String(ownerId)) return false;
    if (system && name === 'SquadHunt' && prior.kind === 'reservation') return false;
    throw prior.kind === 'reservation' ? reservedError() : takenError();
  }
  if (await getUserModel().findOne(lookup(name, ownerId)).select('_id').lean()) throw takenError();
  try {
    await UsernameRegistry.create({ username: name, normalizedUsername, kind: 'user', ownerId });
    return true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await UsernameRegistry.findOne({ normalizedUsername }).select('kind ownerId').lean();
    if (winner?.kind === 'user' && String(winner.ownerId) === String(ownerId)) return false;
    throw winner?.kind === 'reservation' ? reservedError() : takenError();
  }
}

const releaseUserClaim = (username, ownerId, { session } = {}) => UsernameRegistry.deleteOne({
  normalizedUsername: canonicalUsername(username), kind: 'user', ownerId
}, session ? { session } : {});

module.exports = { checkUsername, claimForUser, releaseUserClaim, lookup, reservedError, takenError };
