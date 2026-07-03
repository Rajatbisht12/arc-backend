const assert = require('assert');
const TeamRecruitment = require('../models/TeamRecruitment');
const RecruitmentApplication = require('../models/RecruitmentApplication');
const controller = require('./aiRecruitmentController');

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const originals = {
  recruitmentFindById: TeamRecruitment.findById,
  applicationFindById: RecruitmentApplication.findById
};

const restore = () => {
  TeamRecruitment.findById = originals.recruitmentFindById;
  RecruitmentApplication.findById = originals.applicationFindById;
};

const runHandler = async (handler, req) => {
  const res = responseRecorder();
  await handler(req, res, (error) => {
    if (error) throw error;
  });
  return res;
};

const populatedQuery = (value) => ({
  populate() { return this; },
  then(resolve) { return Promise.resolve(resolve(value)); }
});

const run = async () => {
  try {
    const teamId = '507f1f77bcf86cd799439011';
    TeamRecruitment.findById = () => populatedQuery({ _id: '507f1f77bcf86cd799439012', team: null });
    let res = await runHandler(controller.matchPlayersToTeam, {
      user: { _id: teamId, userType: 'team' },
      body: { recruitmentId: '507f1f77bcf86cd799439012' }
    });
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.body.message, /team is no longer available/i);

    RecruitmentApplication.findById = () => populatedQuery({
      _id: '507f1f77bcf86cd799439013',
      recruitment: null,
      applicant: null
    });
    res = await runHandler(controller.analyzeApplication, {
      user: { _id: teamId, userType: 'team' },
      body: { applicationId: '507f1f77bcf86cd799439013' }
    });
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.body.message, /references are no longer available/i);

    TeamRecruitment.findById = () => populatedQuery({
      _id: '507f1f77bcf86cd799439012',
      team: teamId,
      applicants: [{ user: null }]
    });
    res = await runHandler(controller.rankCandidates, {
      user: { _id: teamId, userType: 'team' },
      body: { recruitmentId: '507f1f77bcf86cd799439012' }
    });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.data.rankedCandidates, []);

    console.log('AI recruitment orphan-reference contracts passed');
  } finally {
    restore();
  }
};

run().catch((error) => {
  restore();
  console.error(error);
  process.exitCode = 1;
});
