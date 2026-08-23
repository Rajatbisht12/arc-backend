const GAME_RULES = Object.freeze({
  BGMI: {
    required: ['characterId', 'inGameName', 'idLevel', 'role', 'fdRatio', 'currentTier'],
    numeric: { idLevel: { min: 1, max: 100 }, fdRatio: { min: 0 } }
  },
  'Free Fire Max': {
    required: ['inGameName', 'uid', 'level', 'rank', 'role', 'kd', 'matchesPlayed'],
    numeric: { level: { min: 1, max: 100 }, kd: { min: 0 }, matchesPlayed: { min: 0 } }
  },
  Valorant: {
    required: ['inGameName', 'tag', 'rank', 'role'],
    numeric: { rr: { min: 0, max: 100 } }
  },
  'Call of Duty Mobile': {
    required: ['inGameName', 'uid', 'level', 'rank', 'role', 'kd', 'wins'],
    numeric: { level: { min: 1, max: 150 }, kd: { min: 0 }, wins: { min: 0 } }
  },
  'Chess.com': {
    required: ['username', 'rating'],
    numeric: { rating: { min: 100, max: 3000 }, puzzleRating: { min: 100, max: 3000 } }
  },
  'Clash of Clans': {
    required: ['playerTag', 'inGameName', 'townhallLevel'],
    numeric: {
      idLevel: { min: 1, max: 500 }, trophies: { min: 0 }, bestTrophies: { min: 0 },
      warStars: { min: 0 }, attackWins: { min: 0 }, defenseWins: { min: 0 },
      builderHallLevel: { min: 1, max: 10 }, builderBaseTrophies: { min: 0 },
      bestBuilderBaseTrophies: { min: 0 }, totalAttacks: { min: 0 }, winRate: { min: 0, max: 100 }
    }
  },
  'Clash Royale': {
    required: ['playerTag', 'inGameName'],
    numeric: {
      level: { min: 1, max: 100 }, trophies: { min: 0 }, bestTrophies: { min: 0 },
      wins: { min: 0 }, losses: { min: 0 }, battleCount: { min: 0 },
      threeCrownWins: { min: 0 }, winRate: { min: 0, max: 100 }, totalCards: { min: 0 },
      achievementsCount: { min: 0 }, badgesCount: { min: 0 }
    }
  },
  'PUBG Mobile': {
    required: ['inGameName', 'uid', 'level', 'rank', 'role', 'kd', 'matchesPlayed'],
    numeric: { level: { min: 1, max: 100 }, kd: { min: 0 }, matchesPlayed: { min: 0 } }
  },
  Fortnite: {
    required: ['epicUsername', 'level', 'wins', 'kd', 'playstyle'],
    numeric: { level: { min: 1, max: 1000 }, wins: { min: 0 }, kd: { min: 0 } }
  },
  'Rocket League': {
    required: ['inGameName', 'platform', 'rank', 'role', 'wins'],
    numeric: { mmr: { min: 0 }, wins: { min: 0 } }
  },
  Other: {
    required: ['inGameName'],
    numeric: { wins: { min: 0 }, kd: { min: 0 } }
  }
});

const hasValue = (value) => value !== undefined && value !== null && (
  typeof value !== 'string' || value.trim().length > 0
);

const resolveGamingStatsUserId = (authenticatedUser) => (
  authenticatedUser?._id || authenticatedUser?.id || null
);

const findGamingStatIndexes = (stats, game) => {
  if (!Array.isArray(stats)) return [];
  return stats.reduce((indexes, stat, index) => {
    if (String(stat?.game || '').trim() === game) indexes.push(index);
    return indexes;
  }, []);
};

const normalizeGamingStatPayload = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: { field: 'body', message: 'Gaming stats payload is required' } };
  }

  const game = typeof input.game === 'string' ? input.game.trim() : '';
  const rule = GAME_RULES[game];
  if (!rule) {
    return { error: { field: 'game', message: 'Select a supported game' } };
  }

  const value = { ...input, game };
  delete value._id;
  delete value.id;
  delete value.__v;

  for (const field of rule.required) {
    if (!hasValue(value[field])) {
      return { error: { field, message: `${field} is required for ${game}` } };
    }
  }

  for (const [field, bounds] of Object.entries(rule.numeric)) {
    if (!hasValue(value[field])) continue;
    const numericValue = Number(value[field]);
    if (!Number.isFinite(numericValue)) {
      return { error: { field, message: `${field} must be a valid number` } };
    }
    if (typeof bounds.min === 'number' && numericValue < bounds.min) {
      return { error: { field, message: `${field} must be at least ${bounds.min}` } };
    }
    if (typeof bounds.max === 'number' && numericValue > bounds.max) {
      return { error: { field, message: `${field} must be ${bounds.max} or lower` } };
    }
    value[field] = numericValue;
  }

  for (const [field, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'string') value[field] = fieldValue.trim();
  }

  return { value };
};

module.exports = {
  GAME_RULES,
  findGamingStatIndexes,
  normalizeGamingStatPayload,
  resolveGamingStatsUserId
};
