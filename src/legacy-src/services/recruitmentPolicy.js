const mongoose = require('mongoose');

const TEAM_RECRUITMENT_STATUSES = Object.freeze(['active', 'paused', 'closed', 'filled']);
const PLAYER_PROFILE_STATUSES = Object.freeze(['active', 'paused', 'inactive']);
const TEAM_APPLICATION_STATUSES = Object.freeze(['reviewed', 'shortlisted', 'rejected', 'accepted']);
const RECRUITMENT_GAMES = Object.freeze([
  'BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite',
  'Apex Legends', 'League of Legends', 'Dota 2'
]);
const RECRUITMENT_ROLES_BY_GAME = Object.freeze({
  BGMI: Object.freeze(['IGL', 'Assaulter', 'Support', 'Sniper']),
  Valorant: Object.freeze(['Duelist', 'Controller', 'Initiator', 'Sentinel']),
  'Free Fire': Object.freeze(['Rusher', 'Support', 'Sniper', 'IGL']),
  'Call of Duty Mobile': Object.freeze(['Assault', 'SMG', 'Sniper', 'Support']),
  'CS:GO': Object.freeze(['Entry Fragger', 'Support', 'AWPer', 'IGL', 'Lurker']),
  Fortnite: Object.freeze(['Builder', 'Fighter', 'Support', 'IGL']),
  'Apex Legends': Object.freeze(['Fragger', 'Support', 'IGL', 'Flex']),
  'League of Legends': Object.freeze(['Top', 'Jungle', 'Mid', 'ADC', 'Support']),
  'Dota 2': Object.freeze(['Carry', 'Mid', 'Offlane', 'Support', 'Hard Support'])
});
const RECRUITMENT_STAFF_ROLES = Object.freeze([
  'Coach', 'Manager', 'Content Creator', 'Video Editor', 'Social Media Manager',
  'GFX Artist', 'Scrims Manager', 'Tournament Manager', 'Analyst', 'Stream Manager'
]);

const isValidRecruitmentRole = (game, role) => Boolean(
  typeof role === 'string'
  && RECRUITMENT_ROLES_BY_GAME[game]?.includes(role.trim())
);

const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === 'function') {
    return value.toObject({ virtuals: true });
  }
  return { ...value };
};

const serializeTeamRecruitment = (value) => {
  const recruitment = toPlainObject(value);
  if (recruitment.team && typeof recruitment.team === 'object') {
    delete recruitment.team.privacySettings;
    delete recruitment.team.blockedUsers;
    delete recruitment.team.lastSeen;
  }
  const applicants = Array.isArray(recruitment.applicants) ? recruitment.applicants : [];
  const explicitCount = Number(recruitment.applicantCount);
  recruitment.applicantCount = Number.isFinite(explicitCount) ? explicitCount : applicants.length;
  delete recruitment.applicants;
  return recruitment;
};

const serializePlayerProfile = (value, { includeInterestedTeams = false } = {}) => {
  const profile = toPlainObject(value);
  if (profile.player && typeof profile.player === 'object') {
    delete profile.player.privacySettings;
    delete profile.player.blockedUsers;
    delete profile.player.lastSeen;
  }
  const interestedTeams = Array.isArray(profile.interestedTeams) ? profile.interestedTeams : [];
  const explicitCount = Number(profile.interestedTeamsCount);
  profile.interestedTeamsCount = Number.isFinite(explicitCount) ? explicitCount : interestedTeams.length;
  if (!includeInterestedTeams) delete profile.interestedTeams;
  else {
    profile.interestedTeams = interestedTeams.filter((entry) => entry?.team && typeof entry.team === 'object');
    profile.interestedTeamsCount = profile.interestedTeams.length;
  }
  return profile;
};

const isUnexpired = (expiresAt, now = new Date()) => {
  if (!expiresAt) return true;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
};

const isRecruitmentLive = (recruitment, now = new Date()) => Boolean(
  recruitment
  && recruitment.status === 'active'
  && recruitment.isActive !== false
  && isUnexpired(recruitment.expiresAt, now)
);

const isPlayerProfileLive = (profile, now = new Date()) => Boolean(
  profile
  && profile.status === 'active'
  && profile.isActive !== false
  && isUnexpired(profile.expiresAt, now)
);

const addAndCondition = (query, condition) => {
  query.$and = Array.isArray(query.$and) ? query.$and : [];
  query.$and.push(condition);
  return query;
};

const hasNonBlankStringExpression = (field) => ({
  $gt: [
    {
      $strLenCP: {
        $trim: {
          input: { $convert: { input: `$${field}`, to: 'string', onError: '', onNull: '' } }
        }
      }
    },
    0
  ]
});

// Structural-integrity $or for team recruitments, parameterized by an optional
// field prefix so it can also run against an unwound owner path (e.g.
// `__validRecruitment`) at the TOP level of an aggregation. Keeping this out of
// a $lookup sub-pipeline matters: Amazon DocumentDB rejects a pipeline $lookup
// that carries more than one $expr ("$lookup on multiple join conditions").
const teamRecruitmentIntegrityOr = (prefix = '') => {
  const p = prefix ? `${prefix}.` : '';
  return {
    $or: [
      ...Object.entries(RECRUITMENT_ROLES_BY_GAME).map(([game, roles]) => ({
        [`${p}recruitmentType`]: 'roster',
        [`${p}game`]: game,
        [`${p}role`]: { $in: roles }
      })),
      {
        [`${p}recruitmentType`]: 'staff',
        [`${p}staffRole`]: { $in: RECRUITMENT_STAFF_ROLES }
      }
    ]
  };
};

const addTeamRecruitmentIntegrityFilters = (query = {}) => addAndCondition(query, teamRecruitmentIntegrityOr());

const addPlayerProfileIntegrityFilters = (query = {}) => addAndCondition(query, {
  $or: [
    ...Object.entries(RECRUITMENT_ROLES_BY_GAME).map(([game, roles]) => ({
      profileType: 'looking-for-team',
      game,
      role: { $in: roles }
    })),
    {
      profileType: 'staff-position',
      staffRole: { $in: RECRUITMENT_STAFF_ROLES }
    }
  ]
});

const getValidRecruitmentOwnerMatch = (expectedUserType) => ({
  userType: expectedUserType,
  isActive: true,
  needsProfileCompletion: { $ne: true },
  username: { $type: 'string' },
  $expr: hasNonBlankStringExpression('username')
});

// Top-level owner-validity $match for an unwound owner path. Used AFTER a
// $unwind rather than inside the $lookup sub-pipeline so the join stays a single
// DocumentDB-compatible condition (see teamRecruitmentIntegrityOr). The validity
// fields it inspects must be projected out of the owner $lookup.
const buildValidOwnerMatchStage = (ownerPath, expectedUserType) => {
  const p = ownerPath ? `${ownerPath}.` : '';
  return {
    $match: {
      [`${p}userType`]: expectedUserType,
      [`${p}isActive`]: true,
      [`${p}needsProfileCompletion`]: { $ne: true },
      [`${p}username`]: { $type: 'string' },
      $expr: hasNonBlankStringExpression(`${p}username`)
    }
  };
};

// Counts valid joined User rows without relying on a correlated $lookup. This
// is used for denormalized recruitment relationship arrays: basic lookups
// naturally collapse duplicate ids, and filtering here prevents deleted or
// deactivated accounts from inflating the public card counts.
const countValidJoinedOwnersExpression = (arrayField, expectedUserType) => ({
  $size: {
    $filter: {
      input: { $ifNull: [`$${arrayField}`, []] },
      as: 'joinedOwner',
      cond: {
        $and: [
          { $eq: ['$$joinedOwner.userType', expectedUserType] },
          { $eq: ['$$joinedOwner.isActive', true] },
          { $ne: ['$$joinedOwner.needsProfileCompletion', true] },
          { $eq: [{ $type: '$$joinedOwner.username' }, 'string'] },
          hasNonBlankStringExpression('$joinedOwner.username')
        ]
      }
    }
  }
});

const isTeamRecruitmentStructurallyValid = (recruitment) => {
  if (!recruitment) return false;
  if (recruitment.recruitmentType === 'roster') {
    return isValidRecruitmentRole(recruitment.game, recruitment.role);
  }
  return recruitment.recruitmentType === 'staff'
    && RECRUITMENT_STAFF_ROLES.includes(recruitment.staffRole);
};

const isPlayerProfileStructurallyValid = (profile) => {
  if (!profile) return false;
  if (profile.profileType === 'looking-for-team') {
    return isValidRecruitmentRole(profile.game, profile.role);
  }
  return profile.profileType === 'staff-position'
    && RECRUITMENT_STAFF_ROLES.includes(profile.staffRole);
};

const isValidRecruitmentOwner = (owner, expectedUserType) => Boolean(
  owner
  && owner._id
  && owner.userType === expectedUserType
  && owner.isActive === true
  && owner.needsProfileCompletion !== true
  && typeof owner.username === 'string'
  && owner.username.trim()
);

// Builds the effective-visibility expression against an optional owner base path.
// When the owner document has been unwound into a nested field (e.g. `__validOwner`)
// the privacy check runs at the top level of the pipeline, so it must reference
// `$__validOwner.privacySettings.*` instead of `$privacySettings.*`.
const buildEffectiveVisibilityExpression = (base = '') => {
  const prefix = base ? `${base}.` : '';
  const field = (name) => `$${prefix}${name}`;
  return {
    $switch: {
      branches: [
        {
          case: { $in: [field('privacySettings.profileVisibility'), ['public', 'followers', 'private']] },
          then: field('privacySettings.profileVisibility')
        },
        {
          case: {
            $and: [
              { $eq: [{ $type: field('privacySettings.profileVisibility') }, 'missing'] },
              {
                $or: [
                  { $eq: [field('privacySettings.accountType'), 'public'] },
                  { $eq: [{ $type: field('privacySettings.accountType') }, 'missing'] }
                ]
              }
            ]
          },
          then: 'public'
        }
      ],
      default: 'private'
    }
  };
};

const effectiveProfileVisibilityExpression = buildEffectiveVisibilityExpression();

const DEFAULT_RECRUITMENT_OWNER_PROJECTION = Object.freeze({
  _id: 1,
  username: 1,
  userType: 1,
  isActive: 1,
  'profile.displayName': 1,
  'profile.avatar': 1,
  privacySettings: 1,
  blockedUsers: 1
});

// Reconstructs an owner subdocument containing exactly the caller's projection
// fields (dotted keys become nested objects). Used after a basic $lookup, which
// returns the whole user document, so nothing beyond the requested fields ever
// reaches serialization.
const buildOwnerProjectionExpression = (sourcePath, projection) => {
  const root = {};
  for (const key of Object.keys(projection)) {
    if (projection[key] !== 1) continue;
    const parts = key.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = `$${sourcePath}.${key}`;
  }
  return root;
};

// Emits the owner privacy/blocklist $match, which runs at the TOP level of the
// aggregation (after the owner has been unwound into `ownerPath`). Amazon
// DocumentDB does NOT support a correlated $lookup (the `let`/`pipeline` form),
// so the viewer's follow relationships are resolved in JS beforehand and passed
// in as `viewerFollowingIds` rather than joined inside the pipeline.
const buildRecruitmentOwnerPrivacyStages = ({
  viewerId,
  viewerBlockedIds = [],
  viewerFollowingIds = [],
  ownerPath = ''
} = {}) => {
  const prefix = ownerPath ? `${ownerPath}.` : '';
  const ownerField = (name) => `$${prefix}${name}`;
  const visibilityExpr = buildEffectiveVisibilityExpression(ownerPath);
  const hasViewer = viewerId && mongoose.Types.ObjectId.isValid(String(viewerId));
  if (!hasViewer) {
    return [{ $match: { $expr: { $eq: [visibilityExpr, 'public'] } } }];
  }
  const viewerObjectId = new mongoose.Types.ObjectId(String(viewerId));
  const toObjectIds = (ids) => (ids || [])
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  const blockedObjectIds = toObjectIds(viewerBlockedIds);
  const followingObjectIds = toObjectIds(viewerFollowingIds);
  return [
    // Exclude owners who have blocked the viewer. This runs as a plain
    // query-language $ne (not an $expr $in) because Amazon DocumentDB's
    // aggregation $in rejects a computed array argument such as the previous
    // { $ifNull: ['$...blockedUsers', []] } ("$in requires an array as a second
    // argument, found: object"). A query-language $ne against an array field
    // means "no element equals value" and treats a missing field as a pass —
    // exactly the intended semantics.
    { $match: { [`${prefix}blockedUsers`]: { $ne: viewerObjectId } } },
    {
      $match: {
        $expr: {
          $and: [
            // blockedObjectIds / followingObjectIds are precomputed literal
            // arrays, which DocumentDB's aggregation $in accepts.
            { $not: [{ $in: [ownerField('_id'), blockedObjectIds] }] },
            {
              $or: [
                { $eq: [ownerField('_id'), viewerObjectId] },
                { $eq: [visibilityExpr, 'public'] },
                { $in: [ownerField('_id'), followingObjectIds] }
              ]
            }
          ]
        }
      }
    }
  ];
};

/**
 * Canonical list query for TeamRecruitment and PlayerProfile. Owner validity
 * is applied before sorting, pagination, and counting so a failed population
 * can never become an orphan card or an incorrect pagination total.
 */
const listCanonicalRecruitmentRecords = async ({
  model,
  userModel,
  query,
  ownerField,
  expectedUserType,
  countField,
  sortBy,
  sortDirection,
  page,
  limit,
  viewerId,
  viewerBlockedIds,
  followModel,
  applicationModel,
  searchPattern = '',
  searchFields = [],
  ownerProjection = DEFAULT_RECRUITMENT_OWNER_PROJECTION
}) => {
  const countSource = countField === 'applicantCount' ? 'applicants' : 'interestedTeams';
  const sort = sortBy === 'createdAt'
    ? { createdAt: sortDirection, _id: 1 }
    : { [sortBy]: sortDirection, createdAt: -1, _id: 1 };

  // Amazon DocumentDB does not support the correlated $lookup (the `let`/`pipeline`
  // form) — it rejects it with "$lookup on multiple join conditions". So the owner
  // is joined with a basic localField/foreignField $lookup, and the viewer's follow
  // set is resolved in JS beforehand. Owner validity and privacy/blocklist filtering
  // run at the top level after $unwind; the owner (a full user document from the
  // basic join) is then reduced to the caller's projection.
  const hasViewer = viewerId && mongoose.Types.ObjectId.isValid(String(viewerId));
  let viewerFollowingIds = [];
  if (hasViewer) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const FollowModel = followModel || require('../models/Follow');
    viewerFollowingIds = await FollowModel
      .distinct('following', { follower: new mongoose.Types.ObjectId(String(viewerId)) });
  }

  const canonicalApplicationModel = countField === 'applicantCount'
    ? (applicationModel || require('../models/RecruitmentApplication'))
    : null;
  const countStages = canonicalApplicationModel
    ? [
        {
          $lookup: {
            from: canonicalApplicationModel.collection.name,
            localField: '_id',
            foreignField: 'recruitment',
            as: '__canonicalApplications'
          }
        },
        {
          $addFields: {
            __activeCanonicalApplications: {
              $filter: {
                input: { $ifNull: ['$__canonicalApplications', []] },
                as: 'application',
                cond: { $eq: ['$$application.isActive', true] }
              }
            }
          }
        },
        {
          $lookup: {
            from: userModel.collection.name,
            localField: '__activeCanonicalApplications.applicant',
            foreignField: '_id',
            as: '__validApplicantUsers'
          }
        },
        {
          $addFields: {
            [countField]: countValidJoinedOwnersExpression('__validApplicantUsers', 'player')
          }
        },
        { $project: { __canonicalApplications: 0, __activeCanonicalApplications: 0, __validApplicantUsers: 0 } }
      ]
    : [
        {
          $lookup: {
            from: userModel.collection.name,
            localField: `${countSource}.team`,
            foreignField: '_id',
            as: '__validInterestedTeamUsers'
          }
        },
        {
          $addFields: {
            [countField]: countValidJoinedOwnersExpression('__validInterestedTeamUsers', 'team')
          }
        },
        { $project: { __validInterestedTeamUsers: 0 } }
      ];

  const basePipeline = [
    { $match: query },
    {
      $lookup: {
        from: userModel.collection.name,
        localField: ownerField,
        foreignField: '_id',
        as: '__validOwner'
      }
    },
    { $unwind: '$__validOwner' },
    buildValidOwnerMatchStage('__validOwner', expectedUserType),
    ...buildRecruitmentOwnerPrivacyStages({
      viewerId,
      viewerBlockedIds,
      viewerFollowingIds,
      ownerPath: '__validOwner'
    }),
    ...(searchPattern ? [{
      $match: {
        $or: [
          ...searchFields.map((field) => ({ [field]: { $regex: searchPattern, $options: 'i' } })),
          { '__validOwner.username': { $regex: searchPattern, $options: 'i' } },
          { '__validOwner.profile.displayName': { $regex: searchPattern, $options: 'i' } }
        ]
      }
    }] : []),
    // Reduce the joined owner document to exactly the requested projection.
    // Use $addFields, not $set: Amazon DocumentDB does not support the $set
    // pipeline stage ("Unrecognized pipeline stage name: '$set'").
    { $addFields: { [ownerField]: buildOwnerProjectionExpression('__validOwner', ownerProjection) } },
    { $project: { __validOwner: 0 } }
  ];

  // Amazon DocumentDB does not support $facet, so the page and the total count
  // are fetched with two aggregations that share the base pipeline above.
  const [records, countRows] = await Promise.all([
    model.aggregate([
      ...basePipeline,
      ...countStages,
      { $sort: sort },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]),
    model.aggregate([...basePipeline, { $count: 'total' }])
  ]);

  return {
    records: Array.isArray(records) ? records : [],
    total: Number(countRows?.[0]?.total || 0)
  };
};

/**
 * Canonical application query shared by player and team application screens.
 * Referenced recruitment, team, and applicant records are validated before
 * pagination/counting so an orphan cannot become a card or inflate totals.
 */
const listCanonicalRecruitmentApplications = async ({
  applicationModel,
  recruitmentModel,
  userModel,
  query,
  page,
  limit
}) => {
  // Amazon DocumentDB does not support the correlated $lookup (the `let`/`pipeline`
  // form) — it rejects it with "$lookup on multiple join conditions". Each
  // reference is therefore resolved with a basic localField/foreignField join and
  // validated at the top level after $unwind. The final $set rebuilds
  // recruitment/team/applicant from an explicit whitelist so the full joined
  // documents (e.g. the recruitment `applicants` array) never leak.
  const basePipeline = [
    { $match: query },
    {
      $lookup: {
        from: recruitmentModel.collection.name,
        localField: 'recruitment',
        foreignField: '_id',
        as: '__validRecruitment'
      }
    },
    { $unwind: '$__validRecruitment' },
    { $match: { '__validRecruitment.isActive': true } },
    { $match: teamRecruitmentIntegrityOr('__validRecruitment') },
    {
      $lookup: {
        from: userModel.collection.name,
        localField: '__validRecruitment.team',
        foreignField: '_id',
        as: '__validTeam'
      }
    },
    { $unwind: '$__validTeam' },
    buildValidOwnerMatchStage('__validTeam', 'team'),
    {
      $lookup: {
        from: userModel.collection.name,
        localField: 'applicant',
        foreignField: '_id',
        as: '__validApplicant'
      }
    },
    { $unwind: '$__validApplicant' },
    buildValidOwnerMatchStage('__validApplicant', 'player'),
    {
      // $addFields, not $set: Amazon DocumentDB does not support the $set
      // pipeline stage ("Unrecognized pipeline stage name: '$set'").
      $addFields: {
        recruitment: {
          _id: '$__validRecruitment._id',
          game: '$__validRecruitment.game',
          role: '$__validRecruitment.role',
          staffRole: '$__validRecruitment.staffRole',
          recruitmentType: '$__validRecruitment.recruitmentType',
          status: '$__validRecruitment.status',
          isActive: '$__validRecruitment.isActive',
          expiresAt: '$__validRecruitment.expiresAt',
          recruitmentCode: '$__validRecruitment.recruitmentCode',
          team: {
            _id: '$__validTeam._id',
            username: '$__validTeam.username',
            profile: {
              displayName: '$__validTeam.profile.displayName',
              avatar: '$__validTeam.profile.avatar'
            }
          }
        },
        applicant: {
          _id: '$__validApplicant._id',
          username: '$__validApplicant.username',
          profile: {
            displayName: '$__validApplicant.profile.displayName',
            avatar: '$__validApplicant.profile.avatar'
          }
        },
        appliedAt: '$createdAt'
      }
    },
    { $project: { __validRecruitment: 0, __validApplicant: 0, __validTeam: 0 } }
  ];

  // Amazon DocumentDB does not support $facet, so the page and the total count
  // are fetched with two aggregations that share the base pipeline above.
  const [records, countRows] = await Promise.all([
    applicationModel.aggregate([
      ...basePipeline,
      { $sort: { createdAt: -1, _id: 1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]),
    applicationModel.aggregate([...basePipeline, { $count: 'total' }])
  ]);

  return {
    records: Array.isArray(records) ? records : [],
    total: Number(countRows?.[0]?.total || 0)
  };
};

const sameId = (left, right) => {
  if (left === undefined || left === null || right === undefined || right === null) return false;
  const leftValue = left && left._id ? left._id : left;
  const rightValue = right && right._id ? right._id : right;
  return String(leftValue) === String(rightValue);
};

const parsePositiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
};

const parsePagination = (page, limit, { defaultLimit = 10, maxLimit = 100 } = {}) => ({
  page: parsePositiveInteger(page, 1),
  limit: parsePositiveInteger(limit, defaultLimit, maxLimit)
});

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mergeAllowedObject = (currentValue, incomingValue, allowedKeys) => {
  const current = toPlainObject(currentValue);
  if (!incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) {
    return current;
  }

  const merged = { ...current };
  allowedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(incomingValue, key)) {
      // Trim transport whitespace without rewriting free-text content. Empty
      // strings remain empty so an edit can intentionally clear an optional
      // field instead of silently restoring the previous value.
      merged[key] = typeof incomingValue[key] === 'string'
        ? incomingValue[key].trim()
        : incomingValue[key];
    }
  });
  delete merged._id;
  return merged;
};

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

// Defense-in-depth progression gates for callers that invoke controllers
// without the Express route validators. These mirror the existing Web wizard
// and update-handler rules; a null result means the payload may be persisted.
const validateTeamRecruitmentCreateProgression = ({
  recruitmentType,
  game,
  role,
  staffRole,
  requirements = {},
  benefits = {}
} = {}) => {
  if (!['roster', 'staff'].includes(recruitmentType)) return 'Invalid recruitment type';
  if (game && !Object.prototype.hasOwnProperty.call(RECRUITMENT_ROLES_BY_GAME, game)) {
    return 'Invalid game selection';
  }
  if (recruitmentType === 'roster') {
    if (!hasText(game)) return 'Game is required for roster recruitment';
    if (!hasText(role)) return 'Role is required for roster recruitment';
    if (!isValidRecruitmentRole(game, role)) return 'Role is not valid for the selected game';
  } else if (!hasText(staffRole) || !RECRUITMENT_STAFF_ROLES.includes(staffRole)) {
    return hasText(staffRole) ? 'Invalid staff role' : 'Staff role is required for staff recruitment';
  }

  const progressionValues = recruitmentType === 'roster'
    ? [requirements.experienceLevel, requirements.dailyPlayingTime, requirements.tournamentExperience]
    : [requirements.experienceLevel, requirements.availability];
  if (!progressionValues.some(hasText)) return 'Provide at least one experience or availability requirement';
  if (!hasText(benefits.contactInformation)) return 'Contact information is required';
  return null;
};

const validatePlayerProfileCreateProgression = ({
  profileType,
  game,
  role,
  staffRole,
  playerInfo = {},
  professionalInfo = {},
  expectations = {}
} = {}) => {
  if (!['looking-for-team', 'staff-position'].includes(profileType)) return 'Invalid profile type';
  if (profileType === 'looking-for-team') {
    if (!hasText(game)) return 'Game is required for looking for team profile';
    if (!isValidRecruitmentRole(game, role)) return 'Role is not valid for the selected game';
    if (!hasText(playerInfo.playerName) || !hasText(playerInfo.currentRank)) {
      return 'Player name and current rank are required for looking for team profiles';
    }
  } else {
    if (!hasText(staffRole) || !RECRUITMENT_STAFF_ROLES.includes(staffRole)) {
      return hasText(staffRole) ? 'Invalid staff role' : 'Staff role is required for staff position profile';
    }
    if (!hasText(professionalInfo.fullName) || !hasText(professionalInfo.skillsAndExpertise)) {
      return 'Full name and skills and expertise are required for staff profiles';
    }
  }
  if (!hasText(expectations.contactInformation)) return 'Contact information is required';
  return null;
};

module.exports = {
  TEAM_RECRUITMENT_STATUSES,
  PLAYER_PROFILE_STATUSES,
  TEAM_APPLICATION_STATUSES,
  RECRUITMENT_GAMES,
  RECRUITMENT_ROLES_BY_GAME,
  RECRUITMENT_STAFF_ROLES,
  isValidRecruitmentRole,
  serializeTeamRecruitment,
  serializePlayerProfile,
  isRecruitmentLive,
  isPlayerProfileLive,
  addTeamRecruitmentIntegrityFilters,
  addPlayerProfileIntegrityFilters,
  teamRecruitmentIntegrityOr,
  getValidRecruitmentOwnerMatch,
  isValidRecruitmentOwner,
  isTeamRecruitmentStructurallyValid,
  isPlayerProfileStructurallyValid,
  listCanonicalRecruitmentRecords,
  buildRecruitmentOwnerPrivacyStages,
  listCanonicalRecruitmentApplications,
  isUnexpired,
  sameId,
  parsePagination,
  escapeRegex,
  mergeAllowedObject,
  validateTeamRecruitmentCreateProgression,
  validatePlayerProfileCreateProgression
};
