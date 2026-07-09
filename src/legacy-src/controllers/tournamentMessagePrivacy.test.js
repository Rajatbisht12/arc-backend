const assert = require('assert');
const User = require('../models/User');
const {
  _private: {
    canReadTournamentMessages,
    canReadGroupMessages,
    sanitizeTournamentMessages,
    attachViewerMessageHistory
  }
} = require('./tournamentController');

const id = (value) => ({ _id: value, toString: () => value });

(async () => {
  const originalExists = User.exists;
  User.exists = async () => null;
  try {
    const tournament = {
      host: id('host'),
      participants: [id('participant')],
      teams: [id('team')]
    };
    assert.strictEqual(await canReadTournamentMessages(tournament, id('host')), true);
    assert.strictEqual(await canReadTournamentMessages(tournament, id('participant')), true);
    assert.strictEqual(await canReadTournamentMessages(tournament, id('team')), true);
    assert.strictEqual(
      await canReadTournamentMessages(tournament, id('unrelated')),
      false,
      'an unrelated authenticated user must not read tournament messages'
    );

    const group = { participants: [id('participant')] };
    assert.strictEqual(await canReadGroupMessages(tournament, group, id('host')), true);
    assert.strictEqual(await canReadGroupMessages(tournament, group, id('participant')), true);
    assert.strictEqual(
      await canReadGroupMessages(tournament, group, id('team')),
      false,
      'a participant in another group must not read this group thread'
    );

    const [message] = sanitizeTournamentMessages([{
      message: 'Authorized message',
      sender: {
        _id: 'sender',
        username: 'sender',
        email: 'must-not-leak@example.com',
        lastSeen: new Date(),
        privacySettings: { profileVisibility: 'private' },
        profile: { displayName: 'Sender', avatar: 'sender.png', bio: 'protected' }
      }
    }]);
    assert.strictEqual(message.sender.email, undefined);
    assert.strictEqual(message.sender.lastSeen, undefined);
    assert.strictEqual(message.sender.privacySettings, undefined);
    assert.strictEqual(message.sender.profile.bio, undefined);

    const contextualParticipant = {
      viewerParticipation: true,
      viewerRole: 'participant',
      viewerRegisteredTeamId: null
    };
    const sourceTournament = {
      groups: [
        { _id: id('group-a'), name: 'Group A', participants: [id('participant')] },
        { _id: id('group-b'), name: 'Group B', participants: [id('other')] }
      ]
    };
    const messageState = {
      tournamentMessages: [{ message: 'Everyone registered', sender: { _id: 'host', username: 'host' } }],
      groupMessages: [
        { groupId: 'group-a', round: 1, messages: [{ message: 'A only', sender: { _id: 'host', username: 'host' } }] },
        { groupId: 'group-b', round: 1, messages: [{ message: 'B only', sender: { _id: 'host', username: 'host' } }] }
      ]
    };
    const participantHistory = attachViewerMessageHistory(
      contextualParticipant,
      sourceTournament,
      messageState,
      id('participant')
    );
    assert.strictEqual(participantHistory.tournamentMessages.length, 1);
    assert.deepStrictEqual(participantHistory.groupMessages.map((thread) => thread.groupId), ['group-a']);

    const unrelatedHistory = attachViewerMessageHistory(
      { viewerParticipation: false, viewerRole: null },
      sourceTournament,
      messageState,
      id('unrelated')
    );
    assert.strictEqual(unrelatedHistory.groupMessages, undefined);
    assert.strictEqual(unrelatedHistory.tournamentMessages, undefined);

    const hostHistory = attachViewerMessageHistory(
      { viewerParticipation: false, viewerRole: 'host' },
      sourceTournament,
      messageState,
      id('host')
    );
    assert.strictEqual(hostHistory.groupMessages.length, 2);
  } finally {
    User.exists = originalExists;
  }

  console.log('Tournament message privacy tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
