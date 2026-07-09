const assert = require('assert');

const {
  normalizeTournamentHistoryFilters,
  normalizeTournamentHistoryPagination,
  paginateTournamentHistory,
  tournamentHistoryStatus
} = require('./tournamentHistory');

const now = Date.now();

assert.deepStrictEqual(
  normalizeTournamentHistoryPagination({ page: '-7', limit: '999' }),
  { page: 1, limit: 50 }
);
assert.deepStrictEqual(
  normalizeTournamentHistoryPagination({ page: '2', limit: '30' }),
  { page: 2, limit: 30 }
);
assert.strictEqual(normalizeTournamentHistoryFilters({ status: 'Completed' }).valid, true);
assert.strictEqual(normalizeTournamentHistoryFilters({ status: 'not-a-status' }).valid, false);
assert.strictEqual(normalizeTournamentHistoryFilters({ game: 'BGMI' }).valid, true);
assert.strictEqual(normalizeTournamentHistoryFilters({ game: 'Unknown Game' }).valid, false);
assert.strictEqual(normalizeTournamentHistoryFilters({ game: 'x'.repeat(65) }).valid, false);

assert.strictEqual(tournamentHistoryStatus({
  status: 'Registration Open',
  registrationStartDate: new Date(now - 10_000),
  registrationEndDate: new Date(now + 10_000),
  tournamentStartDate: new Date(now + 20_000),
  tournamentEndDate: new Date(now + 30_000)
}), 'Registration Open');

assert.strictEqual(tournamentHistoryStatus({
  status: 'Ongoing',
  registrationStartDate: new Date(now - 40_000),
  registrationEndDate: new Date(now - 30_000),
  tournamentStartDate: new Date(now - 20_000),
  tournamentEndDate: new Date(now - 10_000)
}), 'Completed', 'clock-completed tournaments must not remain Ongoing in history');

assert.strictEqual(tournamentHistoryStatus({
  status: 'Upcoming',
  registrationStartDate: new Date(now + 10_000),
  registrationEndDate: new Date(now + 20_000),
  tournamentStartDate: new Date(now + 30_000),
  tournamentEndDate: new Date(now + 40_000)
}), 'Upcoming', 'granular pre-registration phases must preserve the public history enum');

assert.deepStrictEqual(paginateTournamentHistory(['a', 'b', 'c'], 2, 2), {
  items: ['c'],
  pagination: {
    page: 2,
    currentPage: 2,
    limit: 2,
    total: 3,
    totalPages: 2,
    hasNext: false,
    hasPrev: true
  }
});

assert.deepStrictEqual(paginateTournamentHistory([], 1, 10).pagination, {
  page: 1,
  currentPage: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false
});

console.log('Tournament history utility tests passed');
