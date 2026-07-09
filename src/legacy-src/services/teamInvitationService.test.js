const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RosterInvite = require('../models/RosterInvite');
const StaffInvite = require('../models/StaffInvite');
const User = require('../models/User');
const {
  TEAM_ROLE_MAX_LENGTH,
  buildPendingInviteKey,
  isValidTeamRole,
  normalizeTeamRole
} = require('../utils/teamInvitationPolicy');
const {
  activePendingQuery,
  applyStaffMembership,
  createTeamInvitationService
} = require('./teamInvitationService');
const { formatUserDTO } = require('../utils/dto');

const TEAM_ID = '507f1f77bcf86cd799439011';
const PLAYER_ID = '507f1f77bcf86cd799439012';
const INVITE_ID = '507f1f77bcf86cd799439013';

const queryFor = (value) => ({
  select() { return this; },
  session() { return Promise.resolve(value); },
  sort() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const makeSession = () => ({
  transactionCalls: 0,
  ended: false,
  options: null,
  async withTransaction(work, options) {
    this.transactionCalls += 1;
    this.options = options;
    return work();
  },
  async endSession() { this.ended = true; }
});

const makeMemberDocs = () => {
  const saveSessions = [];
  const team = {
    _id: TEAM_ID,
    teamInfo: { rosters: [], staff: [] },
    markModified() {},
    async save(options) { saveSessions.push(['team', options?.session]); return this; }
  };
  const player = {
    _id: PLAYER_ID,
    playerInfo: { joinedTeams: [] },
    markModified() {},
    async save(options) { saveSessions.push(['player', options?.session]); return this; }
  };
  return { team, player, saveSessions };
};

const makeRespondModels = ({ invite, team, player }) => {
  const InviteModel = {
    findById: () => queryFor(invite),
    findOne: (filter) => queryFor(
      String(filter._id) === String(invite._id) && filter.status === invite.status ? invite : null
    )
  };
  const UserModel = {
    findOne(filter) {
      if (filter.userType === 'team' && String(filter._id) === TEAM_ID) return queryFor(team);
      if (filter.userType === 'player' && String(filter._id) === PLAYER_ID) return queryFor(player);
      return queryFor(null);
    }
  };
  return { InviteModel, UserModel };
};

async function run() {
  // Web and Mobile both expose static plus custom role labels up to 40 chars.
  for (const role of ['Entry Fragger', 'Head Coach', 'Social Media Manager', 'Owner', 'x'.repeat(40)]) {
    assert.equal(isValidTeamRole(role), true, `${role} must be accepted`);
  }
  assert.equal(normalizeTeamRole('  Head   Coach  '), 'Head Coach');
  assert.equal(isValidTeamRole('x'.repeat(TEAM_ROLE_MAX_LENGTH + 1)), false);
  assert.equal(isValidTeamRole('__custom__'), false);
  assert.equal(isValidTeamRole('Coach\nOwner'), false);

  const rosterInvite = new RosterInvite({
    team: TEAM_ID,
    player: PLAYER_ID,
    game: 'BGMI',
    role: 'Entry Fragger'
  });
  await rosterInvite.validate();
  assert.equal(
    rosterInvite.pendingKey,
    buildPendingInviteKey({ type: 'roster', team: TEAM_ID, player: PLAYER_ID, game: 'BGMI' })
  );

  const staffInvite = new StaffInvite({
    team: TEAM_ID,
    player: PLAYER_ID,
    game: 'General',
    role: 'Head Coach'
  });
  await staffInvite.validate();
  assert.equal(staffInvite.role, 'Head Coach');

  const teamUser = new User({
    username: 'contract_team',
    email: 'contract-team@example.com',
    password: 'Testing123!',
    userType: 'team',
    profile: { displayName: 'Contract Team' },
    teamInfo: {
      rosters: [{
        game: 'BGMI',
        players: [{ user: PLAYER_ID, role: 'Entry Fragger', isActive: true }]
      }],
      staff: [{ user: PLAYER_ID, role: 'Head Coach', game: 'General', isActive: true }]
    }
  });
  await teamUser.validate();
  assert.equal(teamUser.teamInfo.rosters[0].players[0].role, 'Entry Fragger');
  assert.equal(teamUser.teamInfo.staff[0].role, 'Head Coach');

  // A role label named Owner is never an authorization grant: membership
  // application mutates only display/membership fields, not the team identity.
  const ownerLabelDocs = makeMemberDocs();
  applyStaffMembership({
    ...ownerLabelDocs,
    invite: { role: 'Owner', game: 'General' },
    now: new Date('2026-07-09T10:00:00.000Z')
  });
  assert.equal(ownerLabelDocs.team._id, TEAM_ID);
  assert.equal(ownerLabelDocs.team.teamInfo.staff[0].role, 'Owner');
  assert.equal(Object.hasOwn(ownerLabelDocs.team.teamInfo.staff[0], 'isOwner'), false);

  const teamDto = formatUserDTO({
    _id: TEAM_ID,
    username: 'contract_team',
    teamInfo: {
      rosters: [{
        game: 'BGMI',
        players: [
          { user: PLAYER_ID, role: 'Player', isActive: true },
          { user: '507f1f77bcf86cd799439099', role: 'Player', isActive: false },
          { user: null, role: 'Player', isActive: true }
        ]
      }],
      staff: [
        { user: PLAYER_ID, role: 'Coach', isActive: true },
        { user: '507f1f77bcf86cd799439098', role: 'Coach', isActive: false },
        { user: '507f1f77bcf86cd799439097', role: 'Coach', isActive: false, leaveRequestStatus: 'pending' }
      ]
    }
  }, false, true);
  assert.equal(teamDto.teamInfo.rosters[0].players.length, 1, 'inactive and orphan roster entries must not leak');
  assert.equal(teamDto.teamInfo.staff.length, 2, 'inactive staff is hidden unless a leave request is pending');

  // Concurrent creates are fenced by pendingKey even if both preflight reads
  // race before either insert is visible.
  const createdKeys = new Set();
  class FakeRosterInvite {
    constructor(data) { Object.assign(this, data, { _id: INVITE_ID }); }
    async save() {
      if (createdKeys.has(this.pendingKey)) {
        const error = new Error('duplicate pending invite');
        error.code = 11000;
        throw error;
      }
      createdKeys.add(this.pendingKey);
      return this;
    }
    static async updateMany() { return { modifiedCount: 0 }; }
    static async exists() { return false; }
  }
  const createService = createTeamInvitationService({
    RosterInviteModel: FakeRosterInvite,
    StaffInviteModel: FakeRosterInvite
  });
  await createService.createPendingInvitation({
    type: 'roster', teamId: TEAM_ID, playerId: PLAYER_ID, game: 'BGMI', role: 'Entry Fragger'
  });
  await assert.rejects(
    createService.createPendingInvitation({
      type: 'roster', teamId: TEAM_ID, playerId: PLAYER_ID, game: 'BGMI', role: 'Entry Fragger'
    }),
    (error) => error?.status === 409 && error?.code === 'TEAM_INVITE_ALREADY_PENDING'
  );

  // Accept is one transaction across both membership documents, invite state,
  // and the optional source-message transition callback.
  const acceptedDocs = makeMemberDocs();
  const acceptedInvite = {
    _id: INVITE_ID,
    team: TEAM_ID,
    player: PLAYER_ID,
    game: 'BGMI',
    role: 'Entry Fragger',
    inGameName: 'ContractPlayer',
    status: 'pending',
    pendingKey: 'pending-key',
    expiresAt: new Date('2026-07-10T10:00:00.000Z'),
    async save(options) { this.savedSession = options?.session; return this; }
  };
  const acceptedModels = makeRespondModels({
    invite: acceptedInvite,
    team: acceptedDocs.team,
    player: acceptedDocs.player
  });
  const acceptedSession = makeSession();
  let transitionSession;
  const respondService = createTeamInvitationService({
    UserModel: acceptedModels.UserModel,
    RosterInviteModel: acceptedModels.InviteModel,
    StaffInviteModel: acceptedModels.InviteModel,
    startSession: async () => acceptedSession
  });
  const accepted = await respondService.respondToInvitation({
    type: 'roster',
    inviteId: INVITE_ID,
    actorId: PLAYER_ID,
    response: 'accept',
    expectedTeamId: TEAM_ID,
    now: new Date('2026-07-09T10:00:00.000Z'),
    onTransition: async ({ session }) => { transitionSession = session; }
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(acceptedInvite.pendingKey, undefined);
  assert.equal(acceptedInvite.savedSession, acceptedSession);
  assert.equal(acceptedSession.transactionCalls, 1);
  assert.equal(acceptedSession.options.readConcern.level, 'snapshot');
  assert.equal(acceptedSession.ended, true);
  assert.equal(transitionSession, acceptedSession);
  assert.deepEqual(acceptedDocs.saveSessions, [
    ['team', acceptedSession],
    ['player', acceptedSession]
  ]);
  assert.equal(acceptedDocs.team.teamInfo.rosters[0].players.length, 1);
  assert.equal(acceptedDocs.player.playerInfo.joinedTeams.length, 1);
  assert.equal(acceptedDocs.player.playerInfo.joinedTeams[0].membershipType, 'roster');

  await assert.rejects(
    respondService.respondToInvitation({
      type: 'roster',
      inviteId: INVITE_ID,
      actorId: PLAYER_ID,
      response: 'accept',
      now: new Date('2026-07-09T10:00:00.000Z')
    }),
    (error) => error?.status === 409 && error?.code === 'TEAM_INVITE_ALREADY_RESPONDED'
  );

  const declinedDocs = makeMemberDocs();
  const declinedInvite = {
    _id: '507f1f77bcf86cd799439014',
    team: TEAM_ID,
    player: PLAYER_ID,
    game: 'General',
    role: 'Head Coach',
    status: 'pending',
    pendingKey: 'staff-pending-key',
    expiresAt: new Date('2026-07-10T10:00:00.000Z'),
    async save(options) { this.savedSession = options?.session; return this; }
  };
  const declinedModels = makeRespondModels({
    invite: declinedInvite,
    team: declinedDocs.team,
    player: declinedDocs.player
  });
  const declinedSession = makeSession();
  const declineService = createTeamInvitationService({
    UserModel: declinedModels.UserModel,
    RosterInviteModel: declinedModels.InviteModel,
    StaffInviteModel: declinedModels.InviteModel,
    startSession: async () => declinedSession
  });
  const declined = await declineService.respondToInvitation({
    type: 'staff',
    inviteId: declinedInvite._id,
    actorId: PLAYER_ID,
    response: 'decline',
    expectedTeamId: TEAM_ID,
    now: new Date('2026-07-09T10:00:00.000Z')
  });
  assert.equal(declined.status, 'declined');
  assert.equal(declinedInvite.pendingKey, undefined);
  assert.equal(declinedDocs.saveSessions.length, 0, 'decline must not mutate memberships');

  const cancellableInvite = {
    _id: '507f1f77bcf86cd799439015',
    team: TEAM_ID,
    player: PLAYER_ID,
    game: 'General',
    role: 'Coach',
    status: 'pending',
    pendingKey: 'cancel-pending-key',
    expiresAt: new Date('2026-07-10T10:00:00.000Z')
  };
  const persistedInviteMessage = {
    sender: TEAM_ID,
    recipient: PLAYER_ID,
    inviteData: { type: 'staff', inviteId: cancellableInvite._id, status: 'pending' }
  };
  const cancellationSessions = [];
  const CancelInviteModel = {
    findById: () => queryFor(cancellableInvite),
    async findOneAndUpdate(filter, update, options) {
      if (cancellableInvite.status !== 'pending' || String(filter.team) !== TEAM_ID) return null;
      assert.equal(options.session, cancellationSessions[0]);
      cancellableInvite.status = update.$set.status;
      cancellableInvite.respondedAt = update.$set.respondedAt;
      cancellableInvite.pendingKey = undefined;
      return cancellableInvite;
    },
    async updateOne() { return { modifiedCount: 1 }; }
  };
  const CancelMessageModel = {
    async updateMany(filter, update, options) {
      assert.equal(String(filter.sender), TEAM_ID);
      assert.equal(String(filter.recipient), PLAYER_ID);
      assert.equal(filter['inviteData.type'], 'staff');
      assert.equal(String(filter['inviteData.inviteId']), cancellableInvite._id);
      assert.equal(options.session, cancellationSessions[0]);
      persistedInviteMessage.inviteData.status = update.$set['inviteData.status'];
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
  const cancelService = createTeamInvitationService({
    RosterInviteModel: CancelInviteModel,
    StaffInviteModel: CancelInviteModel,
    MessageModel: CancelMessageModel,
    startSession: async () => {
      const session = makeSession();
      cancellationSessions.push(session);
      return session;
    }
  });
  const cancelled = await cancelService.cancelInvitation({
    type: 'staff',
    inviteId: cancellableInvite._id,
    actorId: TEAM_ID,
    now: new Date('2026-07-09T10:00:00.000Z')
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.pendingKey, undefined);
  assert.equal(persistedInviteMessage.inviteData.status, 'cancelled', 'reload must not restore pending');
  assert.equal(cancellationSessions[0].transactionCalls, 1);
  assert.equal(cancellationSessions[0].ended, true);
  await assert.rejects(
    cancelService.cancelInvitation({
      type: 'staff',
      inviteId: cancellableInvite._id,
      actorId: TEAM_ID,
      now: new Date('2026-07-09T10:00:00.000Z')
    }),
    (error) => error?.status === 409 && error?.code === 'TEAM_INVITE_ALREADY_RESPONDED'
  );

  const expiredInvite = {
    ...acceptedInvite,
    status: 'pending',
    expiresAt: new Date('2026-07-08T10:00:00.000Z')
  };
  const expiredModels = makeRespondModels({
    invite: expiredInvite,
    team: acceptedDocs.team,
    player: acceptedDocs.player
  });
  const expiredService = createTeamInvitationService({
    UserModel: expiredModels.UserModel,
    RosterInviteModel: expiredModels.InviteModel,
    StaffInviteModel: expiredModels.InviteModel,
    startSession: async () => makeSession()
  });
  await assert.rejects(
    expiredService.respondToInvitation({
      type: 'roster',
      inviteId: INVITE_ID,
      actorId: PLAYER_ID,
      response: 'accept',
      now: new Date('2026-07-09T10:00:00.000Z')
    }),
    (error) => error?.status === 410 && error?.code === 'TEAM_INVITE_EXPIRED'
  );
  await assert.rejects(
    expiredService.respondToInvitation({
      type: 'roster',
      inviteId: INVITE_ID,
      actorId: '507f1f77bcf86cd799439099',
      response: 'accept',
      now: new Date('2026-07-07T10:00:00.000Z')
    }),
    (error) => error?.status === 403 && error?.code === 'TEAM_INVITE_FORBIDDEN'
  );

  const pendingFilter = activePendingQuery(new Date('2026-07-09T10:00:00.000Z'));
  assert.equal(pendingFilter.status, 'pending');
  assert.equal(pendingFilter.$or.length, 3, 'legacy invites without expiresAt need a bounded compatibility window');

  const rosterIndexes = RosterInvite.schema.indexes();
  const staffIndexes = StaffInvite.schema.indexes();
  assert(rosterIndexes.some(([keys, options]) => keys.pendingKey === 1 && options.unique && options.sparse));
  assert(staffIndexes.some(([keys, options]) => keys.pendingKey === 1 && options.unique && options.sparse));

  // The controller must contain only the canonical transactional responder.
  const controllerSource = fs.readFileSync(path.resolve(__dirname, '../controllers/messageController.js'), 'utf8');
  assert.equal((controllerSource.match(/const handleInviteResponse\s*=/g) || []).length, 1);
  assert.match(controllerSource, /const \{ respondToInvitation \} = require\('\.\.\/services\/teamInvitationService'\)/);
  const userControllerSource = fs.readFileSync(path.resolve(__dirname, '../controllers/userController.js'), 'utf8');
  assert.match(userControllerSource, /match:\s*\{ isActive: true, userType: 'player' \}/);
  assert.match(userControllerSource, /match:\s*\{ isActive: true, userType: 'team' \}/);
}

run().then(() => {
  console.log('Team invitation service tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
