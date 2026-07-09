const assert = require('assert');
const {
  normalizeTournamentTimezone,
  parseTournamentDateTime,
  formatTournamentLocalDateTime,
  resolveTournamentMatchDateTime,
  getTournamentPhase,
  getNextTournamentTransitionAt,
  isTournamentRegistrationOpen,
  canTournamentStart,
  registrationWindowQuery,
  upcomingWindowQuery,
  registrationClosedWindowQuery,
  ongoingWindowQuery,
  completedWindowQuery
} = require('./tournamentDateTime');

const iso = (value) => value && value.toISOString();

// A datetime-local value selected five minutes from now in India must remain
// five minutes away after crossing the API boundary. The former new Date()
// behavior interpreted this value in the ECS timezone and added 5h30m.
const now = new Date('2026-07-09T06:30:00.000Z'); // 12:00 Asia/Kolkata
const fiveMinutesLater = parseTournamentDateTime('2026-07-09T12:05', 'IST');
assert.strictEqual(iso(fiveMinutesLater), '2026-07-09T06:35:00.000Z');
assert.strictEqual(fiveMinutesLater.getTime() - now.getTime(), 5 * 60 * 1000);

assert.strictEqual(iso(parseTournamentDateTime('2026-07-09T12:05', 'UTC')), '2026-07-09T12:05:00.000Z');
assert.strictEqual(iso(parseTournamentDateTime('2026-07-09T12:05:00.123', 'UTC')), '2026-07-09T12:05:00.123Z');
assert.strictEqual(iso(parseTournamentDateTime('2026-07-09T12:05:00.999', 'IST')), '2026-07-09T06:35:00.999Z');
assert.strictEqual(
  iso(parseTournamentDateTime('2026-07-09T06:35:00.000Z', 'America/Los_Angeles')),
  '2026-07-09T06:35:00.000Z'
);
assert.strictEqual(
  iso(parseTournamentDateTime('2026-07-09T12:05:00+05:30', 'America/Los_Angeles')),
  '2026-07-09T06:35:00.000Z',
  'an explicit offset must win over display timezone metadata'
);
assert.strictEqual(normalizeTournamentTimezone('IST'), 'Asia/Kolkata');
assert.strictEqual(normalizeTournamentTimezone('GMT'), 'Europe/London');
assert.strictEqual(
  iso(parseTournamentDateTime('2026-07-09T12:00', 'GMT')),
  '2026-07-09T11:00:00.000Z',
  'legacy GMT (UK) must observe BST in summer'
);
assert.strictEqual(parseTournamentDateTime('2026-02-30T12:00', 'UTC'), null);
assert.strictEqual(parseTournamentDateTime('2026-07-09T12:00', 'Not/AZone'), null);
assert.deepStrictEqual(
  formatTournamentLocalDateTime('2026-07-09T06:35:00.000Z', 'IST'),
  { scheduledDate: '2026-07-09', scheduledTimeString: '12:05', timezone: 'Asia/Kolkata' }
);
assert.strictEqual(
  iso(resolveTournamentMatchDateTime({
    // Browser ISO is deliberately different: the visible tournament-local
    // fields must remain authoritative.
    scheduledTime: '2026-07-09T12:05:00.000Z',
    scheduledDate: '2026-07-09',
    scheduledTimeString: '12:05'
  }, 'Asia/Kolkata')),
  '2026-07-09T06:35:00.000Z'
);
assert.strictEqual(
  iso(resolveTournamentMatchDateTime({
    scheduledTime: '2026-07-09T06:35:00.000Z'
  }, 'Asia/Kolkata')),
  '2026-07-09T06:35:00.000Z',
  'Mobile/legacy clients that send only an absolute instant remain supported'
);
const legacyRegistrationEnd = new Date('2026-07-09T06:35:00.000Z');
const legacyFallback = new Date(legacyRegistrationEnd.getTime() - 60_000);
const fallbackLocal = formatTournamentLocalDateTime(legacyFallback, 'IST');
const fallbackRoundTrip = parseTournamentDateTime(
  `${fallbackLocal.scheduledDate}T${fallbackLocal.scheduledTimeString}`,
  'IST'
);
assert(fallbackRoundTrip < legacyRegistrationEnd, 'minute-precision clients must preserve start < end');
assert.strictEqual(
  parseTournamentDateTime('2026-03-08T02:30', 'America/New_York'),
  null,
  'a non-existent DST wall time must not silently move the tournament'
);

const scheduledTournament = {
  status: 'Upcoming',
  registrationStartDate: '2026-07-09T06:00:00.000Z',
  registrationEndDate: '2026-07-09T06:34:00.000Z',
  tournamentStartDate: '2026-07-09T06:35:00.000Z',
  tournamentEndDate: '2026-07-09T08:35:00.000Z'
};
assert.strictEqual(getTournamentPhase(scheduledTournament, now), 'Registration Open');
assert.strictEqual(isTournamentRegistrationOpen(scheduledTournament, now), true);
assert.strictEqual(
  getTournamentPhase(scheduledTournament, new Date('2026-07-09T06:34:00.000Z')),
  'Registration Open',
  'registration remains open through its inclusive deadline'
);
assert.strictEqual(
  getTournamentPhase(scheduledTournament, new Date('2026-07-09T06:34:30.000Z')),
  'Registration Closed'
);
assert.strictEqual(
  getTournamentPhase(scheduledTournament, new Date('2026-07-09T06:36:00.000Z')),
  'Ongoing'
);
assert.strictEqual(
  getTournamentPhase(scheduledTournament, new Date('2026-07-09T09:00:00.000Z')),
  'Completed'
);
assert.strictEqual(
  getTournamentPhase({ ...scheduledTournament, status: 'Cancelled' }, now),
  'Cancelled'
);
assert.strictEqual(
  getTournamentPhase({
    ...scheduledTournament,
    status: 'Registration Open',
    registrationStartDate: '2026-07-09T07:00:00.000Z'
  }, now),
  'Registration Open',
  'manual early-open is preserved'
);
assert.strictEqual(
  iso(getNextTournamentTransitionAt(scheduledTournament, now)),
  '2026-07-09T06:34:00.000Z'
);
assert.strictEqual(canTournamentStart(scheduledTournament, now), true);
assert.strictEqual(
  canTournamentStart(scheduledTournament, new Date('2026-07-09T05:30:00.000Z')),
  false,
  'a host cannot start before the registration window'
);
assert.strictEqual(
  canTournamentStart(scheduledTournament, new Date('2026-07-09T06:34:30.000Z')),
  true,
  'a host can start after registration closes'
);
assert.strictEqual(
  canTournamentStart({ ...scheduledTournament, status: 'Cancelled' }, now),
  false
);
assert.strictEqual(
  getTournamentPhase(
    { ...scheduledTournament, status: 'Ongoing' },
    new Date('2026-07-09T09:00:00.000Z')
  ),
  'Completed',
  'manual Ongoing status must not survive beyond the configured end time'
);

const query = registrationWindowQuery(now);
assert.deepStrictEqual(query.status.$in, ['Upcoming', 'Registration Open']);
assert(Array.isArray(query.$and) && query.$and.length === 2);
assert.strictEqual(upcomingWindowQuery(now).status, 'Upcoming');
assert.strictEqual(upcomingWindowQuery(now).registrationStartDate.$gt.toISOString(), now.toISOString());
assert.deepStrictEqual(registrationClosedWindowQuery(now).status.$in, ['Upcoming', 'Registration Open']);
assert.strictEqual(registrationClosedWindowQuery(now).$and.length, 2);
assert.strictEqual(ongoingWindowQuery(now).status.$in.includes('Ongoing'), true);
assert.strictEqual(Array.isArray(completedWindowQuery(now).$or), true);

console.log('Tournament date/time contract tests passed');
