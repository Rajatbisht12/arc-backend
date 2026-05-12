/**
 * Sanitize user input to prevent XSS, SQL injection, and other attacks
 * @param {string} input - Raw user input
 * @returns {string} Sanitized input
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  // Remove script tags
  sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
  
  // Remove all HTML tags
  sanitized = sanitized.replace(/<[^>]+>/g, '');
  
  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  // Remove data: protocol
  sanitized = sanitized.replace(/data:/gi, '');
  
  // Remove vbscript: protocol
  sanitized = sanitized.replace(/vbscript:/gi, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length (max 50000 characters for AI prompts - increased for detailed rotation strategies)
  sanitized = sanitized.substring(0, 50000);

  return sanitized;
};

/**
 * Sanitize object properties recursively
 * @param {object} obj - Object to sanitize
 * @returns {object} Sanitized object
 */
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} Is valid email
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate username format (alphanumeric, underscore, dash)
 * @param {string} username - Username to validate
 * @returns {boolean} Is valid username
 */
const isValidUsername = (username) => {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
};

/**
 * Sanitize filename to prevent directory traversal
 * @param {string} filename - Filename to sanitize
 * @returns {string} Safe filename
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace invalid chars with underscore
    .replace(/\.{2,}/g, '.') // Remove multiple dots (prevents ..)
    .replace(/^\.+/, '') // Remove leading dots
    .substring(0, 255); // Limit length
};

/**
 * Check if string contains SQL injection patterns
 * @param {string} input - Input to check
 * @returns {boolean} Contains SQL injection
 */
const hasSQLInjection = (input) => {
  // Whitelist common game strategy terms that might contain SQL keywords
  const gameStrategyTerms = [
    'select drop', 'select zone', 'select position', 'select waypoint',
    'drop location', 'drop point', 'drop spot',
    'update rotation', 'update strategy',
    'delete drop', 'delete location',
    'or play', 'or use', 'or rotate', 'or hold', 'or split',
    'and play', 'and use', 'and rotate', 'and hold', 'and split'
  ];
  
  // Check if input contains whitelisted game strategy terms (case insensitive)
  const lowerInput = input.toLowerCase();
  const hasGameContext = gameStrategyTerms.some(term => lowerInput.includes(term));
  
  // If it's clearly game strategy context, be more lenient
  if (hasGameContext) {
    // Only flag very obvious SQL injection patterns in game context
    const strictPatterns = [
      // Actual SQL injection: OR 1=1, AND 1=1 (with quotes or parentheses)
      /(\bOR\b\s+['"]?\d+\s*=\s*\d+['"]?)/gi,
      /(\bAND\b\s+['"]?\d+\s*=\s*\d+['"]?)/gi,
      // UNION SELECT with FROM/WHERE (actual SQL)
      /(\bUNION\b.*\bSELECT\b.*\bFROM\b)/gi,
      // SQL with quotes and semicolons (actual injection)
      /(['"]\s*;\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER))/gi,
      // Multiple SQL keywords in SQL-like syntax
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b\s+.*\bFROM\b)/gi,
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b\s+.*\bWHERE\b)/gi
    ];
    return strictPatterns.some(pattern => pattern.test(input));
  }
  
  // For non-game context, use more strict patterns
  const sqlPatterns = [
    // SQL injection with operators (OR 1=1, AND 1=1, etc.) - must have quotes or be in SQL context
    /(\bOR\b\s+['"]?\d+\s*=\s*\d+['"]?)/gi,
    /(\bAND\b\s+['"]?\d+\s*=\s*\d+['"]?)/gi,
    // UNION SELECT injection
    /(\bUNION\b.*\bSELECT\b)/gi,
    // SQL comments in suspicious context
    /(--|\/\*|\*\/).*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/gi,
    // SQL keywords with semicolons and quotes (command chaining)
    /(['"]\s*;\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER))/gi,
    // SQL keywords with FROM/WHERE (actual SQL syntax)
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b\s+.*\bFROM\b)/gi,
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b\s+.*\bWHERE\b)/gi
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
};

/**
 * Check if string contains XSS patterns
 * @param {string} input - Input to check
 * @returns {boolean} Contains XSS
 */
const hasXSS = (input) => {
  const xssPatterns = [
    /<script/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /eval\(/gi,
    /expression\(/gi
  ];

  return xssPatterns.some(pattern => pattern.test(input));
};

/**
 * Validate and sanitize message for AI Coach
 * @param {string} message - User message
 * @returns {object} Result with sanitized message and validation
 */
const validateMessage = (message) => {
  // Check if message exists
  if (!message || typeof message !== 'string') {
    return {
      valid: false,
      error: 'Message is required',
      sanitized: ''
    };
  }

  // Check length
  if (message.trim().length === 0) {
    return {
      valid: false,
      error: 'Message cannot be empty',
      sanitized: ''
    };
  }

  if (message.length > 50000) {
    return {
      valid: false,
      error: 'Message is too long (max 50000 characters)',
      sanitized: ''
    };
  }

  // Check for SQL injection
  if (hasSQLInjection(message)) {
    console.warn('⚠️ Potential SQL injection detected');
    return {
      valid: false,
      error: 'Invalid message content',
      sanitized: ''
    };
  }

  // Sanitize the message
  const sanitized = sanitizeInput(message);

  // Check if sanitized message is too different (might indicate malicious content)
  const lengthDiff = Math.abs(message.length - sanitized.length);
  if (lengthDiff > message.length * 0.5) {
    console.warn('⚠️ Message heavily sanitized - possible attack');
  }

  return {
    valid: true,
    sanitized,
    original: message
  };
};

module.exports = {
  sanitizeInput,
  sanitizeObject,
  sanitizeFilename,
  isValidEmail,
  isValidUsername,
  hasSQLInjection,
  hasXSS,
  validateMessage
};

