const { validationResult, body } = require('express-validator');
const {
  TEAM_RECRUITMENT_STATUSES,
  PLAYER_PROFILE_STATUSES,
  TEAM_APPLICATION_STATUSES,
  isValidRecruitmentRole,
  RECRUITMENT_STAFF_ROLES
} = require('../services/recruitmentPolicy');
const ALLOWED_GAMES = ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite', 'Apex Legends', 'League of Legends', 'Dota 2'];
const ALLOWED_STAFF_ROLES = RECRUITMENT_STAFF_ROLES;
const ALLOWED_PLAYER_RANKS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Challenger', 'Immortal', 'Radiant'];
const ALLOWED_STAFF_AVAILABILITY = ['Full-time', 'Part-time', 'Freelance', 'Contract', 'Flexible'];
const ALLOWED_TEAM_TYPES = ['Casual', 'Competitive', 'Professional', 'Any'];
const ALLOWED_PLAYER_COMPENSATION = ['No Salary - Just for Experience', 'Share Based - Winnings Share', 'Fixed Salary + Share', 'Negotiable', 'Any'];
const ALLOWED_TEAM_COMPENSATION = ['No Salary - Share Based', 'Fixed Salary + Share', 'Share Only', 'Negotiable', 'Other'];

const RECRUITMENT_TEXT_FIELDS = Object.freeze({
  'requirements.dailyPlayingTime': 120,
  'requirements.tournamentExperience': 500,
  'requirements.requiredDevice': 200,
  'requirements.experienceLevel': 120,
  'requirements.language': 300,
  'requirements.additionalRequirements': 1500,
  'requirements.availability': 500,
  'requirements.requiredSkills': 1500,
  'requirements.portfolioRequirements': 800,
  'benefits.salary': 200,
  'benefits.customSalary': 200,
  'benefits.location': 120,
  'benefits.benefitsAndPerks': 1000,
  'benefits.contactInformation': 300
});

const PLAYER_PROFILE_TEXT_FIELDS = Object.freeze({
  'playerInfo.playerName': 120,
  'playerInfo.currentRank': 120,
  'playerInfo.experienceLevel': 120,
  'playerInfo.tournamentExperience': 500,
  'playerInfo.achievements': 1500,
  'playerInfo.availability': 500,
  'playerInfo.languages': 300,
  'playerInfo.additionalInfo': 1000,
  'professionalInfo.fullName': 120,
  'professionalInfo.experienceLevel': 120,
  'professionalInfo.availability': 500,
  'professionalInfo.preferredLocation': 120,
  'professionalInfo.skillsAndExpertise': 1500,
  'professionalInfo.professionalAchievements': 1500,
  'professionalInfo.portfolio': 800,
  'expectations.expectedSalary': 200,
  'expectations.compensationPreference': 200,
  'expectations.preferredTeamSize': 120,
  'expectations.teamType': 120,
  'expectations.preferredLocation': 120,
  'expectations.additionalInfo': 1000,
  'expectations.contactInformation': 300
});

const optionalTextValidators = (specification) => Object.entries(specification).map(([field, max]) => (
  body(field)
    .optional()
    .isString()
    .withMessage(`${field} must be text`)
    .bail()
    .isLength({ max })
    .withMessage(`${field} cannot exceed ${max} characters`)
));

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // Never echo rejected values. Several validators handle credentials and
    // bearer-like tokens, so returning `error.value` would disclose secrets in
    // API responses and any downstream access/error logs.
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errorMessages
    });
  }

  next();
};

// Team Recruitment Validation
const validateRecruitment = [
  body('recruitmentType')
    .isIn(['roster', 'staff'])
    .withMessage('Recruitment type must be either roster or staff'),
  body('game').custom((value, { req }) => {
    const game = typeof value === 'string' ? value.trim() : value;
    if (req.body?.recruitmentType === 'roster' && !game) {
      throw new Error('Game is required for roster recruitment');
    }
    if (game && !ALLOWED_GAMES.includes(game)) {
      throw new Error('Invalid game selection');
    }
    return true;
  }),
  body('role')
    .if(body('recruitmentType').equals('roster'))
    .isString()
    .withMessage('Role must be text')
    .bail()
    .notEmpty()
    .withMessage('Role is required for roster recruitment')
    .isLength({ max: 120 })
    .withMessage('Role cannot exceed 120 characters'),
  body('staffRole')
    .if(body('recruitmentType').equals('staff'))
    .notEmpty()
    .withMessage('Staff role is required for staff recruitment')
    .isIn(ALLOWED_STAFF_ROLES)
    .withMessage('Invalid staff role'),
  body().custom((_value, { req }) => {
    if (req.body?.recruitmentType === 'roster'
      && !isValidRecruitmentRole(
        typeof req.body.game === 'string' ? req.body.game.trim() : req.body.game,
        req.body.role
      )) {
      throw new Error('Role is not valid for the selected game');
    }
    return true;
  }),
  body('requirements')
    .optional()
    .isObject()
    .withMessage('Requirements must be an object'),
  body('benefits')
    .isObject()
    .withMessage('Benefits must be an object'),
  ...optionalTextValidators(RECRUITMENT_TEXT_FIELDS),
  body('benefits.salary').optional({ checkFalsy: true }).isIn(ALLOWED_TEAM_COMPENSATION).withMessage('Invalid compensation type'),
  body('benefits.contactInformation')
    .isString()
    .withMessage('Contact information must be text')
    .bail()
    .notEmpty()
    .withMessage('Contact information is required')
    .isLength({ max: 300 })
    .withMessage('Contact information cannot exceed 300 characters'),
  body().custom((_value, { req }) => {
    const requirements = req.body?.requirements || {};
    const requiredValues = req.body?.recruitmentType === 'roster'
      ? [requirements.experienceLevel, requirements.dailyPlayingTime, requirements.tournamentExperience]
      : [requirements.experienceLevel, requirements.availability];
    if (!requiredValues.some(value => typeof value === 'string' && value.trim())) {
      throw new Error('Provide at least one experience or availability requirement');
    }
    return true;
  }),
  handleValidationErrors
];

// Player Profile Validation
const validatePlayerProfile = [
  body('profileType')
    .isIn(['looking-for-team', 'staff-position'])
    .withMessage('Profile type must be either looking-for-team or staff-position'),
  body('game')
    .if(body('profileType').equals('looking-for-team'))
    .notEmpty()
    .withMessage('Game is required for looking for team profile')
    .isIn(ALLOWED_GAMES)
    .withMessage('Invalid game selection'),
  body('role')
    .if(body('profileType').equals('looking-for-team'))
    .isString()
    .withMessage('Role must be text')
    .bail()
    .notEmpty()
    .withMessage('Role is required for looking for team profile'),
  body('staffRole')
    .if(body('profileType').equals('staff-position'))
    .notEmpty()
    .withMessage('Staff role is required for staff position profile')
    .isIn(ALLOWED_STAFF_ROLES)
    .withMessage('Invalid staff role'),
  body().custom((_value, { req }) => {
    if (req.body?.profileType === 'looking-for-team'
      && !isValidRecruitmentRole(
        typeof req.body.game === 'string' ? req.body.game.trim() : req.body.game,
        req.body.role
      )) {
      throw new Error('Role is not valid for the selected game');
    }
    return true;
  }),
  body('playerInfo.playerName')
    .if(body('profileType').equals('looking-for-team'))
    .isString()
    .withMessage('Player name must be text')
    .bail()
    .notEmpty()
    .withMessage('Player name is required for looking for team profile')
    .isLength({ max: 120 })
    .withMessage('Player name cannot exceed 120 characters'),
  body('playerInfo.currentRank')
    .if(body('profileType').equals('looking-for-team'))
    .isString()
    .withMessage('Current rank must be text')
    .bail()
    .notEmpty()
    .withMessage('Current rank is required for looking for team profile')
    .isLength({ max: 120 })
    .withMessage('Current rank cannot exceed 120 characters'),
  body('professionalInfo.fullName')
    .if(body('profileType').equals('staff-position'))
    .isString()
    .withMessage('Full name must be text')
    .bail()
    .notEmpty()
    .withMessage('Full name is required for staff position profile')
    .isLength({ max: 120 })
    .withMessage('Full name cannot exceed 120 characters'),
  body('professionalInfo.skillsAndExpertise')
    .if(body('profileType').equals('staff-position'))
    .isString()
    .withMessage('Skills and expertise must be text')
    .bail()
    .notEmpty()
    .withMessage('Skills and expertise are required for staff position profile')
    .isLength({ max: 1500 })
    .withMessage('Skills and expertise cannot exceed 1500 characters'),
  body('expectations')
    .isObject()
    .withMessage('Expectations must be an object'),
  body('expectations.contactInformation')
    .isString()
    .withMessage('Contact information must be text')
    .bail()
    .notEmpty()
    .withMessage('Contact information is required')
    .isLength({ max: 300 })
    .withMessage('Contact information cannot exceed 300 characters'),
  ...optionalTextValidators(PLAYER_PROFILE_TEXT_FIELDS),
  body('playerInfo.currentRank').optional({ checkFalsy: true }).isIn(ALLOWED_PLAYER_RANKS).withMessage('Invalid current rank'),
  body('professionalInfo.availability').optional({ checkFalsy: true }).isIn(ALLOWED_STAFF_AVAILABILITY).withMessage('Invalid availability'),
  body('expectations.teamType').optional({ checkFalsy: true }).isIn(ALLOWED_TEAM_TYPES).withMessage('Invalid team type'),
  body('expectations.compensationPreference').optional({ checkFalsy: true }).isIn(ALLOWED_PLAYER_COMPENSATION).withMessage('Invalid compensation preference'),
  handleValidationErrors
];

const validateRecruitmentUpdate = [
  body('recruitmentType').optional().isIn(['roster', 'staff']).withMessage('Invalid recruitment type'),
  body('game').optional({ checkFalsy: true }).isIn(ALLOWED_GAMES).withMessage('Invalid game selection'),
  body('role').optional({ checkFalsy: true }).isString().withMessage('Role must be text').bail().isLength({ max: 120 }).withMessage('Role cannot exceed 120 characters'),
  body('staffRole').optional({ checkFalsy: true }).isIn(ALLOWED_STAFF_ROLES).withMessage('Invalid staff role'),
  body('requirements').optional().isObject().withMessage('Requirements must be an object'),
  body('benefits').optional().isObject().withMessage('Benefits must be an object'),
  ...optionalTextValidators(RECRUITMENT_TEXT_FIELDS),
  body('benefits.salary').optional({ checkFalsy: true }).isIn(ALLOWED_TEAM_COMPENSATION).withMessage('Invalid compensation type'),
  body('status').optional().isIn(TEAM_RECRUITMENT_STATUSES).withMessage('Invalid recruitment status'),
  handleValidationErrors
];

const validatePlayerProfileUpdate = [
  body('profileType').optional().isIn(['looking-for-team', 'staff-position']).withMessage('Invalid profile type'),
  body('game').optional({ checkFalsy: true }).isIn(ALLOWED_GAMES).withMessage('Invalid game selection'),
  body('role').optional({ checkFalsy: true }).isString().withMessage('Role must be text').bail().isLength({ max: 120 }).withMessage('Role cannot exceed 120 characters'),
  body('staffRole').optional({ checkFalsy: true }).isIn(ALLOWED_STAFF_ROLES).withMessage('Invalid staff role'),
  body('playerInfo').optional().isObject().withMessage('Player information must be an object'),
  body('professionalInfo').optional().isObject().withMessage('Professional information must be an object'),
  body('expectations').optional().isObject().withMessage('Expectations must be an object'),
  ...optionalTextValidators(PLAYER_PROFILE_TEXT_FIELDS),
  body('playerInfo.currentRank').optional({ checkFalsy: true }).isIn(ALLOWED_PLAYER_RANKS).withMessage('Invalid current rank'),
  body('professionalInfo.availability').optional({ checkFalsy: true }).isIn(ALLOWED_STAFF_AVAILABILITY).withMessage('Invalid availability'),
  body('expectations.teamType').optional({ checkFalsy: true }).isIn(ALLOWED_TEAM_TYPES).withMessage('Invalid team type'),
  body('expectations.compensationPreference').optional({ checkFalsy: true }).isIn(ALLOWED_PLAYER_COMPENSATION).withMessage('Invalid compensation preference'),
  body('status').optional().isIn(PLAYER_PROFILE_STATUSES).withMessage('Invalid profile status'),
  handleValidationErrors
];

// Application Validation
const validateApplication = [
  body('message')
    .optional()
    .isString()
    .withMessage('Message must be text')
    .bail()
    .isLength({ max: 1000 })
    .withMessage('Message cannot exceed 1000 characters'),
  body('resume')
    .optional()
    .isString()
    .withMessage('Resume must be a URL string')
    .bail()
    .isLength({ max: 2000 })
    .withMessage('Resume URL cannot exceed 2000 characters')
    .bail()
    .custom((value) => {
      if (value && value.trim() !== '') {
        return /^https?:\/\/.+/.test(value);
      }
      return true;
    })
    .withMessage('Resume must be a valid URL'),
  body('portfolio')
    .optional()
    .isString()
    .withMessage('Portfolio must be a URL string')
    .bail()
    .isLength({ max: 2000 })
    .withMessage('Portfolio URL cannot exceed 2000 characters')
    .bail()
    .custom((value) => {
      if (value && value.trim() !== '') {
        return /^https?:\/\/.+/.test(value);
      }
      return true;
    })
    .withMessage('Portfolio must be a valid URL'),
  handleValidationErrors
];

const validateApplicationStatus = [
  body('status').isIn(TEAM_APPLICATION_STATUSES).withMessage('Invalid application status'),
  body('message').optional().isString().withMessage('Message must be text').bail().isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters'),
  handleValidationErrors
];

const validateProfileInterest = [
  body('message').optional().isString().withMessage('Message must be text').bail().isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateRecruitment,
  validateRecruitmentUpdate,
  validatePlayerProfile,
  validatePlayerProfileUpdate,
  validateApplication,
  validateApplicationStatus,
  validateProfileInterest
};
