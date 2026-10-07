const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
const CORE_RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'app', 'arc', 'auth', 'help', 'login',
  'moderator', 'official', 'profile', 'register', 'root', 'settings',
  'squadhunt', 'support', 'system', 'team', 'teams', 'user', 'users'
]);

const normalizeUsernameInput = (value) => String(value || '').replace(/\s/g, '').trim();
const canonicalUsername = (value) => normalizeUsernameInput(value).toLowerCase();
const validateUsernameFormat = (value) => {
  const username = normalizeUsernameInput(value);
  if (!username) return 'Username is required';
  if (username.length < 3 || username.length > 20) return 'Username must be between 3 and 20 characters';
  if (!USERNAME_PATTERN.test(username)) return 'Username can only contain letters, numbers and underscores';
  return '';
};
const isCoreReservedUsername = (value) => CORE_RESERVED_USERNAMES.has(canonicalUsername(value));
const escapeUsernameRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  normalizeUsernameInput,
  canonicalUsername,
  validateUsernameFormat,
  isCoreReservedUsername,
  escapeUsernameRegex
};
