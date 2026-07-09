const rawReferenceArray = (tournament, path) => {
  if (typeof tournament?.populated === 'function') {
    const originalIds = tournament.populated(path);
    if (Array.isArray(originalIds)) return originalIds;
  }
  return Array.isArray(tournament?.[path]) ? tournament[path] : [];
};

const registeredCountForFormat = (tournament = {}) => {
  // Mongoose populate with `match: { isActive: true }` intentionally removes
  // inactive/orphan rows from public arrays. `populated(path)` retains the raw
  // identifiers used by Mongo's atomic $size admission predicate, so capacity
  // remains identical on cards and during the join write until migration
  // reconciles legacy references.
  const teams = rawReferenceArray(tournament, 'teams').length;
  if (tournament.format !== 'Solo') return teams;
  const participants = rawReferenceArray(tournament, 'participants').length;
  return participants + teams;
};

const getTournamentCapacity = (tournament = {}) => {
  const used = registeredCountForFormat(tournament);
  const total = Math.max(0, Number(tournament.totalSlots) || 0);
  return {
    used,
    total,
    remaining: Math.max(0, total - used),
    isFull: total > 0 && used >= total
  };
};

const mongoCapacityUsedExpression = (format) => {
  const teamCount = { $size: { $ifNull: ['$teams', []] } };
  if (format !== 'Solo') return teamCount;
  return {
    $add: [
      { $size: { $ifNull: ['$participants', []] } },
      teamCount
    ]
  };
};

module.exports = {
  rawReferenceArray,
  registeredCountForFormat,
  getTournamentCapacity,
  mongoCapacityUsedExpression
};
