const assert = require('assert');
const User = require('../models/User');
const { sanitizeNotificationsForViewer } = require('./notificationPrivacy');

const queryResult = (value) => ({
  select() { return this; },
  lean: async () => value
});

(async () => {
  const originalFind = User.find;
  try {
    User.find = () => queryResult([{
      _id: '507f1f77bcf86cd799439011',
      isActive: true,
      blockedUsers: ['507f191e810c19729de860ea']
    }]);
    const notifications = await sanitizeNotificationsForViewer([{
      _id: 'notification-1',
      type: 'message',
      sender: { _id: '507f1f77bcf86cd799439011', username: 'blocked-sender' },
      title: 'New message',
      message: 'private preview',
      data: {
        messageId: '507f1f77bcf86cd799439012',
        deepLink: '/conversation/private-chat',
        customData: { conversationId: 'private-chat' }
      }
    }], {
      _id: '507f191e810c19729de860ea',
      blockedUsers: []
    });
    assert.deepStrictEqual(notifications, []);
  } finally {
    User.find = originalFind;
  }

  console.log('Notification privacy tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
