let io;

const setIoInstance = (ioInstance) => {
  io = ioInstance;
};

const emitNotification = (userId, notification) => {
  if (io) {
    io.to(`user-${userId}`).emit('new-notification', notification);
  }
};

const createAndEmitNotification = async (notificationData) => {
  try {
    const Notification = require('../models/Notification');
const log = require('./logger');
    const notification = await Notification.createNotification(notificationData);
    
    // Emit real-time notification
    emitNotification(notification.recipient, notification);
    
    // Send email via background job queue (non-blocking)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const { enqueueEmail } = require('./jobQueue');
      const User = require('../models/User');
      User.findById(notificationData.recipient).select('email').lean().then((recipient) => {
        if (recipient?.email) {
          const link = process.env.CLIENT_URL ? `${process.env.CLIENT_URL}/notifications` : '';
          enqueueEmail(recipient.email, notificationData.title, notificationData.message, link).catch(() => {});
        }
      }).catch(() => {});
    }
    
    return notification;
  } catch (error) {
    log.error('Notification emit error', { error: String(error) });
    throw error;
  }
};

/**
 * Emit notifications to multiple users via socket.
 * @param {string[]} userIds
 * @param {object} notification
 */
const emitNotificationToMultiple = (userIds, notification) => {
  if (!io || !Array.isArray(userIds)) return;
  for (const userId of userIds) {
    io.to(`user-${userId}`).emit('new-notification', notification);
  }
};

module.exports = {
  setIoInstance,
  emitNotification,
  emitNotificationToMultiple,
  createAndEmitNotification
};
