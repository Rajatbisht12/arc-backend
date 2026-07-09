const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  addPlayerProfileIntegrityFilters,
  listCanonicalRecruitmentRecords
} = require('../services/recruitmentPolicy');
const {
  buildSmartSearchCandidate
} = require('../services/aiRecruitmentCandidateContract');

const source = fs.readFileSync(
  path.join(__dirname, 'aiRecruitmentController.js'),
  'utf8'
);

const sourceSection = (start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `missing source section: ${start}`);
  assert(endIndex > startIndex, `missing end marker for source section: ${start}`);
  return source.slice(startIndex, endIndex);
};

const matchSection = sourceSection(
  'const matchPlayersToTeam',
  'const analyzeApplication'
);
const interviewSection = sourceSection(
  'const generateInterviewQuestions',
  'const rankCandidates'
);
const searchSection = sourceSection(
  'const smartSearch',
  'module.exports'
);

for (const [name, section] of [
  ['matchPlayersToTeam', matchSection],
  ['generateInterviewQuestions', interviewSection],
  ['smartSearch', searchSection]
]) {
  assert(
    section.includes('findPrivacySafeCandidateProfiles'),
    `${name} must use the canonical privacy-safe candidate reader`
  );
}

assert(!matchSection.includes(".populate('player'"));
assert(!interviewSection.includes(".populate('player'"));
assert(!searchSection.includes(".populate('player'"));
assert(
  interviewSection.includes("req.user.userType !== 'team'"),
  'interview-question generation must enforce the Web TeamOnlyRoute permission server-side'
);
assert(interviewSection.includes('mongoose.Types.ObjectId.isValid'));
assert(source.includes('viewerBlockedIds: viewer?.blockedUsers || []'));
assert(source.includes('ownerProjection: AI_CANDIDATE_OWNER_PROJECTION'));
assert(!source.match(/AI_CANDIDATE_OWNER_PROJECTION[\s\S]*?privacySettings:\s*1/));
assert(!source.match(/AI_CANDIDATE_OWNER_PROJECTION[\s\S]*?blockedUsers:\s*1/));
assert.strictEqual(
  (searchSection.match(/buildSmartSearchCandidate\(/g) || []).length,
  2,
  'normal and Gemini-error smart-search paths must share one candidate projector'
);

const candidateContract = buildSmartSearchCandidate({
  candidate: {
    profileId: 'profile-1',
    playerId: 'player-1',
    profileCode: 'LFT-ABC123',
    playerName: 'Fallback Player',
    game: 'BGMI',
    role: 'IGL',
    rank: 'Ace',
    experience: 'Professional',
    tournamentExperience: 'National',
    kdRatio: 2.5,
    winRate: 68,
    inGameName: 'FallbackIGN',
    expectedSalary: 'INR 50,000',
    preferredLocation: 'Remote'
  },
  analysis: {
    compatibilityScore: 82,
    summary: 'Fallback summary',
    strengths: [],
    concerns: [],
    reasoning: 'Fallback reasoning',
    rank: 1
  },
  profile: {
    profileCode: 'LFT-ABC123',
    player: {
      _id: 'player-1',
      username: 'fallback-player',
      profile: { displayName: 'Fallback Player', avatar: 'avatar.jpg' }
    }
  },
  profileType: 'looking-for-team',
  searchType: 'players'
});

assert.strictEqual(candidateContract.player.profile.displayName, 'Fallback Player');
assert.strictEqual(candidateContract.player.username, 'fallback-player');
assert.strictEqual(candidateContract.profile.profileCode, 'LFT-ABC123');
assert.strictEqual(candidateContract.profile.rank, 'Ace');
assert.strictEqual(candidateContract.profile.kdRatio, 2.5);
assert.strictEqual(candidateContract.expectations.expectedSalary, 'INR 50,000');
assert.strictEqual(candidateContract.expectations.preferredLocation, 'Remote');

(async () => {
  const capturedPipelines = [];
  const records = [{ _id: 'profile-visible' }];
  const customOwnerProjection = {
    _id: 1,
    username: 1,
    'profile.displayName': 1,
    'playerInfo.gamingStats': 1
  };
  // $facet is unsupported on Amazon DocumentDB: the page and the count run as
  // two aggregations. The stub returns count rows only for the $count pipeline.
  const model = {
    aggregate(pipeline) {
      capturedPipelines.push(pipeline);
      const isCount = pipeline.some((stage) => stage.$count);
      return Promise.resolve(isCount ? [{ total: 1 }] : records);
    }
  };
  // DocumentDB has no correlated $lookup, so the viewer's follow set is resolved
  // through the model rather than joined inside the pipeline.
  const followModel = { distinct: async () => ['507f1f77bcf86cd799439099'] };

  const query = addPlayerProfileIntegrityFilters({
    profileType: 'looking-for-team',
    game: 'BGMI',
    status: 'active',
    isActive: true
  });
  const result = await listCanonicalRecruitmentRecords({
    model,
    userModel: { collection: { name: 'users' } },
    query,
    ownerField: 'player',
    expectedUserType: 'player',
    countField: 'interestedTeamsCount',
    sortBy: 'createdAt',
    sortDirection: -1,
    page: 1,
    limit: 100,
    viewerId: '507f1f77bcf86cd799439011',
    viewerBlockedIds: ['507f1f77bcf86cd799439012'],
    followModel,
    ownerProjection: customOwnerProjection
  });

  assert.deepStrictEqual(result, { records, total: 1 });
  assert(!capturedPipelines.some((p) => p.some((stage) => stage.$facet)), 'candidate query must not use $facet');
  const capturedPipeline = capturedPipelines.find((p) => !p.some((stage) => stage.$count));
  const countPipeline = capturedPipelines.find((p) => p.some((stage) => stage.$count));
  assert(capturedPipeline && countPipeline, 'privacy filtering must precede pagination and count');

  // Amazon DocumentDB does not support the correlated ($lookup with let/pipeline)
  // form, so every $lookup must be a basic localField/foreignField join.
  capturedPipeline.forEach((stage) => {
    if (!stage.$lookup) return;
    assert(!stage.$lookup.let && !stage.$lookup.pipeline, 'candidate reader must not use a correlated $lookup');
  });
  const ownerLookupStage = capturedPipeline.find((stage) => stage.$lookup?.as === '__validOwner');
  assert(ownerLookupStage, 'candidate owner lookup must exist');
  assert.strictEqual(ownerLookupStage.$lookup.localField, 'player');
  assert.strictEqual(ownerLookupStage.$lookup.foreignField, '_id');
  const ownerLookupIndex = capturedPipeline.indexOf(ownerLookupStage);

  // Block/visibility checks run at the top level after the owner is unwound.
  const privacyMatchIndex = capturedPipeline.findIndex(
    (stage, index) => index > ownerLookupIndex && stage.$match?.$expr?.$and
  );
  assert(privacyMatchIndex > ownerLookupIndex, 'block and visibility checks must run after the owner join');

  // The owner is reduced to exactly the caller's projection; privacy fields the
  // caller did not request must never appear in the output.
  // $addFields, not $set: DocumentDB does not support the $set pipeline stage.
  const projectStage = capturedPipeline.find((stage) => stage.$addFields && stage.$addFields.player);
  assert(projectStage, 'owner must be reduced to the caller projection');
  const ownerShape = projectStage.$addFields.player;
  assert.strictEqual(ownerShape.privacySettings, undefined, 'privacySettings must not leak to a narrow candidate projection');
  assert.strictEqual(ownerShape.blockedUsers, undefined, 'blockedUsers must not leak to a narrow candidate projection');
  assert.strictEqual(
    ownerShape.playerInfo && ownerShape.playerInfo.gamingStats,
    '$__validOwner.playerInfo.gamingStats',
    'requested nested fields must be projected from the joined owner'
  );
  assert(
    capturedPipeline.findIndex((stage) => stage.$limit) > privacyMatchIndex,
    'privacy filtering must happen before the candidate limit'
  );
  assert(countPipeline.some((stage) => stage.$count), 'total count must be a dedicated $count aggregation');

  console.log('AI recruitment privacy contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
