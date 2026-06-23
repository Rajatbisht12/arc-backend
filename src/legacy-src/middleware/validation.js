const { validationResult, body } = require('express-validator');
const ALLOWED_GAMES = ['BGMI', 'Valorant', 'Free Fire', 'Call of Duty Mobile', 'CS:GO', 'Fortnite', 'Apex Legends', 'League of Legends', 'Dota 2'];
const ALLOWED_STAFF_ROLES = [
  'Coach',
  'Manager',
  'Content Creator',
  'Video Editor',
  'Social Media Manager',
  'GFX Artist',
  'Scrims Manager',
  'Tournament Manager',
  'Analyst',
  'Stream Manager'
];

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
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
  body('game')
    .notEmpty()
    .withMessage('Game is required')
    .isIn(ALLOWED_GAMES)
    .withMessage('Invalid game selection'),
  body('role')
    .if(body('recruitmentType').equals('roster'))
    .notEmpty()
    .withMessage('Role is required for roster recruitment'),
  body('staffRole')
    .if(body('recruitmentType').equals('staff'))
    .notEmpty()
    .withMessage('Staff role is required for staff recruitment')
    .isIn(ALLOWED_STAFF_ROLES)
    .withMessage('Invalid staff role'),
  body('requirements.salary')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Salary description cannot exceed 200 characters'),
  body('benefits.contactInformation')
    .notEmpty()
    .withMessage('Contact information is required'),
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
    .notEmpty()
    .withMessage('Role is required for looking for team profile'),
  body('staffRole')
    .if(body('profileType').equals('staff-position'))
    .notEmpty()
    .withMessage('Staff role is required for staff position profile')
    .isIn(ALLOWED_STAFF_ROLES)
    .withMessage('Invalid staff role'),
  body('expectations.contactInformation')
    .notEmpty()
    .withMessage('Contact information is required'),
  handleValidationErrors
];

// Application Validation
const validateApplication = [
  body('message')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Message cannot exceed 1000 characters'),
  body('resume')
    .optional()
    .custom((value) => {
      if (value && value.trim() !== '') {
        return /^https?:\/\/.+/.test(value);
      }
      return true;
    })
    .withMessage('Resume must be a valid URL'),
  body('portfolio')
    .optional()
    .custom((value) => {
      if (value && value.trim() !== '') {
        return /^https?:\/\/.+/.test(value);
      }
      return true;
    })
    .withMessage('Portfolio must be a valid URL'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateRecruitment,
  validatePlayerProfile,
  validateApplication
};