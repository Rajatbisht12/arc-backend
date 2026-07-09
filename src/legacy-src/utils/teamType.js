const TEAM_TYPES = Object.freeze([
  'casual',
  'competitive',
  'professional',
  'semi-pro'
]);

const TEAM_TYPE_ALIASES = Object.freeze({
  casual: 'casual',
  competitive: 'competitive',
  professional: 'professional',
  'semi-pro': 'semi-pro',
  semipro: 'semi-pro',
  'semi pro': 'semi-pro'
});

const normalizeTeamType = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, ' ');
  return TEAM_TYPE_ALIASES[normalized] || null;
};

module.exports = {
  TEAM_TYPES,
  normalizeTeamType
};
