const assert = require('assert');
const challengeController = require('./challengeController');
const tournamentController = require('./tournamentController');
const scrimController = require('./scrimController');
const recruitmentController = require('./recruitmentController');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const assertRejected = async (handler, req, expectedMessage) => {
  const res = responseRecorder();
  await handler(req, res, (error) => {
    if (error) throw error;
  });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.message, expectedMessage);
};

const run = async () => {
  await assertRejected(
    challengeController.getChallenges,
    { query: { status: { $ne: 'cancelled' } }, user: null },
    'Invalid challenge filter'
  );
  await assertRejected(
    challengeController.getMyChallenges,
    { query: { status: { $ne: 'cancelled' } }, user: { _id: '507f1f77bcf86cd799439011' } },
    'Invalid challenge status'
  );
  await assertRejected(
    challengeController.getMyParticipations,
    { query: { status: { $ne: 'withdrawn' } }, user: { _id: '507f1f77bcf86cd799439011' } },
    'Invalid participation status'
  );
  await assertRejected(
    tournamentController.getTournaments,
    { query: { status: { $ne: 'Cancelled' } }, user: null },
    'Invalid tournament filter'
  );
  await assertRejected(
    scrimController.getScrims,
    { query: { status: { $ne: 'Cancelled' } }, user: null },
    'Invalid scrim filter'
  );
  await assertRejected(
    recruitmentController.getTeamRecruitments,
    { query: { game: { $ne: 'BGMI' } }, user: { _id: '507f1f77bcf86cd799439011', blockedUsers: [] } },
    'Invalid recruitment filter'
  );
  await assertRejected(
    recruitmentController.getPlayerProfiles,
    { query: { profileType: { $ne: 'looking-for-team' } }, user: { _id: '507f1f77bcf86cd799439011', blockedUsers: [] } },
    'Invalid player profile filter'
  );
  await assertRejected(
    tournamentController.configureScheduleSettings,
    {
      params: { id: '507f1f77bcf86cd799439011' },
      body: { defaultMatchDuration: { $ne: 30 } },
      user: { _id: '507f1f77bcf86cd799439012' }
    },
    'Invalid tournament schedule configuration'
  );

  console.log('List filter query-shape validation contracts passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
