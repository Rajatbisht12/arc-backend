/**
 * Legacy Structured Logger
 * ------------------------
 * Drop-in replacement for console.log / console.error in legacy controllers.
 *
 * In production:
 *   - Outputs JSON for machine-parseable logs (ELK, Datadog, etc.)
 *   - Uses process.stdout.write (non-blocking) instead of console.log (sync)
 *   - Supports structured metadata
 *
 * In development:
 *   - Uses standard console.log for colored/readable output
 *
 * Usage:
 *   const log = require('../utils/logger');
 *   log.info('User created', { userId: '123' });
 *   log.error('Failed to create user', { error: err.message });
 *   log.debug('Debugging flow', { step: 3 }); // Only in development
 */

const isProd = process.env.NODE_ENV === 'production';

function formatJson(level, message, meta) {
  return JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta
  }) + '\n';
}

const logger = {
  info(message, meta = {}) {
    if (isProd) {
      process.stdout.write(formatJson('info', message, meta));
    } else {
      console.log(`[INFO] ${message}`, Object.keys(meta).length ? meta : '');
    }
  },

  warn(message, meta = {}) {
    if (isProd) {
      process.stdout.write(formatJson('warn', message, meta));
    } else {
      console.warn(`[WARN] ${message}`, Object.keys(meta).length ? meta : '');
    }
  },

  error(message, meta = {}) {
    if (isProd) {
      process.stderr.write(formatJson('error', message, meta));
    } else {
      console.error(`[ERROR] ${message}`, Object.keys(meta).length ? meta : '');
    }
  },

  debug(message, meta = {}) {
    if (!isProd) {
      console.log(`[DEBUG] ${message}`, Object.keys(meta).length ? meta : '');
    }
    // In production, debug logs are silently dropped (no I/O)
  }
};

module.exports = logger;
