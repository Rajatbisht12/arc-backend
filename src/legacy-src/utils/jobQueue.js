/**
 * Job Queue Bridge
 * ----------------
 * Provides enqueueEmail() and enqueueBulkNotifications() to legacy JS code.
 * The actual queue handlers are injected from TypeScript at startup.
 *
 * If the queue is not available (Redis down, not injected yet),
 * falls back to synchronous execution.
 */

let _enqueueEmail = null;
let _enqueueBulkNotifications = null;

/**
 * Inject the queue functions from TypeScript land.
 */
const setQueueFunctions = ({ enqueueEmail, enqueueBulkNotifications }) => {
  _enqueueEmail = enqueueEmail;
  _enqueueBulkNotifications = enqueueBulkNotifications;
};

/**
 * Enqueue an email to be sent in the background.
 * Falls back to direct sending if queue is unavailable.
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} [link]
 */
const enqueueEmail = async (to, subject, text, link) => {
  if (_enqueueEmail) {
    try {
      await _enqueueEmail(to, subject, text, link);
      return;
    } catch {
      // Fall through to direct send
    }
  }

  // Fallback: send directly (blocking but ensures delivery)
  try {
    const { sendNotificationEmail } = require('./email');
    await sendNotificationEmail(to, subject, text, link);
  } catch {
    // Best-effort
  }
};

/**
 * Enqueue bulk notifications in the background.
 * Falls back to direct bulk insert if queue is unavailable.
 * @param {string[]} recipientIds
 * @param {string} title
 * @param {string} message
 * @param {string} [type]
 * @param {object} [data]
 */
const enqueueBulkNotifications = async (recipientIds, title, message, type, data) => {
  if (_enqueueBulkNotifications) {
    try {
      await _enqueueBulkNotifications(recipientIds, title, message, type, data);
      return;
    } catch {
      // Fall through to direct insert
    }
  }

  // Fallback: direct batch insert
  try {
    const Notification = require('../models/Notification');
    const BATCH = 200;
    for (let i = 0; i < recipientIds.length; i += BATCH) {
      const slice = recipientIds.slice(i, i + BATCH);
      const ops = slice.map(id => ({
        insertOne: {
          document: {
            recipient: id,
            type: type || 'system',
            title,
            message,
            data: data || {},
            isRead: false,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }
      }));
      await Notification.bulkWrite(ops, { ordered: false });
    }
  } catch {
    // Best-effort
  }
};

module.exports = {
  setQueueFunctions,
  enqueueEmail,
  enqueueBulkNotifications
};
