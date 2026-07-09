const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;
const EXPLICIT_OFFSET_PATTERN = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

const TOURNAMENT_TIMEZONE_ALIASES = Object.freeze({
  UTC: 'UTC',
  // The legacy UI labelled GMT as "GMT (UK)"; use the UK civil timezone so
  // summer dates observe BST exactly like the Web reference implementation.
  GMT: 'Europe/London',
  IST: 'Asia/Kolkata',
  EST: 'America/New_York',
  PST: 'America/Los_Angeles'
});

const normalizeTournamentTimezone = (value = 'UTC') => {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';
  const normalized = TOURNAMENT_TIMEZONE_ALIASES[candidate.toUpperCase()] || candidate;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return normalized;
  } catch (_error) {
    return null;
  }
};

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
};

const wallTimeValue = (parts) => Date.UTC(
  parts.year,
  parts.month - 1,
  parts.day,
  parts.hour || 0,
  parts.minute || 0,
  parts.second || 0,
  parts.millisecond || 0
);

const sameWallTime = (left, right) => (
  left.year === right.year
  && left.month === right.month
  && left.day === right.day
  && (left.hour || 0) === (right.hour || 0)
  && (left.minute || 0) === (right.minute || 0)
  && (left.second || 0) === (right.second || 0)
);

const isRealCalendarDate = (parts) => {
  const candidate = new Date(wallTimeValue(parts));
  return candidate.getUTCFullYear() === parts.year
    && candidate.getUTCMonth() + 1 === parts.month
    && candidate.getUTCDate() === parts.day
    && candidate.getUTCHours() === (parts.hour || 0)
    && candidate.getUTCMinutes() === (parts.minute || 0)
    && candidate.getUTCSeconds() === (parts.second || 0);
};

const zonedPartsToDate = (parts, timeZone) => {
  if (!isRealCalendarDate(parts)) return null;
  const desiredWallTime = wallTimeValue(parts);
  const offsets = new Set();
  // Sampling both sides of the requested date covers normal offsets and DST
  // transitions without depending on the container's local timezone.
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    const sample = new Date(desiredWallTime + (hours * 60 * 60 * 1000));
    // Intl.DateTimeFormat below resolves to whole seconds. Keeping the desired
    // fractional milliseconds on the offset sample subtracts them twice
    // (e.g. .123 becomes .246), so calculate zone offsets at a whole second.
    sample.setUTCMilliseconds(0);
    offsets.add(wallTimeValue(getZonedParts(sample, timeZone)) - sample.getTime());
  }
  const exactCandidates = Array.from(offsets)
    .map((offset) => new Date(desiredWallTime - offset))
    .filter((candidate) => sameWallTime(getZonedParts(candidate, timeZone), parts))
    .sort((left, right) => left.getTime() - right.getTime());
  // Repeated DST wall times resolve to the first occurrence. Non-existent DST
  // wall times are rejected instead of silently scheduling at a different time.
  return exactCandidates[0] || null;
};

/**
 * Parse an API timestamp into an absolute instant.
 *
 * ISO timestamps carrying Z or an explicit offset are already unambiguous and
 * are parsed as-is. Values emitted by <input type="datetime-local"> have no
 * offset, so they are interpreted in the explicitly supplied tournament zone.
 */
const parseTournamentDateTime = (value, timezone = 'UTC') => {
  if (value instanceof Date || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (EXPLICIT_OFFSET_PATTERN.test(input)) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = input.match(LOCAL_DATE_TIME_PATTERN);
  if (!match) return null;
  const timeZone = normalizeTournamentTimezone(timezone);
  if (!timeZone) return null;
  return zonedPartsToDate({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
    millisecond: Number(String(match[7] || '0').padEnd(3, '0'))
  }, timeZone);
};

const formatTournamentLocalDateTime = (value, timezone = 'UTC') => {
  const date = value instanceof Date ? value : new Date(value);
  const timeZone = normalizeTournamentTimezone(timezone);
  if (!timeZone || Number.isNaN(date.getTime())) return null;
  const parts = getZonedParts(date, timeZone);
  const pad = (number) => String(number).padStart(2, '0');
  return {
    scheduledDate: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    scheduledTimeString: `${pad(parts.hour)}:${pad(parts.minute)}`,
    timezone: timeZone
  };
};

/**
 * Resolve the match instant represented by the Web schedule editor.
 *
 * The editor sends its visible date/time fields as well as an ISO timestamp
 * produced in the browser timezone. The visible fields are authoritative and
 * must be interpreted in the tournament timezone; otherwise an organizer in a
 * different zone sees the saved match shift after refresh.
 */
const resolveTournamentMatchDateTime = (value = {}, timezone = 'UTC') => {
  const scheduledDate = typeof value.scheduledDate === 'string'
    ? value.scheduledDate.trim()
    : '';
  const scheduledTimeString = typeof value.scheduledTimeString === 'string'
    ? value.scheduledTimeString.trim()
    : '';

  if (scheduledDate && scheduledTimeString) {
    return parseTournamentDateTime(
      `${scheduledDate}T${scheduledTimeString}`,
      timezone
    );
  }

  return parseTournamentDateTime(value.scheduledTime, timezone);
};

const validDate = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const tournamentDates = (tournament = {}) => ({
  registrationStart: validDate(tournament.registrationStartDate),
  registrationEnd: validDate(tournament.registrationEndDate || tournament.registrationDeadline),
  tournamentStart: validDate(tournament.tournamentStartDate || tournament.startDate),
  tournamentEnd: validDate(tournament.tournamentEndDate || tournament.endDate)
});

const getTournamentPhase = (tournament = {}, nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  if (tournament.status === 'Cancelled') return 'Cancelled';
  if (tournament.status === 'Completed') return 'Completed';
  const dates = tournamentDates(tournament);
  if (!dates.registrationEnd || !dates.tournamentStart) {
    return tournament.status || 'Upcoming';
  }
  // A manual start can move the tournament to Ongoing early, but it must not
  // keep an already-ended tournament alive forever.
  if (tournament.status === 'Ongoing'
    && (!dates.tournamentEnd || now <= dates.tournamentEnd)) return 'Ongoing';

  // A host may explicitly open registration before its scheduled start.
  if (tournament.status === 'Registration Open' && now <= dates.registrationEnd) {
    return 'Registration Open';
  }
  if (dates.registrationStart && now < dates.registrationStart) return 'Upcoming Registration';
  if ((!dates.registrationStart || now >= dates.registrationStart) && now <= dates.registrationEnd) {
    return 'Registration Open';
  }
  if (now > dates.registrationEnd && now < dates.tournamentStart) return 'Registration Closed';
  if (!dates.tournamentEnd || now <= dates.tournamentEnd) return 'Ongoing';
  return 'Completed';
};

const isTournamentRegistrationOpen = (tournament, nowValue = new Date()) => (
  getTournamentPhase(tournament, nowValue) === 'Registration Open'
);

const canTournamentStart = (tournament, nowValue = new Date()) => (
  ['Registration Open', 'Registration Closed', 'Ongoing']
    .includes(getTournamentPhase(tournament, nowValue))
);

const getNextTournamentTransitionAt = (tournament = {}, nowValue = new Date()) => {
  const phase = getTournamentPhase(tournament, nowValue);
  const dates = tournamentDates(tournament);
  if (phase === 'Upcoming Registration') return dates.registrationStart;
  if (phase === 'Registration Open') return dates.registrationEnd;
  if (phase === 'Registration Closed') return dates.tournamentStart;
  if (phase === 'Ongoing') return dates.tournamentEnd;
  return null;
};

const registrationWindowQuery = (nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  return {
    status: { $in: ['Upcoming', 'Registration Open'] },
    $and: [
      {
        $or: [
          { registrationEndDate: { $gte: now } },
          { registrationEndDate: null, registrationDeadline: { $gte: now } }
        ]
      },
      {
        $or: [
          { status: 'Registration Open' },
          { registrationStartDate: { $lte: now } },
          // Legacy rows without an explicit open timestamp historically used
          // status/deadline only. Treat a non-terminal row with a future
          // deadline as open, matching getTournamentPhase's compatibility rule.
          { registrationStartDate: null }
        ]
      }
    ]
  };
};

const upcomingWindowQuery = (nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  return {
    status: 'Upcoming',
    registrationStartDate: { $gt: now }
  };
};

const registrationClosedWindowQuery = (nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  return {
    status: { $in: ['Upcoming', 'Registration Open'] },
    $and: [
      {
        $or: [
          { registrationEndDate: { $lt: now } },
          { registrationEndDate: null, registrationDeadline: { $lt: now } }
        ]
      },
      {
        $or: [
          { tournamentStartDate: { $gt: now } },
          { tournamentStartDate: null, startDate: { $gt: now } }
        ]
      }
    ]
  };
};

const ongoingWindowQuery = (nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  return {
    status: { $in: ['Upcoming', 'Registration Open', 'Ongoing'] },
    $and: [
      {
        $or: [
          { status: 'Ongoing' },
          { tournamentStartDate: { $lte: now } },
          { tournamentStartDate: null, startDate: { $lte: now } }
        ]
      },
      {
        $or: [
          { tournamentEndDate: { $gte: now } },
          { tournamentEndDate: null, endDate: { $gte: now } },
          { tournamentEndDate: null, endDate: null }
        ]
      }
    ]
  };
};

const completedWindowQuery = (nowValue = new Date()) => {
  const now = validDate(nowValue) || new Date();
  return {
    $or: [
      { status: 'Completed' },
      {
        status: { $in: ['Upcoming', 'Registration Open', 'Ongoing'] },
        $or: [
          { tournamentEndDate: { $lt: now } },
          { tournamentEndDate: null, endDate: { $lt: now } }
        ]
      }
    ]
  };
};

module.exports = {
  TOURNAMENT_TIMEZONE_ALIASES,
  normalizeTournamentTimezone,
  parseTournamentDateTime,
  formatTournamentLocalDateTime,
  resolveTournamentMatchDateTime,
  tournamentDates,
  getTournamentPhase,
  getNextTournamentTransitionAt,
  isTournamentRegistrationOpen,
  canTournamentStart,
  registrationWindowQuery,
  upcomingWindowQuery,
  registrationClosedWindowQuery,
  ongoingWindowQuery,
  completedWindowQuery,
  _private: {
    getZonedParts,
    zonedPartsToDate
  }
};
