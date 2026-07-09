const { getTournamentPhase } = require('./tournamentDateTime');

const HISTORY_STATUSES = Object.freeze([
  'Upcoming',
  'Registration Open',
  'Ongoing',
  'Completed',
  'Cancelled'
]);

const HISTORY_STATUS_SET = new Set(HISTORY_STATUSES);
const HISTORY_GAME_SET = new Set([
  'BGMI',
  'Valorant',
  'Free Fire',
  'Call of Duty Mobile'
]);

const normalizePositiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const normalizeTournamentHistoryPagination = (query = {}, options = {}) => {
  const defaultLimit = options.defaultLimit || 10;
  const maxLimit = options.maxLimit || 50;
  return {
    page: normalizePositiveInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
    limit: normalizePositiveInteger(query.limit, defaultLimit, maxLimit)
  };
};

const normalizeTournamentHistoryFilters = (query = {}) => {
  const game = typeof query.game === 'string' ? query.game.trim() : '';
  const status = typeof query.status === 'string' ? query.status.trim() : '';

  if (game && !HISTORY_GAME_SET.has(game)) {
    return { valid: false, message: 'Invalid game filter' };
  }
  if (status && !HISTORY_STATUS_SET.has(status)) {
    return { valid: false, message: 'Invalid tournament status filter' };
  }

  return { valid: true, game, status };
};

/**
 * History documents intentionally use the original five-value status enum.
 * Clock-derived phases that are more granular are mapped back to that enum so
 * existing Web and Mobile clients keep their established response contract.
 */
const tournamentHistoryStatus = (tournament = {}, fallback = 'Upcoming') => {
  const effectiveStatus = getTournamentPhase(tournament);
  if (effectiveStatus === 'Upcoming Registration' || effectiveStatus === 'Registration Closed') {
    return 'Upcoming';
  }
  if (HISTORY_STATUS_SET.has(effectiveStatus)) return effectiveStatus;
  return HISTORY_STATUS_SET.has(fallback) ? fallback : 'Upcoming';
};

const paginateTournamentHistory = (items, page, limit) => {
  const records = Array.isArray(items) ? items : [];
  const total = records.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  return {
    items: records.slice(offset, offset + limit),
    pagination: {
      page,
      currentPage: page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1 && totalPages > 0
    }
  };
};

module.exports = {
  HISTORY_STATUSES,
  normalizeTournamentHistoryFilters,
  normalizeTournamentHistoryPagination,
  paginateTournamentHistory,
  tournamentHistoryStatus
};
