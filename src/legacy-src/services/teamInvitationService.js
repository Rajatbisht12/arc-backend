const mongoose = require('mongoose');
const User = require('../models/User');
const RosterInvite = require('../models/RosterInvite');
const StaffInvite = require('../models/StaffInvite');
const { Message } = require('../models/Message');
const log = require('../utils/logger');
const {
  INVITE_RESPONSES,
  INVITE_TYPES,
  TEAM_INVITE_TTL_MS,
  assertTeamRole,
  buildPendingInviteKey,
  isValidInviteGame,
  normalizeInviteGame
} = require('../utils/teamInvitationPolicy');

class TeamInvitationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'TeamInvitationError';
    this.status = status;
    this.code = code;
  }
}

const idString = (value) => String(value?._id || value || '');

const invitationExpiry = (invite) => {
  const explicit = invite?.expiresAt ? new Date(invite.expiresAt) : null;
  if (explicit && Number.isFinite(explicit.getTime())) return explicit;
  const created = invite?.createdAt ? new Date(invite.createdAt) : null;
  if (created && Number.isFinite(created.getTime())) {
    return new Date(created.getTime() + TEAM_INVITE_TTL_MS);
  }
  return new Date(0);
};

const activePendingQuery = (now = new Date()) => {
  const legacyCutoff = new Date(now.getTime() - TEAM_INVITE_TTL_MS);
  return {
    status: 'pending',
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: null, createdAt: { $gt: legacyCutoff } },
      { expiresAt: { $exists: false }, createdAt: { $gt: legacyCutoff } }
    ]
  };
};

const expiredPendingQuery = (now = new Date()) => {
  const legacyCutoff = new Date(now.getTime() - TEAM_INVITE_TTL_MS);
  return {
    status: 'pending',
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: null, createdAt: { $lte: legacyCutoff } },
      { expiresAt: { $exists: false }, createdAt: { $lte: legacyCutoff } }
    ]
  };
};

const applyRosterMembership = ({ team, player, invite, now }) => {
  if (!team.teamInfo) team.teamInfo = {};
  if (!Array.isArray(team.teamInfo.rosters)) team.teamInfo.rosters = [];
  if (!player.playerInfo) player.playerInfo = {};
  if (!Array.isArray(player.playerInfo.joinedTeams)) player.playerInfo.joinedTeams = [];

  let roster = team.teamInfo.rosters.find((entry) => entry.game === invite.game);
  if (!roster) {
    team.teamInfo.rosters.push({ game: invite.game, players: [], isActive: true });
    roster = team.teamInfo.rosters[team.teamInfo.rosters.length - 1];
  }
  if (!Array.isArray(roster.players)) roster.players = [];

  const rosterEntry = roster.players.find((entry) => idString(entry.user) === idString(player._id));
  if (rosterEntry) {
    rosterEntry.role = invite.role;
    rosterEntry.inGameName = invite.inGameName || '';
    rosterEntry.joinedAt = now;
    rosterEntry.leftAt = null;
    rosterEntry.isActive = true;
  } else {
    roster.players.push({
      user: player._id,
      role: invite.role,
      inGameName: invite.inGameName || '',
      joinedAt: now,
      leftAt: null,
      isActive: true
    });
  }
  roster.isActive = true;

  const joinedEntry = player.playerInfo.joinedTeams.find((entry) => (
    idString(entry.team) === idString(team._id)
      && entry.game === invite.game
      && (!entry.membershipType || entry.membershipType === 'roster')
  ));
  if (joinedEntry) {
    joinedEntry.membershipType = 'roster';
    joinedEntry.role = invite.role;
    joinedEntry.inGameName = invite.inGameName || '';
    joinedEntry.joinedAt = now;
    joinedEntry.leftAt = null;
    joinedEntry.isActive = true;
    joinedEntry.removedByTeam = false;
  } else {
    player.playerInfo.joinedTeams.push({
      team: team._id,
      membershipType: 'roster',
      game: invite.game,
      role: invite.role,
      inGameName: invite.inGameName || '',
      joinedAt: now,
      leftAt: null,
      isActive: true,
      removedByTeam: false
    });
  }

  team.markModified?.('teamInfo.rosters');
  player.markModified?.('playerInfo.joinedTeams');
};

const applyStaffMembership = ({ team, player, invite, now }) => {
  if (!team.teamInfo) team.teamInfo = {};
  if (!Array.isArray(team.teamInfo.staff)) team.teamInfo.staff = [];
  if (!player.playerInfo) player.playerInfo = {};
  if (!Array.isArray(player.playerInfo.joinedTeams)) player.playerInfo.joinedTeams = [];

  const staffEntry = team.teamInfo.staff.find((entry) => idString(entry.user) === idString(player._id));
  if (staffEntry) {
    staffEntry.role = invite.role;
    staffEntry.game = invite.game;
    staffEntry.joinedAt = now;
    staffEntry.leftAt = null;
    staffEntry.isActive = true;
    staffEntry.leaveRequestStatus = 'none';
  } else {
    team.teamInfo.staff.push({
      user: player._id,
      role: invite.role,
      game: invite.game,
      joinedAt: now,
      leftAt: null,
      isActive: true,
      leaveRequestStatus: 'none'
    });
  }

  const joinedEntry = player.playerInfo.joinedTeams.find((entry) => (
    idString(entry.team) === idString(team._id)
      && entry.game === invite.game
      && (entry.membershipType === 'staff'
        || (!entry.membershipType && entry.role === invite.role))
  ));
  if (joinedEntry) {
    joinedEntry.membershipType = 'staff';
    joinedEntry.role = invite.role;
    joinedEntry.inGameName = '';
    joinedEntry.joinedAt = now;
    joinedEntry.leftAt = null;
    joinedEntry.isActive = true;
    joinedEntry.removedByTeam = false;
  } else {
    player.playerInfo.joinedTeams.push({
      team: team._id,
      membershipType: 'staff',
      game: invite.game,
      role: invite.role,
      inGameName: '',
      joinedAt: now,
      leftAt: null,
      isActive: true,
      removedByTeam: false
    });
  }

  team.markModified?.('teamInfo.staff');
  player.markModified?.('playerInfo.joinedTeams');
};

const createTeamInvitationService = ({
  UserModel = User,
  RosterInviteModel = RosterInvite,
  StaffInviteModel = StaffInvite,
  MessageModel = Message,
  startSession = () => mongoose.startSession(),
  logger = log
} = {}) => {
  const modelFor = (type) => {
    if (type === 'roster') return RosterInviteModel;
    if (type === 'staff') return StaffInviteModel;
    throw new TeamInvitationError(400, 'INVALID_INVITE_TYPE', 'Invalid team invite type');
  };

  const validateInvitationInput = ({ type, game, role }) => {
    if (!INVITE_TYPES.includes(type)) {
      throw new TeamInvitationError(400, 'INVALID_INVITE_TYPE', 'Invalid team invite type');
    }
    const normalizedGame = normalizeInviteGame(type, game);
    if (!isValidInviteGame(type, normalizedGame)) {
      throw new TeamInvitationError(400, 'INVALID_INVITE_GAME', 'Invalid game selection');
    }
    return { game: normalizedGame, role: assertTeamRole(role) };
  };

  const createPendingInvitation = async ({
    type,
    teamId,
    playerId,
    game,
    role,
    inGameName,
    message,
    now = new Date()
  }) => {
    const Model = modelFor(type);
    const normalized = validateInvitationInput({ type, game, role });
    const scope = { team: teamId, player: playerId, game: normalized.game };

    await Model.updateMany(
      { ...scope, ...expiredPendingQuery(now) },
      {
        $set: { status: 'expired', respondedAt: now },
        $unset: { pendingKey: 1 }
      }
    );

    if (await Model.exists({ ...scope, ...activePendingQuery(now) })) {
      throw new TeamInvitationError(
        409,
        'TEAM_INVITE_ALREADY_PENDING',
        type === 'roster'
          ? 'Player already has a pending invite for this roster'
          : 'An invite is already pending for this member for this game'
      );
    }

    const invite = new Model({
      ...scope,
      role: normalized.role,
      inGameName: typeof inGameName === 'string' ? inGameName.trim() : undefined,
      message: typeof message === 'string' ? message.trim() : undefined,
      status: 'pending',
      pendingKey: buildPendingInviteKey({ type, ...scope }),
      expiresAt: new Date(now.getTime() + TEAM_INVITE_TTL_MS)
    });

    try {
      await invite.save();
      return invite;
    } catch (error) {
      if (error?.code === 11000) {
        throw new TeamInvitationError(
          409,
          'TEAM_INVITE_ALREADY_PENDING',
          type === 'roster'
            ? 'Player already has a pending invite for this roster'
            : 'An invite is already pending for this member for this game'
        );
      }
      throw error;
    }
  };

  const loadInvite = async (Model, inviteId, session) => {
    let query = Model.findById(inviteId);
    if (query?.select) query = query.select('+pendingKey');
    if (session && query?.session) query = query.session(session);
    return query;
  };

  const loadUser = async (filter, session) => {
    let query = UserModel.findOne(filter);
    if (session && query?.session) query = query.session(session);
    return query;
  };

  const assertRespondable = ({ invite, actorId, expectedTeamId, now }) => {
    if (!invite) throw new TeamInvitationError(404, 'TEAM_INVITE_NOT_FOUND', 'Invite not found');
    if (idString(invite.player) !== idString(actorId)) {
      throw new TeamInvitationError(403, 'TEAM_INVITE_FORBIDDEN', 'You can only respond to invites sent to you');
    }
    if (expectedTeamId && idString(invite.team) !== idString(expectedTeamId)) {
      throw new TeamInvitationError(409, 'TEAM_INVITE_MESSAGE_MISMATCH', 'Invite message does not match the invitation');
    }
    if (invite.status !== 'pending') {
      throw new TeamInvitationError(409, 'TEAM_INVITE_ALREADY_RESPONDED', `Invite is already ${invite.status}`);
    }
    if (invitationExpiry(invite) <= now) {
      throw new TeamInvitationError(410, 'TEAM_INVITE_EXPIRED', 'Invite has expired');
    }
  };

  const respondToInvitation = async ({
    type,
    inviteId,
    actorId,
    response,
    expectedTeamId,
    onTransition,
    now = new Date()
  }) => {
    if (!INVITE_RESPONSES.includes(response)) {
      throw new TeamInvitationError(400, 'INVALID_INVITE_RESPONSE', 'Response must be accept or decline');
    }
    const Model = modelFor(type);
    const terminalStatus = response === 'accept' ? 'accepted' : 'declined';
    const session = await startSession();
    let outcome;

    try {
      await session.withTransaction(async () => {
        const invite = await loadInvite(Model, inviteId, session);
        assertRespondable({ invite, actorId, expectedTeamId, now });
        const normalized = validateInvitationInput({ type, game: invite.game, role: invite.role });
        invite.game = normalized.game;
        invite.role = normalized.role;

        let team;
        let player;
        if (response === 'accept') {
          [team, player] = await Promise.all([
            loadUser({ _id: invite.team, userType: 'team', isActive: true }, session),
            loadUser({ _id: actorId, userType: 'player', isActive: true }, session)
          ]);
          if (!team) {
            throw new TeamInvitationError(409, 'INVITE_TEAM_UNAVAILABLE', 'The team is no longer available');
          }
          if (!player) {
            throw new TeamInvitationError(409, 'INVITE_PLAYER_UNAVAILABLE', 'The invited player is no longer available');
          }

          const applyMembership = type === 'roster' ? applyRosterMembership : applyStaffMembership;
          applyMembership({ team, player, invite, now });
          await team.save({ session });
          await player.save({ session });
        }

        invite.status = terminalStatus;
        invite.respondedAt = now;
        invite.pendingKey = undefined;
        await invite.save({ session });

        if (typeof onTransition === 'function') {
          await onTransition({ session, invite, team, player, status: terminalStatus });
        }
        outcome = { invite, team, player, status: terminalStatus, reconciled: false };
      }, {
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      });
      return outcome;
    } catch (error) {
      if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) {
        let query = Model.findOne({ _id: inviteId, player: actorId, status: terminalStatus });
        if (query?.select) query = query.select('+pendingKey');
        const committed = await query;
        if (committed) {
          return { invite: committed, status: terminalStatus, reconciled: true };
        }
      }
      if (
        error?.code === 20
        || /Transaction numbers are only allowed|does not support transactions/i.test(String(error?.message || ''))
      ) {
        throw new TeamInvitationError(
          503,
          'TEAM_INVITE_TRANSACTION_REQUIRED',
          'Team invitation responses temporarily require database transaction support'
        );
      }
      throw error;
    } finally {
      try {
        await session.endSession();
      } catch (error) {
        logger.warn('Team invitation Mongo session cleanup failed', { error: String(error) });
      }
    }
  };

  const reconcileInviteMessages = async ({ type, invite, status, session }) => {
    return MessageModel.updateMany(
      {
        sender: invite.team,
        recipient: invite.player,
        'inviteData.type': type,
        'inviteData.inviteId': invite._id
      },
      { $set: { 'inviteData.status': status } },
      { session }
    );
  };

  const cancelInvitation = async ({ type, inviteId, actorId, now = new Date() }) => {
    const Model = modelFor(type);
    const session = await startSession();
    let outcome;
    let expired = false;
    try {
      await session.withTransaction(async () => {
        const invite = await loadInvite(Model, inviteId, session);
        if (!invite) throw new TeamInvitationError(404, 'TEAM_INVITE_NOT_FOUND', 'Invite not found');
        if (idString(invite.team) !== idString(actorId)) {
          throw new TeamInvitationError(403, 'TEAM_INVITE_FORBIDDEN', 'Only team owners can cancel invites');
        }
        if (invite.status !== 'pending') {
          throw new TeamInvitationError(409, 'TEAM_INVITE_ALREADY_RESPONDED', `Invite is already ${invite.status}`);
        }

        if (invitationExpiry(invite) <= now) {
          const expiredUpdate = await Model.findOneAndUpdate(
            { _id: inviteId, team: actorId, status: 'pending' },
            { $set: { status: 'expired', respondedAt: now }, $unset: { pendingKey: 1 } },
            { new: true, session }
          );
          if (!expiredUpdate) {
            throw new TeamInvitationError(409, 'TEAM_INVITE_STATE_CHANGED', 'Invite is no longer pending');
          }
          await reconcileInviteMessages({ type, invite: expiredUpdate, status: 'expired', session });
          outcome = expiredUpdate;
          expired = true;
          return;
        }

        const cancelled = await Model.findOneAndUpdate(
          { _id: inviteId, team: actorId, ...activePendingQuery(now) },
          { $set: { status: 'cancelled', respondedAt: now }, $unset: { pendingKey: 1 } },
          { new: true, session }
        );
        if (!cancelled) {
          throw new TeamInvitationError(409, 'TEAM_INVITE_STATE_CHANGED', 'Invite is no longer pending');
        }
        await reconcileInviteMessages({ type, invite: cancelled, status: 'cancelled', session });
        outcome = cancelled;
      }, {
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      });
      if (expired) throw new TeamInvitationError(410, 'TEAM_INVITE_EXPIRED', 'Invite has expired');
      return outcome;
    } catch (error) {
      if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) {
        let query = Model.findOne({ _id: inviteId, team: actorId, status: { $in: ['cancelled', 'expired'] } });
        if (query?.select) query = query.select('+pendingKey');
        const committed = await query;
        if (committed) {
          if (committed.status === 'expired') {
            throw new TeamInvitationError(410, 'TEAM_INVITE_EXPIRED', 'Invite has expired');
          }
          return committed;
        }
      }
      if (
        error?.code === 20
        || /Transaction numbers are only allowed|does not support transactions/i.test(String(error?.message || ''))
      ) {
        throw new TeamInvitationError(
          503,
          'TEAM_INVITE_TRANSACTION_REQUIRED',
          'Team invitation cancellation temporarily requires database transaction support'
        );
      }
      throw error;
    } finally {
      try {
        await session.endSession();
      } catch (error) {
        logger.warn('Team invitation cancellation session cleanup failed', { error: String(error) });
      }
    }
  };

  const revokeUndeliveredInvitation = (options) => cancelInvitation(options);

  return {
    createPendingInvitation,
    respondToInvitation,
    cancelInvitation,
    revokeUndeliveredInvitation
  };
};

const service = createTeamInvitationService();

module.exports = {
  TeamInvitationError,
  activePendingQuery,
  expiredPendingQuery,
  invitationExpiry,
  applyRosterMembership,
  applyStaffMembership,
  createTeamInvitationService,
  ...service
};
