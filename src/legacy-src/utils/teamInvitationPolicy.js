const TEAM_ROLE_MAX_LENGTH = 40;
const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ROSTER_GAMES = Object.freeze([
  'BGMI',
  'Valorant',
  'Free Fire',
  'Call of Duty Mobile'
]);

const STAFF_GAMES = Object.freeze([...ROSTER_GAMES, 'General']);

const INVITE_TYPES = Object.freeze(['roster', 'staff']);
const INVITE_RESPONSES = Object.freeze(['accept', 'decline']);
const INVITE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'cancelled', 'expired']);

const normalizeTeamRole = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
};

const isValidTeamRole = (value) => {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F-\u009F]/u.test(value)) return false;
  const role = normalizeTeamRole(value);
  return Boolean(role)
    && role.length <= TEAM_ROLE_MAX_LENGTH
    && role !== '__custom__';
};

const assertTeamRole = (value) => {
  if (!isValidTeamRole(value)) {
    const error = new Error(`Role must be between 1 and ${TEAM_ROLE_MAX_LENGTH} characters`);
    error.status = 400;
    error.code = 'INVALID_TEAM_ROLE';
    throw error;
  }
  return normalizeTeamRole(value);
};

const normalizeInviteGame = (type, value) => {
  if (type === 'staff' && (value === undefined || value === null || value === '')) return 'General';
  return typeof value === 'string' ? value.trim() : '';
};

const isValidInviteGame = (type, value) => {
  const game = normalizeInviteGame(type, value);
  return (type === 'roster' ? ROSTER_GAMES : STAFF_GAMES).includes(game);
};

const buildPendingInviteKey = ({ type, team, player, game }) => {
  if (!INVITE_TYPES.includes(type)) throw new TypeError('Invalid team invite type');
  const normalizedGame = normalizeInviteGame(type, game);
  return `${type}:${String(team)}:${String(player)}:${normalizedGame}`;
};

module.exports = {
  TEAM_ROLE_MAX_LENGTH,
  TEAM_INVITE_TTL_MS,
  ROSTER_GAMES,
  STAFF_GAMES,
  INVITE_TYPES,
  INVITE_RESPONSES,
  INVITE_STATUSES,
  normalizeTeamRole,
  isValidTeamRole,
  assertTeamRole,
  normalizeInviteGame,
  isValidInviteGame,
  buildPendingInviteKey
};
