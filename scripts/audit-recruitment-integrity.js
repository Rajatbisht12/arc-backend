#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const modelPath = (name) => path.resolve(
  __dirname,
  '..',
  'src',
  'legacy-src',
  'models',
  `${name}.js`
);
const User = require(modelPath('User'));
const TeamRecruitment = require(modelPath('TeamRecruitment'));
const PlayerProfile = require(modelPath('PlayerProfile'));
const RecruitmentApplication = require(modelPath('RecruitmentApplication'));
const RecruitmentPostingQuota = require(modelPath('RecruitmentPostingQuota'));
const {
  TEAM_RECRUITMENT_STATUSES,
  PLAYER_PROFILE_STATUSES,
  TEAM_APPLICATION_STATUSES,
  addTeamRecruitmentIntegrityFilters,
  addPlayerProfileIntegrityFilters,
  teamRecruitmentIntegrityOr,
  isValidRecruitmentRole
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'legacy-src',
  'services',
  'recruitmentPolicy.js'
));
const {
  SHARE_CODE_PATTERNS,
  SUPPORTED_LEGACY_SHARE_CODE_PATTERNS,
  generateRecruitmentCode,
  generatePlayerProfileCode,
  backfillUniqueShareCode
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'legacy-src',
  'utils',
  'recruitmentShareCode.js'
));
const { utcDayWindow } = require(path.resolve(
  __dirname,
  '..',
  'src',
  'legacy-src',
  'services',
  'recruitmentPostingQuota.js'
));

const apply = process.argv.includes('--apply');
const strict = process.argv.includes('--strict');
const isNamespaceNotFound = (error) => error?.code === 26 || error?.codeName === 'NamespaceNotFound';

// Only basic localField/foreignField joins are used. Amazon DocumentDB rejects
// the correlated let/pipeline form used by the previous version of this audit.
const basicLookup = (from, localField, as) => ({
  $lookup: { from, localField, foreignField: '_id', as }
});

const unwindOptional = (pathName) => ({
  $unwind: { path: `$${pathName}`, preserveNullAndEmptyArrays: true }
});

const nonBlankLengthExpression = (field) => ({
  $strLenCP: {
    $trim: {
      input: { $convert: { input: `$${field}`, to: 'string', onError: '', onNull: '' } }
    }
  }
});

const invalidOwnerConditions = (ownerPath, expectedUserType) => [
  { [`${ownerPath}._id`]: { $exists: false } },
  { [`${ownerPath}.userType`]: { $ne: expectedUserType } },
  { [`${ownerPath}.isActive`]: { $ne: true } },
  { [`${ownerPath}.needsProfileCompletion`]: true },
  { [`${ownerPath}.username`]: { $not: { $type: 'string' } } },
  { $expr: { $lte: [nonBlankLengthExpression(`${ownerPath}.username`), 0] } }
];

const findInvalidOwners = (Model, ownerField, expectedUserType) => Model.aggregate([
  basicLookup(User.collection.name, ownerField, '__owner'),
  unwindOptional('__owner'),
  { $match: { $or: invalidOwnerConditions('__owner', expectedUserType) } },
  { $project: { _id: 1, ownerId: `$${ownerField}` } }
]);

const findInvalidQuotaOwners = async () => {
  try {
    return await findInvalidOwners(RecruitmentPostingQuota, 'player', 'player');
  } catch (error) {
    if (isNamespaceNotFound(error)) return [];
    throw error;
  }
};

const findInvalidRecruitments = (Model, ownerField, expectedUserType, integrityQuery) => {
  const structuralCondition = integrityQuery.$and[0];
  return Model.aggregate([
    basicLookup(User.collection.name, ownerField, '__owner'),
    unwindOptional('__owner'),
    {
      $match: {
        $or: [
          ...invalidOwnerConditions('__owner', expectedUserType),
          { $nor: [structuralCondition] }
        ]
      }
    },
    { $project: { _id: 1 } }
  ]);
};

const findInvalidApplications = () => RecruitmentApplication.aggregate([
  basicLookup(TeamRecruitment.collection.name, 'recruitment', '__recruitment'),
  unwindOptional('__recruitment'),
  basicLookup(User.collection.name, '__recruitment.team', '__team'),
  unwindOptional('__team'),
  basicLookup(User.collection.name, 'applicant', '__applicant'),
  unwindOptional('__applicant'),
  {
    $match: {
      $or: [
        { '__recruitment._id': { $exists: false } },
        { '__recruitment.isActive': { $ne: true } },
        { $nor: [teamRecruitmentIntegrityOr('__recruitment')] },
        ...invalidOwnerConditions('__team', 'team'),
        ...invalidOwnerConditions('__applicant', 'player')
      ]
    }
  },
  { $project: { _id: 1 } }
]);

const findInvalidEmbeddedReferences = (Model, arrayField, referenceField, expectedUserType) => Model.aggregate([
  { $unwind: `$${arrayField}` },
  basicLookup(User.collection.name, `${arrayField}.${referenceField}`, '__reference'),
  unwindOptional('__reference'),
  { $match: { $or: invalidOwnerConditions('__reference', expectedUserType) } },
  {
    $group: {
      _id: `$${arrayField}.${referenceField}`,
      ownerRecords: { $addToSet: '$_id' }
    }
  },
  { $project: { _id: 1, affectedRecords: { $size: '$ownerRecords' } } }
]);

const findDuplicateCodes = (Model, codeField) => Model.aggregate([
  { $match: { [codeField]: { $type: 'string', $ne: '' } } },
  { $group: { _id: `$${codeField}`, count: { $sum: 1 }, records: { $addToSet: '$_id' } } },
  { $match: { count: { $gt: 1 } } }
]);

const findCodeProblems = async (Model, codeField, canonicalPattern, supportedPattern) => {
  const [missing, unsupported, legacyNonCanonical] = await Promise.all([
    Model.find({ $or: [{ [codeField]: { $exists: false } }, { [codeField]: null }, { [codeField]: '' }] })
      .lean(),
    Model.find({ [codeField]: { $type: 'string', $ne: '', $not: supportedPattern } })
      .select(`_id ${codeField}`).lean(),
    Model.find({
      $and: [
        { [codeField]: { $type: 'string', $regex: supportedPattern } },
        { [codeField]: { $not: canonicalPattern } }
      ]
    }).select(`_id ${codeField}`).lean()
  ]);
  return { missing, unsupported, legacyNonCanonical };
};

const findDuplicateActiveApplications = () => RecruitmentApplication.aggregate([
  { $match: { isActive: true } },
  {
    $group: {
      _id: { applicant: '$applicant', recruitment: '$recruitment' },
      count: { $sum: 1 },
      records: { $addToSet: '$_id' }
    }
  },
  { $match: { count: { $gt: 1 } } }
]);

const findApplicantStatusDivergence = () => RecruitmentApplication.aggregate([
  { $match: { isActive: true } },
  basicLookup(TeamRecruitment.collection.name, 'recruitment', '__recruitment'),
  unwindOptional('__recruitment'),
  {
    $addFields: {
      __embeddedApplicants: {
        $filter: {
          input: { $ifNull: ['$__recruitment.applicants', []] },
          as: 'embedded',
          cond: { $eq: ['$$embedded.user', '$applicant'] }
        }
      }
    }
  },
  {
    $match: {
      $expr: {
        $or: [
          { $eq: [{ $size: '$__embeddedApplicants' }, 0] },
          { $ne: [{ $arrayElemAt: ['$__embeddedApplicants.status', 0] }, '$status'] }
        ]
      }
    }
  },
  {
    $project: {
      _id: 1,
      recruitment: 1,
      applicant: 1,
      status: 1,
      message: 1,
      resume: 1,
      portfolio: 1,
      createdAt: 1
    }
  }
]);

const findEmbeddedApplicantsWithoutCanonical = () => TeamRecruitment.aggregate([
  { $unwind: '$applicants' },
  basicLookup(RecruitmentApplication.collection.name, 'applicants.user', '__candidateApplications'),
  {
    $addFields: {
      __activeCanonical: {
        $filter: {
          input: { $ifNull: ['$__candidateApplications', []] },
          as: 'candidate',
          cond: {
            $and: [
              { $eq: ['$$candidate.recruitment', '$_id'] },
              { $eq: ['$$candidate.isActive', true] }
            ]
          }
        }
      }
    }
  },
  { $match: { $expr: { $eq: [{ $size: '$__activeCanonical' }, 0] } } },
  { $project: { _id: 0, recruitmentId: '$_id', applicantId: '$applicants.user' } }
]);

const findDuplicateEmbeddedReferences = (Model, arrayField, referenceField) => Model.aggregate([
  { $unwind: `$${arrayField}` },
  {
    $group: {
      _id: { owner: '$_id', reference: `$${arrayField}.${referenceField}` },
      count: { $sum: 1 }
    }
  },
  { $match: { count: { $gt: 1 } } }
]);

const findInvalidExpiry = (Model) => Model.find({
  $nor: [
    { expiresAt: null },
    { expiresAt: { $exists: false } },
    { expiresAt: { $type: 'date' } }
  ]
}).select('_id expiresAt').lean();

const findInvalidRoleMappings = async (Model, typeField, typeValue) => {
  const records = await Model.find({ [typeField]: typeValue }).select('_id game role').lean();
  return records.filter((record) => !isValidRecruitmentRole(record.game, record.role));
};

const indexSignature = (key, options = {}) => JSON.stringify({
  key,
  unique: options.unique === true,
  sparse: options.sparse === true,
  expireAfterSeconds: options.expireAfterSeconds ?? null,
  partialFilterExpression: options.partialFilterExpression || null
});

const findMissingDeclaredIndexes = async (models) => {
  const missing = [];
  for (const Model of models) {
    let actualIndexes;
    try {
      actualIndexes = await Model.collection.indexes();
    } catch (error) {
      if (!isNamespaceNotFound(error)) throw error;
      actualIndexes = [];
    }
    const actualSignatures = new Set(actualIndexes.map((index) => indexSignature(index.key, index)));
    Model.schema.indexes().forEach(([key, options]) => {
      if (!actualSignatures.has(indexSignature(key, options))) {
        missing.push({ model: Model.modelName, key, options });
      }
    });
  }
  return missing;
};

const findDailyLimitState = async () => {
  const window = utcDayWindow();
  const profileCounts = await PlayerProfile.aggregate([
    { $match: { createdAt: { $gte: window.start, $lt: window.resetsAt } } },
    { $group: { _id: '$player', count: { $sum: 1 } } }
  ]);
  let quotas;
  try {
    quotas = await RecruitmentPostingQuota.find({ dayKey: window.dayKey }).select('player count').lean();
  } catch (error) {
    if (!isNamespaceNotFound(error)) throw error;
    quotas = [];
  }
  const quotaByPlayer = new Map(quotas.map((quota) => [String(quota.player), Number(quota.count) || 0]));
  return {
    window,
    profileCounts,
    violations: profileCounts.filter((row) => row.count > 2),
    quotaMismatches: profileCounts.filter((row) => quotaByPlayer.get(String(row._id)) !== Math.min(2, row.count))
  };
};

const findDuplicateQuotaKeys = async () => {
  try {
    return await RecruitmentPostingQuota.aggregate([
      {
        $group: {
          _id: { player: '$player', dayKey: '$dayKey' },
          count: { $sum: 1 },
          records: { $addToSet: '$_id' }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);
  } catch (error) {
    if (isNamespaceNotFound(error)) return [];
    throw error;
  }
};

const cleanupEmbeddedReferences = async (Model, arrayField, referenceField, records) => {
  if (!records.length) return;
  await Model.bulkWrite(records.map((record) => ({
    updateMany: {
      filter: { [`${arrayField}.${referenceField}`]: record._id },
      update: { $pull: { [arrayField]: { [referenceField]: record._id } } }
    }
  })), { ordered: false });
};

const reportCounts = (report) => ({
  invalidTeamRecruitments: report.teamRecruitments.length,
  invalidPlayerProfiles: report.playerProfiles.length,
  invalidTeamOwners: report.invalidTeamOwners.length,
  invalidPlayerOwners: report.invalidPlayerOwners.length,
  invalidQuotaOwners: report.invalidQuotaOwners.length,
  invalidApplications: report.applications.length,
  invalidEmbeddedApplicants: report.embeddedApplicants.length,
  invalidEmbeddedInterestedTeams: report.embeddedInterestedTeams.length,
  missingRecruitmentCodes: report.recruitmentCodes.missing.length,
  unsupportedRecruitmentCodes: report.recruitmentCodes.unsupported.length,
  legacyNonCanonicalRecruitmentCodes: report.recruitmentCodes.legacyNonCanonical.length,
  duplicateRecruitmentCodes: report.duplicateRecruitmentCodes.length,
  missingProfileCodes: report.profileCodes.missing.length,
  unsupportedProfileCodes: report.profileCodes.unsupported.length,
  legacyNonCanonicalProfileCodes: report.profileCodes.legacyNonCanonical.length,
  duplicateProfileCodes: report.duplicateProfileCodes.length,
  duplicateActiveApplications: report.duplicateActiveApplications.length,
  applicantStatusDivergence: report.applicantStatusDivergence.length,
  embeddedApplicantsWithoutCanonical: report.embeddedApplicantsWithoutCanonical.length,
  duplicateEmbeddedApplicants: report.duplicateEmbeddedApplicants.length,
  duplicateInterestedTeams: report.duplicateInterestedTeams.length,
  invalidRecruitmentStatuses: report.invalidRecruitmentStatuses.length,
  invalidPlayerProfileStatuses: report.invalidPlayerProfileStatuses.length,
  invalidApplicationStatuses: report.invalidApplicationStatuses.length,
  invalidRecruitmentExpiry: report.invalidRecruitmentExpiry.length,
  invalidPlayerProfileExpiry: report.invalidPlayerProfileExpiry.length,
  invalidRecruitmentRoleMappings: report.invalidRecruitmentRoleMappings.length,
  invalidPlayerRoleMappings: report.invalidPlayerRoleMappings.length,
  dailyPlayerCardLimitViolations: report.dailyLimit.violations.length,
  dailyQuotaMismatches: report.dailyLimit.quotaMismatches.length,
  duplicateQuotaKeys: report.duplicateQuotaKeys.length,
  missingDeclaredIndexes: report.missingDeclaredIndexes.length
});

const collectReport = async () => {
  const [
    teamRecruitments,
    playerProfiles,
    invalidTeamOwners,
    invalidPlayerOwners,
    invalidQuotaOwners,
    applications,
    embeddedApplicants,
    embeddedInterestedTeams,
    recruitmentCodes,
    profileCodes,
    duplicateRecruitmentCodes,
    duplicateProfileCodes,
    duplicateActiveApplications,
    applicantStatusDivergence,
    embeddedApplicantsWithoutCanonical,
    duplicateEmbeddedApplicants,
    duplicateInterestedTeams,
    invalidRecruitmentStatuses,
    invalidPlayerProfileStatuses,
    invalidApplicationStatuses,
    invalidRecruitmentExpiry,
    invalidPlayerProfileExpiry,
    invalidRecruitmentRoleMappings,
    invalidPlayerRoleMappings,
    dailyLimit,
    missingDeclaredIndexes,
    duplicateQuotaKeys
  ] = await Promise.all([
    findInvalidRecruitments(TeamRecruitment, 'team', 'team', addTeamRecruitmentIntegrityFilters({})),
    findInvalidRecruitments(PlayerProfile, 'player', 'player', addPlayerProfileIntegrityFilters({})),
    findInvalidOwners(TeamRecruitment, 'team', 'team'),
    findInvalidOwners(PlayerProfile, 'player', 'player'),
    findInvalidQuotaOwners(),
    findInvalidApplications(),
    findInvalidEmbeddedReferences(TeamRecruitment, 'applicants', 'user', 'player'),
    findInvalidEmbeddedReferences(PlayerProfile, 'interestedTeams', 'team', 'team'),
    findCodeProblems(
      TeamRecruitment,
      'recruitmentCode',
      SHARE_CODE_PATTERNS.recruitment,
      SUPPORTED_LEGACY_SHARE_CODE_PATTERNS.recruitment
    ),
    findCodeProblems(
      PlayerProfile,
      'profileCode',
      SHARE_CODE_PATTERNS.profile,
      SUPPORTED_LEGACY_SHARE_CODE_PATTERNS.profile
    ),
    findDuplicateCodes(TeamRecruitment, 'recruitmentCode'),
    findDuplicateCodes(PlayerProfile, 'profileCode'),
    findDuplicateActiveApplications(),
    findApplicantStatusDivergence(),
    findEmbeddedApplicantsWithoutCanonical(),
    findDuplicateEmbeddedReferences(TeamRecruitment, 'applicants', 'user'),
    findDuplicateEmbeddedReferences(PlayerProfile, 'interestedTeams', 'team'),
    TeamRecruitment.find({ status: { $nin: TEAM_RECRUITMENT_STATUSES } }).select('_id status').lean(),
    PlayerProfile.find({ status: { $nin: PLAYER_PROFILE_STATUSES } }).select('_id status').lean(),
    RecruitmentApplication.find({ status: { $nin: ['pending', 'withdrawn', ...TEAM_APPLICATION_STATUSES] } }).select('_id status').lean(),
    findInvalidExpiry(TeamRecruitment),
    findInvalidExpiry(PlayerProfile),
    findInvalidRoleMappings(TeamRecruitment, 'recruitmentType', 'roster'),
    findInvalidRoleMappings(PlayerProfile, 'profileType', 'looking-for-team'),
    findDailyLimitState(),
    findMissingDeclaredIndexes([TeamRecruitment, PlayerProfile, RecruitmentApplication, RecruitmentPostingQuota]),
    findDuplicateQuotaKeys()
  ]);
  return {
    teamRecruitments,
    playerProfiles,
    invalidTeamOwners,
    invalidPlayerOwners,
    invalidQuotaOwners,
    applications,
    embeddedApplicants,
    embeddedInterestedTeams,
    recruitmentCodes,
    profileCodes,
    duplicateRecruitmentCodes,
    duplicateProfileCodes,
    duplicateActiveApplications,
    applicantStatusDivergence,
    embeddedApplicantsWithoutCanonical,
    duplicateEmbeddedApplicants,
    duplicateInterestedTeams,
    invalidRecruitmentStatuses,
    invalidPlayerProfileStatuses,
    invalidApplicationStatuses,
    invalidRecruitmentExpiry,
    invalidPlayerProfileExpiry,
    invalidRecruitmentRoleMappings,
    invalidPlayerRoleMappings,
    dailyLimit,
    missingDeclaredIndexes,
    duplicateQuotaKeys
  };
};

const ids = (records) => records.map((record) => record._id);

const backfillMissingCodes = async (report) => {
  const invalidRecruitmentIds = new Set(ids(report.teamRecruitments).map(String));
  const invalidProfileIds = new Set(ids(report.playerProfiles).map(String));
  for (const recruitment of report.recruitmentCodes.missing
    .filter((record) => !invalidRecruitmentIds.has(String(record._id)))) {
    await backfillUniqueShareCode({
      model: TeamRecruitment,
      document: recruitment,
      codeField: 'recruitmentCode',
      generateCode: () => generateRecruitmentCode(recruitment)
    });
  }
  for (const profile of report.profileCodes.missing
    .filter((record) => !invalidProfileIds.has(String(record._id)))) {
    await backfillUniqueShareCode({
      model: PlayerProfile,
      document: profile,
      codeField: 'profileCode',
      generateCode: () => generatePlayerProfileCode(profile)
    });
  }
};

const reconcileCanonicalApplicants = async (report) => {
  const pairs = new Map();
  report.applicantStatusDivergence.forEach((application) => {
    pairs.set(`${application.recruitment}:${application.applicant}`, {
      recruitmentId: application.recruitment,
      applicantId: application.applicant,
      application
    });
  });
  report.duplicateEmbeddedApplicants.forEach((duplicate) => {
    const recruitmentId = duplicate._id?.owner;
    const applicantId = duplicate._id?.reference;
    if (recruitmentId && applicantId) {
      pairs.set(`${recruitmentId}:${applicantId}`, { recruitmentId, applicantId });
    }
  });

  for (const pair of pairs.values()) {
    const application = pair.application || await RecruitmentApplication.findOne({
      recruitment: pair.recruitmentId,
      applicant: pair.applicantId,
      isActive: true
    }).lean();
    await TeamRecruitment.updateOne(
      { _id: pair.recruitmentId },
      { $pull: { applicants: { user: pair.applicantId } } }
    );
    if (application) {
      await TeamRecruitment.updateOne(
        { _id: pair.recruitmentId },
        {
          $push: {
            applicants: {
              user: pair.applicantId,
              appliedAt: application.createdAt || new Date(),
              status: application.status,
              message: application.message,
              resume: application.resume,
              portfolio: application.portfolio
            }
          }
        }
      );
    }
  }
};

const applySafeRepairs = async (report) => {
  await backfillMissingCodes(report);
  await reconcileCanonicalApplicants(report);
  await Promise.all([
    ids(report.teamRecruitments).length
      ? TeamRecruitment.updateMany(
        { _id: { $in: ids(report.teamRecruitments) } },
        { $set: { status: 'closed', isActive: false } }
      )
      : null,
    ids(report.playerProfiles).length
      ? PlayerProfile.updateMany(
        { _id: { $in: ids(report.playerProfiles) } },
        { $set: { status: 'inactive', isActive: false } }
      )
      : null,
    ids(report.applications).length
      ? RecruitmentApplication.updateMany(
        { _id: { $in: ids(report.applications) } },
        { $set: { status: 'withdrawn', isActive: false } }
      )
      : null,
    ids(report.invalidQuotaOwners).length
      ? RecruitmentPostingQuota.deleteMany({ _id: { $in: ids(report.invalidQuotaOwners) } })
      : null,
    cleanupEmbeddedReferences(TeamRecruitment, 'applicants', 'user', report.embeddedApplicants),
    cleanupEmbeddedReferences(PlayerProfile, 'interestedTeams', 'team', report.embeddedInterestedTeams),
    report.embeddedApplicantsWithoutCanonical.length
      ? TeamRecruitment.bulkWrite(report.embeddedApplicantsWithoutCanonical.map((record) => ({
        updateOne: {
          filter: { _id: record.recruitmentId },
          update: { $pull: { applicants: { user: record.applicantId } } }
        }
      })), { ordered: false })
      : null,
    ...report.dailyLimit.profileCounts.map((row) => RecruitmentPostingQuota.updateOne(
      { player: row._id, dayKey: report.dailyLimit.window.dayKey },
      {
        $set: {
          count: Math.min(2, row.count),
          expiresAt: new Date(report.dailyLimit.window.resetsAt.getTime() + 24 * 60 * 60 * 1000)
        }
      },
      { upsert: true }
    ))
  ]);
};

const connectOptions = () => ({
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

const main = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri, connectOptions());

  const report = await collectReport();
  const counts = reportCounts(report);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'audit-only', strict, ...counts }, null, 2));

  if (apply) {
    await applySafeRepairs(report);
    console.log('Safe recruitment integrity repairs applied. Ambiguous duplicate interests/share codes/statuses were report-only.');
  } else {
    console.log('No data changed. Re-run with --apply only after reviewing counts and taking a snapshot.');
  }

  const blockingCounts = Object.entries(counts).filter(([key]) => !key.startsWith('legacyNonCanonical'));
  if (strict && blockingCounts.some(([, count]) => count > 0)) process.exitCode = 2;
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = {
  basicLookup,
  invalidOwnerConditions,
  isNamespaceNotFound,
  findInvalidOwners,
  findInvalidQuotaOwners,
  findInvalidRecruitments,
  findInvalidApplications,
  findInvalidEmbeddedReferences,
  findDuplicateCodes,
  findDuplicateActiveApplications,
  findApplicantStatusDivergence,
  findEmbeddedApplicantsWithoutCanonical,
  findDuplicateEmbeddedReferences,
  findDuplicateQuotaKeys,
  reconcileCanonicalApplicants,
  reportCounts,
  connectOptions
};
