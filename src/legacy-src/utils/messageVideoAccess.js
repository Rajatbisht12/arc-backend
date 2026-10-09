const { idString } = require('./privacyPolicy');
const { getGroupMembershipWindow, canReadGroupMessageAt } = require('./groupMembershipPrivacy');

const canReadMessageVideo = (message, viewerId, room) => {
  if (!message || message.deletedForEveryone || message.isDeleted) return false;
  if ((message.deletedForUsers || []).some((entry) => idString(entry.user) === idString(viewerId))) return false;

  if (message.messageType === 'direct') {
    return idString(message.sender) === idString(viewerId)
      || idString(message.recipient) === idString(viewerId);
  }
  if (message.messageType === 'group') {
    return Boolean(room?.isActive)
      && idString(room._id) === idString(message.chatRoom)
      && canReadGroupMessageAt(getGroupMembershipWindow(room, viewerId), message.createdAt);
  }
  return false;
};

module.exports = { canReadMessageVideo };
