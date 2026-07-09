#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { normalizeTournamentTimezone, getTournamentPhase } = require(path.resolve(
  __dirname,
  '..',
  'src',
  'legacy-src',
  'utils',
  'tournamentDateTime.js'
));

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const loadModels = () => [
  require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'Tournament.js')),
  require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'TournamentHostActiveLock.js')),
  require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'PaymentTransaction.js')),
  require(path.resolve(__dirname, '..', 'src', 'legacy-src', 'models', 'User.js'))
];

const normalizeKey = (key) => JSON.stringify(Object.entries(key || {}));
const normalizeOptions = (options = {}) => ({
  unique: options.unique === true,
  sparse: options.sparse === true,
  expireAfterSeconds: Object.prototype.hasOwnProperty.call(options, 'expireAfterSeconds')
    ? Number(options.expireAfterSeconds)
    : null
});

const matches = (expectedKey, expectedOptions, actual) => (
  normalizeKey(actual.key) === normalizeKey(expectedKey)
  && JSON.stringify(normalizeOptions(actual)) === JSON.stringify(normalizeOptions(expectedOptions))
);

const verifyIndexes = async (Model) => {
  const expected = Model.schema.indexes();
  const actual = await Model.collection.indexes();
  const missing = expected.filter(([key, options]) => (
    !actual.some((index) => matches(key, options, index))
  ));
  if (missing.length > 0) {
    throw new Error(`${Model.modelName} is missing or has incompatible indexes: ${missing
      .map(([key, options]) => `${normalizeKey(key)} ${JSON.stringify(normalizeOptions(options))}`)
      .join(', ')}`);
  }
  console.log(`verified ${Model.modelName}: ${expected.length} declared indexes`);
};

const verifyNoDuplicateHostLocks = async (HostLock) => {
  const duplicates = await HostLock.aggregate([
    { $group: { _id: '$host', count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
    { $limit: 1 }
  ]);
  if (duplicates.length > 0) {
    throw new Error('TournamentHostActiveLock contains duplicate hosts; reconcile them before creating the unique index');
  }
};

const sameInstant = (left, right) => {
  if (!left || !right) return left == null && right == null;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return !Number.isNaN(leftTime) && leftTime === rightTime;
};

const auditTournamentDates = async (Tournament) => {
  const summary = {
    scanned: 0,
    invalidOrMissingDates: 0,
    invalidChronology: 0,
    legacyFieldMismatches: 0,
    invalidTimezones: 0,
    staleLifecycleStatuses: 0,
    samples: []
  };
  const cursor = Tournament.find({})
    .select('_id name status timezone registrationStartDate registrationEndDate registrationDeadline tournamentStartDate startDate tournamentEndDate endDate')
    .lean()
    .cursor();
  for await (const tournament of cursor) {
    summary.scanned += 1;
    const regStart = new Date(tournament.registrationStartDate).getTime();
    const regEnd = new Date(tournament.registrationEndDate).getTime();
    const tourStart = new Date(tournament.tournamentStartDate).getTime();
    const tourEnd = new Date(tournament.tournamentEndDate).getTime();
    const invalidDates = [regStart, regEnd, tourStart, tourEnd].some(Number.isNaN);
    const invalidChronology = !invalidDates
      && !(regStart < regEnd && regEnd <= tourStart && tourStart < tourEnd);
    const legacyMismatch = !sameInstant(tournament.registrationEndDate, tournament.registrationDeadline)
      || !sameInstant(tournament.tournamentStartDate, tournament.startDate)
      || !sameInstant(tournament.tournamentEndDate, tournament.endDate);
    const invalidTimezone = !normalizeTournamentTimezone(tournament.timezone || 'UTC');
    const staleLifecycleStatus = ['Upcoming', 'Registration Open', 'Ongoing'].includes(tournament.status)
      && getTournamentPhase(tournament) === 'Completed';
    if (invalidDates) summary.invalidOrMissingDates += 1;
    if (invalidChronology) summary.invalidChronology += 1;
    if (legacyMismatch) summary.legacyFieldMismatches += 1;
    if (invalidTimezone) summary.invalidTimezones += 1;
    if (staleLifecycleStatus) summary.staleLifecycleStatuses += 1;
    if ((invalidDates || invalidChronology || legacyMismatch || invalidTimezone || staleLifecycleStatus)
      && summary.samples.length < 20) {
      summary.samples.push({
        id: String(tournament._id),
        name: tournament.name,
        invalidDates,
        invalidChronology,
        legacyMismatch,
        invalidTimezone,
        staleLifecycleStatus
      });
    }
  }
  console.log(`tournament date audit: ${JSON.stringify(summary)}`);
  const issueCount = summary.invalidOrMissingDates
    + summary.invalidChronology
    + summary.legacyFieldMismatches
    + summary.invalidTimezones
    + summary.staleLifecycleStatuses;
  if (process.argv.includes('--strict-dates') && issueCount > 0) {
    throw new Error('Tournament date integrity verification failed; review the reported IDs without auto-shifting historical timestamps');
  }
  return summary;
};

const auditLegacyTournamentPayments = async (Tournament, PaymentTransaction) => {
  // Query the raw collection because entryFee is a hidden compatibility field
  // and must never be copied into public API responses.
  const paidRows = await Tournament.collection.find(
    { entryFee: { $gt: 0 } },
    { projection: { _id: 1, name: 1, entryFee: 1, status: 1 }, limit: 20 }
  ).toArray();
  const paidTournamentCount = await Tournament.collection.countDocuments({ entryFee: { $gt: 0 } });
  const transactionCount = await PaymentTransaction.countDocuments({ type: 'tournament' });
  const unresolvedTransactionCount = await PaymentTransaction.countDocuments({
    type: 'tournament',
    status: { $in: ['pending', 'completed'] }
  });
  const references = await PaymentTransaction.find({
    type: 'tournament',
    referenceId: { $ne: null }
  }).select('_id referenceId status').lean();
  const tournamentIds = Array.from(new Set(references.map((entry) => String(entry.referenceId)).filter(Boolean)));
  const existingIds = tournamentIds.length > 0
    ? new Set((await Tournament.find({ _id: { $in: tournamentIds } }).select('_id').lean()).map((entry) => String(entry._id)))
    : new Set();
  const orphanTransactions = references
    .filter((entry) => !existingIds.has(String(entry.referenceId)))
    .slice(0, 20)
    .map((entry) => ({
      transactionId: String(entry._id),
      tournamentId: String(entry.referenceId),
      status: entry.status
    }));
  const summary = {
    paidTournamentCount,
    tournamentTransactionCount: transactionCount,
    unresolvedTransactionCount,
    orphanTournamentTransactionCount: references.filter(
      (entry) => !existingIds.has(String(entry.referenceId))
    ).length,
    paidTournamentSamples: paidRows.map((row) => ({
      id: String(row._id),
      name: row.name,
      entryFee: row.entryFee,
      status: row.status
    })),
    orphanTransactionSamples: orphanTransactions
  };
  console.log(`legacy tournament payment audit: ${JSON.stringify(summary)}`);
  return summary;
};

const migrateGeneratedDuoMarkers = async (Tournament, User, { apply }) => {
  const candidatesByTeam = new Map();
  const cursor = Tournament.find({ format: 'Duo', teams: { $ne: [] } })
    .select('_id teams')
    .lean()
    .cursor();
  for await (const tournament of cursor) {
    const teams = await User.find({
      _id: { $in: tournament.teams || [] },
      userType: 'team',
      'teamInfo.isGeneratedDuo': { $ne: true },
      username: /^duo_/,
      email: /@team\.com$/i,
      'teamInfo.members.1': { $exists: true },
      'teamInfo.members.2': { $exists: false },
      'teamInfo.rosters.0': { $exists: false },
      'teamInfo.staff.0': { $exists: false }
    }).select('_id').lean();
    teams.forEach((team) => {
      const key = String(team._id);
      const current = candidatesByTeam.get(key) || {
        teamId: team._id,
        tournamentIds: new Set()
      };
      current.tournamentIds.add(String(tournament._id));
      candidatesByTeam.set(key, current);
    });
  }

  const ambiguousCandidates = Array.from(candidatesByTeam.values())
    .filter((candidate) => candidate.tournamentIds.size !== 1);
  const candidates = Array.from(candidatesByTeam.values())
    .filter((candidate) => candidate.tournamentIds.size === 1)
    .map((candidate) => ({
      teamId: candidate.teamId,
      tournamentId: Array.from(candidate.tournamentIds)[0]
    }));

  if (apply && ambiguousCandidates.length > 0) {
    throw new Error(
      'Generated Duo marker migration found teams registered in multiple Duo tournaments; reconcile them before applying markers'
    );
  }

  if (apply) {
    for (const candidate of candidates) {
      await User.updateOne(
        { _id: candidate.teamId, 'teamInfo.isGeneratedDuo': { $ne: true } },
        {
          $set: {
            'teamInfo.isGeneratedDuo': true,
            'teamInfo.generatedForTournament': candidate.tournamentId
          }
        }
      );
    }
  }
  console.log(`generated Duo marker audit: ${JSON.stringify({
    candidates: candidates.length,
    ambiguousCandidates: ambiguousCandidates.length,
    applied: apply ? candidates.length : 0,
    samples: candidates.slice(0, 20).map((candidate) => ({
      teamId: String(candidate.teamId),
      tournamentId: String(candidate.tournamentId)
    })),
    ambiguousSamples: ambiguousCandidates.slice(0, 20).map((candidate) => ({
      teamId: String(candidate.teamId),
      tournamentIds: Array.from(candidate.tournamentIds)
    }))
  })}`);
  if (!apply && process.argv.includes('--strict-integrity')
    && (candidates.length > 0 || ambiguousCandidates.length > 0)) {
    throw new Error('Generated Duo markers require migration before strict integrity verification');
  }
  return candidates.length + ambiguousCandidates.length;
};

const auditTournamentReferences = async (Tournament, HostLock, User) => {
  const referenceBuckets = {
    hosts: new Map(),
    participants: new Map(),
    teams: new Map(),
    embeddedEntrants: new Map(),
    embeddedPeople: new Map()
  };
  const addReference = (bucket, value, tournamentId, expectedType = null) => {
    if (!value) return;
    const id = String(value);
    const current = bucket.get(id) || {
      count: 0,
      tournamentIds: new Set(),
      expectedTypes: new Set()
    };
    current.count += 1;
    current.tournamentIds.add(String(tournamentId));
    if (expectedType) current.expectedTypes.add(expectedType);
    bucket.set(id, current);
  };
  const duplicateValues = (values) => {
    const normalized = (values || []).map(String).filter(Boolean);
    return normalized.length - new Set(normalized).size;
  };
  const malformed = {
    missingHostReferences: 0,
    duplicateParticipantReferences: 0,
    duplicateTeamReferences: 0,
    duplicateDuoMemberReservations: 0,
    participantTeamOverlapReferences: 0,
    embeddedEntrantsOutsideRegistration: 0,
    affectedTournamentIds: new Set()
  };
  const tournamentCursor = Tournament.find({})
    .select([
      '_id',
      'name',
      'format',
      'host',
      'participants',
      'teams',
      '+duoRegistrationMembers',
      'groups.participants',
      'matches.team1',
      'matches.team2',
      'matches.winner',
      'groupResults.teams.teamId',
      'qualifications.qualifiedTeams',
      'winners.team',
      'finalResult.standings.teamId',
      'finalResult.specialPrizeWinners.winnerId',
      'specialPrizes.winnerId'
    ].join(' '))
    .lean()
    .cursor();
  for await (const tournament of tournamentCursor) {
    const tournamentId = String(tournament._id);
    const expectedEntrantType = tournament.format === 'Solo' ? 'non-team' : 'team';
    const participants = tournament.participants || [];
    const teams = tournament.teams || [];
    const duoMembers = tournament.duoRegistrationMembers || [];
    const registeredEntrants = new Set([...participants, ...teams].map(String).filter(Boolean));
    if (!tournament.host) {
      malformed.missingHostReferences += 1;
      malformed.affectedTournamentIds.add(tournamentId);
    } else {
      addReference(referenceBuckets.hosts, tournament.host, tournamentId);
    }
    participants.forEach((id) => addReference(
      referenceBuckets.participants,
      id,
      tournamentId,
      'non-team'
    ));
    teams.forEach((id) => addReference(referenceBuckets.teams, id, tournamentId, 'team'));
    duoMembers.forEach((id) => addReference(
      referenceBuckets.embeddedPeople,
      id,
      tournamentId,
      'non-team'
    ));

    const duplicateParticipants = duplicateValues(participants);
    const duplicateTeams = duplicateValues(teams);
    const duplicateDuoMembers = duplicateValues(duoMembers);
    const participantIds = new Set(participants.map(String));
    const overlaps = teams.filter((id) => participantIds.has(String(id))).length;
    malformed.duplicateParticipantReferences += duplicateParticipants;
    malformed.duplicateTeamReferences += duplicateTeams;
    malformed.duplicateDuoMemberReservations += duplicateDuoMembers;
    malformed.participantTeamOverlapReferences += overlaps;
    if (duplicateParticipants || duplicateTeams || duplicateDuoMembers || overlaps) {
      malformed.affectedTournamentIds.add(tournamentId);
    }

    const addEmbeddedEntrant = (value) => {
      if (!value) return;
      addReference(
        referenceBuckets.embeddedEntrants,
        value,
        tournamentId,
        expectedEntrantType
      );
      if (!registeredEntrants.has(String(value))) {
        malformed.embeddedEntrantsOutsideRegistration += 1;
        malformed.affectedTournamentIds.add(tournamentId);
      }
    };
    (tournament.groups || []).forEach((group) => (
      (group.participants || []).forEach(addEmbeddedEntrant)
    ));
    (tournament.matches || []).forEach((match) => {
      addEmbeddedEntrant(match.team1);
      addEmbeddedEntrant(match.team2);
      addEmbeddedEntrant(match.winner);
    });
    (tournament.groupResults || []).forEach((result) => (
      (result.teams || []).forEach((entry) => addEmbeddedEntrant(entry.teamId))
    ));
    (tournament.qualifications || []).forEach((qualification) => (
      (qualification.qualifiedTeams || []).forEach(addEmbeddedEntrant)
    ));
    (tournament.winners || []).forEach((winner) => addEmbeddedEntrant(winner.team));
    (tournament.finalResult?.standings || []).forEach((standing) => (
      addEmbeddedEntrant(standing.teamId)
    ));
    (tournament.specialPrizes || []).forEach((prize) => addReference(
      referenceBuckets.embeddedPeople,
      prize.winnerId,
      tournamentId
    ));
    (tournament.finalResult?.specialPrizeWinners || []).forEach((prize) => addReference(
      referenceBuckets.embeddedPeople,
      prize.winnerId,
      tournamentId
    ));
  }

  const allReferenceEntries = Object.values(referenceBuckets).flatMap((bucket) => (
    Array.from(bucket.entries())
  ));
  const referencedUserIds = Array.from(new Set(allReferenceEntries.map(([id]) => id)));
  const activeUsers = referencedUserIds.length > 0
    ? await User.find({ _id: { $in: referencedUserIds }, isActive: true })
      .select('_id userType')
      .lean()
    : [];
  const activeById = new Map(activeUsers.map((user) => [String(user._id), user]));
  const invalidEntries = (bucket, validator) => Array.from(bucket.entries())
    .filter(([id, details]) => !validator(activeById.get(id), details));
  const invalidHostEntries = invalidEntries(referenceBuckets.hosts, (user) => Boolean(user));
  const invalidParticipantEntries = invalidEntries(
    referenceBuckets.participants,
    (user) => Boolean(user) && user.userType !== 'team'
  );
  const invalidTeamEntries = invalidEntries(
    referenceBuckets.teams,
    (user) => user?.userType === 'team'
  );
  const matchesExpectedTypes = (user, details) => Boolean(user)
    && Array.from(details.expectedTypes).every((type) => (
      type === 'non-team' ? user.userType !== 'team' : user.userType === type
    ));
  const invalidEmbeddedEntrantEntries = invalidEntries(
    referenceBuckets.embeddedEntrants,
    matchesExpectedTypes
  );
  const invalidEmbeddedPeopleEntries = invalidEntries(
    referenceBuckets.embeddedPeople,
    matchesExpectedTypes
  );
  const markInvalidTournaments = (entries) => entries.forEach(([, details]) => (
    details.tournamentIds.forEach((id) => malformed.affectedTournamentIds.add(id))
  ));
  [
    invalidHostEntries,
    invalidParticipantEntries,
    invalidTeamEntries,
    invalidEmbeddedEntrantEntries,
    invalidEmbeddedPeopleEntries
  ].forEach(markInvalidTournaments);
  const locks = await HostLock.find({}).select('host tournament').lean();
  const lockedTournamentIds = locks.map((lock) => lock.tournament).filter(Boolean);
  const lockedTournaments = lockedTournamentIds.length > 0
    ? await Tournament.find({ _id: { $in: lockedTournamentIds } })
      .select('_id host status registrationStartDate registrationEndDate tournamentStartDate tournamentEndDate')
      .lean()
    : [];
  const lockedById = new Map(lockedTournaments.map((tournament) => [String(tournament._id), tournament]));
  const staleLocks = locks.filter((lock) => {
    const tournament = lockedById.get(String(lock.tournament));
    return !tournament
      || String(tournament.host) !== String(lock.host)
      || ['Completed', 'Cancelled'].includes(getTournamentPhase(tournament));
  });
  const affectedTournamentIds = Array.from(malformed.affectedTournamentIds);
  const samples = affectedTournamentIds.length > 0
    ? await Tournament.find({ _id: { $in: affectedTournamentIds.slice(0, 20) } })
      .select('_id name host status')
      .lean()
    : [];
  const countOccurrences = (entries) => entries.reduce(
    (total, [, details]) => total + details.count,
    0
  );
  const summary = {
    invalidOrInactiveHostReferenceCount: countOccurrences(invalidHostEntries),
    missingHostReferenceCount: malformed.missingHostReferences,
    invalidOrInactiveParticipantReferenceCount: countOccurrences(invalidParticipantEntries),
    invalidInactiveOrNonTeamReferenceCount: countOccurrences(invalidTeamEntries),
    invalidOrWrongTypeEmbeddedEntrantReferenceCount: countOccurrences(
      invalidEmbeddedEntrantEntries
    ),
    invalidOrInactiveEmbeddedPersonReferenceCount: countOccurrences(
      invalidEmbeddedPeopleEntries
    ),
    duplicateParticipantReferenceCount: malformed.duplicateParticipantReferences,
    duplicateTeamReferenceCount: malformed.duplicateTeamReferences,
    duplicateDuoMemberReservationCount: malformed.duplicateDuoMemberReservations,
    participantTeamOverlapReferenceCount: malformed.participantTeamOverlapReferences,
    embeddedEntrantOutsideRegistrationCount: malformed.embeddedEntrantsOutsideRegistration,
    affectedTournamentCount: affectedTournamentIds.length,
    staleHostLockCount: staleLocks.length,
    affectedTournamentSamples: samples.map((entry) => ({
      id: String(entry._id),
      name: entry.name,
      host: String(entry.host || ''),
      status: entry.status
    })),
    staleHostLockSamples: staleLocks.slice(0, 20).map((lock) => ({
      host: String(lock.host),
      tournament: String(lock.tournament)
    }))
  };
  console.log(`tournament reference audit: ${JSON.stringify(summary)}`);
  const integrityIssueCount = affectedTournamentIds.length + staleLocks.length;
  if (process.argv.includes('--strict-integrity')
    && integrityIssueCount > 0) {
    throw new Error('Tournament reference integrity verification failed; reconcile the reported records');
  }
  return summary;
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    retryWrites: process.env.MONGODB_TLS === 'true' ? false : true,
    serverSelectionTimeoutMS: 15000,
    ...(process.env.MONGODB_TLS === 'true' ? {
      tls: true,
      ...(process.env.MONGODB_TLS_CA_FILE && fs.existsSync(process.env.MONGODB_TLS_CA_FILE)
        ? { tlsCAFile: process.env.MONGODB_TLS_CA_FILE }
        : {})
    } : {})
  });

  const [Tournament, HostLock, PaymentTransaction, User] = loadModels();
  await verifyNoDuplicateHostLocks(HostLock);
  if (!process.argv.includes('--verify')) {
    await Tournament.createIndexes();
    await HostLock.createIndexes();
    await migrateGeneratedDuoMarkers(Tournament, User, { apply: true });
    console.log('created/confirmed Tournament indexes');
  } else {
    await migrateGeneratedDuoMarkers(Tournament, User, { apply: false });
  }
  await verifyIndexes(Tournament);
  await verifyIndexes(HostLock);
  await auditTournamentDates(Tournament);
  await auditLegacyTournamentPayments(Tournament, PaymentTransaction);
  await auditTournamentReferences(Tournament, HostLock, User);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
