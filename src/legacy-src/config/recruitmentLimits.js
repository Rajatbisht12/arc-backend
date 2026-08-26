// Canonical, single source of truth for Recruitment monthly quotas. Nothing else
// in the codebase should hard-code these numbers — controllers, the usage
// service, and the entitlements endpoint all read from here so Web and Mobile
// render exactly what the backend enforces.
//
// Product rules (monthly, calendar month in UTC):
//   PLAYER free    -> 2 player cards,  5 recruitment applications (team+staff combined)
//   PLAYER premium -> 10 player cards, 20 recruitment applications (team+staff combined)
//   TEAM   free    -> 7 recruitment posts (roster+staff combined)
//   TEAM   premium -> 30 recruitment posts (roster+staff combined)
// Premium also grants existing recruitment visibility boost (see recruitmentPolicy).

const RECRUITMENT_LIMITS = Object.freeze({
  player: {
    free: Object.freeze({ playerCardsPerMonth: 2, applicationsPerMonth: 5 }),
    premium: Object.freeze({ playerCardsPerMonth: 10, applicationsPerMonth: 20 })
  },
  team: {
    free: Object.freeze({ recruitmentsPerMonth: 7 }),
    premium: Object.freeze({ recruitmentsPerMonth: 30 })
  }
});

// Usage buckets tracked per identity per calendar month.
const USAGE_TYPES = Object.freeze({
  PLAYER_CARD: 'player_card',
  APPLICATION: 'application',
  TEAM_RECRUITMENT: 'team_recruitment'
});

// Structured error codes returned when a monthly quota is exhausted. Clients key
// blocked-state copy / CTAs off these codes, never off message text.
const RECRUITMENT_LIMIT_ERROR_CODES = Object.freeze({
  [USAGE_TYPES.PLAYER_CARD]: 'PLAYER_POST_MONTHLY_LIMIT_REACHED',
  [USAGE_TYPES.APPLICATION]: 'PLAYER_APPLICATION_MONTHLY_LIMIT_REACHED',
  [USAGE_TYPES.TEAM_RECRUITMENT]: 'TEAM_RECRUITMENT_MONTHLY_LIMIT_REACHED'
});

const playerLimits = (tier) =>
  tier === 'premium' ? RECRUITMENT_LIMITS.player.premium : RECRUITMENT_LIMITS.player.free;

const teamLimits = (tier) =>
  tier === 'premium' ? RECRUITMENT_LIMITS.team.premium : RECRUITMENT_LIMITS.team.free;

module.exports = {
  RECRUITMENT_LIMITS,
  USAGE_TYPES,
  RECRUITMENT_LIMIT_ERROR_CODES,
  playerLimits,
  teamLimits
};
